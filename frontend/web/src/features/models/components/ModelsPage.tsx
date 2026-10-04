/**
 * 模型中心页面壳：路由分发到 ModelsTab.* / ModelsModals.*（按 M08 P1 决策）。
 *
 * 拆分原因：原 pages/Models.tsx 2273L，按 D1 决策拆为 12 个子文件；
 * 本文件聚焦壳层：tab 路由、KPI 卡、工作区面板与所有弹层入口。
 */
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { KpiCard } from '@qzda/web-ui';
import { Activity, AlertTriangle, CheckCircle2, Cloud, FileKey2, FlaskConical, History, Network, Plus, Route, ShieldCheck } from 'lucide-react';
import { EmptyState, RoleReadonlyBanner } from '@/components/shared';
import { budgetRiskLabel, defaultModelTab, type ModelWorkspaceTab } from '@/features/models/model-ui';
import { rolePageCopy } from '@/features/role-nav/role-nav';
import { cn } from '@qzda/web-utils';
import { useModelsController } from './useModelsController';
import { ModelsTabProviders } from './ModelsTab.Providers';
import { ModelsTabGovernance } from './ModelsTab.Governance';
import { ModelsTabAudit } from './ModelsTab.Audit';
import { ModelsModals } from './ModelsModals';

type TT = (key: string, fallback?: string) => string;

const WORKSPACES: Array<{ key: ModelWorkspaceTab; labelKey: string; icon: typeof Cloud; description: string }> = [
  { key: 'access', labelKey: 'module.models.tabs.access', icon: Cloud, description: '接入供应商、验证连通性，并管理凭据引用与退役影响。' },
  { key: 'governance', labelKey: 'module.models.tabs.governance', icon: Activity, description: '观察运行健康、预算占用与地域分布；在 sandbox 隔离范围验证已发布路由的降级链。' },
  { key: 'audit', labelKey: 'module.models.tabs.audit', icon: History, description: '追溯接入、校验、发布、回滚、退役与演练结果。' },
];

export default function ModelsPage() {
  const { t } = useT();
  const c = useModelsController();
  return <ModelsPageShell controller={c} t={t} />;
}

