import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, LockKeyhole, Plus, RefreshCw, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { Badge, Button, Input, toast } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { TemporaryAuthorization, ZeroTrustEvent, ZeroTrustPolicy } from '@qzda/web-types';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';

type OverviewApi = {
  policyCount?: number;
  enabledCount?: number;
  eventCount?: number;
  activeTempAuth?: number;
  /** legacy / mock */
  policies?: number;
  blocked?: number;
  approvals?: number;
  masked?: number;
  risk?: 'normal' | 'attention';
  updatedAt?: string;
};

type Tab = 'overview' | 'policies' | 'authorizations' | 'events';

const decisionMeta = {
  allow: ['允许', 'success'],
  mask: ['脱敏', 'info'],
  approval_required: ['需审批', 'warn'],
  deny: ['已阻断', 'error'],
} as const;

function formatTime(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return '—';
  }
}

export default function ZeroTrust({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useT();
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const isAuditor = useAuthStore((state) => state.user?.role === 'auditor');
  const [tab, setTab] = useState<Tab>(isAuditor ? 'policies' : 'overview');
  const [formOpen, setFormOpen] = useState(false);

  const overview = useApiQuery<OverviewApi>(['zero-trust', 'overview'], '/api/zero-trust/overview');
  const policies = useApiQuery<ZeroTrustPolicy[]>(['zero-trust', 'policies'], '/api/zero-trust/policies');
  const authorizations = useApiQuery<TemporaryAuthorization[]>(['zero-trust', 'authorizations'], '/api/zero-trust/authorizations');
  const events = useApiQuery<ZeroTrustEvent[]>(['zero-trust', 'events'], '/api/zero-trust/events', undefined, { refetchInterval: 15_000 });

  const togglePolicy = useApiMutation<ZeroTrustPolicy, { id: string; enabled: boolean }>(
    ({ id }) => `/api/zero-trust/policies/${id}`,
    { onSuccess: () => toast.success('策略版本已更新并写入审计') },
    'PATCH',
  );
  const revoke = useApiMutation<TemporaryAuthorization, { id: string }>(
    ({ id }) => `/api/zero-trust/authorizations/${id}/revoke`,
    { onSuccess: () => toast.success('临时授权已回收') },
  );

  const policyRows = policies.data ?? [];
  const authRows = authorizations.data ?? [];
  const eventRows = events.data ?? [];

  const derived = useMemo(() => {
    const enabled = policyRows.filter((p) => p.enabled).length;
    const blocked = eventRows.filter((e) => e.decision === 'deny').length;
    const approvals = eventRows.filter((e) => e.decision === 'approval_required').length;
    const masked = eventRows.filter((e) => e.decision === 'mask').length;
    const activeAuth = authRows.filter((a) => a.status === 'active').length;
    return {
      policies: overview.data?.enabledCount ?? overview.data?.policies ?? enabled,
      policyTotal: overview.data?.policyCount ?? policyRows.length,
      blocked: overview.data?.blocked ?? blocked,
      approvals: overview.data?.approvals ?? approvals,
      masked: overview.data?.masked ?? masked,
      activeAuth: overview.data?.activeTempAuth ?? activeAuth,
      events: overview.data?.eventCount ?? eventRows.length,
    };
  }, [overview.data, policyRows, authRows, eventRows]);

  const tabs = (
    [
      ['overview', isAuditor ? '摘要' : t('module.zeroTrust.tabs.overview')],
      ['policies', isAuditor ? '策略版本' : t('module.zeroTrust.tabs.policies')],
      ['authorizations', isAuditor ? '临时授权记录' : t('module.zeroTrust.tabs.authorizations')],
      ['events', t('module.zeroTrust.tabs.events')],
    ] as Array<[Tab, string]>
  );

  const refreshAll = () => {
    void overview.refetch();
    void policies.refetch();
    void authorizations.refetch();
    void events.refetch();
  };

  return (
    <div className={cn('zt-verify', embedded ? 'zt-verify--embedded min-w-0' : 'mx-auto min-h-full max-w-[1480px] p-3 sm:p-4 lg:p-5')}>
      {!embedded ? (
        <header className="zt-verify__hero">
          <div className="zt-verify__hero-main">
            <div>
              <h1 className="zt-verify__title">
                <ShieldAlert className="h-4 w-4 text-[var(--brand)]" />
                {t('module.zeroTrust.title')}
              </h1>
              <p className="zt-verify__subtitle">{t('module.zeroTrust.subtitle')}</p>
              {isAuditor && (
                <p className="zt-verify__scope">只读复核：策略版本、临时授权例外与策略命中记录</p>
              )}
            </div>
            <div className="zt-verify__hero-actions">
              <Button size="sm" variant="secondary" onClick={refreshAll}>
                <RefreshCw className="h-3.5 w-3.5" />刷新
              </Button>
              {isAdmin && (
                <Button size="sm" onClick={() => setFormOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />授予临时访问
                </Button>
              )}
            </div>
          </div>
          <nav className="settings-subnav mt-4" aria-label="持续验证分类">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn('settings-subnav__item', tab === key && 'is-active')}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>
      ) : (
        <div className="zt-verify__embedded-bar">
          <nav className="settings-subnav" aria-label="持续验证分类">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn('settings-subnav__item', tab === key && 'is-active')}
              >
                {label}
              </button>
            ))}
          </nav>
          {isAdmin && (
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="h-3.5 w-3.5" />授予临时访问
            </Button>
          )}
        </div>
      )}

      <div className={cn('zt-verify__body', !embedded && 'mt-3')}>
        {tab === 'overview' && <OverviewPanel derived={derived} events={eventRows} />}
        {tab === 'policies' && (
          <Policies
            rows={policyRows}
            editable={isAdmin}
            loading={policies.isLoading}
            onToggle={(id, enabled) => togglePolicy.mutate({ id, enabled })}
          />
        )}
        {tab === 'authorizations' && (
          <Authorizations
            rows={authRows}
            editable={isAdmin}
            loading={authorizations.isLoading}
            onRevoke={(id) => revoke.mutate({ id })}
          />
        )}
        {tab === 'events' && <Events rows={eventRows} loading={events.isLoading} />}
      </div>

      <p className="zt-verify__footnote">
        <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />
        摘要数字优先来自策略/事件/授权列表聚合；评估引擎仍为控制面演示能力，不作生产级 OPA 承诺。
      </p>

      {formOpen && <AuthorizationDialog onClose={() => setFormOpen(false)} />}
    </div>
  );
}

