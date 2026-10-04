/**
 * 知识中心 · 加工任务（挂在文档 / 知识包详情分段上）。
 */
import { ProcessingWorkbench } from './ProcessingWorkbench';
import type { KnowledgeController } from './useKnowledgeController';
import type { KnowledgeProcessingJob } from '@qzda/web-types';

export function KnowledgeTabJobs({
  c,
  packageId,
  jobs: jobsOverride,
  onGoEval,
  onConnectSource,
}: {
  c: KnowledgeController;
  packageId?: string;
  jobs?: KnowledgeProcessingJob[];
  onGoEval?: () => void;
  onConnectSource?: () => void;
}) {
  const jobs = jobsOverride
    ?? (packageId
      ? c.filteredProcessingJobs.filter((job) => job.packageId === packageId)
      : c.filteredProcessingJobs);
  const pendingPackages = packageId
    ? c.knowledgePackages.filter((item) => item.id === packageId && item.status !== 'published')
    : [];
  const activeJobCount = jobs.filter((item) => item.status === 'running' || item.status === 'queued').length;
  const failedJobCount = jobs.filter((item) => item.status === 'failed').length;

  return (
    <ProcessingWorkbench
      scoped
      sources={c.sourceConnections}
      jobs={jobs}
      pendingPackages={pendingPackages}
      pipelineStages={c.pipelineStages.map((stage) => ({
        ...stage,
        onClick: () => {
          if (stage.target === 'retrieval' && onGoEval) {
            onGoEval();
            return;
          }
          c.focusPipelineTarget(stage.target);
        },
      }))}
      jobStatusFilter={c.jobStatusFilter}
      canWrite={c.canWrite}
      busySyncId={c.sourceSyncMutation.isPending ? (c.sourceSyncMutation.variables?.id ?? null) : null}
      busyProcess={c.processPackageMutation.isPending}
      busyRetry={c.retryJobMutation.isPending}
      isReindexing={c.isReindexing}
      sourceDocumentTotal={c.sourceDocumentTotal}
      healthySourceCount={c.healthySourceCount}
      attentionSourceCount={c.attentionSourceCount}
      activeJobCount={activeJobCount}
      failedJobCount={failedJobCount}
      onFilterChange={c.setJobStatusFilter}
      onConnectSource={onConnectSource}
      onSyncSource={c.syncSource}
      onReindex={() => c.setReindexConfirm(true)}
      onProcessPending={() => {
        const target = packageId ?? c.pendingReviewPackages[0]?.id;
        if (target) c.processPackageMutation.mutate({ id: target, strategy: 'semantic' });
      }}
      onRetryJob={(id) => c.retryJobMutation.mutate({ id })}
      onOpenPackages={onGoEval}
      sourcesRef={c.sourcesSectionRef}
      jobsRef={c.jobsSectionRef}
    />
  );
}
