import { type RefObject } from 'react';
import { Badge, Button, KpiCard } from '@qzda/web-ui';
import {
  Boxes, CheckCircle2, ChevronRight, Clock3, Database, FileText, Layers, PlayCircle, Plus, RefreshCw, RotateCcw,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { KnowledgePackage, KnowledgeProcessingJob, KnowledgeSourceConnection } from '@qzda/web-types';
import { cn } from '@qzda/web-utils';
import { EmptyState } from '@/components/shared';
import { normalizeSourceStatus } from '@/features/knowledge/knowledge-ui';

type JobFilter = 'all' | 'running' | 'succeeded' | 'failed';
type PipelineTone = 'default' | 'active' | 'attention';

type PipelineStage = {
  key: string;
  label: string;
  icon: LucideIcon;
  capability: string;
  statusLabel: string;
  tone: PipelineTone;
  onClick: () => void;
};

function jobStrategyLabel(strategy: KnowledgeProcessingJob['strategy']) {
  if (strategy === 'structured') return '结构切片';
  if (strategy === 'semantic') return '语义切片';
  if (strategy === 'table') return '表格切片';
  return '固定窗口';
}

function jobStatusMeta(status: KnowledgeProcessingJob['status']) {
  if (status === 'succeeded') return { label: '已完成', className: 'is-ready', tone: 'success' as const };
  if (status === 'failed') return { label: '失败', className: 'is-failed', tone: 'error' as const };
  if (status === 'running') return { label: '加工中', className: 'is-indexing', tone: 'warn' as const };
  return { label: '排队中', className: 'is-indexing', tone: 'info' as const };
}

export function ProcessingWorkbench({
  sources,
  jobs,
  pendingPackages,
  pipelineStages,
  jobStatusFilter,
  canWrite,
  busySyncId,
  busyProcess,
  busyRetry,
  isReindexing,
  sourceDocumentTotal,
  healthySourceCount,
  attentionSourceCount,
  activeJobCount,
  failedJobCount,
  onFilterChange,
  onConnectSource,
  onSyncSource,
  onReindex,
  onProcessPending,
  onRetryJob,
  onOpenPackages,
  sourcesRef,
  jobsRef,
  scoped,
}: {
  sources: KnowledgeSourceConnection[];
  jobs: KnowledgeProcessingJob[];
  pendingPackages: KnowledgePackage[];
  pipelineStages: PipelineStage[];
  jobStatusFilter: JobFilter;
  canWrite: boolean;
  busySyncId?: string | null;
  busyProcess?: boolean;
  busyRetry?: boolean;
  isReindexing?: boolean;
  sourceDocumentTotal: number;
  healthySourceCount: number;
  attentionSourceCount: number;
  activeJobCount: number;
  failedJobCount: number;
  onFilterChange: (filter: JobFilter) => void;
  onConnectSource?: () => void;
  onSyncSource: (id: string) => void;
  onReindex: () => void;
  onProcessPending: () => void;
  onRetryJob: (id: string) => void;
  onOpenPackages?: () => void;
  sourcesRef: RefObject<HTMLElement>;
  jobsRef: RefObject<HTMLElement>;
  scoped?: boolean;
}) {
  return (
    <div className="knowledge-processing">
      <header className="knowledge-processing__intro">
        <div className="min-w-0">
          <h2>{scoped ? '加工' : '加工中心'}</h2>
          <p>{scoped ? '查看本包切片、索引与已接入来源的同步。完成后到「检索验证」检查质量。' : '先看任务进度与失败项，再管理数据源与加工链路。'}</p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={onReindex}>
              <RefreshCw className={cn('h-3.5 w-3.5', isReindexing && 'animate-spin')} />重建索引
            </Button>
            {onConnectSource && (
              <Button size="sm" onClick={onConnectSource}>
                <Plus className="h-3.5 w-3.5" />接入数据源
              </Button>
            )}
          </div>
        )}
      </header>

      <section className="knowledge-processing__kpi" aria-label="加工概览">
        <KpiCard label="数据源" value={sources.length} sub="个已接入" icon={Database} tone="brand" size="comfortable" />
        <KpiCard label="覆盖资产" value={sourceDocumentTotal} sub="项文档" icon={FileText} tone="neutral" size="comfortable" />
        <KpiCard
          label="连接健康"
          value={healthySourceCount}
          sub={attentionSourceCount ? `${attentionSourceCount} 需关注` : '全部正常'}
          icon={CheckCircle2}
          tone={attentionSourceCount ? 'warn' : 'success'}
          size="comfortable"
        />
        <KpiCard
          label="进行中任务"
          value={activeJobCount}
          sub={failedJobCount ? `${failedJobCount} 失败待处理` : '运行 / 排队'}
          icon={Layers}
          tone={failedJobCount ? 'warn' : 'success'}
          size="comfortable"
        />
      </section>

      <section ref={jobsRef} className="knowledge-processing__panel">
        <div className="knowledge-processing__panel-head">
          <div className="min-w-0">
            <h3>加工任务</h3>
            <p>查看切片、向量化与索引进度；失败任务可一键重试。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="knowledge-filter-group" role="group" aria-label="任务状态筛选">
              {([
                { key: 'all' as const, label: '全部' },
                { key: 'running' as const, label: '进行中' },
                { key: 'succeeded' as const, label: '已完成' },
                { key: 'failed' as const, label: '失败' },
              ]).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={cn(jobStatusFilter === item.key && 'is-active')}
                  onClick={() => onFilterChange(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {canWrite && pendingPackages[0] && (
              <Button size="sm" variant="secondary" disabled={busyProcess} onClick={onProcessPending}>
                <PlayCircle className="h-3.5 w-3.5" />加工待审包
              </Button>
            )}
          </div>
        </div>

        {!scoped && pendingPackages.length > 0 && onOpenPackages && (
          <button type="button" className="knowledge-package-strip" onClick={onOpenPackages}>
            <span className="flex min-w-0 items-center gap-2">
              <Boxes className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
              <span className="truncate text-[11px] text-[var(--text-secondary)]">
                <strong className="font-semibold text-[var(--text)]">{pendingPackages.length}</strong> 个知识包待加工/发布
                <span className="text-[var(--text-muted)]"> · 完成后可在检索中验证质量</span>
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-[var(--brand)]">
              去知识包 <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </button>
        )}

        {jobs.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={Layers}
              title={jobStatusFilter === 'all' ? '还没有加工任务' : '没有匹配的任务'}
              description={jobStatusFilter === 'all' ? '对知识包发起加工后，进度会出现在这里。' : '换一个状态筛选，或发起一次新的加工。'}
              action={canWrite && pendingPackages[0] ? (
                <Button size="sm" onClick={onProcessPending} disabled={busyProcess}>
                  <PlayCircle className="h-3.5 w-3.5" />加工待审包
                </Button>
              ) : undefined}
            />
          </div>
        ) : (
          <div className="knowledge-job-list">
            {jobs.map((job) => {
              const status = jobStatusMeta(job.status);
              return (
                <article key={job.id} className={cn('knowledge-job-card', job.status === 'failed' && 'is-failed')}>
                  <div className="knowledge-job-card__main">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="truncate text-[13px] text-[var(--text)]">{job.source}</strong>
                        <span className={cn('knowledge-status-dot', status.className)}>{status.label}</span>
                      </div>
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3 w-3" />
                          {new Date(job.startedAt).toLocaleString('zh-CN')}
                        </span>
                        <span>策略 {jobStrategyLabel(job.strategy)}</span>
                        <span className="font-mono">{job.chunkCount || '—'} 切片 / {job.documentCount} 文档</span>
                      </p>
                      {job.error && <p className="knowledge-job-card__error">{job.error}</p>}
                    </div>
                    <div className="knowledge-job-card__side">
                      <span className="font-mono text-[10px] text-[var(--text-muted)]">{job.indexVersion}</span>
                      {job.status === 'failed' && canWrite ? (
                        <Button size="sm" variant="secondary" disabled={busyRetry} onClick={() => onRetryJob(job.id)}>
                          <RotateCcw className="h-3.5 w-3.5" />重试
                        </Button>
                      ) : (
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {job.status === 'succeeded' ? '已可追溯' : job.status === 'running' ? '处理中…' : '等待调度'}
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="knowledge-processing__panel knowledge-processing__pipeline-panel">
        <div className="knowledge-processing__panel-head">
          <div className="min-w-0">
            <h3>加工链路</h3>
            <p>从接入到检索的默认能力说明；点击阶段可跳到对应区域。</p>
          </div>
        </div>
        <div className="knowledge-pipeline knowledge-pipeline--roomy" role="navigation" aria-label="加工流水线导航">
          {pipelineStages.map((stage, index) => (
            <button
              key={stage.key}
              type="button"
              className={cn(
                'knowledge-pipeline__stage',
                stage.tone === 'active' && 'is-active',
                stage.tone === 'attention' && 'is-attention',
              )}
              onClick={stage.onClick}
            >
              <span className="knowledge-pipeline__step">{index + 1}</span>
              <stage.icon className="h-3.5 w-3.5 text-[var(--brand)]" />
              <strong>{stage.label}</strong>
              <small>{stage.capability}</small>
              <em className="knowledge-pipeline__status">{stage.statusLabel}</em>
            </button>
          ))}
        </div>
      </section>

      <section ref={sourcesRef} className="knowledge-processing__panel">
        <div className="knowledge-processing__panel-head">
          <div className="min-w-0">
            <h3>数据源</h3>
            <p>查看已接入来源的同步状态；新增连接请到「添加内容」。</p>
          </div>
          {canWrite && sources.length > 0 && onConnectSource && (
            <Button size="sm" onClick={onConnectSource}>
              <Plus className="h-3.5 w-3.5" />接入数据源
            </Button>
          )}
        </div>

        {sources.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={Database}
              title="尚未接入数据源"
              description="请到本包「添加内容」接入数据源。"
            />
          </div>
        ) : (
          <div className="knowledge-source-grid">
            {sources.map((source) => {
              const syncing = busySyncId === source.id;
              const displayStatus = normalizeSourceStatus(source.status);
              const statusLabel = syncing || displayStatus === 'syncing' ? '同步中' : displayStatus === 'healthy' ? '健康' : '需关注';
              const statusTone = syncing || displayStatus === 'syncing' ? 'brand' : displayStatus === 'healthy' ? 'success' : 'warn';
              return (
                <article key={source.id} className="knowledge-source-card">
                  <div className="knowledge-source-card__icon"><Database className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="truncate text-sm text-[var(--text)]">{source.name}</strong>
                      <Badge tone={statusTone}>{statusLabel}</Badge>
                    </div>
                    <p className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">
                      {source.kind} · {source.documents} 个资产 · {source.schedule}
                    </p>
                    {source.endpoint && (
                      <p className="mt-1.5 truncate font-mono text-[11px] text-[var(--text-muted)]" title={source.endpoint}>
                        {source.endpoint}
                      </p>
                    )}
                    <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[11px] text-[var(--text-muted)]">
                      <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />最近同步：{source.lastSync}</span>
                    </div>
                  </div>
                  {canWrite && (
                    <Button size="sm" variant="secondary" disabled={syncing} onClick={() => onSyncSource(source.id)}>
                      {syncing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      {displayStatus === 'attention' ? '重试同步' : '立即同步'}
                    </Button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
