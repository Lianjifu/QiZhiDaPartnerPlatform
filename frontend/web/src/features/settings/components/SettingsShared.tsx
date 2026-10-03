/**
 * SettingsShared — 平台设置各 tab 共用的小件:MENU、PanelHeader、FeatureCard、
 * Field、BillingFact、KeyStatusBadge、SettingsToggle、panelClass 常量。
 * M09 P1 拆分原因:原 pages/Settings.tsx 单文件 734L,提取共享件避免 5 个 tab 文件重复。
 */
import { useState, type ReactNode } from 'react';
import {
  Building2, ShieldCheck, CreditCard, Database, Clock3, HardDrive,
  Key, Webhook, Users, ShieldAlert, ScrollText, Fingerprint, Timer,
  CheckCircle2, ExternalLink,
} from 'lucide-react';
import { Badge } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';

export const MENU = [
  { key: 'tenant', labelKey: 'module.settings.tabs.organization', icon: Building2 },
  { key: 'security', labelKey: 'module.settings.tabs.identity', icon: Fingerprint },
  { key: 'backup', labelKey: 'module.settings.tabs.retention', icon: HardDrive },
  { key: 'apikeys', labelKey: 'module.settings.tabs.integration', icon: Key },
  { key: 'billing', labelKey: 'module.settings.tabs.usage', icon: CreditCard },
  { key: 'access', labelKey: 'nav.accessControl', icon: Users },
  { key: 'zeroTrust', labelKey: 'nav.zeroTrust', icon: ShieldAlert },
  { key: 'auditCenter', labelKey: 'nav.auditCenter', icon: ScrollText },
] as const;

export type TabKey = (typeof MENU)[number]['key'];
export const SETTINGS_TAB_KEYS = new Set<string>(MENU.map((item) => item.key));
export const panelClass = 'de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]';

export function PanelHeader({
  icon: Icon,
  title,
  description,
  trailing,
}: {
  icon: typeof Building2;
  title: string;
  description?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="settings-panel__head">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <span className="settings-panel__icon">
            <Icon className="h-3.5 w-3.5" />
          </span>
          {title}
        </div>
        {description ? <p className="settings-panel__desc">{description}</p> : null}
      </div>
      {trailing ? <div className="settings-panel__trailing shrink-0">{trailing}</div> : null}
    </div>
  );
}

export function FeatureCard({
  icon: Icon,
  title,
  description,
  meta,
  actionLabel,
  onAction,
}: {
  icon: typeof Building2;
  title: string;
  description: string;
  meta?: string[];
  actionLabel: string;
  onAction?: () => void;
}) {
  return (
    <article className="settings-feature-card">
      <div className="settings-feature-card__icon">
        <Icon className="h-4 w-4" />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {meta && meta.length > 0 ? (
        <div className="settings-feature-card__meta">
          {meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ) : null}
      <button type="button" className="settings-feature-card__action" onClick={onAction}>
        {actionLabel}
        <ExternalLink className="h-3 w-3 opacity-70" />
      </button>
    </article>
  );
}

export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="settings-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function BillingFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function KeyStatusBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge tone="success">生效中</Badge>;
  if (status === 'warning') return <Badge tone="warn">即将到期</Badge>;
  return <Badge tone="neutral">{status}</Badge>;
}

export function SettingsToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('settings-switch', checked && 'is-on')}
    >
      <span />
    </button>
  );
}

// Re-export icons commonly used across tab components so each tab file
// doesn't need to import them again from lucide-react.
export {
  ShieldCheck, CreditCard, Database, Clock3, HardDrive, Key, Webhook,
  Users, Timer, CheckCircle2,
};