function OverviewPanel({
  derived,
  events,
}: {
  derived: {
    policies: number;
    policyTotal: number;
    blocked: number;
    approvals: number;
    masked: number;
    activeAuth: number;
    events: number;
  };
  events: ZeroTrustEvent[];
}) {
  const cards = [
    { label: '启用策略', value: `${derived.policies}/${derived.policyTotal}`, icon: SlidersHorizontal, tone: 'brand' as const },
    { label: '命中阻断', value: String(derived.blocked), icon: ShieldAlert, tone: derived.blocked > 0 ? 'warn' as const : 'success' as const },
    { label: '待审批命中', value: String(derived.approvals), icon: Clock3, tone: derived.approvals > 0 ? 'warn' as const : 'success' as const },
    { label: '脱敏命中', value: String(derived.masked), icon: LockKeyhole, tone: 'info' as const },
    { label: '生效临时授权', value: String(derived.activeAuth), icon: AlertTriangle, tone: derived.activeAuth > 0 ? 'warn' as const : 'neutral' as const },
  ];

  return (
    <div className="space-y-3.5">
      <section className="zt-verify__kpis" aria-label="持续验证摘要">
        {cards.map((card) => (
          <div key={card.label} className={cn('zt-verify__kpi', `zt-verify__kpi--${card.tone}`)}>
            <div className="zt-verify__kpi-label">
              <card.icon className="h-3.5 w-3.5" />
              {card.label}
            </div>
            <strong className="zt-verify__kpi-value">{card.value}</strong>
          </div>
        ))}
      </section>
      <section className="zt-verify__panel">
        <div className="zt-verify__panel-head">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-[var(--brand)]" />
            最近策略命中
          </div>
          <span className="text-[11px] text-[var(--text-muted)]">共 {derived.events} 条 · 展示最近 8 条</span>
        </div>
        {events.length === 0 ? (
          <div className="zt-verify__empty">暂无策略命中记录</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {events.slice(0, 8).map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Policies({
  rows,
  editable,
  loading,
  onToggle,
}: {
  rows: ZeroTrustPolicy[];
  editable: boolean;
  loading?: boolean;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  return (
    <section className="zt-verify__panel">
      <div className="zt-verify__panel-head zt-verify__panel-head--stack">
        <h2 className="text-sm font-semibold">访问策略 / 版本</h2>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          按资源、动作、范围与条件决定允许、脱敏、审批或阻断。租户安全基线不可停用。
        </p>
      </div>
      {loading ? (
        <div className="zt-verify__empty">正在加载策略…</div>
      ) : rows.length === 0 ? (
        <div className="zt-verify__empty">暂无策略版本</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="bg-[var(--bg-elevated)] text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-2.5">策略</th>
                <th className="px-4 py-2.5">资源 / 动作</th>
                <th className="px-4 py-2.5">条件</th>
                <th className="px-4 py-2.5">处置</th>
                <th className="px-4 py-2.5">版本</th>
                <th className="px-4 py-2.5">状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const [label, tone] = decisionMeta[row.decision];
                return (
                  <tr key={row.id} className="border-t border-[var(--border)]">
                    <td className="px-4 py-3 font-medium">
                      {row.name}
                      {row.baseline && <Badge tone="brand" className="ml-2 text-[9px]">安全基线</Badge>}
                      <div className="mt-1 text-[10px] text-[var(--text-muted)]">{row.scope}</div>
                    </td>
                    <td className="px-4 py-3">{row.resource} / {row.action}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{row.condition}</td>
                    <td className="px-4 py-3"><Badge tone={tone as 'success' | 'info' | 'warn' | 'error'}>{label}</Badge></td>
                    <td className="px-4 py-3 font-mono">v{row.version}</td>
                    <td className="px-4 py-3">
                      {editable && !row.baseline ? (
                        <button
                          type="button"
                          onClick={() => onToggle(row.id, !row.enabled)}
                          className={cn(
                            'rounded px-2 py-1 text-[10px]',
                            row.enabled ? 'bg-[var(--success-bg)] text-[var(--success)]' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]',
                          )}
                        >
                          {row.enabled ? '启用' : '停用'}
                        </button>
                      ) : (
                        <Badge tone={row.enabled ? 'success' : 'neutral'}>{row.enabled ? '启用' : '停用'}</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Authorizations({
  rows,
  editable,
  loading,
  onRevoke,
}: {
  rows: TemporaryAuthorization[];
  editable: boolean;
  loading?: boolean;
  onRevoke: (id: string) => void;
}) {
  return (
    <section className="zt-verify__panel">
      <div className="zt-verify__panel-head zt-verify__panel-head--stack">
        <h2 className="text-sm font-semibold">临时授权记录</h2>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          仅对明确工作区、资源与动作生效；到期或回收后保留审计痕迹。
        </p>
      </div>
      {loading ? (
        <div className="zt-verify__empty">正在加载授权记录…</div>
      ) : rows.length === 0 ? (
        <div className="zt-verify__empty">暂无临时授权</div>
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-[150px] flex-1">
                <strong className="text-xs">{row.subjectName}</strong>
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {row.workspaceId} · {row.resource}:{row.action} · {row.reason}
                </p>
              </div>
              <span className="text-[11px] text-[var(--text-secondary)]">至 {formatTime(row.expiresAt)}</span>
              <Badge tone={row.status === 'active' ? 'warn' : 'neutral'}>
                {row.status === 'active' ? '生效中' : row.status === 'revoked' ? '已回收' : '已到期'}
              </Badge>
              {editable && row.status === 'active' && (
                <Button size="sm" variant="secondary" onClick={() => onRevoke(row.id)}>回收</Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Events({ rows, loading }: { rows: ZeroTrustEvent[]; loading?: boolean }) {
  return (
    <section className="zt-verify__panel">
      <div className="zt-verify__panel-head">
        <h2 className="text-sm font-semibold">策略命中记录</h2>
        <span className="text-[11px] text-[var(--text-muted)]">{rows.length} 条</span>
      </div>
      {loading ? (
        <div className="zt-verify__empty">正在加载命中记录…</div>
      ) : rows.length === 0 ? (
        <div className="zt-verify__empty">暂无策略命中</div>
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {rows.map((event) => (
            <EventRow key={event.id} event={event} detail />
          ))}
        </div>
      )}
    </section>
  );
}

function explainZeroTrustEvent(event: ZeroTrustEvent) {
  const next =
    event.decision === 'deny' ? '请调整请求范围或申请临时授权后重试'
      : event.decision === 'approval_required' ? '提交人工审核，通过后再继续'
        : event.decision === 'mask' ? '继续使用脱敏结果；如需明文请走授权流程'
          : '可继续，注意保留审计关联 ID';
  const impact =
    event.decision === 'deny' ? '操作已被阻断，未产生写副作用'
      : event.decision === 'approval_required' ? '操作暂停在审批门禁，待批准后执行'
        : event.decision === 'mask' ? '返回内容已脱敏，敏感字段不可见'
          : '策略允许本次访问';
  return { impact, next };
}

function EventRow({ event, detail = false }: { event: ZeroTrustEvent; detail?: boolean }) {
  const [label, tone] = decisionMeta[event.decision];
  const explained = explainZeroTrustEvent(event);
  return (
    <div className="flex flex-wrap items-start gap-3 px-4 py-3">
      <span
        className={cn(
          'mt-1.5 h-2 w-2 rounded-full',
          event.decision === 'deny' ? 'bg-[var(--danger)]'
            : event.decision === 'approval_required' ? 'bg-[var(--warning)]'
              : event.decision === 'mask' ? 'bg-[var(--info)]'
                : 'bg-[var(--success)]',
        )}
      />
      <div className="min-w-[220px] flex-1">
        <div className="text-xs font-medium">{event.reason}</div>
        <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{explained.impact}</div>
        {detail && <div className="mt-1 text-[11px] text-[var(--brand)]">说明：{explained.next}</div>}
        <div className="mt-1 text-[10px] text-[var(--text-muted)]">
          {event.actor} · {event.workspaceId} · {event.resource}:{event.action}
          {detail ? ` · ${event.classification}` : ''}
          {' · '}{formatTime(event.time)}
        </div>
      </div>
      <Badge tone={tone as 'success' | 'info' | 'warn' | 'error'}>{label}</Badge>
      <span className="font-mono text-[10px] text-[var(--text-muted)]">{event.correlationId}</span>
    </div>
  );
}

function AuthorizationDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [workspaceId, setWorkspaceId] = useState('w2');
  const [environment, setEnvironment] = useState<'sandbox' | 'staging'>('staging');
  const [hours, setHours] = useState('8');
  const create = useApiMutation<TemporaryAuthorization, Partial<TemporaryAuthorization>>(
    '/api/zero-trust/authorizations',
    {
      onSuccess: () => {
        toast.success('临时授权已生效并写入审计');
        onClose();
      },
      onError: (error: unknown) => toast.error(error instanceof Error ? error.message : '授权失败'),
    },
  );
  const duration = Math.min(24, Math.max(1, Number(hours) || 1));
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--bg)] p-5 shadow-xl">
        <h2 className="text-sm font-semibold">授予临时访问</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">仅支持开发和测试环境，最长 24 小时；生产环境需人工审核。</p>
        <label className="mt-4 block text-xs">
          成员名称
          <Input className="mt-1" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：陈小雨" />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-xs">
            工作区
            <select className="mt-1 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
              <option value="w1">ACME 生产</option>
              <option value="w2">ACME 预发</option>
              <option value="w3">ACME 安全</option>
              <option value="w4">外协沙箱</option>
            </select>
          </label>
          <label className="block text-xs">
            环境
            <select className="mt-1 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2" value={environment} onChange={(event) => setEnvironment(event.target.value as 'sandbox' | 'staging')}>
              <option value="sandbox">开发</option>
              <option value="staging">测试</option>
            </select>
          </label>
        </div>
        <label className="mt-3 block text-xs">
          有效时长（小时）
          <Input type="number" min="1" max="24" className="mt-1" value={hours} onChange={(event) => setHours(event.target.value)} />
        </label>
        <label className="mt-3 block text-xs">
          授权原因
          <Input className="mt-1" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：预发回归验证" />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>取消</Button>
          <Button
            size="sm"
            loading={create.isPending}
            disabled={!name.trim() || !reason.trim()}
            onClick={() => create.mutate({
              subjectName: name,
              workspaceId,
              environment,
              resource: 'workflow',
              action: 'run',
              reason,
              expiresAt: new Date(Date.now() + duration * 3600_000).toISOString(),
            })}
          >
            确认授权
          </Button>
        </div>
      </div>
    </div>
  );
}
