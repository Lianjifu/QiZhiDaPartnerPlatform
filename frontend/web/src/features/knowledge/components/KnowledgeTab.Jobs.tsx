/**
 * 知识中心 · 加工任务 tab（M07 P1 拆分）。
 *
 * 复用 ProcessingWorkbench（M07 既有组件），本文件只负责把 controller 翻译成
 * ProcessingWorkbench 期望的 props + pipeline 跳转回调。
 */
import { ProcessingWorkbench } from './ProcessingWorkbench';
import type { KnowledgeController } from './useKnowledgeController';

export function KnowledgeTabJobs({ c }: { c: KnowledgeController }) {
  return (
    <ProcessingWorkbench
      sources={c.sourceConnections}
      jobs={c.filteredProcessingJobs}
      pendingPackages={c.pendingReviewPackages}
      pipelineStages={c.pipelineStages.map((stage) => ({
        ...stage,
        onClick: () => c.focusPipelineTarget(stage.target),
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
      activeJobCount={c.activeJobCount}
      failedJobCount={c.failedJobCount}
      onFilterChange={c.setJobStatusFilter}
      onConnectSource={() => c.setActiveModal('connectSource')}
      onSyncSource={c.syncSource}
      onReindex={() => c.setReindexConfirm(true)}
      onProcessPending={() => {
        if (c.pendingReviewPackages[0]) c.processPackageMutation.mutate({ id: c.pendingReviewPackages[0].id, strategy: 'semantic' });
      }}
      onRetryJob={(id) => c.retryJobMutation.mutate({ id })}
      onOpenPackages={() => { c.setWorkspace('assets'); c.setAssetsView('packages'); }}
      sourcesRef={c.sourcesSectionRef}
      jobsRef={c.jobsSectionRef}
    />
  );
}