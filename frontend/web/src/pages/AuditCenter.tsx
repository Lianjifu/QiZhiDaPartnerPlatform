import { useEffect, useMemo, useState } from 'react';
import { Bot, Download, FileSearch, Filter, ListChecks, RefreshCw, ShieldCheck, Workflow } from 'lucide-react';
import { Badge, Button, toast } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useT } from '@/i18n';
import { useAuthStore } from '@/stores/authStore';

type AuditRow = {
  id: string;
  time: string;
  actor: string;
  action: string;
  target: string;
  result: 'success' | 'failed';
  workspaceId?: string;
  correlationId: string;
};

type DomainFilter = 'all' | 'employee' | 'task' | 'workflow';
type ResultFilter = 'all' | 'success' | 'failed';

function domainOf(row: AuditRow): Exclude<DomainFilter, 'all'> {
  const blob = `${row.action} ${row.target}`;
  if (/工作流|流程|发布技能|workflow/i.test(blob)) return 'workflow';
  if (/任务|审批|交接|授权|结案/.test(blob)) return 'task';
  if (/数字伙伴|员工|上岗|评测|岗位/.test(blob)) return 'employee';
  return 'task';
}

function formatRefresh(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '—';
  }
}

export default function AuditCenter({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useT();
  const isAuditor = useAuthStore((state) => state.user?.role === 'auditor');
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState<DomainFilter>('all');
  const [result, setResult] = useState<ResultFilter>('all');

  const audit = useApiQuery<AuditRow[]>(['audit-center'], '/api/audit-center', undefined, { refetchInterval: 15_000 });
  const [refreshedAt, setRefreshedAt] = useState<string | undefined>();
  useEffect(() => {
    if (audit.data) setRefreshedAt(new Date().toISOString());
  }, [audit.data]);
  const exportEvidence = useApiMutation<
    { filename: string; recordCount: number; masked: boolean; registered?: boolean; downloadAvailable?: boolean },
    Record<string, never>
  >(
    '/api/audit-center/export',
    {
      onSuccess: (data) => {
        if (data.downloadAvailable) {
          toast.success(`已生成 ${data.filename}，共 ${data.recordCount} 条脱敏记录`);
          return;
        }
        toast.success(`已登记导出意图：${data.filename}（${data.recordCount} 条，默认脱敏）。文件下载尚未开放，登记已写入审计。`);
      },
      onError: (error: unknown) => toast.error(error instanceof Error ? error.message : '导出登记失败'),
    },
  );

  const source = audit.data ?? [];
  const stats = useMemo(() => {
    const failed = source.filter((item) => item.result === 'failed').length;
    const authLike = source.filter((item) => /授权|策略|审批|审核/.test(item.action)).length;
    return { total: source.length, failed, authLike };
  }, [source]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return source.filter((item) => {
      if (domain !== 'all' && domainOf(item) !== domain) return false;
      if (result !== 'all' && item.result !== result) return false;
      if (!q) return true;
      return `${item.actor} ${item.action} ${item.target} ${item.correlationId}`.toLowerCase().includes(q);
    });
  }, [source, query, domain, result]);

  const domainChips: Array<[DomainFilter, string, typeof FileSearch]> = [
    ['all', '全部', FileSearch],
    ['employee', '工作伙伴', Bot],
    ['task', '任务协作', ListChecks],
    ['workflow', '工作流程', Workflow],
  ];

  return (
    <div className={cn('audit-evidence', embedded ? 'audit-evidence--embedded min-w-0' : 'mx-auto min-h-full max-w-[1480px] p-3 sm:p-4 lg:p-5')}>
      {!embedded ? (
        <header className="audit-evidence__hero">
          <div className="audit-evidence__hero-main">
            <div>
              <h1 className="audit-evidence__title">
                <FileSearch className="h-4 w-4 text-[var(--brand)]" />
                {t('module.audit.title')}
              </h1>
              <p className="audit-evidence__subtitle">{t('module.audit.subtitle')}</p>
              {isAuditor && (
                <p className="audit-evidence__scope">只读证据台：工作区授权范围内的操作流水与导出登记</p>
              )}
            </div>
            <div className="audit-evidence__hero-actions">
              <Button
                size="sm"
                variant="secondary"
                loading={audit.isFetching}
                onClick={() => void audit.refetch()}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', audit.isFetching && 'animate-spin')} />
                刷新
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={exportEvidence.isPending}
                onClick={() => exportEvidence.mutate({})}
              >
                <Download className="h-3.5 w-3.5" />
                {t('module.audit.export')}
              </Button>
            </div>
          </div>
          <div className="audit-evidence__stats" aria-label="事件摘要">
            <div className="audit-evidence__stat">
              <span className="audit-evidence__stat-label">范围内事件</span>
              <strong className="audit-evidence__stat-value">{stats.total}</strong>
            </div>
            <div className="audit-evidence__stat audit-evidence__stat--warn">
              <span className="audit-evidence__stat-label">失败 / 阻断</span>
              <strong className="audit-evidence__stat-value">{stats.failed}</strong>
            </div>
            <div className="audit-evidence__stat">
              <span className="audit-evidence__stat-label">授权与策略相关</span>
              <strong className="audit-evidence__stat-value">{stats.authLike}</strong>
            </div>
            <div className="audit-evidence__stat audit-evidence__stat--muted">
              <span className="audit-evidence__stat-label">上次刷新</span>
              <strong className="audit-evidence__stat-value audit-evidence__stat-value--sm">{formatRefresh(refreshedAt)}</strong>
            </div>
          </div>
        </header>
      ) : (
        <div className="audit-evidence__embedded-bar">
          <div className="audit-evidence__stats audit-evidence__stats--compact" aria-label="事件摘要">
            <div className="audit-evidence__stat"><span className="audit-evidence__stat-label">事件</span><strong>{stats.total}</strong></div>
            <div className="audit-evidence__stat audit-evidence__stat--warn"><span className="audit-evidence__stat-label">失败</span><strong>{stats.failed}</strong></div>
            <div className="audit-evidence__stat"><span className="audit-evidence__stat-label">刷新</span><strong className="text-[11px]">{formatRefresh(refreshedAt)}</strong></div>
          </div>
          <Button size="sm" variant="secondary" loading={exportEvidence.isPending} onClick={() => exportEvidence.mutate({})}>
            <Download className="h-3.5 w-3.5" />{t('module.audit.export')}
          </Button>
        </div>
      )}

      <section className="audit-evidence__toolbar">
        <div className="settings-subnav" role="tablist" aria-label="事件域过滤">
          {domainChips.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={domain === key}
              onClick={() => setDomain(key)}
              className={cn('settings-subnav__item', domain === key && 'is-active')}
            >
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>
        <div className="settings-subnav" role="tablist" aria-label="结果过滤">
          {([
            ['all', '全部结果'],
            ['success', '成功'],
            ['failed', '失败'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={result === key}
              onClick={() => setResult(key)}
              className={cn('settings-subnav__item', result === key && 'is-active')}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="settings-search audit-evidence__search">
          <Filter className="h-3.5 w-3.5" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="按操作人、事件、目标、关联 ID 搜索"
            aria-label="搜索审计事件"
          />
        </div>
      </section>

      <section className="audit-evidence__panel">
        <div className="audit-evidence__panel-head">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {t('module.audit.events')}
            <Badge tone="neutral" className="text-[10px]">授权范围</Badge>
          </div>
          <span className="text-[11px] text-[var(--text-muted)]">
            显示 {rows.length} / {stats.total} 条
          </span>
        </div>

        {audit.isLoading ? (
          <div className="audit-evidence__empty">正在读取审计证据…</div>
        ) : rows.length === 0 ? (
          <div className="audit-evidence__empty">
            <FileSearch className="mx-auto mb-2 h-5 w-5 opacity-50" />
            <p>当前过滤条件下无事件</p>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              {stats.total === 0
                ? '工作区内尚无授权范围内审计记录；运营动作发生后会写入此处。'
                : '尝试清空搜索或切换域 / 结果过滤。'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead className="bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">时间</th>
                  <th className="px-4 py-2.5 font-medium">操作人</th>
                  <th className="px-4 py-2.5 font-medium">事件</th>
                  <th className="px-4 py-2.5 font-medium">目标</th>
                  <th className="px-4 py-2.5 font-medium">域</th>
                  <th className="px-4 py-2.5 font-medium">结果</th>
                  <th className="px-4 py-2.5 font-medium">关联 ID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const d = domainOf(item);
                  const domainLabel = d === 'employee' ? '员工' : d === 'workflow' ? '流程' : '任务';
                  return (
                    <tr key={item.id} className="border-t border-[var(--border)] hover:bg-[color-mix(in_srgb,var(--brand)_3%,transparent)]">
                      <td className="whitespace-nowrap px-4 py-3 text-[var(--text-muted)]">
                        {new Date(item.time).toLocaleString('zh-CN')}
                      </td>
                      <td className="px-4 py-3 font-medium">{item.actor}</td>
                      <td className="px-4 py-3">{item.action}</td>
                      <td className="max-w-[240px] truncate px-4 py-3 text-[var(--text-secondary)]" title={item.target}>
                        {item.target}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone="neutral" className="text-[9px]">{domainLabel}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={item.result === 'success' ? 'success' : 'error'}>
                          {item.result === 'success' ? '成功' : '失败'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-[10px] text-[var(--text-muted)]">{item.correlationId}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="audit-evidence__footnote">
        <ShieldCheck className="h-3.5 w-3.5 text-[var(--success)]" />
        视图只读。导出当前为「登记导出意图」并写入审计；默认脱敏，不宣称已生成可下载合规压缩包。
      </p>
    </div>
  );
}
