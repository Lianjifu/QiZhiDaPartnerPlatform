/**
 * 技能中心 · 技能详情 Modal 之 详情面板（M09 P1 拆分）。
 *
 * 由原 SkillsDetailModal.tsx 拆分出来：runtime / versions / access 三块面板。
 * overview 面板（包含 promote-to-store + runtime-config）保留在 SkillsDetailModal.tsx 中。
 *
 * 复用约定：所有 props 都是非受控局部组件，仅依赖父级传入的 canWrite / onNotice / state。
 */
import { Badge, Button, Input } from '@qzda/web-ui';
import {
  Activity, CheckCircle2, Container, Eye, History, Lock, Play, Settings,
  ShieldCheck, Sparkles, Terminal, Trash2, X,
} from 'lucide-react';
import { cn } from '@qzda/web-utils';
import { EmptyState } from '@/components/shared';
import type { SkillAuditEvent, SkillPermission } from '@qzda/web-types';
import { Stat } from './SkillsModals';

export type DetailTab = 'overview' | 'access' | 'versions' | 'runtime';

export function RuntimePanel({
  active,
  testRunnerOpen,
  setTestRunnerOpen,
  testCmd,
  setTestCmd,
  testOutputs,
  handleRunTest,
  trace,
  skillAudit,
  canWrite,
}: {
  active: any;
  testRunnerOpen: boolean;
  setTestRunnerOpen: (open: boolean) => void;
  testCmd: string;
  setTestCmd: (cmd: string) => void;
  testOutputs: Array<{ cmd: string; out: string; ms: number; tone: 'success' | 'error' | 'info' }>;
  handleRunTest: () => void;
  trace: any;
  skillAudit: SkillAuditEvent[];
  canWrite: boolean;
}) {
  return (
    <>
      <div className="skill-detail-panel">
        <div className="skill-detail-panel__title"><Activity className="h-3.5 w-3.5 text-[var(--brand)]" />24h 运行指标</div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="调用" value={active.perf?.calls24h ?? 0} />
          <Stat label="错误率" value={`${active.perf?.errorRate ?? 0}%`} tone={(active.perf?.errorRate ?? 0) > 1 ? 'error' : 'success'} />
          <Stat label="P95" value={`${active.perf?.p95Ms ?? 0}ms`} />
        </div>
      </div>

      <div className="skill-detail-panel">
        <div className="skill-detail-panel__title">
          <Terminal className="h-3.5 w-3.5 text-[var(--brand)]" />测试运行器
          <button type="button" className="skill-detail-link ml-auto" onClick={() => setTestRunnerOpen(!testRunnerOpen)}>{testRunnerOpen ? '收起' : '展开'}</button>
        </div>
        {testRunnerOpen ? (
          <div className="space-y-2">
            <Input placeholder={`${active.name} 命令...`} className="font-mono text-xs h-8" value={testCmd} onChange={(event) => setTestCmd(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && handleRunTest()} />
            <div className="flex gap-1.5">
              <Button size="sm" className="flex-1" disabled={!canWrite} onClick={handleRunTest}><Play className="h-3 w-3" />执行（沙箱隔离）</Button>
              <Button size="sm" variant="secondary" onClick={() => setTestCmd('')} title="清空"><Trash2 className="h-3 w-3" /></Button>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {testOutputs.length === 0 ? (
                <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--bg)] p-3 text-center text-[10px] text-[var(--text-muted)]">输入命令并回车，或点击执行</div>
              ) : (
                testOutputs.map((o, i) => (
                  <div key={i} className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[10px]">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[var(--text-muted)]">→ {o.cmd}</span>
                      <Badge tone={o.tone} className="text-[9px]">{o.ms}ms</Badge>
                    </div>
                    <pre className={cn('whitespace-pre-wrap text-[10px]',
                      o.tone === 'error' ? 'text-[var(--danger)]' : o.tone === 'success' ? 'text-[var(--success)]' : 'text-[var(--text-secondary)]',
                    )}>{o.out}</pre>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">在沙箱中试跑命令，验证超时、出口与写审批策略是否符合预期。</p>
        )}
      </div>

      {trace && (
        <div className="skill-detail-panel">
          <div className="skill-detail-panel__title"><Eye className="h-3.5 w-3.5 text-[var(--brand)]" />最近执行 trace</div>
          <div className="max-h-32 space-y-0.5 overflow-y-auto font-mono text-[10px]">
            {trace.trace?.map((line: any, i: number) => (
              <div key={i} className="flex gap-2">
                <span className="shrink-0 text-[var(--text-muted)]">{line.ts}</span>
                <span className={cn(
                  line.level === 'info' ? 'text-[var(--info)]' :
                  line.level === 'debug' ? 'text-[var(--text-muted)]' :
                  'text-[var(--text-secondary)]',
                )}>[{line.level}] {line.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="skill-detail-panel">
        <div className="skill-detail-panel__title"><History className="h-3.5 w-3.5 text-[var(--brand)]" />治理审计</div>
        <div className="space-y-1.5 text-[10px]">
          {skillAudit.filter((event) => event.target.includes(active.name)).slice(0, 3).map((event) => (
            <div key={event.id} className="flex gap-2 rounded bg-[var(--bg)] px-2 py-1.5">
              <span className="font-mono text-[var(--text-muted)]">{event.time}</span>
              <span className={event.result === 'failed' ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]'}>{event.action}</span>
            </div>
          ))}
          {!skillAudit.some((event) => event.target.includes(active.name)) && <span className="text-[var(--text-muted)]">暂无该技能的治理事件</span>}
        </div>
      </div>
    </>
  );
}

export function VersionsPanel({ versions }: { versions: any[] }) {
  if (versions.length === 0) {
    return <EmptyState icon={History} title="暂无版本记录" description="后续升级、回滚和发布记录会在此处沉淀。" />;
  }
  return (
    <div className="skill-detail-panel">
      <div className="skill-detail-panel__title">
        <History className="h-3.5 w-3.5 text-[var(--brand)]" />版本历史
      </div>
      <div className="space-y-2">
        {versions.slice(0, 3).map((v) => (
          <div key={v.version} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs font-bold">v{v.version}</span>
                <Badge tone={v.type === 'major' ? 'error' : v.type === 'minor' ? 'info' : 'neutral'} className="text-[9px]">{v.type}</Badge>
              </div>
              <span className="font-mono text-[10px] text-[var(--text-muted)]">{v.date}</span>
            </div>
            <div className="mt-2 space-y-0.5 text-[11px] text-[var(--text-muted)]">
              {v.notes?.map((n: string, i: number) => (
                <div key={i} className={cn(n.startsWith('+') ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{n}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AccessPanel({ currentPerms, canWrite, active, permissionMutation, setPermsState }: {
  currentPerms: SkillPermission[];
  canWrite: boolean;
  active: any;
  permissionMutation: any;
  setPermsState: React.Dispatch<React.SetStateAction<Record<string, { canCall: boolean; canConfig: boolean }>>>;
}) {
  return (
    <div className="skill-detail-panel">
      <div className="skill-detail-panel__title">
        <Lock className="h-3.5 w-3.5 text-[var(--brand)]" />权限矩阵
        <span className="ml-auto text-[10px] font-medium text-[var(--text-muted)]">点击切换</span>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[var(--text-muted)]">
            <th className="py-1.5 text-left font-medium">角色</th>
            <th className="px-2 font-medium">调用</th>
            <th className="px-2 font-medium">配置</th>
          </tr>
        </thead>
        <tbody>
          {currentPerms.map((p: any) => (
            <tr key={p.role} className="border-t border-[var(--border)]">
              <td className="py-2 font-semibold">{p.role}</td>
              <td className="px-2 text-center">
                <button
                  disabled={!canWrite}
                  onClick={() => permissionMutation.mutate({ id: active.id, role: p.role, canCall: !p.canCall, canConfig: p.canConfig }, { onSuccess: (saved: any) => setPermsState((s) => ({ ...s, [saved.role]: { canCall: saved.canCall, canConfig: saved.canConfig } })) })}
                  className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  {p.canCall ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" /> : <X className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
                </button>
              </td>
              <td className="px-2 text-center">
                <button
                  disabled={!canWrite}
                  onClick={() => permissionMutation.mutate({ id: active.id, role: p.role, canCall: p.canCall, canConfig: !p.canConfig }, { onSuccess: (saved: any) => setPermsState((s) => ({ ...s, [saved.role]: { canCall: saved.canCall, canConfig: saved.canConfig } })) })}
                  className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  {p.canConfig ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" /> : <X className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OverviewPanel({
  active,
  governance,
  canWrite,
  governanceMutation,
  showRuntimeConfig,
  activeRuntimeSettings,
  setRuntimeSettings,
  runtimeMutation,
  promoteTicket,
  setPromoteTicket,
  publishToCatalogMutation,
}: {
  active: any;
  governance: any;
  canWrite: boolean;
  governanceMutation: any;
  showRuntimeConfig: boolean;
  activeRuntimeSettings: { cacheable: boolean; timeout: string; retries: string } | null;
  setRuntimeSettings: React.Dispatch<React.SetStateAction<Record<string, { cacheable: boolean; timeout: string; retries: string }>>>;
  runtimeMutation: any;
  promoteTicket: string;
  setPromoteTicket: (s: string) => void;
  publishToCatalogMutation: any;
}) {
  return (
    <>
      <div className="skill-detail-overview-grid">
        <div className="skill-detail-panel">
          <div className="skill-detail-panel__title">
            <Container className="h-3.5 w-3.5 text-[var(--success)]" />
            执行隔离
            <small>gVisor · 受控</small>
          </div>
          <dl className="skill-detail-kv skill-detail-kv--stack">
            <div>
              <dt>运行时</dt>
              <dd className="font-mono">runsc · gvisor 20240603</dd>
            </div>
            <div>
              <dt>隔离边界</dt>
              <dd>
                <ul className="skill-detail-chip-list">
                  <li>syscall 拦截</li>
                  <li>网络命名空间</li>
                  <li>文件只读挂载</li>
                </ul>
              </dd>
            </div>
            {(active as any).source === 'package' && (
              <div>
                <dt>制品来源</dt>
                <dd>
                  技能包{(active as any).hasScripts ? ` · ${(active as any).scripts?.length ?? 0} 个脚本` : ''}
                  {(active as any).packageFileName ? <span className="mt-1 block truncate font-mono text-[10px] text-[var(--text-muted)]">{(active as any).packageFileName}</span> : null}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div className="skill-detail-panel">
          <div className="skill-detail-panel__title"><ShieldCheck className="h-3.5 w-3.5 text-[var(--brand)]" />生产安全策略</div>
          <dl className="skill-detail-kv skill-detail-kv--stack">
            <div>
              <dt>密钥引用</dt>
              <dd className="truncate font-mono text-[var(--brand)]" title={governance?.secretRef}>{governance?.secretRef ?? '加载中'}</dd>
            </div>
            <div>
              <dt>网络出口</dt>
              <dd>
                {(governance?.allowedEgress?.length ?? 0) > 0 ? (
                  <ul className="skill-detail-chip-list">
                    {governance!.allowedEgress.map((host: string) => <li key={host}>{host}</li>)}
                  </ul>
                ) : (
                  <span className="text-[var(--text-muted)]">无外网出口</span>
                )}
              </dd>
            </div>
            <div>
              <dt>写操作审批</dt>
              <dd><Badge tone={governance?.writeApprovalRequired ? 'warn' : 'success'} className="text-[9px]">{governance?.writeApprovalRequired ? '必须审批' : '无需审批'}</Badge></dd>
            </div>
          </dl>
          {canWrite && (
            <div className="skill-detail-policy-toggles" role="group" aria-label="安全策略开关">
              <button type="button" className={cn('skill-detail-toggle', governance?.writeApprovalRequired && 'is-on')} onClick={() => governance && governanceMutation.mutate({ writeApprovalRequired: !governance.writeApprovalRequired })}>
                <span>写审批</span><strong>{governance?.writeApprovalRequired ? '开' : '关'}</strong>
              </button>
              <button type="button" className={cn('skill-detail-toggle', governance?.dataMaskingEnabled && 'is-on')} onClick={() => governance && governanceMutation.mutate({ dataMaskingEnabled: !governance.dataMaskingEnabled })}>
                <span>脱敏</span><strong>{governance?.dataMaskingEnabled ? '开' : '关'}</strong>
              </button>
              <button type="button" className={cn('skill-detail-toggle', governance?.circuitBreakerEnabled && 'is-on')} onClick={() => governance && governanceMutation.mutate({ circuitBreakerEnabled: !governance.circuitBreakerEnabled })}>
                <span>熔断</span><strong>{governance?.circuitBreakerEnabled ? '开' : '关'}</strong>
              </button>
            </div>
          )}
        </div>
      </div>

      {canWrite && (
        <div className="skill-detail-panel">
          <div className="skill-detail-panel__title"><Sparkles className="h-3.5 w-3.5 text-[var(--brand)]" />晋升到技能商店</div>
          <p className="mb-3 text-[11px] leading-5 text-[var(--text-muted)]">将本工作区已验证技能上架为可安装目录条目；高风险 / 全局可见需审批单号。</p>
          <div className="flex flex-wrap gap-2">
            <Input value={promoteTicket} onChange={(event) => setPromoteTicket(event.target.value)} placeholder="审批单号（可选/按策略必填）" className="h-8 min-w-[160px] flex-1 text-xs" />
            <Button size="sm" variant="secondary" loading={publishToCatalogMutation.isPending} onClick={() => publishToCatalogMutation.mutate({
              skillId: active.id, releaseChannel: active.riskLevel === 'high' ? 'beta' : 'stable',
              visibilityScope: 'workspace', approvalTicket: promoteTicket.trim() || undefined,
            })}>上架到商店</Button>
            <Button size="sm" variant="outline" loading={publishToCatalogMutation.isPending} onClick={() => publishToCatalogMutation.mutate({
              skillId: active.id, releaseChannel: 'stable', visibilityScope: 'global',
              approvalTicket: promoteTicket.trim() || 'APR-GLOBAL',
            })}>全局上架</Button>
          </div>
        </div>
      )}

      {showRuntimeConfig && activeRuntimeSettings && (
        <div className="skill-detail-panel">
          <div className="skill-detail-panel__title">
            <Settings className="h-3.5 w-3.5 text-[var(--brand)]" />运行配置
            <Badge tone={active.riskLevel === 'high' ? 'error' : active.riskLevel === 'mid' ? 'warn' : 'success'} className="ml-auto text-[9px]">{active.riskLevel === 'high' ? '高风险变更受控' : '沙箱策略生效'}</Badge>
          </div>
          <div className="space-y-3 text-xs">
            <label className="flex items-center justify-between gap-3 rounded-lg bg-[var(--bg)] px-3 py-2">
              <span><span className="block font-medium">结果缓存</span><span className="mt-0.5 block text-[10px] text-[var(--text-muted)]">相同请求命中隔离缓存</span></span>
              <input type="checkbox" disabled={!canWrite} checked={activeRuntimeSettings.cacheable} onChange={(event) => setRuntimeSettings((settings) => ({ ...settings, [active.id]: { ...activeRuntimeSettings, cacheable: event.target.checked } }))} className="h-4 w-4 accent-[var(--brand)]" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] font-medium text-[var(--text-muted)]">超时（秒）<Input value={activeRuntimeSettings.timeout} disabled={!canWrite} onChange={(event) => setRuntimeSettings((settings) => ({ ...settings, [active.id]: { ...activeRuntimeSettings, timeout: event.target.value } }))} className="mt-1 h-8 font-mono text-xs" inputMode="numeric" /></label>
              <label className="text-[10px] font-medium text-[var(--text-muted)]">失败重试<Input value={activeRuntimeSettings.retries} disabled={!canWrite} onChange={(event) => setRuntimeSettings((settings) => ({ ...settings, [active.id]: { ...activeRuntimeSettings, retries: event.target.value } }))} className="mt-1 h-8 font-mono text-xs" inputMode="numeric" /></label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" disabled={!canWrite} onClick={() => runtimeMutation.mutate({ id: active.id, ...activeRuntimeSettings }, { onSuccess: () => undefined })}><CheckCircle2 className="h-3.5 w-3.5" />保存</Button>
              <Button size="sm" variant="ghost" onClick={() => undefined}>收起</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
