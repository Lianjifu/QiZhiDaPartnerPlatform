import { useMemo, useState } from 'react';
import { useApiMutation, useApiQuery } from '@/services/query';
import { Badge, Button, Input } from '@qzda/web-ui';
import {
  ShieldCheck, Activity, AlertTriangle, Search, CheckCircle2, PauseCircle, ShieldAlert,
} from 'lucide-react';
import { cn } from '@qzda/web-utils';
import type { SkillGovernanceIncident, SkillGovernanceEvent, SkillRuntimeHealth } from '@qzda/web-types';
import { Modal, EmptyState } from '@/components/shared';

export function GovernanceWorkspace({
  onOpenSkill, canWrite,
}: {
  onOpenSkill: (id: string) => void;
  canWrite: boolean;
}) {
  const [healthFilter, setHealthFilter] = useState<'all' | SkillRuntimeHealth['status']>('all');
  const [searchQ, setSearchQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [incident, setIncident] = useState<SkillGovernanceIncident | null>(null);

  const { data: overview } = useApiQuery<{ calls24h: number; successRate: number; p95Ms: number; abnormalSkills: number; pendingActions: number }>(['skills', 'governance', 'overview'], '/api/skills/governance/overview');
  const { data: healthData } = useApiQuery<SkillRuntimeHealth[]>(['skills', 'governance', 'health'], '/api/skills/governance/health');
  const { data: incidentsData } = useApiQuery<SkillGovernanceIncident[]>(['skills', 'governance', 'incidents'], '/api/skills/governance/incidents');
  const { data: eventsData } = useApiQuery<SkillGovernanceEvent[]>(['skills', 'governance', 'events'], '/api/skills/governance/events');
  const { data: trendsData } = useApiQuery<Array<{ time: string; calls: number; errorRate: number; p95: number }>>(['skills', 'governance', 'trends'], '/api/skills/governance/trends');

  const health = healthData ?? [];
  const incidents = incidentsData ?? [];
  const events = eventsData ?? [];
  const trends = trendsData ?? [];

  const revalidate = useApiMutation<SkillRuntimeHealth, { id: string }>(
    ({ id }) => `/api/skills/${id}/revalidate`,
    { onSuccess: () => setIncident(null) },
  );
  const isolate = useApiMutation<SkillRuntimeHealth, { id: string }>(
    ({ id }) => `/api/skills/${id}/isolate`,
    { onSuccess: () => { setIncident(null); setSelected(new Set()); } },
  );
  const batch = useApiMutation<SkillRuntimeHealth[], { skillIds: string[]; action: 'revalidate' | 'pause' }>(
    '/api/skills/governance/batch',
    { onSuccess: () => setSelected(new Set()) },
  );

  const visible = useMemo(() => health.filter((item) => {
    if (healthFilter !== 'all' && item.status !== healthFilter) return false;
    if (!searchQ.trim()) return true;
    const q = searchQ.toLowerCase();
    return `${item.name} ${item.kind} ${item.owner}`.toLowerCase().includes(q);
  }), [health, healthFilter, searchQ]);

  const openIncidents = incidents.filter((item) => item.status !== 'resolved');
  const policyHits = useMemo(() => {
    const counts = {
      approval: events.filter((e) => e.type === 'policy' || e.type === 'approval' || e.action.includes('审批')).length,
      threshold: events.filter((e) => e.action.includes('阈值') || e.action.includes('告警')).length,
      credential: incidents.filter((i) => i.type === 'credential').length,
    };
    return [
      { label: '写操作审批阻断', value: counts.approval, tone: 'warn' as const },
      { label: '错误率阈值告警', value: counts.threshold, tone: 'error' as const },
      { label: '凭据到期提醒', value: counts.credential, tone: 'info' as const },
    ];
  }, [events, incidents]);

  const maxCalls = Math.max(1, ...trends.map((item) => item.calls));
  const healthLabel: Record<SkillRuntimeHealth['status'], string> = {
    healthy: '健康', attention: '关注', incident: '异常', paused: '已暂停', quarantined: '已隔离',
  };
  const healthTone = (status: SkillRuntimeHealth['status']) => (
    status === 'healthy' ? 'success' : status === 'attention' ? 'warn' : status === 'incident' || status === 'quarantined' ? 'error' : 'neutral'
  );

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selected.has(item.skillId));
  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelected((current) => {
        const next = new Set(current);
        visible.forEach((item) => next.delete(item.skillId));
        return next;
      });
      return;
    }
    setSelected((current) => {
      const next = new Set(current);
      visible.forEach((item) => next.add(item.skillId));
      return next;
    });
  };

  const kpiItems = [
    { key: 'calls', label: '24h 调用', value: overview?.calls24h?.toLocaleString() ?? '—', tone: 'brand' as const, filter: null as null | SkillRuntimeHealth['status'] },
    { key: 'success', label: '成功率', value: overview ? `${Number(overview.successRate).toFixed(1)}%` : '—', tone: 'success' as const, filter: null },
    { key: 'p95', label: '全局 P95', value: overview ? `${overview.p95Ms ?? 0}ms` : '—', tone: 'info' as const, filter: null },
    { key: 'abnormal', label: '异常能力', value: overview?.abnormalSkills ?? 0, tone: 'error' as const, filter: 'incident' as const },
    { key: 'pending', label: '待处置', value: overview?.pendingActions ?? 0, tone: 'warn' as const, filter: 'attention' as const },
  ];

  return (
    <div className="skills-governance">
      <section className="skills-governance__kpis">
        {kpiItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={cn('skills-governance-kpi', item.filter && healthFilter === item.filter && 'is-active')}
            onClick={() => {
              if (!item.filter) return;
              setHealthFilter((prev) => (prev === item.filter ? 'all' : item.filter!));
            }}
          >
            <span>{item.label}</span>
            <strong className={cn(
              item.tone === 'success' ? 'text-[var(--success)]'
                : item.tone === 'error' ? 'text-[var(--danger)]'
                  : item.tone === 'warn' ? 'text-[var(--warning)]'
                    : item.tone === 'brand' ? 'text-[var(--brand)]' : 'text-[var(--text)]',
            )}>{item.value}</strong>
          </button>
        ))}
      </section>

      <section className="skills-governance__mid">
        <div className="skills-governance-panel">
          <header className="skills-governance-panel__head">
            <div>
              <h3><Activity className="h-4 w-4 text-[var(--brand)]" />调用与延迟趋势</h3>
              <p>24 小时聚合 · 错误率或 P95 异常会进入处置队列</p>
            </div>
            <Badge tone="neutral">24h</Badge>
          </header>
          {trends.length === 0 ? (
            <div className="py-10"><EmptyState icon={Activity} title="暂无趋势数据" description="运行数据汇聚后将显示调用量与延迟。" /></div>
          ) : (
            <div className="skills-governance-chart" role="img" aria-label="24 小时调用趋势">
              {trends.map((item) => (
                <div key={item.time} className="skills-governance-chart__col" title={`${item.time} · ${item.calls} 调用 · 错误率 ${item.errorRate}% · P95 ${item.p95}ms`}>
                  <div className="skills-governance-chart__bar-track">
                    <div className="skills-governance-chart__bar" style={{ height: `${Math.max(10, (item.calls / maxCalls) * 100)}%` }} />
                    {item.errorRate >= 1 && <span className="skills-governance-chart__warn" />}
                  </div>
                  <span>{item.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="skills-governance-panel">
          <header className="skills-governance-panel__head">
            <div>
              <h3><AlertTriangle className="h-4 w-4 text-[var(--warning)]" />异常与待处置</h3>
              <p>点击条目查看证据与推荐处置</p>
            </div>
            <Badge tone="error">{openIncidents.length}</Badge>
          </header>
          <div className="skills-governance-incidents">
            {openIncidents.length === 0 ? (
              <p className="skills-governance-empty">当前无未关闭异常，运行态健康。</p>
            ) : openIncidents.slice(0, 4).map((item) => (
              <button key={item.id} type="button" className="skills-governance-incident" onClick={() => setIncident(item)}>
                <div className="skills-governance-incident__top">
                  <Badge tone={item.severity === 'P0' ? 'error' : item.severity === 'P1' ? 'warn' : 'info'} className="text-[9px]">{item.severity}</Badge>
                  <strong>{item.skillName}</strong>
                  <span>{item.createdAt}</span>
                </div>
                <p>{item.title}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="skills-governance__shell">
        <header className="skills-governance__header">
          <div className="min-w-0">
            <h3>能力健康列表</h3>
            <p>查看健康、引用、风险与负责人，并执行紧急处置。</p>
          </div>
          <div className="skills-governance__toolbar">
            <select
              value={healthFilter}
              onChange={(event) => setHealthFilter(event.target.value as typeof healthFilter)}
              className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[11px]"
              aria-label="健康状态筛选"
            >
              <option value="all">全部健康状态</option>
              <option value="healthy">健康</option>
              <option value="attention">关注</option>
              <option value="incident">异常</option>
              <option value="paused">已暂停</option>
              <option value="quarantined">已隔离</option>
            </select>
            <div className="relative min-w-0 sm:w-52">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
              <Input value={searchQ} onChange={(event) => setSearchQ(event.target.value)} placeholder="搜索能力或责任人" className="h-9 pl-8 text-xs" />
            </div>
            {selected.size > 0 && canWrite && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" loading={batch.isPending} onClick={() => batch.mutate({ skillIds: Array.from(selected), action: 'revalidate' })}>
                  <CheckCircle2 className="h-3.5 w-3.5" />批量验证 ({selected.size})
                </Button>
                <Button size="sm" variant="outline" loading={batch.isPending} onClick={() => batch.mutate({ skillIds: Array.from(selected), action: 'pause' })}>
                  <PauseCircle className="h-3.5 w-3.5" />批量暂停
                </Button>
              </div>
            )}
          </div>
        </header>

        <div className="skills-governance__table-wrap">
          {visible.length === 0 ? (
            <div className="px-5 py-10"><EmptyState icon={ShieldCheck} title="没有匹配的能力" description="调整健康状态或搜索条件后重试。" /></div>
          ) : (
            <table className="skills-governance-table">
              <thead>
                <tr>
                  <th>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" disabled={!canWrite} checked={allVisibleSelected} onChange={toggleAllVisible} className="accent-[var(--brand)]" aria-label="全选当前列表" />
                      能力
                    </label>
                  </th>
                  <th>健康 / 风险</th>
                  <th>调用 / 成功率</th>
                  <th>P95</th>
                  <th>引用 / 负责人</th>
                  <th>更新时间</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <label className="skills-governance-table__skill">
                        <input type="checkbox" disabled={!canWrite} checked={selected.has(item.skillId)} onChange={() => toggle(item.skillId)} className="accent-[var(--brand)]" />
                        <span>
                          <strong>{item.name}</strong>
                          <small className="font-mono">{item.kind.toUpperCase()}</small>
                        </span>
                      </label>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={healthTone(item.status) as 'success' | 'warn' | 'error' | 'neutral'} className="text-[9px]">{healthLabel[item.status]}</Badge>
                        <Badge tone={item.riskLevel === 'high' ? 'error' : item.riskLevel === 'mid' ? 'warn' : 'success'} className="text-[9px]">{item.riskLevel === 'high' ? '高' : item.riskLevel === 'mid' ? '中' : '低'}</Badge>
                      </div>
                    </td>
                    <td>
                      <span className="font-mono font-semibold">{item.calls24h.toLocaleString()}</span>
                      <span className="ml-1 text-[var(--text-muted)]">/ {item.successRate}%</span>
                    </td>
                    <td className={cn('font-mono', item.p95Ms > 500 ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]')}>{item.p95Ms}ms</td>
                    <td>{item.references} 处 · {item.owner}</td>
                    <td className="text-[var(--text-muted)]">{item.updatedAt}</td>
                    <td className="text-right">
                      <div className="skills-governance-table__ops">
                        <button type="button" onClick={() => onOpenSkill(item.skillId)}>运行</button>
                        <button type="button" disabled={!canWrite || revalidate.isPending} onClick={() => revalidate.mutate({ id: item.skillId })}>验证</button>
                        {item.status !== 'quarantined' && (
                          <button type="button" className="is-danger" disabled={!canWrite || isolate.isPending} onClick={() => isolate.mutate({ id: item.skillId })}>隔离</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="skills-governance__footer">
        <div className="skills-governance-panel">
          <header className="skills-governance-panel__head">
            <div>
              <h3>治理事件流</h3>
              <p>调用、策略、审批与生命周期变更</p>
            </div>
          </header>
          <div className="skills-governance-events">
            {events.length === 0 ? (
              <p className="skills-governance-empty">暂无治理事件</p>
            ) : events.slice(0, 8).map((event) => (
              <div key={event.id} className="skills-governance-event">
                <span className="font-mono">{event.time}</span>
                <Badge tone={event.result === 'success' ? 'success' : event.result === 'blocked' ? 'warn' : 'error'} className="text-[9px]">
                  {event.result === 'success' ? '完成' : event.result === 'blocked' ? '阻断' : '失败'}
                </Badge>
                <strong>{event.skillName}</strong>
                <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">{event.action}</span>
                {event.requestId && <span className="hidden font-mono text-[10px] text-[var(--text-muted)] xl:inline">{event.requestId}</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="skills-governance-panel">
          <header className="skills-governance-panel__head">
            <div>
              <h3><ShieldCheck className="h-4 w-4 text-[var(--brand)]" />策略命中</h3>
              <p>基于当前事件与异常汇总</p>
            </div>
          </header>
          <div className="skills-governance-policy">
            {policyHits.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <Badge tone={item.tone}>{item.value}</Badge>
              </div>
            ))}
          </div>
          <p className="skills-governance-policy__note">
            可继续配置阈值、持续时间、通知对象与自动隔离；此处展示控制面当前命中结果。
          </p>
        </div>
      </section>

      <Modal
        open={!!incident}
        onClose={() => setIncident(null)}
        title={incident ? `${incident.severity} · ${incident.title}` : '异常详情'}
        description="影响范围、请求证据、关联能力与推荐处置。"
        size="md"
        panelClassName="max-w-[560px]"
        bodyClassName="skill-detail-modal px-6 py-5"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setIncident(null)}>关闭</Button>
            {incident && (
              <Button variant="secondary" disabled={!canWrite} loading={revalidate.isPending} onClick={() => revalidate.mutate({ id: incident.skillId })}>
                重新验证
              </Button>
            )}
            {incident && (
              <Button variant="danger" disabled={!canWrite} loading={isolate.isPending} onClick={() => isolate.mutate({ id: incident.skillId })}>
                <ShieldAlert className="h-3.5 w-3.5" />隔离能力
              </Button>
            )}
          </>
        )}
      >
        {incident && (
          <div className="flex flex-col gap-4 text-xs">
            <div className="skill-detail-panel">
              <div className="skill-detail-panel__title">{incident.skillName}</div>
              <p className="m-0 text-[12px] leading-6 text-[var(--text-secondary)]">{incident.detail}</p>
            </div>
            <div className="skill-detail-panel">
              <div className="skill-detail-panel__title">证据</div>
              <dl className="skill-detail-kv">
                <div><dt>关联请求</dt><dd className="font-mono">{incident.requestId}</dd></div>
                <div><dt>事件时间</dt><dd>{incident.createdAt}</dd></div>
                <div><dt>状态</dt><dd>{incident.status === 'open' ? '待处置' : incident.status === 'acknowledged' ? '已确认' : '已关闭'}</dd></div>
              </dl>
            </div>
            <p className="m-0 rounded-xl bg-[var(--warning-bg)] px-4 py-3 text-[12px] leading-5 text-[var(--warning)]">
              推荐先验证连接与运行时策略；若影响持续扩大，可隔离能力以阻断新调用。
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
