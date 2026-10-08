/**
 * 数字伙伴能力装配式资产选择器：
 *
 *  - `LinkedAssetPicker` — 已发布资产中心选择器（技能 / 工作流 / 工具 / 知识 / 渠道）
 *  - `CapabilityCatalogOption` / `DigitalPartnerCapabilityCatalog` — 类型定义
 *
 * 编辑器与同步逻辑（`CapabilityAssemblySelector` / `syncCapabilityModes`）见 `PartnersTab.Capability.Assembly`。
 */
import { useState } from 'react';
import type { DigitalPartnerExecutionMode } from '@qzda/web-types';
import { Badge } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { executionModeOptions } from './PartnersShared';

export type CapabilityCatalogOption = { id: string; name: string; meta: string; removable?: boolean; builtin?: boolean; autoBind?: boolean; availability?: string };
export type DigitalPartnerCapabilityCatalog = {
  models: CapabilityCatalogOption[];
  knowledge: CapabilityCatalogOption[];
  skills: CapabilityCatalogOption[];
  tools: CapabilityCatalogOption[];
  workflows: CapabilityCatalogOption[];
  channels: CapabilityCatalogOption[];
  platformTools?: CapabilityCatalogOption[];
  runtimeTools?: CapabilityCatalogOption[];
};

export function LinkedAssetPicker({ label, hint, options, values, onChange, capabilityType, modeOf, onModeChange, compact, emptyHint, readonly }: {
  label: string;
  hint: string;
  options: CapabilityCatalogOption[];
  values: string[];
  onChange: (values: string[]) => void;
  capabilityType?: 'tool' | 'workflow' | 'skill';
  modeOf?: (name: string) => DigitalPartnerExecutionMode;
  onModeChange?: (name: string, mode: DigitalPartnerExecutionMode) => void;
  compact?: boolean;
  emptyHint?: string;
  readonly?: boolean;
}) {
  const [filter, setFilter] = useState('');
  const displayValues = readonly ? options.map((item) => item.name) : values;
  const available = readonly ? [] : options.filter((item) => !values.includes(item.name) && (!filter.trim() || `${item.name} ${item.meta}`.toLowerCase().includes(filter.trim().toLowerCase())));
  const remove = (name: string) => {
    const option = options.find((item) => item.name === name);
    if (readonly || option?.removable === false) return;
    onChange(values.filter((item) => item !== name));
  };
  const withMode = Boolean(capabilityType && modeOf && onModeChange);
  return (
    <section className={cn('rounded-xl border border-[var(--border)] bg-[var(--bg)]', compact ? 'p-3' : 'p-3.5')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold">{label}</h3>
            <span className="text-[10px] tabular-nums text-[var(--text-muted)]">{displayValues.length}</span>
            {readonly && <Badge tone="neutral">内置</Badge>}
          </div>
          {!compact && <p className="mt-0.5 text-[11px] leading-4 text-[var(--text-muted)]">{hint}</p>}
        </div>
        {!readonly && (
          <div className="flex items-center gap-1.5">
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="搜索"
              className="h-8 w-[108px] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs outline-none focus:border-[var(--brand)]"
              aria-label={`搜索${label}`}
            />
            <select
              aria-label={`添加${label}`}
              value=""
              disabled={!available.length}
              onChange={(event) => {
                const selected = event.target.value;
                if (selected) {
                  onChange([...values, selected]);
                  setFilter('');
                }
              }}
              className="h-8 max-w-[160px] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs outline-none focus:border-[var(--brand)] disabled:opacity-50"
            >
              <option value="">{available.length ? '+ 添加' : '无可选资产'}</option>
              {available.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className={cn('mt-2.5 space-y-1.5', !displayValues.length && 'min-h-0')}>
        {displayValues.length ? displayValues.map((value) => {
          const option = options.find((item) => item.name === value);
          return (
            <div key={value} className="flex items-center gap-2 rounded-lg bg-[var(--surface-1)] px-2.5 py-2" style={{ boxShadow: 'var(--saas-ring)' }}>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{value}</span>
                {!compact && <span className="block truncate text-[10px] text-[var(--text-muted)]">{option?.meta ?? '历史已绑定资产（目录中已不存在）'}</span>}
              </div>
              {withMode && modeOf && onModeChange && (() => {
                const currentMode = modeOf(value);
                const isMissing = !currentMode;
                return (
                  <select
                    value={currentMode}
                    onChange={(event) => onModeChange(value, event.target.value as DigitalPartnerExecutionMode)}
                    className={cn(
                      'h-7 max-w-[148px] shrink-0 rounded-md border bg-[var(--bg)] px-1.5 text-[11px] outline-none focus:border-[var(--brand)]',
                      isMissing
                        ? 'border-[var(--danger)] ring-1 ring-[var(--danger)]/30'
                        : 'border-[var(--border)]',
                    )}
                    aria-label={`${value} 授权模式`}
                    aria-invalid={isMissing || undefined}
                  >
                    <option value="" disabled={!isMissing}>
                      {isMissing ? '请选择授权模式 *' : '—'}
                    </option>
                    {executionModeOptions.map(([modeValue, modeLabel]) => (
                      <option key={modeValue} value={modeValue}>{modeLabel}</option>
                    ))}
                  </select>
                );
              })()}
              {!readonly && option?.removable !== false && (
                <button type="button" onClick={() => remove(value)} className="shrink-0 rounded-md px-1 text-xs text-[var(--text-muted)] hover:bg-[var(--danger-light)] hover:text-[var(--danger)]" aria-label={`移除 ${value}`}>×</button>
              )}
            </div>
          );
        }) : (
          <p className="rounded-lg border border-dashed border-[var(--border)] px-2.5 py-2 text-[11px] text-[var(--text-muted)]">
            {options.length ? '尚未选择' : (emptyHint ?? '暂无可选资产')}
          </p>
        )}
      </div>
    </section>
  );
}