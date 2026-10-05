/**
 * 知识中心 controller hook（M07 P1 拆分）。
 *
 * 原 pages/Knowledge.tsx 内全部 useState / query / mutation / handler / useEffect
 * 收拢至本文件；组件文件只消费返回的 controller，不再持有业务状态。
 *
 * 设计参考：
 *  - M06 P1 useWorkflowsController / M08 P1 useModelsController 同模式
 *  - useSearchParams 兼容 `?package=...` / `?view=packages` 深链跳转
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import type {
  KnowledgeAuditEvent, KnowledgeConsumerBinding, KnowledgeDoc, KnowledgeEvaluation,
  KnowledgeGovernancePolicy, KnowledgeGraphEntity, KnowledgeGraphRelation,
  KnowledgePackage, KnowledgeProcessingJob, KnowledgeRetrievalProfile,
  KnowledgeRetrievalResult, KnowledgeSourceConnection,
} from '@qzda/web-types';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  defaultKnowledgeTab, roleCanMutate, rolePageCopy, visibleKnowledgeTabs, type KnowledgeTab as KnowledgeWorkspaceTab,
} from '@/features/role-nav/role-nav';
import {
  normalizeEvalMetrics, normalizeRetrievalResults, normalizeSourceStatus,
} from '@/features/knowledge/knowledge-ui';
import { PIPELINE } from './KnowledgeShared';

type KnowledgeWorkspace = KnowledgeWorkspaceTab;

type ModalKind = 'upload' | 'reindex' | 'citationAgents' | 'connectSource' | 'newPackage' | null;
type JobFilter = 'all' | 'running' | 'succeeded' | 'failed';
type DocStatusFilter = 'all' | 'ready' | 'indexing';
type AssetsView = 'docs' | 'packages';

type PipelineTarget = 'sources' | 'jobs' | 'retrieval';
type PipelineTone = 'default' | 'active' | 'attention';

export type DeleteConfirmPayload = { ids: string[]; titles: string[]; citeTotal: number };

export type PipelineStage = {
  key: string;
  label: string;
  icon: LucideIcon;
  capability: string;
  target: PipelineTarget;
  tone: PipelineTone;
  statusLabel: string;
};

export type KnowledgeController = ReturnType<typeof useKnowledgeController>;

export function useKnowledgeController() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const permissionWrite = Boolean(user?.permissions.includes('knowledge.write'));
  const canWrite = permissionWrite && roleCanMutate(user?.role);
  const pageCopy = rolePageCopy('knowledge', user?.role);
  const allowedTabs = visibleKnowledgeTabs(user?.role);
  const currentWorkspace = useWorkspaceStore((state) => state.current);
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId ?? 'w1');
  const scopeKey = `${currentWorkspaceId}:${user?.id ?? 'anonymous'}`;
  const workspaceName = currentWorkspace?.name ?? 'ACME 生产';

  // 工作区 / 子视图
  const [workspace, setWorkspace] = useState<KnowledgeWorkspace>(() => defaultKnowledgeTab(user?.role));
  const [assetsView, setAssetsView] = useState<AssetsView>('packages');
  const [highlightedPackageId, setHighlightedPackageId] = useState<string | null>(null);

  // 内容文档 / 加工任务筛选
  const [jobStatusFilter, setJobStatusFilter] = useState<JobFilter>('all');
  const [searchQ, setSearchQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<DocStatusFilter>('all');
  const [contentPage, setContentPage] = useState(1);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  // 文档阅读器 / 切片抽屉
  const [docPreviewId, setDocPreviewId] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [chunkDrawer, setChunkDrawer] = useState<KnowledgeRetrievalResult | null>(null);

  // 检索 / 图谱
  const [testQuery, setTestQuery] = useState('');
  const [retrieveResults, setRetrieveResults] = useState<KnowledgeRetrievalResult[]>([]);
  const [selectedGraphEntityId, setSelectedGraphEntityId] = useState<string | null>(null);

  // 批量选择 / 弹层 / 提示
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [activeModal, setActiveModal] = useState<ModalKind>(null);
  const [reindexConfirm, setReindexConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmPayload | null>(null);
  const [governanceNotice, setGovernanceNotice] = useState('所有知识资产均处于可追溯治理范围内');

  // Refs（pipeline 跳转需要）
  const sourcesSectionRef = useRef<HTMLElement>(null);
  const jobsSectionRef = useRef<HTMLElement>(null);

  // 深链：`?package=xxx` / `?view=packages` 触发跳转
  const [searchParams] = useSearchParams();
  useEffect(() => {
    if (location.pathname !== '/knowledge') return;
    const packageId = searchParams.get('package');
    const view = searchParams.get('view');
    if (packageId) {
      navigate(`/knowledge/packages/${encodeURIComponent(packageId)}`, { replace: true });
      return;
    }
    if (view === 'packages') setAssetsView('packages');
  }, [location.pathname, navigate, searchParams]);

  // ===== 服务端查询 =====
  const { data: docs = [] } = useApiQuery<KnowledgeDoc[]>(['knowledge', 'docs', scopeKey], '/api/knowledge/docs', undefined, {
    refetchInterval: (query) => {
      const list = query.state.data as KnowledgeDoc[] | undefined;
      return Array.isArray(list) && list.some((doc) => doc.status === 'indexing' || doc.status === 'parsing') ? 1500 : false;
    },
  });
  const { data: docDetail } = useApiQuery<any>(['doc', docPreviewId, scopeKey], `/api/knowledge/doc/${docPreviewId ?? 'k1'}`, undefined, { enabled: Boolean(docPreviewId) });
  const { data: citationTrace = [] } = useApiQuery<any[]>(['citation-trace', scopeKey], '/api/knowledge/citation-trace');
  const { data: evalMetrics } = useApiQuery<any>(['eval', scopeKey], '/api/knowledge/eval');
  const normalizedEvalMetrics = useMemo(() => normalizeEvalMetrics(evalMetrics), [evalMetrics]);
  const { data: topChunks = [] } = useApiQuery<KnowledgeRetrievalResult[]>(['knowledge', 'chunks', 'top', scopeKey], '/api/knowledge/chunks/top');
  const { data: sourceConnections = [] } = useApiQuery<KnowledgeSourceConnection[]>(['knowledge', 'sources', scopeKey], '/api/knowledge/sources');
  const { data: governance } = useApiQuery<KnowledgeGovernancePolicy>(['knowledge', 'governance', scopeKey], '/api/knowledge/governance');
  const { data: knowledgeAudit = [] } = useApiQuery<KnowledgeAuditEvent[]>(['knowledge', 'audit', scopeKey], '/api/knowledge/audit');
  const { data: knowledgePackages = [] } = useApiQuery<KnowledgePackage[]>(['knowledge', 'packages', scopeKey], '/api/knowledge/packages');
  const { data: processingJobs = [] } = useApiQuery<KnowledgeProcessingJob[]>(['knowledge', 'processing-jobs', scopeKey], '/api/knowledge/processing-jobs', undefined, {
    refetchInterval: (query) => {
      const list = query.state.data as KnowledgeProcessingJob[] | undefined;
      return Array.isArray(list) && list.some((job) => job.status === 'queued' || job.status === 'running') ? 1500 : false;
    },
  });
  const { data: retrievalProfiles = [] } = useApiQuery<KnowledgeRetrievalProfile[]>(['knowledge', 'retrieval-profiles', scopeKey], '/api/knowledge/retrieval-profiles');
  const { data: evaluations = [] } = useApiQuery<KnowledgeEvaluation[]>(['knowledge', 'evaluations', scopeKey], '/api/knowledge/evaluations');
  const { data: graphEntities = [] } = useApiQuery<KnowledgeGraphEntity[]>(['knowledge', 'graph-entities', scopeKey], '/api/knowledge/graph/entities');
  const { data: graphRelations = [] } = useApiQuery<KnowledgeGraphRelation[]>(['knowledge', 'graph-relations', scopeKey], '/api/knowledge/graph/relations');
  const { data: consumerBindings = [] } = useApiQuery<KnowledgeConsumerBinding[]>(['knowledge', 'bindings', scopeKey], '/api/knowledge/bindings');

  // ===== Mutations =====
  const uploadStayRef = useRef(false);
  const uploadMutation = useApiMutation<KnowledgeDoc, { title: string; source: string; tags: string; content: string; fileName?: string; packageId?: string }>('/api/knowledge/docs', {
    onSuccess: (doc) => {
      setActiveModal(null);
      setGovernanceNotice(`文档「${doc.title}」已进入解析与索引队列。`);
      if (uploadStayRef.current) {
        uploadStayRef.current = false;
        return;
      }
      if (doc.packageId) navigate(`/knowledge/packages/${encodeURIComponent(doc.packageId)}?step=processing`);
      else if (doc.id) navigate(`/knowledge/docs/${encodeURIComponent(doc.id)}`);
    },
  });
  const reindexMutation = useApiMutation<{ status: string; affected: number }, { kb: string }>('/api/knowledge/reindex', {
    onSuccess: (result) => {
      setReindexConfirm(false);
      setGovernanceNotice(`索引重建任务已创建，影响 ${result.affected} 项资产。`);
    },
  });
  const reviewMutation = useApiMutation<{ ids: string[] }, { ids: string[] }>('/api/knowledge/docs/review', {
    onSuccess: (result) => {
      setSelectedDocumentIds([]);
      setGovernanceNotice(`已发起 ${result.ids.length} 项知识资产复核。`);
    },
  });
  const deleteDocsMutation = useApiMutation<{ deleted: number; ids: string[] }, { ids: string[] }>('/api/knowledge/docs/delete', {
    onSuccess: (result) => {
      setDeleteConfirm(null);
      setSelectedDocumentIds((prev) => prev.filter((id) => !result.ids.includes(id)));
      if (docPreviewId && result.ids.includes(docPreviewId)) {
        setShowDetails(false);
        setDocPreviewId(null);
        navigate('/knowledge');
      }
      setGovernanceNotice(`已删除 ${result.deleted} 项知识文档，相关切片与引用痕迹已清理。`);
    },
  });
  const retrieveMutation = useApiMutation<{ results: KnowledgeRetrievalResult[]; metrics: unknown }, { query: string; kb: string }>('/api/knowledge/retrieve', {
    onSuccess: (result, vars) => {
      setRetrieveResults(normalizeRetrievalResults(result.results));
      setGovernanceNotice(`已完成「${vars.query}」检索验证，返回 ${result.results.length} 条证据。`);
    },
  });
  const rescoreMutation = useApiMutation<KnowledgeRetrievalResult[], Record<string, never>>('/api/knowledge/chunks/rescore', {
    onSuccess: () => setGovernanceNotice('证据重新评分完成，已刷新 Top-K 结果。'),
  });
  const sourceMutation = useApiMutation<KnowledgeSourceConnection, import('@/features/knowledge/components/ConnectSourceForm').ConnectSourceForm>(
    '/api/knowledge/sources',
    { onError: (err) => setGovernanceNotice(err instanceof Error ? err.message : '接入数据源失败。') },
  );
  const sourceSyncMutation = useApiMutation<KnowledgeSourceConnection, { id: string }>(
    ({ id }) => `/api/knowledge/sources/${id}/sync`,
    {
      onSuccess: (source) => setGovernanceNotice(`数据源「${source.name}」同步完成。`),
      onError: (err) => setGovernanceNotice(err instanceof Error ? err.message : '数据源同步失败。'),
    },
  );
  const governanceMutation = useApiMutation<KnowledgeGovernancePolicy, Partial<KnowledgeGovernancePolicy>>('/api/knowledge/governance', {
    onSuccess: (policy) => setGovernanceNotice(policy.versionRetention ? '版本保留策略已启用并写入审计。' : '版本保留策略已暂停，请确认合规风险。'),
  }, 'PATCH');
  const createPackageMutation = useApiMutation<KnowledgePackage, { name: string; description: string; domain: string; classification: KnowledgePackage['classification'] }>('/api/knowledge/packages', {
    onSuccess: (item) => {
      setActiveModal(null);
      setHighlightedPackageId(item.id);
      setGovernanceNotice(`知识包「${item.name}」已创建，请纳管文档后完成加工与评测再发布。`);
    },
  });
  const publishPackageMutation = useApiMutation<KnowledgePackage, { id: string }>(
    ({ id }) => `/api/knowledge/packages/${id}/publish`,
    {
      onSuccess: (item) => setGovernanceNotice(`知识包「${item.name}」${item.currentVersion.version} 已发布，可供智能体与工作流引用。`),
      onError: (err) => setGovernanceNotice(err instanceof Error ? err.message : '发布失败，请检查纳管文档与评测门禁。'),
    },
  );
  const processPackageMutation = useApiMutation<KnowledgeProcessingJob, { id: string; strategy: KnowledgeProcessingJob['strategy'] }>(
    ({ id }) => `/api/knowledge/packages/${id}/process`,
    {
      onSuccess: (job) => { setGovernanceNotice(`已启动 ${job.strategy} 切片与 ${job.indexVersion} 索引构建。`); },
      onError: (err) => setGovernanceNotice(err instanceof Error ? err.message : '加工启动失败。'),
    },
  );
  const attachPackageMutation = useApiMutation<KnowledgePackage, { id: string; docIds: string[] }>(
    ({ id }) => `/api/knowledge/packages/${id}/attach`,
    {
      onSuccess: (item) => {
        setHighlightedPackageId(item.id);
        setGovernanceNotice(`已向「${item.name}」纳管文档，当前 ${item.documentCount} 篇。${item.status === 'review' ? ' 已发布包需重新加工/发布。' : ''}`);
      },
      onError: (err) => setGovernanceNotice(err instanceof Error ? err.message : '纳管失败。'),
    },
  );
  const updatePackageMutation = useApiMutation<KnowledgePackage, { id: string; name: string; description: string; domain: string; classification: KnowledgePackage['classification'] }>(
    ({ id }) => `/api/knowledge/packages/${id}/update`,
    {
      onSuccess: (item) => setGovernanceNotice(`知识包「${item.name}」资料已更新。`),
      onError: (err) => setGovernanceNotice(err instanceof Error ? err.message : '保存知识包资料失败。'),
    },
  );
  const deletePackageMutation = useApiMutation<{ id: string; deleted: boolean }, { id: string }>(
    ({ id }) => `/api/knowledge/packages/${id}/delete`,
    {
      onSuccess: (_result, vars) => {
        if (highlightedPackageId === vars.id) setHighlightedPackageId(null);
        setGovernanceNotice('知识包已删除；包内文档已解除归属并保留。');
      },
      onError: (err) => setGovernanceNotice(err instanceof Error ? err.message : '删除知识包失败。'),
    },
  );
  const retryJobMutation = useApiMutation<KnowledgeProcessingJob, { id: string }>(({ id }) => `/api/knowledge/processing-jobs/${id}/retry`, {
    onSuccess: (job) => setGovernanceNotice(`加工任务「${job.source}」已重新进入队列。`),
  });
  const evaluationMutation = useApiMutation<KnowledgeEvaluation, { packageId: string; profileId: string }>('/api/knowledge/evaluations/run', {
    onSuccess: (item) => setGovernanceNotice(`评测完成：Recall@K ${(item.recallAtK * 100).toFixed(0)}%，引用正确率 ${(item.citationAccuracy * 100).toFixed(0)}%。`),
  });

  // ===== 派生 / KPI =====
  const allTags = useMemo(() => {
    const s = new Set<string>();
    docs.forEach((d) => {
      const source = typeof d.source === 'string' ? d.source.trim() : '';
      if (source) s.add(source);
    });
    return Array.from(s);
  }, [docs]);
  const filteredDocs = useMemo(() => {
    return docs.filter((d) => {
      if (tagFilter && d.source !== tagFilter) return false;
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (searchQ && !d.title.toLowerCase().includes(searchQ.toLowerCase())) return false;
      return true;
    });
  }, [docs, statusFilter, tagFilter, searchQ]);

  const isReindexing = reindexMutation.isPending;
  const pendingIndexCount = docs.filter((doc) => doc.status === 'indexing' || doc.status === 'parsing').length
    + processingJobs.filter((job) => job.status === 'queued' || job.status === 'running').length
    + (isReindexing ? 1 : 0);
  const publishedPackageCount = knowledgePackages.filter((item) => item.status === 'published').length;
  const pendingPackageCount = knowledgePackages.filter((item) => item.status !== 'published').length;
  const healthySourceCount = sourceConnections.filter((item) => normalizeSourceStatus(item.status) === 'healthy').length;
  const attentionSourceCount = sourceConnections.filter((item) => normalizeSourceStatus(item.status) === 'attention').length;
  const sourceDocumentTotal = sourceConnections.reduce((total, item) => total + item.documents, 0);
  const failedJobCount = processingJobs.filter((item) => item.status === 'failed').length;
  const activeJobCount = processingJobs.filter((item) => item.status === 'running' || item.status === 'queued').length;
  const syncingSourceCount = sourceConnections.filter((item) => normalizeSourceStatus(item.status) === 'syncing').length
    + (sourceSyncMutation.isPending ? 1 : 0);

  const filteredProcessingJobs = useMemo(() => {
    if (jobStatusFilter === 'all') return processingJobs;
    if (jobStatusFilter === 'running') return processingJobs.filter((item) => item.status === 'running' || item.status === 'queued');
    return processingJobs.filter((item) => item.status === jobStatusFilter);
  }, [jobStatusFilter, processingJobs]);

  const pendingReviewPackages = knowledgePackages.filter((item) => item.status !== 'published');

  const pipelineStages = useMemo<PipelineStage[]>(() => {
    return PIPELINE.map((stage) => {
      let tone: PipelineTone = 'default';
      let statusLabel = '默认能力';
      if (stage.target === 'sources') {
        if (attentionSourceCount > 0) { tone = 'attention'; statusLabel = `${attentionSourceCount} 需关注`; }
        else if (syncingSourceCount > 0) { tone = 'active'; statusLabel = '同步中'; }
        else if (sourceConnections.length > 0) { statusLabel = `${sourceConnections.length} 个数据源`; }
        else { statusLabel = '待接入'; }
      } else if (stage.target === 'jobs') {
        if (failedJobCount > 0) { tone = 'attention'; statusLabel = `${failedJobCount} 失败`; }
        else if (activeJobCount > 0) { tone = 'active'; statusLabel = `${activeJobCount} 进行中`; }
        else { statusLabel = '查看任务'; }
      } else {
        statusLabel = '检索验证';
      }
      return { ...stage, tone, statusLabel };
    });
  }, [activeJobCount, attentionSourceCount, failedJobCount, sourceConnections.length, syncingSourceCount]);

  const selectedCount = selectedDocumentIds.length;
  const activeCitation = citationTrace[0] ?? null;

  // ===== Handlers =====
  const handleUploadDoc = useCallback((form: { title: string; source: string; tags: string; content: string; fileName?: string; packageId?: string }, opts?: { stay?: boolean }) => {
    uploadStayRef.current = Boolean(opts?.stay);
    uploadMutation.mutate(form);
  }, [uploadMutation]);
  // 单一知识目录下的重建始终覆盖全部可用资产，而不是某个空间子集。
  const handleReindex = useCallback(() => reindexMutation.mutate({ kb: 'all' }), [reindexMutation]);
  const handleRescore = useCallback(() => rescoreMutation.mutate({}), [rescoreMutation]);
  const requestDeleteDocs = useCallback((ids: string[]) => {
    const targets = docs.filter((doc) => ids.includes(doc.id));
    if (!targets.length) return;
    setDeleteConfirm({
      ids: targets.map((doc) => doc.id),
      titles: targets.map((doc) => doc.title),
      citeTotal: targets.reduce((sum, doc) => sum + (doc.citeCount ?? 0), 0),
    });
  }, [docs]);
  const handleDeleteDocs = useCallback(() => {
    if (!deleteConfirm?.ids.length) return;
    deleteDocsMutation.mutate({ ids: deleteConfirm.ids });
  }, [deleteConfirm, deleteDocsMutation]);
  const toggleDocument = useCallback((id: string) => {
    setSelectedDocumentIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  }, []);
  const openDocument = useCallback((id: string) => {
    setDocPreviewId(id);
    setEditingContent(false);
    setShowDetails(false);
    navigate(`/knowledge/docs/${encodeURIComponent(id)}`);
  }, [navigate]);
  const downloadOriginal = useCallback(() => {
    if (!docDetail) return;
    const blob = new Blob([docDetail.content ?? ''], { type: 'text/markdown;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `${docDetail.title ?? 'knowledge-content'}.md`; link.click(); URL.revokeObjectURL(link.href);
  }, [docDetail]);
  const syncSource = useCallback((id: string) => sourceSyncMutation.mutate({ id }), [sourceSyncMutation]);
  const connectSource = useCallback(async (form: import('@/features/knowledge/components/ConnectSourceForm').ConnectSourceForm) => {
    try {
      const source = await sourceMutation.mutateAsync(form);
      setActiveModal(null);
      if (form.syncNow && source.kind !== 'Webhook') {
        try {
          await sourceSyncMutation.mutateAsync({ id: source.id });
          setGovernanceNotice(`数据源「${source.name}」已接入并完成首次同步。`);
        } catch {
          setGovernanceNotice(`数据源「${source.name}」已接入，但首次同步失败，可在列表中重试。`);
        }
        return source;
      }
      setGovernanceNotice(
        source.kind === 'Webhook'
          ? `Webhook「${source.name}」已接入，回调地址已签发，等待事件推送。`
          : `数据源「${source.name}」已接入，等待首次同步。`,
      );
      return source;
    } catch {
      return null;
    }
  }, [sourceMutation, sourceSyncMutation]);

  const focusPipelineTarget = useCallback((target: PipelineTarget) => {
    if (target === 'retrieval') {
      setWorkspace('retrieval');
      return;
    }
    if (target === 'jobs') {
      setJobStatusFilter(failedJobCount > 0 ? 'failed' : activeJobCount > 0 ? 'running' : 'all');
      requestAnimationFrame(() => jobsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    requestAnimationFrame(() => sourcesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [failedJobCount, activeJobCount]);

  return {
    // Identity & permissions
    user, canWrite, pageCopy, allowedTabs, scopeKey, workspaceName,

    // Workspace state
    workspace, setWorkspace,
    assetsView, setAssetsView,
    highlightedPackageId, setHighlightedPackageId,

    // Doc / job filters
    jobStatusFilter, setJobStatusFilter,
    searchQ, setSearchQ,
    statusFilter, setStatusFilter,
    contentPage, setContentPage,
    tagFilter, setTagFilter,
    selectedDocumentIds, setSelectedDocumentIds,
    selectedCount,

    // Doc reader / chunk drawer
    docPreviewId, setDocPreviewId,
    showDetails, setShowDetails,
    editingContent, setEditingContent,
    chunkDrawer, setChunkDrawer,

    // Retrieval / graph
    testQuery, setTestQuery,
    retrieveResults, setRetrieveResults,
    selectedGraphEntityId, setSelectedGraphEntityId,

    // Modal / confirm
    activeModal, setActiveModal,
    reindexConfirm, setReindexConfirm,
    deleteConfirm, setDeleteConfirm,

    // Notice
    governanceNotice, setGovernanceNotice,

    // Refs
    sourcesSectionRef, jobsSectionRef,

    // Server queries (raw)
    docs, docDetail, citationTrace, evalMetrics, normalizedEvalMetrics, topChunks,
    sourceConnections, governance, knowledgeAudit, knowledgePackages, processingJobs,
    retrievalProfiles, evaluations, graphEntities, graphRelations, consumerBindings,

    // Computed
    pendingIndexCount, isReindexing,
    publishedPackageCount, pendingPackageCount,
    healthySourceCount, attentionSourceCount, sourceDocumentTotal,
    failedJobCount, activeJobCount, syncingSourceCount,
    filteredProcessingJobs, pendingReviewPackages,
    pipelineStages,
    allTags, filteredDocs, contentPageCount: Math.max(1, Math.ceil(filteredDocs.length / 10)),
    activeContentPage: Math.min(contentPage, Math.max(1, Math.ceil(filteredDocs.length / 10))),
    paginatedDocs: filteredDocs.slice((Math.min(contentPage, Math.max(1, Math.ceil(filteredDocs.length / 10))) - 1) * 10, Math.min(contentPage, Math.max(1, Math.ceil(filteredDocs.length / 10))) * 10),
    activeCitation,

    // Mutations
    uploadMutation, reindexMutation, reviewMutation, deleteDocsMutation,
    retrieveMutation, rescoreMutation, sourceMutation, sourceSyncMutation,
    governanceMutation, createPackageMutation, publishPackageMutation,
    processPackageMutation, attachPackageMutation, updatePackageMutation, deletePackageMutation,
    retryJobMutation, evaluationMutation,

    // Handlers
    handleUploadDoc, handleReindex, handleRescore,
    handleDeleteDocs, requestDeleteDocs,
    toggleDocument, openDocument, downloadOriginal,
    syncSource, connectSource,
    focusPipelineTarget,
  };
}