import { useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock3, Filter, RefreshCcw, Shield, UserPlus, UsersRound,
} from 'lucide-react';
import { Badge, Button, Input, KpiCard, toast } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { AccessGrant, AccessReview, ReleaseApproval, SeparationOfDutyRule, Role } from '@qzda/web-types';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useT } from '@/i18n';

type GovernanceData = {
  grants: AccessGrant[];
  reviews: AccessReview[];
  rules: SeparationOfDutyRule[];
  conflicts: Array<{ id: string; subjectName: string; reason: string; severity: 'medium' | 'high' }>;
  generatedAt: string;
};
type Tab = 'access' | 'approvals' | 'controls';

const roleLabel: Record<Role, string> = { user: '普通用户', admin: '管理员', auditor: '审计用户' };
const environmentLabel = { sandbox: '开发', staging: '测试', production: '生产' };
const workspaceLabel: Record<string, string> = {
  w1: 'ACME 生产',
  w2: 'ACME 预发',
  w3: 'ACME 安全',
  w4: '外协沙箱',
};

const panelClass = 'de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]';

export default function Governance({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('access');
  const [grantOpen, setGrantOpen] = useState(false);
  const governance = useApiQuery<GovernanceData>(['access-governance'], '/api/access/governance');
  const approvals = useApiQuery<ReleaseApproval[]>(['release-approvals'], '/api/release-approvals');
  const completeReview = useApiMutation<AccessReview, { id: string }>('/api/access/reviews/complete', {
    onSuccess: () => toast.success('权限复核已完成并记录审计'),
  });
  const releaseAction = useApiMutation<ReleaseApproval, { id: string }>(
    ({ id }) => `/api/release-approvals/${id}/approve`,
    { onSuccess: () => toast.success('生产发布已审批并写入审计'), onError: (error: any) => toast.error(error?.message ?? '审批失败') },
  );
  const rejectRelease = useApiMutation<ReleaseApproval, { id: string }>(
    ({ id }) => `/api/release-approvals/${id}/reject`,
    { onSuccess: () => toast.success('发布申请已驳回') },
  );

  const pendingApprovals = useMemo(
    () => (approvals.data ?? []).filter((item) => item.status === 'pending'),
    [approvals.data],
  );
  const data = governance.data;
  const grants = data?.grants ?? [];
  const activeGrants = grants.filter((g) => g.status === 'active').length;
  const expiringGrants = grants.filter((g) => g.status === 'expiring').length;
  const sodIssues = (data?.conflicts ?? []).length + (data?.rules ?? []).filter((r) => r.violations).length;

  const tabItems: Array<[Tab, string]> = [
    ['access', t('module.governance.tabs.access')],
    ['approvals', `${t('module.governance.tabs.approvals')}${pendingApprovals.length ? ` · ${pendingApprovals.length}` : ''}`],
    ['controls', t('module.governance.tabs.controls')],
  ];

  const tabNav = (
    <nav
      className={cn('settings-subnav', !embedded && 'mt-4')}
      aria-label="访问治理分类"
    >
      {tabItems.map(([key, label]) => (
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
  );

  const grantButton = (
    <Button size="sm" onClick={() => setGrantOpen(true)}>
      <UserPlus className="h-3.5 w-3.5" />授予访问
    </Button>
  );

  return (
    <div className={cn(embedded ? 'min-w-0 space-y-3' : 'mx-auto min-h-full max-w-[1480px] p-3 sm:p-4 lg:p-5')}>
      {!embedded ? (
        <>
          <header className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="flex items-center gap-2 text-base font-semibold">
                  <Shield className="h-4 w-4 text-[var(--brand)]" />{t('module.governance.title')}
                </h1>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{t('module.governance.subtitle')}</p>
              </div>
              {grantButton}
            </div>
            {tabNav}
          </header>
          <section className="settings-kpis mt-3">
            <KpiCard label="生效授权" value={activeGrants} sub="个" icon={UsersRound} tone="brand" size="comfortable" />
            <KpiCard label="即将到期" value={expiringGrants} sub="个" icon={Clock3} tone={expiringGrants ? 'warn' : 'success'} size="comfortable" />
            <KpiCard label="待发布审批" value={pendingApprovals.length} sub="项" icon={Shield} tone={pendingApprovals.length ? 'warn' : 'success'} size="comfortable" />
            <KpiCard label="职责风险" value={sodIssues} sub="项" icon={AlertTriangle} tone={sodIssues ? 'warn' : 'success'} size="comfortable" />
          </section>
        </>
      ) : (
        <>
          <section className="settings-kpis">
            <KpiCard label="生效授权" value={activeGrants} sub="个" icon={UsersRound} tone="brand" size="comfortable" />
            <KpiCard label="即将到期" value={expiringGrants} sub="个" icon={Clock3} tone={expiringGrants ? 'warn' : 'success'} size="comfortable" />
            <KpiCard label="待发布审批" value={pendingApprovals.length} sub="项" icon={Shield} tone={pendingApprovals.length ? 'warn' : 'success'} size="comfortable" />
            <KpiCard label="职责风险" value={sodIssues} sub="项" icon={AlertTriangle} tone={sodIssues ? 'warn' : 'success'} size="comfortable" />
          </section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {tabNav}
            {grantButton}
          </div>
        </>
      )}

      <div className={cn(!embedded && 'mt-3')}>
        {governance.isLoading ? (
          <div className={cn(panelClass, 'p-10 text-center text-sm text-[var(--text-muted)]')}>正在加载访问治理数据…</div>
        ) : governance.error ? (
          <ErrorPanel message="无法读取访问治理数据" onRetry={() => governance.refetch()} />
        ) : (
          <>
            {tab === 'access' && <AccessScope grants={grants} embedded={embedded} />}
            {tab === 'approvals' && (
              <Approvals
                rows={pendingApprovals}
                onApprove={(id) => releaseAction.mutate({ id })}
                onReject={(id) => rejectRelease.mutate({ id })}
                busy={releaseAction.isPending || rejectRelease.isPending}
                embedded={embedded}
              />
            )}
            {tab === 'controls' && (
              <Controls
                rules={data?.rules ?? []}
                reviews={data?.reviews ?? []}
                conflicts={data?.conflicts ?? []}
                onComplete={(id) => completeReview.mutate({ id })}
                busy={completeReview.isPending}
                embedded={embedded}
              />
            )}
          </>
        )}
      </div>

      {grantOpen && <GrantDialog onClose={() => setGrantOpen(false)} />}
    </div>
  );
}

function AccessScope({ grants, embedded }: { grants: AccessGrant[]; embedded: boolean }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () => grants.filter((grant) =>
      `${grant.subjectName} ${grant.role} ${grant.workspaceIds.join(' ')} ${grant.grantedBy}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
    [grants, query],
  );

  return (
    <section className={cn(embedded ? panelClass : 'overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]')}>
      <div
        className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border)] px-4 py-3 md:px-5"
        style={{ boxShadow: 'var(--saas-divider)' }}
      >
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">用户与访问范围</h2>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">角色定义动作范围，工作区与环境定义其生效边界。</p>
        </div>
        <div className="flex h-9 w-full max-w-xs items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 sm:w-auto">
          <Filter className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索成员、角色或工作区"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--text-muted)]"
          />
        </div>
      </div>

      <div className="hidden border-b border-[var(--border)] bg-[var(--bg-elevated)] px-5 py-2 text-[11px] font-medium text-[var(--text-muted)] lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,0.75fr)] lg:gap-4">
        <span>成员</span>
        <span>平台角色</span>
        <span>工作区范围</span>
        <span>环境范围</span>
        <span>状态</span>
        <span>授权来源</span>
      </div>

      <div className="divide-y divide-[var(--border)]">
        {filtered.length ? filtered.map((grant) => (
          <article
            key={grant.id}
            className="grid gap-3 px-4 py-3 text-xs transition-colors hover:bg-[var(--bg-hover)] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,0.75fr)] lg:items-center lg:gap-4 lg:px-5"
          >
            <div className="font-semibold">{grant.subjectName}</div>
            <div>
              <Badge tone={grant.role === 'admin' ? 'brand' : grant.role === 'auditor' ? 'warn' : 'neutral'} className="text-[9px]">
                {roleLabel[grant.role]}
              </Badge>
            </div>
            <div className="text-[var(--text-secondary)]">
              {grant.workspaceIds.map((id) => workspaceLabel[id] ?? id).join('、')}
            </div>
            <div className="text-[var(--text-secondary)]">
              {grant.environmentScopes.map((item) => environmentLabel[item]).join('、')}
            </div>
            <div>
              <Badge tone={grant.status === 'active' ? 'success' : grant.status === 'expiring' ? 'warn' : 'neutral'} className="text-[9px]">
                {grant.status === 'active' ? '生效中' : grant.status === 'expiring' ? '即将到期' : '已失效'}
              </Badge>
              {grant.expiresAt && (
                <span className="ml-2 text-[10px] text-[var(--text-muted)]">
                  至 {new Date(grant.expiresAt).toLocaleDateString('zh-CN')}
                </span>
              )}
            </div>
            <div className="text-[var(--text-muted)]">{grant.grantedBy}</div>
          </article>
        )) : (
          <div className="px-4 py-10 text-center text-xs text-[var(--text-muted)] md:px-5">没有匹配的授权记录</div>
        )}
      </div>

      <div className="border-t border-[var(--border)] px-4 py-3 text-[11px] text-[var(--text-muted)] md:px-5">
        共 {filtered.length} 条授权；临时访问到期后自动失效，所有变更写入审计。
      </div>
    </section>
  );
}

function Approvals({
  rows,
  onApprove,
  onReject,
  busy,
  embedded,
}: {
  rows: ReleaseApproval[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  busy: boolean;
  embedded: boolean;
}) {
  return (
    <section className={cn(embedded ? panelClass : 'overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]')}>
      <div className="border-b border-[var(--border)] px-4 py-3 md:px-5">
        <h2 className="text-sm font-semibold">生产发布审批</h2>
        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">创建者不可审批自己的变更；审批动作自动产生关联审计事件。</p>
      </div>
      <div className="hidden border-b border-[var(--border)] bg-[var(--bg-elevated)] px-5 py-2 text-[11px] font-medium text-[var(--text-muted)] lg:grid lg:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,0.6fr)_minmax(0,0.8fr)_auto] lg:gap-4">
        <span>风险</span>
        <span>资源</span>
        <span>级别</span>
        <span>关联 ID</span>
        <span className="text-right">操作</span>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {rows.length ? rows.map((row) => (
          <article
            key={row.id}
            className="grid gap-3 px-4 py-3 lg:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,0.6fr)_minmax(0,0.8fr)_auto] lg:items-center lg:gap-4 lg:px-5"
          >
            <span className={cn('h-2 w-2 rounded-full', row.risk === 'high' ? 'bg-[var(--danger)]' : 'bg-[var(--warning)]')} />
            <div className="min-w-0">
              <div className="text-xs font-semibold">{row.resourceName}</div>
              <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                {row.resourceType} · {workspaceLabel[row.workspaceId] ?? row.workspaceId} · {environmentLabel[row.environment]} · 提交人 {row.submittedBy}
              </div>
            </div>
            <Badge tone={row.risk === 'high' ? 'error' : 'warn'} className="w-fit text-[9px]">
              {row.risk === 'high' ? '高风险' : '中风险'}
            </Badge>
            <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">{row.correlationId}</span>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => onReject(row.id)}>驳回</Button>
              <Button size="sm" disabled={busy} onClick={() => onApprove(row.id)}>审批</Button>
            </div>
          </article>
        )) : (
          <div className="px-4 py-12 text-center text-xs text-[var(--text-muted)]">没有待处理的发布申请</div>
        )}
      </div>
    </section>
  );
}

function Controls({
  rules,
  reviews,
  conflicts,
  onComplete,
  busy,
  embedded,
}: {
  rules: SeparationOfDutyRule[];
  reviews: AccessReview[];
  conflicts: Array<{ id: string; subjectName: string; reason: string; severity: 'medium' | 'high' }>;
  onComplete: (id: string) => void;
  busy: boolean;
  embedded: boolean;
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
      <section className={cn(embedded ? panelClass : 'rounded-lg border border-[var(--border)] bg-[var(--bg)]', 'p-4 md:p-5')}>
        <h2 className="text-sm font-semibold">职责分离规则</h2>
        <div className="mt-3 space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
              <CheckCircle2 className={cn('mt-0.5 h-4 w-4 shrink-0', rule.enabled ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold">{rule.title}</div>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">{rule.description}</p>
              </div>
              <Badge tone={rule.violations ? 'warn' : 'success'} className="text-[9px]">
                {rule.violations ? `${rule.violations} 项待处理` : '已执行'}
              </Badge>
            </div>
          ))}
        </div>
      </section>

      <div className="space-y-3">
        <section className={cn(embedded ? panelClass : 'rounded-lg border border-[var(--border)] bg-[var(--bg)]', 'p-4 md:p-5')}>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Clock3 className="h-4 w-4 text-[var(--brand)]" />权限复核
          </h2>
          <div className="mt-3 space-y-2">
            {reviews.map((review) => (
              <div key={review.id} className="rounded-lg border border-[var(--border)] p-3">
                <div className="flex justify-between gap-2">
                  <strong className="text-xs">{review.title}</strong>
                  <Badge tone={review.status === 'completed' ? 'success' : 'warn'} className="text-[9px]">
                    {review.status === 'completed' ? '已完成' : '待复核'}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">{review.scope} · {review.reviewed}/{review.total} 已完成</p>
                {review.status !== 'completed' && (
                  <Button size="sm" variant="secondary" className="mt-2" disabled={busy} onClick={() => onComplete(review.id)}>
                    完成复核
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className={cn(
          embedded ? panelClass : 'rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-bg)]/30',
          'p-4 md:p-5',
          embedded && 'border-[var(--warning)]/30 bg-[color-mix(in_srgb,var(--warning)_6%,var(--surface-1))]',
        )}>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />权限风险提示
          </h2>
          <div className="mt-3 space-y-2">
            {conflicts.map((item) => (
              <div key={item.id} className="text-[11px]">
                <strong>{item.subjectName}</strong>
                <p className="mt-0.5 text-[var(--text-secondary)]">{item.reason}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function GrantDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [workspaceId, setWorkspaceId] = useState('w1');
  const [production, setProduction] = useState(false);
  const create = useApiMutation<AccessGrant, Partial<AccessGrant>>('/api/access/grants', {
    onSuccess: () => { toast.success('访问范围已授予并写入审计'); onClose(); },
    onError: (error: any) => toast.error(error?.message ?? '授权失败'),
  });

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/30 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--bg)] p-5 shadow-xl">
        <h2 className="text-sm font-semibold">授予访问范围</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">最小权限原则：按工作区与环境授予，临时访问应设置到期时间。</p>
        <label className="mt-4 block text-xs">
          成员名称
          <Input className="mt-1" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：陈小雨" />
        </label>
        <label className="mt-3 block text-xs">
          平台角色
          <select className="mt-1 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2" value={role} onChange={(event) => setRole(event.target.value as Role)}>
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
            <option value="auditor">审计用户</option>
          </select>
        </label>
        <label className="mt-3 block text-xs">
          工作区
          <select className="mt-1 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
            {Object.entries(workspaceLabel).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
        <label className="mt-3 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={production} onChange={(event) => setProduction(event.target.checked)} />
          包含生产环境
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>取消</Button>
          <Button
            size="sm"
            loading={create.isPending}
            onClick={() => create.mutate({
              subjectName: name,
              role,
              workspaceIds: [workspaceId],
              environmentScopes: production ? ['sandbox', 'staging', 'production'] : ['sandbox', 'staging'],
            })}
          >
            确认授权
          </Button>
        </div>
      </div>
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-[var(--danger)]/40 bg-[var(--bg)] p-8 text-center">
      <AlertTriangle className="mx-auto h-5 w-5 text-[var(--danger)]" />
      <p className="mt-2 text-sm font-medium">{message}</p>
      <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
        <RefreshCcw className="h-3.5 w-3.5" />重试
      </Button>
    </div>
  );
}