function ModelsPageShell({ controller: c, t }: { controller: ReturnType<typeof useModelsController>; t: TT }) {
  const navigate = useNavigate();
  const pageCopy = rolePageCopy('models', c.user?.role);
  const activeWorkspace = WORKSPACES.find((item) => item.key === c.workspace) ?? WORKSPACES.find((item) => item.key === defaultModelTab(c.user?.role)) ?? WORKSPACES[0];
  const visibleWorkspaces = WORKSPACES.filter((item) => c.visibleTabs.includes(item.key));

  return (
    <div className="models-page h-full min-w-0 overflow-y-auto bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5">
      <div className="space-y-3" aria-label="模型中心">
        {c.isAuditor && <RoleReadonlyBanner />}
        <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
          <div className="flex items-start justify-between gap-4 px-4 py-3.5 md:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg text-[var(--text-secondary)]">
                  {c.isAuditor ? <History className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
                </div>
                <h1 className="text-base font-semibold text-[var(--text)]">{pageCopy.title}</h1>
              </div>
              <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{pageCopy.subtitle}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {!c.isAuditor && (
                <span className="de-employee-hint hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--warning)] sm:inline-flex">
                  <AlertTriangle className="h-3 w-3" />控制面治理 · KMS 由服务端执行
                </span>
              )}
              {c.workspace === 'access' && (
                <button type="button" className="de-employee-btn de-employee-btn--primary" disabled={!c.canWrite} onClick={() => navigate('/models/providers/new')}>
                  <Plus className="h-3.5 w-3.5" />接入供应商
                </button>
              )}
              {c.workspace === 'governance' && (
                <button
                  type="button"
                  className="de-employee-btn de-employee-btn--primary"
                  disabled={!c.canWrite || !c.drillEligibility.ready}
                  title={!c.drillEligibility.ready ? c.drillEligibility.guidance : '打开 sandbox 故障切换演练'}
                  onClick={() => c.setDrillModalOpen(true)}
                >
                  <FlaskConical className="h-3.5 w-3.5" />sandbox 演练
                </button>
              )}
            </div>
          </div>
          {visibleWorkspaces.length > 1 && (
            <div className="de-employee-tabs flex overflow-x-auto px-3" role="tablist" aria-label="模型控制面工作区">
              {visibleWorkspaces.map(({ key, labelKey, icon: Icon }) => (
                <button
                  key={key}
                  id={`model-workspace-tab-${key}`}
                  type="button"
                  role="tab"
                  aria-controls={`model-workspace-${key}`}
                  aria-selected={c.workspace === key}
                  onClick={() => c.setWorkspace(key)}
                  className={cn('de-employee-tab flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-xs transition-colors', c.workspace === key && 'is-active')}
                >
                  <Icon className="h-3.5 w-3.5" />{t(labelKey)}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className={cn('grid grid-cols-2 gap-3', c.workspace === 'governance' || c.workspace === 'audit' ? 'lg:grid-cols-4' : 'lg:grid-cols-3')} aria-label="控制面摘要">
          {c.workspace === 'governance' ? (
            <>
              <KpiCard label="健康占比" value={c.governance?.healthyShare ?? 0} sub="%" icon={Activity} tone="info" size="comfortable" />
              <KpiCard label="预算状态" value={budgetRiskLabel(c.governance?.budgetRisk ?? 'normal')} icon={ShieldCheck} tone={c.budgetTone} size="comfortable" />
              <KpiCard label="本月消耗" value={c.governance?.monthlySpendUsd ?? 0} sub="USD" icon={Network} tone="warn" size="comfortable" />
              <KpiCard label="可演练路由" value={c.drillEligibility.count} sub={`/ ${c.drillEligibility.total} 已发布`} icon={FlaskConical} tone={c.drillEligibility.ready ? 'success' : 'warn'} size="comfortable" />
            </>
          ) : c.workspace === 'audit' ? (
            <>
              <KpiCard label="审计事件" value={c.auditEvents.length} sub="条" icon={History} tone="info" size="comfortable" />
              <KpiCard label="成功" value={c.auditSuccessCount} sub="条" icon={CheckCircle2} tone="success" size="comfortable" />
              <KpiCard label="失败" value={c.auditFailedCount} sub="条" icon={AlertTriangle} tone={c.auditFailedCount ? 'warn' : 'neutral'} size="comfortable" />
              <KpiCard label="动作类型" value={c.auditActions.length} sub="种" icon={FileKey2} tone="brand" size="comfortable" />
            </>
          ) : (
            <>
              <KpiCard label="可用供应商" value={c.providers.filter((item) => item.status === 'active').length} sub="个" icon={Cloud} tone="brand" size="comfortable" />
              <KpiCard label="已发布路由" value={c.routingSummary.published} sub="条" icon={Route} tone="success" size="comfortable" />
              <KpiCard label="预算状态" value={budgetRiskLabel(c.governance?.budgetRisk ?? 'normal')} icon={ShieldCheck} tone={c.budgetTone} size="comfortable" />
            </>
          )}
        </section>

        <section
          id={`model-workspace-${c.workspace}`}
          role="tabpanel"
          aria-labelledby={`model-workspace-tab-${c.workspace}`}
          className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]"
        >
          {c.queryState.kind === 'loading' ? (
            <div className="p-8 text-center text-xs text-[var(--text-muted)]">{c.queryState.label}…</div>
          ) : c.queryState.kind === 'error' ? (
            <div className="p-8 text-center">
              <AlertTriangle className="mx-auto h-6 w-6 text-[var(--danger)]" />
              <p className="mt-3 text-sm font-medium">{c.queryState.label}</p>
              {c.queryState.detail ? (
                <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[var(--text-muted)]">{c.queryState.detail}</p>
              ) : null}
              <button type="button" className="mt-4 inline-flex items-center rounded-md bg-[var(--bg)] px-3 py-1.5 text-xs text-[var(--text)]" onClick={c.refetchControlPlane}>重新读取</button>
            </div>
          ) : c.queryState.kind === 'empty' ? (
            <div className="p-8">
              <EmptyState
                icon={c.isAuditor ? History : Cloud}
                title={c.isAuditor ? '暂无模型控制面审计事件' : c.queryState.label}
                description={c.isAuditor ? '接入、发布、回滚与演练操作发生后，证据会出现在此。' : '请先接入供应商。'}
              />
            </div>
          ) : c.workspace === 'access' ? (
            <ModelsTabProviders
              c={c}
              description="接入后验证连通性；被已发布路由引用的供应商需先取消发布或替换模型后再删除。"
              canWrite={c.canWrite}
              providers={c.providers}
              policies={c.policies}
              onSelect={(id) => navigate(`/models/providers/${encodeURIComponent(id)}`)}
              onDelete={(provider) => c.setDeleteProvider(provider)}
            />
          ) : c.workspace === 'governance' ? (
            <ModelsTabGovernance
              canWrite={c.canWrite}
              snapshot={c.governance}
              models={c.models}
              policies={c.policies}
              description={activeWorkspace.description}
              lastDrillResult={c.lastDrillResult}
              onOpenDrill={(policyId) => {
                if (policyId) c.setDrillPolicyId(policyId);
                c.setDrillModalOpen(true);
              }}
              onGoRouting={() => {
                const first = c.providers[0];
                navigate(first
                  ? `/models/providers/new?id=${encodeURIComponent(first.id)}&step=routing`
                  : '/models/providers/new');
              }}
              onConfigurePolicy={c.openPolicyFromGovernance}
            />
          ) : (
            <ModelsTabAudit
              events={c.filteredAudit}
              description={activeWorkspace.description}
              resultFilter={c.auditResultFilter}
              actionFilter={c.auditActionFilter}
              actions={c.auditActions}
              onResultFilter={c.setAuditResultFilter}
              onActionFilter={c.setAuditActionFilter}
            />
          )}
        </section>
      </div>

      <ModelsModals c={c} />
    </div>
  );
}
