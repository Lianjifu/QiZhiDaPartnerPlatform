/**
 * 数字伙伴受控能力装配组件：
 *
 *  - `syncCapabilityModes` — 能力绑定变更时同步授权模式
 *  - `CapabilityAssemblySelector` — 受控装配编辑器（模型路由 + 认知 + 执行能力 + 上下文）
 *
 * 已发布资产选择器（`LinkedAssetPicker`）见 `PartnersTab.Capability.LinkedAsset`。
 */
import { useEffect, useRef } from 'react';
import type { DigitalPartner, DigitalPartnerBoundaryPolicy, DigitalPartnerExecutionMode } from '@qzda/web-types';
import { type DigitalPartnerCapabilityCatalog, LinkedAssetPicker } from './PartnersTab.Capability.LinkedAsset';

function mergeUniqueNames(...groups: string[][]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const name of group) {
      const key = name.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

function autoBindRuntimeNames(catalog: DigitalPartnerCapabilityCatalog) {
  return (catalog.runtimeTools ?? [])
    .filter((item) => item.autoBind !== false && (item.availability ?? 'default') !== 'opt_in')
    .map((item) => item.name);
}

export function mergeBuiltinToolBindings(catalog: DigitalPartnerCapabilityCatalog, tools: string[]) {
  const platform = (catalog.platformTools ?? []).map((item) => item.name);
  const runtimeDefault = autoBindRuntimeNames(catalog);
  const allRuntime = new Set((catalog.runtimeTools ?? []).map((item) => item.name));
  const optionalRuntime = (catalog.runtimeTools ?? [])
    .filter((item) => (item.availability ?? 'default') === 'opt_in' || item.autoBind === false)
    .map((item) => item.name);
  const enterprise = tools.filter((name) => !platform.includes(name) && !allRuntime.has(name));
  const selectedOptional = tools.filter((name) => optionalRuntime.includes(name));
  return mergeUniqueNames(platform, runtimeDefault, enterprise, selectedOptional);
}

export function isBuiltinPlatformOrRuntimeTool(catalog: DigitalPartnerCapabilityCatalog | undefined, name: string) {
  if (!catalog) return false;
  return (catalog.platformTools ?? []).some((item) => item.name === name)
    || (catalog.runtimeTools ?? []).some((item) => item.name === name);
}

export function defaultToolExecutionMode(catalog: DigitalPartnerCapabilityCatalog | undefined, name: string): DigitalPartnerExecutionMode {
  return isBuiltinPlatformOrRuntimeTool(catalog, name) ? 'execute' : 'approval_required';
}

export function normalizeBuiltinToolMode(
  catalog: DigitalPartnerCapabilityCatalog | undefined,
  capabilityType: 'tool' | 'workflow' | 'skill',
  capabilityName: string,
  mode: DigitalPartnerExecutionMode,
): DigitalPartnerExecutionMode {
  if (capabilityType !== 'tool' || !isBuiltinPlatformOrRuntimeTool(catalog, capabilityName)) return mode;
  return mode === 'approval_required' || mode === 'recommend' ? 'execute' : mode;
}

export function syncCapabilityModes(
  policy: DigitalPartnerBoundaryPolicy,
  capabilities: DigitalPartner['capabilities'],
  catalog?: DigitalPartnerCapabilityCatalog,
): DigitalPartnerBoundaryPolicy {
  const bound = [
    ...capabilities.skills.map((capabilityName) => ({ capabilityType: 'skill' as const, capabilityName, fallback: 'recommend' as DigitalPartnerExecutionMode })),
    ...capabilities.tools.map((capabilityName) => ({ capabilityType: 'tool' as const, capabilityName, fallback: defaultToolExecutionMode(catalog, capabilityName) })),
    ...capabilities.workflows.map((capabilityName) => ({ capabilityType: 'workflow' as const, capabilityName, fallback: 'approval_required' as DigitalPartnerExecutionMode })),
  ];
  return {
    ...policy,
    capabilityModes: bound.map((item) => {
      const existing = policy.capabilityModes.find((mode) => mode.capabilityType === item.capabilityType && mode.capabilityName === item.capabilityName);
      if (existing) {
        return {
          ...existing,
          mode: normalizeBuiltinToolMode(catalog, item.capabilityType, item.capabilityName, existing.mode),
        };
      }
      return { capabilityType: item.capabilityType, capabilityName: item.capabilityName, mode: item.fallback };
    }),
  };
}

export function CapabilityAssemblySelector({ catalog, capabilities, policy, onChangeCapabilities, onChangePolicy }: {
  catalog?: DigitalPartnerCapabilityCatalog;
  capabilities: DigitalPartner['capabilities'];
  policy: DigitalPartnerBoundaryPolicy;
  onChangeCapabilities: (capabilities: DigitalPartner['capabilities']) => void;
  onChangePolicy: (policy: DigitalPartnerBoundaryPolicy) => void;
}) {
  const seededCatalogRef = useRef('');
  const updateAssets = (key: 'knowledge' | 'skills' | 'tools' | 'workflows' | 'channels', values: string[]) => {
    const next = { ...capabilities, [key]: values };
    onChangeCapabilities(next);
    if (key === 'skills' || key === 'tools' || key === 'workflows') onChangePolicy(syncCapabilityModes(policy, next, catalog));
  };
  useEffect(() => {
    if (!catalog) return;
    const signature = JSON.stringify({
      platform: (catalog.platformTools ?? []).map((item) => item.name),
      runtime: autoBindRuntimeNames(catalog),
    });
    if (seededCatalogRef.current === signature) return;
    seededCatalogRef.current = signature;
    const merged = mergeBuiltinToolBindings(catalog, capabilities.tools);
    const next = { ...capabilities, tools: merged };
    if (merged.join('\0') !== capabilities.tools.join('\0')) {
      onChangeCapabilities(next);
    }
    onChangePolicy(syncCapabilityModes(policy, next, catalog));
  // 仅在能力目录加载/变更时补齐内置绑定，避免与用户编辑循环触发
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);
  const modeOf = (capabilityType: 'tool' | 'workflow' | 'skill', capabilityName: string) => {
    const existing = policy.capabilityModes.find((item) => item.capabilityType === capabilityType && item.capabilityName === capabilityName)?.mode;
    if (existing) return existing;
    if (capabilityType === 'skill') return 'recommend';
    if (capabilityType === 'tool') return defaultToolExecutionMode(catalog, capabilityName);
    return 'approval_required';
  };
  const setMode = (capabilityType: 'tool' | 'workflow' | 'skill', capabilityName: string, mode: DigitalPartnerExecutionMode) => {
    const exists = policy.capabilityModes.some((item) => item.capabilityType === capabilityType && item.capabilityName === capabilityName);
    onChangePolicy({
      ...policy,
      capabilityModes: exists
        ? policy.capabilityModes.map((item) => item.capabilityType === capabilityType && item.capabilityName === capabilityName ? { ...item, mode } : item)
        : [...policy.capabilityModes, { capabilityType, capabilityName, mode }],
    });
  };
  const modelOptions = catalog?.models ?? [];
  const modelInCatalog = modelOptions.some((item) => item.name === capabilities.model);
  const platformTools = catalog?.platformTools ?? [];
  const runtimeTools = catalog?.runtimeTools ?? [];
  const defaultRuntimeTools = runtimeTools.filter((item) => item.autoBind !== false && (item.availability ?? 'default') !== 'opt_in');
  const optionalRuntimeTools = runtimeTools.filter((item) => (item.availability ?? 'default') === 'opt_in' || item.autoBind === false);
  const platformNames = new Set(platformTools.map((item) => item.name));
  const runtimeNames = new Set(runtimeTools.map((item) => item.name));
  const executableCount = capabilities.skills.length + capabilities.tools.length + capabilities.workflows.length;
  const catalogEmpty = Boolean(catalog) && modelOptions.length === 0 && (catalog?.skills.length ?? 0) === 0 && (catalog?.tools.length ?? 0) === 0 && (catalog?.workflows.length ?? 0) === 0;
  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            模型路由 <span className="text-[var(--danger)]">*</span>
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">可选已发布路由策略，或当前工作区已激活供应商的可用对话模型</p>
        </div>
        <select
          value={capabilities.model}
          onChange={(event) => onChangeCapabilities({ ...capabilities, model: event.target.value })}
          className="h-9 min-w-[260px] max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs outline-none focus:border-[var(--brand)]"
        >
          {!capabilities.model && <option value="">请选择已发布路由或对话模型</option>}
          {capabilities.model && !modelInCatalog && (
            <option value={capabilities.model}>{capabilities.model}（历史绑定，建议改选目录中的路由）</option>
          )}
          {modelOptions.map((item) => (
            <option key={`${item.id}:${item.name}`} value={item.name} title={item.meta}>
              {item.name} · {item.meta}
            </option>
          ))}
        </select>
        {capabilities.agentId && (
          <span className="w-full text-[11px] text-[var(--text-muted)] sm:w-auto sm:border-l sm:border-[var(--border)] sm:pl-3">
            运行时已绑定（内部）
          </span>
        )}
      </section>

      {!catalog && <div className="rounded-xl px-3 py-8 text-center text-xs text-[var(--text-muted)]" style={{ boxShadow: 'var(--saas-ring)' }}>正在同步各能力中心的可选资产…</div>}

      {catalogEmpty && (
        <div className="rounded-xl border border-dashed border-[var(--warning)]/40 bg-[var(--warning-bg)]/40 px-3.5 py-3 text-[11px] leading-5 text-[var(--text-secondary)]">
          当前工作区暂无已发布可装配资产。请先在「模型服务」发布路由并激活供应商，在「技能中心 / 工作流程 / 知识中心 / 消息渠道」发布对应资产后返回刷新。
        </div>
      )}

      {catalog && (
        <>
          <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3.5 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">认知思路模型</h3>
                <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                  对话中自动选用逻辑思考 / 问题解决 / 创意决策骨架；可关闭或设部门偏好。
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={capabilities.cognitive?.enabled !== false}
                  onChange={(event) => onChangeCapabilities({
                    ...capabilities,
                    cognitive: {
                      enabled: event.target.checked,
                      defaultPack: capabilities.cognitive?.defaultPack ?? 'base-cognitive-v1',
                      allowOverride: capabilities.cognitive?.allowOverride ?? true,
                      maxFrameworksPerTurn: capabilities.cognitive?.maxFrameworksPerTurn ?? 2,
                      preferredFramework: capabilities.cognitive?.preferredFramework,
                    },
                  })}
                />
                启用
              </label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)] sm:col-span-2">
                <input
                  type="checkbox"
                  checked={capabilities.cognitive?.showNarrative !== false}
                  disabled={capabilities.cognitive?.enabled === false}
                  onChange={(event) => onChangeCapabilities({
                    ...capabilities,
                    cognitive: {
                      enabled: capabilities.cognitive?.enabled !== false,
                      defaultPack: capabilities.cognitive?.defaultPack ?? 'base-cognitive-v1',
                      allowOverride: capabilities.cognitive?.allowOverride ?? true,
                      maxFrameworksPerTurn: capabilities.cognitive?.maxFrameworksPerTurn ?? 2,
                      preferredFramework: capabilities.cognitive?.preferredFramework,
                      showNarrative: event.target.checked,
                    },
                  })}
                />
                展示三阶段思考叙事（意图理解 → 任务规划 → 工具执行）
              </label>
              <label className="grid gap-1.5 text-xs font-medium">
                默认偏好框架
                <select
                  value={capabilities.cognitive?.preferredFramework ?? ''}
                  disabled={capabilities.cognitive?.enabled === false}
                  onChange={(event) => onChangeCapabilities({
                    ...capabilities,
                    cognitive: {
                      enabled: capabilities.cognitive?.enabled !== false,
                      defaultPack: capabilities.cognitive?.defaultPack ?? 'base-cognitive-v1',
                      allowOverride: capabilities.cognitive?.allowOverride ?? true,
                      maxFrameworksPerTurn: capabilities.cognitive?.maxFrameworksPerTurn ?? 2,
                      preferredFramework: capabilities.cognitive?.preferredFramework,
                      showNarrative: capabilities.cognitive?.showNarrative,
                    },
                  })}
                  className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs font-normal outline-none focus:border-[var(--brand)] disabled:opacity-50"
                >
                  <option value="">自动（按问题信号）</option>
                  <option value="logic">逻辑思考分析</option>
                  <option value="problem">问题解决分析</option>
                  <option value="creative">创意决策分析</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-medium">
                每回合最多框架数
                <select
                  value={String(capabilities.cognitive?.maxFrameworksPerTurn ?? 2)}
                  disabled={capabilities.cognitive?.enabled === false}
                  onChange={(event) => onChangeCapabilities({
                    ...capabilities,
                    cognitive: {
                      enabled: capabilities.cognitive?.enabled !== false,
                      defaultPack: capabilities.cognitive?.defaultPack ?? 'base-cognitive-v1',
                      allowOverride: capabilities.cognitive?.allowOverride ?? true,
                      maxFrameworksPerTurn: Number(event.target.value) || 2,
                      preferredFramework: capabilities.cognitive?.preferredFramework,
                      showNarrative: capabilities.cognitive?.showNarrative,
                    },
                  })}
                  className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs font-normal outline-none focus:border-[var(--brand)] disabled:opacity-50"
                >
                  <option value="1">1（仅主框架）</option>
                  <option value="2">2（主 + 辅）</option>
                </select>
              </label>
            </div>
          </section>

          <section className="space-y-2.5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">执行能力</h3>
                <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">仅列出已启用技能/工具与已发布流程 · 已绑 {executableCount} 项</p>
              </div>
            </div>
            <div className="space-y-2.5">
              <LinkedAssetPicker label="技能" hint="" options={catalog.skills} values={capabilities.skills} onChange={(values) => updateAssets('skills', values)} capabilityType="skill" modeOf={(name) => modeOf('skill', name)} onModeChange={(name, mode) => setMode('skill', name, mode)} emptyHint="技能中心暂无已启用技能" />
              <LinkedAssetPicker label="企业工具 / MCP" hint="" options={catalog.tools} values={capabilities.tools.filter((n) => !platformNames.has(n) && !runtimeNames.has(n))} onChange={(values) => {
                const platform = capabilities.tools.filter((n) => platformNames.has(n));
                const runtime = capabilities.tools.filter((n) => runtimeNames.has(n));
                updateAssets('tools', [...platform, ...runtime, ...values]);
              }} capabilityType="tool" modeOf={(name) => modeOf('tool', name)} onModeChange={(name, mode) => setMode('tool', name, mode)} emptyHint="暂无已启用工具 / MCP" />
              {platformTools.length > 0 && (
                <LinkedAssetPicker label="平台工具" hint="内置 · 默认全员可用 · 不可关闭" options={platformTools} values={capabilities.tools.filter((n) => platformNames.has(n))} onChange={(values) => {
                  const enterprise = capabilities.tools.filter((n) => !platformNames.has(n) && !runtimeNames.has(n));
                  const runtime = capabilities.tools.filter((n) => runtimeNames.has(n));
                  updateAssets('tools', [...values, ...runtime, ...enterprise]);
                }} capabilityType="tool" modeOf={(name) => modeOf('tool', name)} onModeChange={(name, mode) => setMode('tool', name, mode)} emptyHint="—" readonly hideModeSelector />
              )}
              {defaultRuntimeTools.length > 0 && (
                <LinkedAssetPicker label="运行时工具" hint="内置 · 文件、搜索、任务与 MCP 等" options={defaultRuntimeTools} values={capabilities.tools.filter((n) => defaultRuntimeTools.some((item) => item.name === n))} onChange={(values) => {
                  const platform = capabilities.tools.filter((n) => platformNames.has(n));
                  const enterprise = capabilities.tools.filter((n) => !platformNames.has(n) && !runtimeNames.has(n));
                  const optional = capabilities.tools.filter((n) => optionalRuntimeTools.some((item) => item.name === n));
                  updateAssets('tools', [...platform, ...values, ...optional, ...enterprise]);
                }} capabilityType="tool" modeOf={(name) => modeOf('tool', name)} onModeChange={(name, mode) => setMode('tool', name, mode)} emptyHint="—" readonly hideModeSelector />
              )}
              {optionalRuntimeTools.length > 0 && (
                <LinkedAssetPicker label="可选运行时工具" hint="按需启用" options={optionalRuntimeTools} values={capabilities.tools.filter((n) => optionalRuntimeTools.some((item) => item.name === n))} onChange={(values) => {
                  const platform = capabilities.tools.filter((n) => platformNames.has(n));
                  const runtimeDefault = capabilities.tools.filter((n) => defaultRuntimeTools.some((item) => item.name === n));
                  const enterprise = capabilities.tools.filter((n) => !platformNames.has(n) && !runtimeNames.has(n));
                  updateAssets('tools', [...platform, ...runtimeDefault, ...values, ...enterprise]);
                }} capabilityType="tool" modeOf={(name) => modeOf('tool', name)} onModeChange={(name, mode) => setMode('tool', name, mode)} emptyHint="—" />
              )}
              <LinkedAssetPicker label="流程技能与工作流" hint="" options={catalog.workflows} values={capabilities.workflows} onChange={(values) => updateAssets('workflows', values)} capabilityType="workflow" modeOf={(name) => modeOf('workflow', name)} onModeChange={(name, mode) => setMode('workflow', name, mode)} emptyHint="请先在工作流程中心发布流程技能" />
            </div>
          </section>

          <section className="space-y-2.5">
            <div>
              <h3 className="text-sm font-semibold">上下文资产</h3>
              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">知识与渠道为引用，不设执行授权</p>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <LinkedAssetPicker label="知识" hint="" options={catalog.knowledge} values={capabilities.knowledge} onChange={(values) => updateAssets('knowledge', values)} compact emptyHint="请先发布知识包" />
              <LinkedAssetPicker label="渠道" hint="" options={catalog.channels} values={capabilities.channels} onChange={(values) => updateAssets('channels', values)} compact emptyHint="请先启用消息渠道" />
            </div>
          </section>
        </>
      )}

      <p className="text-[11px] leading-4 text-[var(--text-muted)]">
        仅可选择各能力中心已发布/已启用资产；能力装配保存后立即生效。技能执行授权仍可按项设为「需双重审批后执行」。
      </p>
    </div>
  );
}