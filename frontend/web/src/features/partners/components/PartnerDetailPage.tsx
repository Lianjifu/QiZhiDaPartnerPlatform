/**
 * 数字伙伴详情页：只读核查档案、能力、运行与证据；配置跳转分步向导。
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { DigitalPartner, DigitalPartnerLifecycle } from '@qzda/web-types';
import { Badge, Button } from '@qzda/web-ui';
import { ArrowLeft, ClipboardCheck, HeartPulse, MessageSquare, Pause, Play, ShieldAlert } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { roleCanMutate } from '@/features/role-nav/role-nav';
import {
  capabilityAssemblyCompleteness,
  employeePrimaryLabel,
  employeeSecondaryLabel,
  isDepartmentHead,
  operationsHealth,
  releaseOnboardingCompleteness,
  roleSetupCompleteness,
} from '@/features/partners/lib/partners';
import { DepartmentTeamPanel } from '@/components/DepartmentTeamPanel';
import { CapabilityContent, MemoryContent, ProfileContent, RuntimeContent, StructuredBoundaryContent } from './PartnersDetail.Panels';
import { OperationsDisposeModal } from './PartnersTab.Detail';
import { DeleteUnreleasedPartnerButton } from './PartnersDelete';
import { EmployeeAvatar, gateLabel, lifecycleMeta, Metric, riskMeta } from './PartnersShared';
import { usePartnerBuiltinToolNames } from '../hooks/usePartnerBuiltinToolNames';

type DetailTab = 'overview' | 'team' | 'profile' | 'boundary' | 'capabilities' | 'memory' | 'runtime' | 'evidence';

const TAB_KEYS: DetailTab[] = ['overview', 'team', 'profile', 'boundary', 'capabilities', 'memory', 'runtime', 'evidence'];

export default function PartnerDetailPage() {
  const builtinToolNames = usePartnerBuiltinToolNames();
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const canMutate = roleCanMutate(useAuthStore((s) => s.user?.role));
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [disposeLifecycle, setDisposeLifecycle] = useState<'paused' | 'quarantined' | 'active' | null>(null);

  const { data: employees = [], isLoading, refetch } = useApiQuery<DigitalPartner[]>(['digital-employees'], '/api/partners');
  const employee = employees.find((item) => item.id === id) ?? null;
  const head = employee ? isDepartmentHead(employee) : false;

  const requestedTab = params.get('tab') as DetailTab | null;
  const tab: DetailTab = useMemo(() => {
    if (requestedTab && TAB_KEYS.includes(requestedTab) && (requestedTab !== 'team' || head)) return requestedTab;
    return 'overview';
  }, [requestedTab, head]);

  const { data: evidence = [] } = useApiQuery<Array<{ id: string; time: string; actor: string; action: string; target: string; result: string }>>(
    ['digital-employee', id, 'evidence'],
    `/api/partners/${id}/evidence`,
    undefined,
    { enabled: Boolean(id) },
  );

  const transition = useApiMutation<DigitalPartner, { lifecycle: DigitalPartnerLifecycle; reason?: string; confirmed?: boolean }>(
    () => `/api/partners/${id}/lifecycle`,
    { invalidateKeys: [['digital-employees'], ['digital-employee', id]] },
  );

  if (!id) return <Navigate to="/partners" replace />;
  if (!isLoading && !employee) {
    return (
      <div className="de-partner-wizard">
        <header className="de-partner-wizard__top">
          <div>
            <Link to="/partners" className="de-partner-wizard__back"><ArrowLeft className="h-3.5 w-3.5" />返回数字伙伴</Link>
            <h1 className="mt-2">未找到该数字伙伴</h1>
            <p>可能已删除，或当前工作区没有这份档案。</p>
          </div>
        </header>
      </div>
    );
  }
  if (!employee) {
    return (
      <div className="de-partner-wizard">
        <p className="px-1 py-8 text-sm text-[var(--text-muted)]">正在载入数字伙伴详情…</p>
      </div>
    );
  }

  const roleMeta = roleSetupCompleteness(employee);
  const capMeta = capabilityAssemblyCompleteness(employee, builtinToolNames);
  const releaseMeta = releaseOnboardingCompleteness(employee, builtinToolNames);
  const health = operationsHealth(employee);
  const envLabel = employee.environment === 'production' ? '生产环境' : employee.environment === 'staging' ? '预发环境' : '沙箱环境';
  const incomplete = employee.lifecycle !== 'active' && employee.release.status !== 'released';

  const goTab = (next: DetailTab) => {
    setParams(next === 'overview' ? {} : { tab: next }, { replace: true });
  };

  const configureHref = `/partners/new?id=${employee.id}&step=${incomplete ? (roleMeta.ready ? (capMeta.ready ? 'release' : 'capability') : 'role') : 'role'}`;

  const tabs: Array<{ key: DetailTab; label: string; note: string }> = [
    { key: 'overview', label: '总览', note: '身份与门禁' },
    ...(head ? [{ key: 'team' as const, label: '部门班组', note: '派工与协办' }] : []),
    { key: 'profile', label: '档案与岗位', note: '身份与责任' },
    { key: 'boundary', label: '职责与边界', note: '可做与不可做' },
    { key: 'capabilities', label: '能力装配', note: '模型与资产' },
    { key: 'memory', label: '记忆策略', note: '三层沉淀' },
    { key: 'runtime', label: '运行观测', note: '健康与处置' },
    { key: 'evidence', label: '审计证据', note: '可追溯记录' },
  ];

  let body: ReactNode;
  switch (tab) {
    case 'overview':
      body = (
        <OverviewPane
          employee={employee}
          roleLabel={roleMeta.label}
          roleReady={roleMeta.ready}
          capLabel={capMeta.label}
          capReady={capMeta.ready}
          releaseLabel={releaseMeta.label}
          healthLabel={health.label}
          healthOk={!health.attention}
          onOpen={goTab}
        />
      );
      break;
    case 'team':
      body = head ? <DepartmentTeamPanel head={employee} /> : <ProfileContent employee={employee} />;
      break;
    case 'profile':
      body = <ProfileContent employee={employee} />;
      break;
    case 'boundary':
      body = <StructuredBoundaryContent employee={employee} />;
      break;
    case 'capabilities':
      body = <CapabilityContent employee={employee} />;
      break;
    case 'memory':
      body = <MemoryContent employee={employee} />;
      break;
    case 'runtime':
      body = (
        <div className="space-y-5">
          <div className={cn('rounded-lg border px-3 py-2.5 text-xs leading-5', health.attention ? 'border-[var(--warning)]/40 bg-[var(--warning-light)] text-[var(--text-secondary)]' : 'border-[var(--success)]/30 bg-[var(--success-bg)] text-[var(--text-secondary)]')}>
            <HeartPulse className="mr-1 inline h-3.5 w-3.5" />
            {health.summary}
          </div>
          <RuntimeContent employee={employee} />
          {health.signals.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold">异常与关注项</h4>
              {health.signals.map((signal) => (
                <div key={signal.key} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{signal.label}</span>
                    <Badge tone={signal.severity === 'error' ? 'error' : signal.severity === 'warn' ? 'warn' : 'neutral'}>{signal.severity === 'error' ? '优先' : signal.severity === 'warn' ? '关注' : '状态'}</Badge>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-5 text-[var(--text-muted)]">{signal.detail}</p>
                </div>
              ))}
            </div>
          )}
          {employee.opsControl?.reason && (
            <p className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-secondary)]">
              最近处置：{employee.opsControl.lastAction === 'paused' ? '暂停' : employee.opsControl.lastAction === 'quarantined' ? '隔离' : '恢复'}
              · {employee.opsControl.reason}
              {employee.opsControl.actor ? ` · ${employee.opsControl.actor}` : ''}
            </p>
          )}
          {isAdmin && employee.lifecycle === 'active' && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDisposeLifecycle('paused')}><Pause className="h-3.5 w-3.5" />暂停运行</Button>
              <Button size="sm" variant="secondary" onClick={() => setDisposeLifecycle('quarantined')}><ShieldAlert className="h-3.5 w-3.5" />隔离</Button>
            </div>
          )}
          {isAdmin && (employee.lifecycle === 'paused' || employee.lifecycle === 'quarantined') && employee.release.status === 'released' && (
            <Button size="sm" onClick={() => setDisposeLifecycle('active')}><Play className="h-3.5 w-3.5" />恢复运行</Button>
          )}
        </div>
      );
      break;
    case 'evidence':
      body = evidence.length ? (
        <div className="space-y-3">
          {evidence.map((event) => (
            <div key={event.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
              <div className="text-sm font-medium">{event.action}</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">{event.target}</div>
              <div className="mt-1 text-[11px] text-[var(--text-muted)]">{event.actor} · {new Date(event.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</div>
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-[var(--text-muted)]">暂无证据记录。</p>;
      break;
  }

  return (
    <div className="de-partner-wizard de-partner-detail">
      <header className="de-partner-wizard__top">
        <div className="min-w-0">
          <Link to="/partners" className="de-partner-wizard__back">
            <ArrowLeft className="h-3.5 w-3.5" />返回数字伙伴
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1>{employeePrimaryLabel(employee)}</h1>
            {head && <Badge tone="info">部门负责人</Badge>}
            <Badge tone={lifecycleMeta[employee.lifecycle].tone}>{lifecycleMeta[employee.lifecycle].label}</Badge>
            <Badge tone={riskMeta[employee.risk].tone}>{riskMeta[employee.risk].label}</Badge>
          </div>
          <p>{employeeSecondaryLabel(employee)} · 岗位版本 {employee.version}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {employee.lifecycle === 'active' && (
            <Button size="sm" onClick={() => navigate(`/copilot?employeeId=${employee.id}`)}><MessageSquare className="h-3.5 w-3.5" />发起协作</Button>
          )}
          {canMutate && incomplete && (
            <Button size="sm" variant="secondary" onClick={() => navigate(configureHref)}><ClipboardCheck className="h-3.5 w-3.5" />继续配置</Button>
          )}
          {canMutate && !incomplete && (
            <Button size="sm" variant="secondary" onClick={() => navigate(`/partners/new?id=${employee.id}&step=role`)}>调整配置</Button>
          )}
          {canMutate && <DeleteUnreleasedPartnerButton employee={employee} onDeleted={() => navigate('/partners')} />}
          <Button size="sm" variant="outline" onClick={() => navigate(`/tasks?task=${encodeURIComponent(employeePrimaryLabel(employee))}`)}>相关任务</Button>
        </div>
      </header>

      <section className="de-partner-detail__hero">
        <EmployeeAvatar employee={employee} size={52} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{gateLabel(employee)}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">服务 {employee.serviceObject || '待指定'} · 负责人 {employee.owner || '待指定'} · 接管 {employee.escalationOwner || '待指定'}</p>
        </div>
        <dl className="de-partner-detail__kpis">
          <div><dt>运行环境</dt><dd>{envLabel}</dd></div>
          <div><dt>质量评测</dt><dd>{employee.evaluation.score ?? '待评测'}{employee.evaluation.score ? ' 分' : ''}{employee.evaluation.mock ? <span className="ml-1 rounded bg-[var(--warning-light)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--warning)]">演示</span> : null}</dd></div>
          <div><dt>24h 调用</dt><dd>{employee.runtime.calls24h}</dd></div>
          <div><dt>异常</dt><dd>{employee.runtime.anomalies}</dd></div>
        </dl>
      </section>

      <div className="de-partner-wizard__body">
        <nav className="de-partner-wizard__rail" aria-label="详情分区">
          {tabs.map((item) => (
            <button
              type="button"
              key={item.key}
              onClick={() => goTab(item.key)}
              className={cn('de-partner-wizard__step', tab === item.key && 'is-current')}
            >
              <span className="de-partner-detail__dot" aria-hidden />
              <span className="de-partner-wizard__meta">
                <strong>{item.label}</strong>
                <em>{item.note}</em>
              </span>
            </button>
          ))}
        </nav>
        <section className="de-partner-wizard__main">{body}</section>
      </div>

      {disposeLifecycle && (
        <OperationsDisposeModal
          employee={employee}
          targetLifecycle={disposeLifecycle}
          loading={transition.isPending}
          onClose={() => setDisposeLifecycle(null)}
          onConfirm={(input) => {
            transition.mutate(
              { lifecycle: disposeLifecycle, reason: input.reason, confirmed: input.confirmed },
              { onSuccess: () => { setDisposeLifecycle(null); void refetch(); } },
            );
          }}
        />
      )}
    </div>
  );
}

function OverviewPane({ employee, roleLabel, roleReady, capLabel, capReady, releaseLabel, healthLabel, healthOk, onOpen }: {
  employee: DigitalPartner;
  roleLabel: string; roleReady: boolean;
  capLabel: string; capReady: boolean;
  releaseLabel: string;
  healthLabel: string; healthOk: boolean;
  onOpen: (tab: DetailTab) => void;
}) {
  const gates = [
    { key: 'profile' as const, title: '岗位配置', status: roleLabel, ok: roleReady, detail: '档案、职责、接管与记忆策略' },
    { key: 'capabilities' as const, title: '能力装配', status: capLabel, ok: capReady, detail: '模型路由、技能 / 工具 / 流程与执行授权' },
    { key: 'runtime' as const, title: '运行健康', status: healthLabel, ok: healthOk, detail: '近 24 小时调用、交接与异常信号' },
  ];
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold">岗位说明</h2>
        <p className="mt-2 rounded-xl bg-[var(--bg)] px-4 py-3 text-xs leading-6 text-[var(--text-secondary)]" style={{ boxShadow: 'var(--saas-ring)' }}>
          {employee.description?.trim() || '尚未填写岗位说明。'}
        </p>
      </div>
      <div>
        <h2 className="text-sm font-semibold">配置与运行门禁</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">当前上岗状态：{releaseLabel}。点开对应分区查看只读详情；修改请走「继续配置」分步向导。</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {gates.map((gate) => (
            <button type="button" key={gate.key} onClick={() => onOpen(gate.key)} className="de-partner-detail__gate">
              <span className="flex items-center justify-between gap-2">
                <strong>{gate.title}</strong>
                <Badge tone={gate.ok ? 'success' : 'warn'}>{gate.status}</Badge>
              </span>
              <em>{gate.detail}</em>
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Metric label="岗位负责人" value={employee.owner || '待指定'} />
        <Metric label="人工接管" value={employee.escalationOwner || '待指定'} />
        <Metric label="服务对象" value={employee.serviceObject || '待指定'} />
        <Metric label="绑定能力" value={employee.capabilities.skills.length + employee.capabilities.tools.length + employee.capabilities.workflows.length} sub="项" />
      </div>
    </div>
  );
}
