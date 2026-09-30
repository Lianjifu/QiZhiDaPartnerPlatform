/**
 * P7 知识库（企业级优化版）
 * 增强：所有按钮接入交互，纯前端 state 化演示。
 */
import { useState, useMemo, useRef, useEffect, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReactFlow, { Background, Controls, Handle, MarkerType, Position, useEdgesState, useNodesState, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { useApiMutation, useApiQuery } from '@/services/query';
import { Badge, Button, Input, KpiCard } from '@de/web-ui';
import {
  Database, FileText, Brain, Layers, Search, Upload, ShieldCheck, BookOpen,
  Plus, Eye, RefreshCw, Tag as TagIcon, Download, Trash2,
  CheckCircle2, Clock3, Link2, RotateCcw, ShieldAlert,
  Users, Network, Boxes, PlayCircle, Pencil, TrendingUp, Activity, Hash, ChevronRight,
  Sparkles,
} from 'lucide-react';
import type { KnowledgeAuditEvent, KnowledgeConsumerBinding, KnowledgeDoc, KnowledgeEvaluation, KnowledgeGovernancePolicy, KnowledgeGraphEntity, KnowledgeGraphRelation, KnowledgePackage, KnowledgeProcessingJob, KnowledgeRetrievalProfile, KnowledgeRetrievalResult, KnowledgeSourceConnection } from '@de/web-types';
import { cn } from '@de/web-utils';
import { Modal, ConfirmDialog, EmptyState, RoleReadonlyBanner } from '@/components/shared';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useT } from '@/i18n';
import { defaultKnowledgeTab, roleCanMutate, rolePageCopy, visibleKnowledgeTabs } from '@/features/role-nav/role-nav';
import { DocumentPaperPreview } from '@/features/knowledge/DocumentPaperPreview';
import { PackageWorkbench } from '@/features/knowledge/PackageWorkbench';
import { ChunkDetailModal, EvidenceResultList } from '@/features/knowledge/ChunkEvidence';
import { ProcessingWorkbench } from '@/features/knowledge/ProcessingWorkbench';
import { ConnectSourceModal, type ConnectSourceForm } from '@/features/knowledge/ConnectSourceModal';
import {
  docQualityBarValue,
  formatDocQualityAverage,
  formatEvalMs,
  formatEvalPercent,
  formatHealthLatencySub,
  formatHealthPercent,
  normalizeEvalMetrics,
  normalizeRetrievalResults,
  normalizeSourceStatus,
  packageReadyToPublish,
} from '@/features/knowledge/knowledge-ui';

type PipelineTarget = 'sources' | 'jobs' | 'retrieval';
type PipelineTone = 'default' | 'active' | 'attention';

const PIPELINE: Array<{
  key: string;
  label: string;
  icon: typeof Upload;
  capability: string;
  target: PipelineTarget;
}> = [
  { key: 'ingest', label: '接入', icon: Upload, capability: 'Tika + PaddleOCR', target: 'sources' },
  { key: 'chunk', label: '切片', icon: FileText, capability: '512 tokens · 64 overlap', target: 'jobs' },
  { key: 'embed', label: '向量化', icon: Brain, capability: 'BGE-M3 · 1024 维', target: 'jobs' },
  { key: 'index', label: '索引', icon: Layers, capability: 'Milvus HNSW', target: 'jobs' },
  { key: 'retrieve', label: '检索', icon: Search, capability: 'Top-K=8 + Rerank', target: 'retrieval' },
];

const OWNER_LABEL: Record<string, string> = { u1: '平台管理员', u2: '业务构建者', u3: '合规审计员' };

function docVersionFromTitle(title: string) {
  return title.match(/v[\d.]+/i)?.[0] ?? 'v1.0';
}

function docOwnerLabel(doc: KnowledgeDoc) {
  return OWNER_LABEL[doc.ownerId ?? 'u1'] ?? '未指定';
}

const KB_TYPE_OPTIONS = ['Runbook', 'CMDB', 'CVE', 'SIEM', 'Postmortem', '变更方案', '合规文档'];
const CONTENT_PAGE_SIZE = 10;

type ModalKind = 'upload' | 'reindex' | 'citationAgents' | 'connectSource' | 'newPackage' | null;
type KnowledgeWorkspace = 'assets' | 'processing' | 'retrieval' | 'graph' | 'governance';
type AssetsView = 'docs' | 'packages';

export default function Knowledge() {
  const { t } = useT();
  const { user } = useAuthStore();
  const [searchParams] = useSearchParams();
  const permissionWrite = Boolean(user?.permissions.includes('knowledge.write'));
  const canWrite = permissionWrite && roleCanMutate(user?.role);
  const pageCopy = rolePageCopy('knowledge', user?.role);
  const allowedTabs = visibleKnowledgeTabs(user?.role);
  const currentWorkspace = useWorkspaceStore((state) => state.current);
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId ?? 'w1');
  const scopeKey = `${currentWorkspaceId}:${user?.id ?? 'anonymous'}`;
  const workspaceName = currentWorkspace?.name ?? 'ACME 生产';

  const [workspace, setWorkspace] = useState<KnowledgeWorkspace>(() => defaultKnowledgeTab(user?.role));
  const [assetsView, setAssetsView] = useState<AssetsView>('docs');
  const [highlightedPackageId, setHighlightedPackageId] = useState<string | null>(null);
  const [jobStatusFilter, setJobStatusFilter] = useState<'all' | 'running' | 'succeeded' | 'failed'>('all');
  const [docPreviewId, setDocPreviewId] = useState<string | null>('k1');
  const [chunkDrawer, setChunkDrawer] = useState<any | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [activeModal, setActiveModal] = useState<ModalKind>(null);
  const [reindexConfirm, setReindexConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: string[]; titles: string[]; citeTotal: number } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'indexing'>('all');
  const [contentPage, setContentPage] = useState(1);
  const [selectedGraphEntityId, setSelectedGraphEntityId] = useState<string | null>(null);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [governanceNotice, setGovernanceNotice] = useState('所有知识资产均处于可追溯治理范围内');
  const [testQuery, setTestQuery] = useState('');
  const [retrieveResults, setRetrieveResults] = useState<KnowledgeRetrievalResult[]>([]);
  const sourcesSectionRef = useRef<HTMLElement>(null);
  const jobsSectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const packageId = searchParams.get('package');
    const view = searchParams.get('view');
    if (!packageId && view !== 'packages') return;
    setWorkspace('assets');
    if (view === 'packages' || packageId) setAssetsView('packages');
    if (packageId) {
      setHighlightedPackageId(packageId);
      setGovernanceNotice('已定位记忆晋升生成的知识包草稿，请完成加工与评测后发布。');
    }
  }, [searchParams]);

  const isAssets = workspace === 'assets';
  const isProcessing = workspace === 'processing';
  const isRetrieval = workspace === 'retrieval';
  const isGraph = workspace === 'graph';
  const isGovernance = workspace === 'governance';

  const { data: docs = [] } = useApiQuery<KnowledgeDoc[]>(['knowledge', 'docs', scopeKey], '/api/knowledge/docs', undefined, {
    enabled: isAssets || isRetrieval,
    refetchInterval: (query) => {
      const list = query.state.data as KnowledgeDoc[] | undefined;
      return Array.isArray(list) && list.some((doc) => doc.status === 'indexing' || doc.status === 'parsing') ? 1500 : false;
    },
  });
  const { data: docDetail } = useApiQuery<any>(['doc', docPreviewId, scopeKey], `/api/knowledge/doc/${docPreviewId ?? 'k1'}`, undefined, { enabled: isAssets && Boolean(docPreviewId) && showDetails });
  const { data: citationTrace = [] } = useApiQuery<any[]>(['citation-trace', scopeKey], '/api/knowledge/citation-trace', undefined, { enabled: isAssets || isGovernance });
  const { data: evalMetrics } = useApiQuery<any>(['eval', scopeKey], '/api/knowledge/eval', undefined, { enabled: isAssets || isRetrieval });
  const normalizedEvalMetrics = useMemo(() => normalizeEvalMetrics(evalMetrics), [evalMetrics]);
  const { data: topChunks = [] } = useApiQuery<KnowledgeRetrievalResult[]>(['knowledge', 'chunks', 'top', scopeKey], '/api/knowledge/chunks/top', undefined, { enabled: isAssets || isRetrieval });
  const { data: sourceConnections = [] } = useApiQuery<KnowledgeSourceConnection[]>(['knowledge', 'sources', scopeKey], '/api/knowledge/sources', undefined, { enabled: isProcessing });
  const { data: governance } = useApiQuery<KnowledgeGovernancePolicy>(['knowledge', 'governance', scopeKey], '/api/knowledge/governance', undefined, { enabled: isGovernance });
  const { data: knowledgeAudit = [] } = useApiQuery<KnowledgeAuditEvent[]>(['knowledge', 'audit', scopeKey], '/api/knowledge/audit', undefined, { enabled: isGovernance });
  const { data: knowledgePackages = [] } = useApiQuery<KnowledgePackage[]>(['knowledge', 'packages', scopeKey], '/api/knowledge/packages', undefined, { enabled: isAssets || isRetrieval || isProcessing });
  const { data: processingJobs = [] } = useApiQuery<KnowledgeProcessingJob[]>(['knowledge', 'processing-jobs', scopeKey], '/api/knowledge/processing-jobs', undefined, {
    enabled: isProcessing || isAssets,
    refetchInterval: (query) => {
      const list = query.state.data as KnowledgeProcessingJob[] | undefined;
      return Array.isArray(list) && list.some((job) => job.status === 'queued' || job.status === 'running') ? 1500 : false;
    },
  });
  const { data: retrievalProfiles = [] } = useApiQuery<KnowledgeRetrievalProfile[]>(['knowledge', 'retrieval-profiles', scopeKey], '/api/knowledge/retrieval-profiles', undefined, { enabled: isRetrieval });
  const { data: evaluations = [] } = useApiQuery<KnowledgeEvaluation[]>(['knowledge', 'evaluations', scopeKey], '/api/knowledge/evaluations', undefined, { enabled: isRetrieval });
  const { data: graphEntities = [] } = useApiQuery<KnowledgeGraphEntity[]>(['knowledge', 'graph-entities', scopeKey], '/api/knowledge/graph/entities', undefined, { enabled: isGraph });
  const { data: graphRelations = [] } = useApiQuery<KnowledgeGraphRelation[]>(['knowledge', 'graph-relations', scopeKey], '/api/knowledge/graph/relations', undefined, { enabled: isGraph });
  const { data: consumerBindings = [] } = useApiQuery<KnowledgeConsumerBinding[]>(['knowledge', 'bindings', scopeKey], '/api/knowledge/bindings', undefined, { enabled: isGovernance });

  const uploadMutation = useApiMutation<KnowledgeDoc, { title: string; source: string; tags: string; content: string; fileName?: string }>('/api/knowledge/docs', { onSuccess: (doc) => { setActiveModal(null); setAssetsView('docs'); setGovernanceNotice(`文档「${doc.title}」已进入解析与索引队列。`); } });
  const reindexMutation = useApiMutation<{ status: string; affected: number }, { kb: string }>('/api/knowledge/reindex', { onSuccess: (result) => { setReindexConfirm(false); setGovernanceNotice(`索引重建任务已创建，影响 ${result.affected} 项资产。`); } });
  const reviewMutation = useApiMutation<{ ids: string[] }, { ids: string[] }>('/api/knowledge/docs/review', { onSuccess: (result) => { setSelectedDocumentIds([]); setGovernanceNotice(`已发起 ${result.ids.length} 项知识资产复核。`); } });
  const deleteDocsMutation = useApiMutation<{ deleted: number; ids: string[] }, { ids: string[] }>('/api/knowledge/docs/delete', {
    onSuccess: (result) => {
      setDeleteConfirm(null);
      setSelectedDocumentIds((prev) => prev.filter((id) => !result.ids.includes(id)));
      if (docPreviewId && result.ids.includes(docPreviewId)) {
        setShowDetails(false);
        setDocPreviewId(null);
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
  const rescoreMutation = useApiMutation<KnowledgeRetrievalResult[], Record<string, never>>('/api/knowledge/chunks/rescore', { onSuccess: () => setGovernanceNotice('证据重新评分完成，已刷新 Top-K 结果。') });
  const sourceMutation = useApiMutation<KnowledgeSourceConnection, ConnectSourceForm>(
    '/api/knowledge/sources',
    {
      onError: (err) => setGovernanceNotice(err instanceof Error ? err.message : '接入数据源失败。'),
    },
  );
  const sourceSyncMutation = useApiMutation<KnowledgeSourceConnection, { id: string }>(
    ({ id }) => `/api/knowledge/sources/${id}/sync`,
    {
      onSuccess: (source) => setGovernanceNotice(`数据源「${source.name}」同步完成。`),
      onError: (err) => setGovernanceNotice(err instanceof Error ? err.message : '数据源同步失败。'),
    },
  );
  const governanceMutation = useApiMutation<KnowledgeGovernancePolicy, Partial<KnowledgeGovernancePolicy>>('/api/knowledge/governance', { onSuccess: (policy) => setGovernanceNotice(policy.versionRetention ? '版本保留策略已启用并写入审计。' : '版本保留策略已暂停，请确认合规风险。') }, 'PATCH');
  const createPackageMutation = useApiMutation<KnowledgePackage, { name: string; description: string; domain: string; classification: KnowledgePackage['classification'] }>('/api/knowledge/packages', { onSuccess: (item) => { setActiveModal(null); setWorkspace('assets'); setAssetsView('packages'); setHighlightedPackageId(item.id); setGovernanceNotice(`知识包「${item.name}」已创建，请纳管文档后完成加工与评测再发布。`); } });
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
      onSuccess: (job) => { setWorkspace('processing'); setGovernanceNotice(`已启动 ${job.strategy} 切片与 ${job.indexVersion} 索引构建。`); },
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
  const retryJobMutation = useApiMutation<KnowledgeProcessingJob, { id: string }>(({ id }) => `/api/knowledge/processing-jobs/${id}/retry`, { onSuccess: (job) => setGovernanceNotice(`加工任务「${job.source}」已重新进入队列。`) });
  const evaluationMutation = useApiMutation<KnowledgeEvaluation, { packageId: string; profileId: string }>('/api/knowledge/evaluations/run', { onSuccess: (item) => setGovernanceNotice(`评测完成：Recall@K ${(item.recallAtK * 100).toFixed(0)}%，引用正确率 ${(item.citationAccuracy * 100).toFixed(0)}%。`) });

  // 标签筛选：忽略空来源，避免 key={undefined} 触发 React 列表告警
  const allTags = useMemo(() => {
    const s = new Set<string>();
    docs.forEach((d) => {
      const source = typeof d.source === 'string' ? d.source.trim() : '';
      if (source) s.add(source);
    });
    return Array.from(s);
  }, [docs]);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const filteredDocs = useMemo(() => {
    return docs.filter((d) => {
      if (tagFilter && d.source !== tagFilter) return false;
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (searchQ && !d.title.toLowerCase().includes(searchQ.toLowerCase())) return false;
      return true;
    });
  }, [docs, statusFilter, tagFilter, searchQ]);
  const contentPageCount = Math.max(1, Math.ceil(filteredDocs.length / CONTENT_PAGE_SIZE));
  const activeContentPage = Math.min(contentPage, contentPageCount);
  const paginatedDocs = filteredDocs.slice((activeContentPage - 1) * CONTENT_PAGE_SIZE, activeContentPage * CONTENT_PAGE_SIZE);

  const searchResults = retrieveResults;

  const isReindexing = reindexMutation.isPending;
  const pendingIndexCount = docs.filter((doc) => doc.status === 'indexing' || doc.status === 'parsing').length
    + processingJobs.filter((job) => job.status === 'queued' || job.status === 'running').length
    + (isReindexing ? 1 : 0);

  // Handlers
  const handleUploadDoc = (form: { title: string; source: string; tags: string; content: string; fileName?: string }) => uploadMutation.mutate(form);
  // 单一知识目录下的重建始终覆盖全部可用资产，而不是某个空间子集。
  const handleReindex = () => reindexMutation.mutate({ kb: 'all' });
  const handleRescore = () => rescoreMutation.mutate({});
  const requestDeleteDocs = (ids: string[]) => {
    const targets = docs.filter((doc) => ids.includes(doc.id));
    if (!targets.length) return;
    setDeleteConfirm({
      ids: targets.map((doc) => doc.id),
      titles: targets.map((doc) => doc.title),
      citeTotal: targets.reduce((sum, doc) => sum + (doc.citeCount ?? 0), 0),
    });
  };
  const handleDeleteDocs = () => {
    if (!deleteConfirm?.ids.length) return;
    deleteDocsMutation.mutate({ ids: deleteConfirm.ids });
  };

  const activeCitation = citationTrace[0] ?? null;
  const selectedCount = selectedDocumentIds.length;
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

  const pipelineStages = useMemo(() => {
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

  const focusPipelineTarget = (target: PipelineTarget) => {
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
  };

  const toggleDocument = (id: string) => setSelectedDocumentIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  const openDocument = (id: string) => {
    setDocPreviewId(id);
    setEditingContent(false);
    setShowDetails(true);
  };
  const downloadOriginal = () => {
    if (!docDetail) return;
    const blob = new Blob([docDetail.content ?? ''], { type: 'text/markdown;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `${docDetail.title ?? 'knowledge-content'}.md`; link.click(); URL.revokeObjectURL(link.href);
  };
  const syncSource = (id: string) => sourceSyncMutation.mutate({ id });
  const connectSource = async (form: ConnectSourceForm) => {
    try {
      const source = await sourceMutation.mutateAsync(form);
      setActiveModal(null);
      setWorkspace('processing');
      if (form.syncNow && source.kind !== 'Webhook') {
        try {
          await sourceSyncMutation.mutateAsync({ id: source.id });
          setGovernanceNotice(`数据源「${source.name}」已接入并完成首次同步。`);
        } catch {
          setGovernanceNotice(`数据源「${source.name}」已接入，但首次同步失败，可在列表中重试。`);
        }
        return;
      }
      setGovernanceNotice(
        source.kind === 'Webhook'
          ? `Webhook「${source.name}」已接入，回调地址已签发，等待事件推送。`
          : `数据源「${source.name}」已接入，等待首次同步。`,
      );
    } catch {
      /* onError 已提示 */
    }
  };

  return (
    <div className="knowledge-page de-employee-page h-full min-w-0 overflow-y-auto overscroll-contain bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5">
      <div className="space-y-3">
        <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
          <div className="flex items-start justify-between gap-4 px-4 py-3.5 md:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg">
                  <BookOpen className="h-4 w-4" />
                </div>
                <h1 className="text-base font-semibold text-[var(--text)]">{pageCopy.title}</h1>
              </div>
              <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{pageCopy.subtitle}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Badge tone="info">{workspaceName}</Badge>
              {!canWrite && <Badge tone="neutral">只读</Badge>}
            </div>
          </div>
          <div className="px-4 pt-1 md:px-5"><RoleReadonlyBanner className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]" /></div>
          <div className="de-employee-tabs flex overflow-x-auto px-3" role="tablist" aria-label="知识运营分区">
            {[
              { key: 'assets' as const, labelKey: 'module.knowledge.tabs.assets', icon: FileText },
              { key: 'processing' as const, labelKey: 'module.knowledge.tabs.processing', icon: Layers },
              { key: 'retrieval' as const, labelKey: 'module.knowledge.tabs.retrieval', icon: Search },
              { key: 'graph' as const, labelKey: 'module.knowledge.tabs.graph', icon: Network },
              { key: 'governance' as const, labelKey: 'module.knowledge.tabs.governance', icon: ShieldCheck },
            ].filter((item) => allowedTabs.includes(item.key)).map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={workspace === item.key}
                onClick={() => setWorkspace(item.key)}
                className={cn('de-employee-tab flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-xs transition-colors', workspace === item.key && 'is-active')}
              >
                <item.icon className="h-3.5 w-3.5" />{t(item.labelKey)}
              </button>
            ))}
          </div>
        </section>
        {workspace === 'assets' ? (
          <div className="space-y-3">
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="受管文档" value={docs?.length ?? 0} sub="项" icon={FileText} tone="brand" size="comfortable" />
              <KpiCard label="待处理索引" value={pendingIndexCount} sub="项" icon={RefreshCw} tone={pendingIndexCount > 0 ? 'warn' : 'neutral'} size="comfortable" />
              <KpiCard label="检索健康度" value={formatHealthPercent(normalizedEvalMetrics)} sub={formatHealthLatencySub(normalizedEvalMetrics)} icon={Activity} tone={normalizedEvalMetrics?.recall != null ? 'success' : 'neutral'} size="comfortable" />
              <KpiCard label="智能体引用" value={citationTrace.reduce((total: number, item: any) => total + (item.citeCount ?? item.count ?? 0), 0)} sub="次" icon={Users} tone="neutral" size="comfortable" />
            </section>

            <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-5" style={{ boxShadow: 'var(--saas-divider)' }}>
                <div className="knowledge-assets-segment" role="tablist" aria-label="知识资产视图">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={assetsView === 'docs'}
                    className={cn(assetsView === 'docs' && 'is-active')}
                    onClick={() => setAssetsView('docs')}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    内容文档
                    <span className="knowledge-assets-segment__count">{docs.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={assetsView === 'packages'}
                    className={cn(assetsView === 'packages' && 'is-active')}
                    onClick={() => setAssetsView('packages')}
                  >
                    <Boxes className="h-3.5 w-3.5" />
                    知识包
                    <span className="knowledge-assets-segment__count">{knowledgePackages.length}</span>
                  </button>
                </div>
                {assetsView === 'docs' ? (
                  canWrite && <Button size="sm" onClick={() => setActiveModal('upload')}><Upload className="h-3.5 w-3.5" />上传内容</Button>
                ) : (
                  canWrite && <Button size="sm" variant="secondary" onClick={() => setActiveModal('newPackage')}><Plus className="h-3.5 w-3.5" />新建知识包</Button>
                )}
              </div>

              {assetsView === 'docs' ? (
                <>
                  {knowledgePackages.length > 0 && (
                    <button type="button" className="knowledge-package-strip" onClick={() => setAssetsView('packages')}>
                      <span className="flex min-w-0 items-center gap-2">
                        <Boxes className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
                        <span className="truncate text-[11px] text-[var(--text-secondary)]">
                          <strong className="font-semibold text-[var(--text)]">{publishedPackageCount}</strong> 个已发布知识包
                          {pendingPackageCount > 0 && <> · <strong className="font-semibold text-[var(--warning)]">{pendingPackageCount}</strong> 个待发布</>}
                          <span className="text-[var(--text-muted)]"> · 向智能体与工作流交付稳定版本</span>
                        </span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-[var(--brand)]">
                        管理知识包 <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  )}

                  <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-3 md:px-5">
                    <div>
                      <h2 className="text-sm font-semibold text-[var(--text)]">内容列表</h2>
                      <p className="mt-1 text-xs text-[var(--text-muted)]">按来源、生命周期与检索影响持续运营企业知识内容。</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
                        <Input placeholder="搜索标题、来源…" value={searchQ} onChange={(event) => { setSearchQ(event.target.value); setContentPage(1); }} className="de-employee-input h-8 w-48 bg-[var(--bg)] pl-8 text-xs md:w-56" />
                      </div>
                      <div className="knowledge-filter-group" role="group" aria-label="状态筛选">
                        {(['all', 'ready', 'indexing'] as const).map((status) => (
                          <button key={status} type="button" onClick={() => { setStatusFilter(status); setContentPage(1); }} className={cn(statusFilter === status && 'is-active')}>
                            {status === 'all' ? '全部' : status === 'ready' ? '已就绪' : '索引中'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-y border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2.5 md:px-5">
                    <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">来源</span>
                    <button type="button" onClick={() => { setTagFilter(null); setContentPage(1); }} className={cn('knowledge-source-chip', !tagFilter && 'is-active')}>全部</button>
                    {allTags.map((source) => (
                      <button key={`source:${source}`} type="button" onClick={() => { setTagFilter(tagFilter === source ? null : source); setContentPage(1); }} className={cn('knowledge-source-chip', tagFilter === source && 'is-active')}>
                        <TagIcon className="h-3 w-3" />{source}
                      </button>
                    ))}
                    <span className="ml-auto text-[11px] text-[var(--text-muted)]">共 {filteredDocs.length} 条</span>
                  </div>

                  {selectedCount > 0 && canWrite && (
                    <div className="knowledge-bulk-bar mx-4 mt-3 md:mx-5">
                      <span>已选择 {selectedCount} 项资产</span>
                      <Button size="sm" variant="secondary" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate({ ids: selectedDocumentIds })}>
                        <ShieldCheck className="h-3 w-3" />{reviewMutation.isPending ? '提交中…' : '发起复核'}
                      </Button>
                      <Button size="sm" variant="danger" disabled={deleteDocsMutation.isPending} onClick={() => requestDeleteDocs(selectedDocumentIds)}>
                        <Trash2 className="h-3 w-3" />删除
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setSelectedDocumentIds([])}>取消选择</Button>
                    </div>
                  )}

                  {filteredDocs.length === 0 ? (
                    <div className="p-6">
                      <EmptyState icon={FileText} title="没有匹配的内容" description="尝试清除筛选条件，或上传新的企业知识文档。" action={canWrite ? <Button size="sm" onClick={() => setActiveModal('upload')}><Upload className="h-3.5 w-3.5" />上传文档</Button> : undefined} />
                    </div>
                  ) : (
                    <>
                      <div className="knowledge-asset-table knowledge-asset-table--flush">
                        <div className="knowledge-asset-table__head">
                          <span />
                          <span>内容</span>
                          <span>来源与状态</span>
                          <span>质量与规模</span>
                          <span>影响</span>
                          <span>更新</span>
                          <span className="text-right">操作</span>
                        </div>
                        {paginatedDocs.map((doc) => (
                          <div
                            key={doc.id}
                            className={cn('knowledge-asset-row', doc.id === docPreviewId && showDetails && 'is-selected')}
                            onClick={() => openDocument(doc.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => event.key === 'Enter' && openDocument(doc.id)}
                          >
                            <span>
                              {canWrite && (
                                <input type="checkbox" checked={selectedDocumentIds.includes(doc.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleDocument(doc.id)} aria-label={`选择 ${doc.title}`} />
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="flex items-center gap-2.5">
                                <span className="knowledge-doc-icon"><FileText className="h-3.5 w-3.5" /></span>
                                <span className="min-w-0">
                                  <strong className="block truncate text-[12px] text-[var(--text)]">{doc.title}</strong>
                                  <small>责任人 {docOwnerLabel(doc)} · {docVersionFromTitle(doc.title)}</small>
                                </span>
                              </span>
                            </span>
                            <span className="flex flex-wrap items-center gap-2">
                              <Badge tone="info">{doc.source}</Badge>
                              <span className={cn('knowledge-status-dot', doc.status === 'ready' ? 'is-ready' : 'is-indexing')}>
                                {doc.status === 'ready' ? '已就绪' : '索引中'}
                              </span>
                            </span>
                            <span>
                              <strong className="font-mono text-xs text-[var(--text)]">{doc.chunks}</strong>
                              <small>{doc.sizeKb} KB · {doc.status === 'ready' ? '质量正常' : '等待构建'}</small>
                            </span>
                            <span>
                              <strong className="font-mono text-xs text-[var(--text)]">{doc.citeCount}</strong>
                              <small>引用次数</small>
                            </span>
                            <span className="text-[11px] tabular-nums text-[var(--text-secondary)]">{doc.updatedAt.slice(0, 10)}</span>
                            <span className="knowledge-row-actions justify-self-end">
                              <button
                                type="button"
                                className="knowledge-row-action"
                                onClick={(event) => { event.stopPropagation(); openDocument(doc.id); }}
                              >
                                <Eye className="h-3.5 w-3.5" />详情
                              </button>
                              {canWrite && (
                                <button
                                  type="button"
                                  className="knowledge-row-action is-danger"
                                  disabled={deleteDocsMutation.isPending}
                                  onClick={(event) => { event.stopPropagation(); requestDeleteDocs([doc.id]); }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />删除
                                </button>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-[var(--text-muted)] md:px-5" style={{ boxShadow: 'inset 0 1px 0 rgba(15,23,42,0.06)' }}>
                        <span>第 {activeContentPage} / {contentPageCount} 页 · 每页 {CONTENT_PAGE_SIZE} 条</span>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="secondary" disabled={activeContentPage === 1} onClick={() => setContentPage((page) => Math.max(1, page - 1))}>上一页</Button>
                          <Button size="sm" variant="secondary" disabled={activeContentPage === contentPageCount} onClick={() => setContentPage((page) => Math.min(contentPageCount, page + 1))}>下一页</Button>
                        </div>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <PackageWorkbench
                  packages={knowledgePackages}
                  docs={docs}
                  canWrite={canWrite}
                  highlightedPackageId={highlightedPackageId}
                  busy={publishPackageMutation.isPending || processPackageMutation.isPending || attachPackageMutation.isPending || deletePackageMutation.isPending}
                  onCreate={() => setActiveModal('newPackage')}
                  onOpenDoc={(docId) => { setAssetsView('docs'); openDocument(docId); }}
                  onProcess={(pkg) => processPackageMutation.mutate({ id: pkg.id, strategy: 'semantic' })}
                  onPublish={(pkg) => {
                    const gate = packageReadyToPublish(pkg);
                    if (!gate.ok) {
                      setGovernanceNotice(gate.reason ?? '暂不可发布');
                      return;
                    }
                    publishPackageMutation.mutate({ id: pkg.id });
                  }}
                  onAttach={(pkg, docIds) => attachPackageMutation.mutate({ id: pkg.id, docIds })}
                  onDelete={(pkg) => deletePackageMutation.mutate({ id: pkg.id })}
                  onViewBindings={() => setWorkspace('governance')}
                />
              )}
            </section>
          </div>
        ) : workspace === 'processing' ? (
          <ProcessingWorkbench
            sources={sourceConnections}
            jobs={filteredProcessingJobs}
            pendingPackages={pendingReviewPackages}
            pipelineStages={pipelineStages.map((stage) => ({
              ...stage,
              onClick: () => focusPipelineTarget(stage.target),
            }))}
            jobStatusFilter={jobStatusFilter}
            canWrite={canWrite}
            busySyncId={sourceSyncMutation.isPending ? (sourceSyncMutation.variables?.id ?? null) : null}
            busyProcess={processPackageMutation.isPending}
            busyRetry={retryJobMutation.isPending}
            isReindexing={isReindexing}
            sourceDocumentTotal={sourceDocumentTotal}
            healthySourceCount={healthySourceCount}
            attentionSourceCount={attentionSourceCount}
            activeJobCount={activeJobCount}
            failedJobCount={failedJobCount}
            onFilterChange={setJobStatusFilter}
            onConnectSource={() => setActiveModal('connectSource')}
            onSyncSource={syncSource}
            onReindex={() => setReindexConfirm(true)}
            onProcessPending={() => {
              if (pendingReviewPackages[0]) processPackageMutation.mutate({ id: pendingReviewPackages[0].id, strategy: 'semantic' });
            }}
            onRetryJob={(id) => retryJobMutation.mutate({ id })}
            onOpenPackages={() => { setWorkspace('assets'); setAssetsView('packages'); }}
            sourcesRef={sourcesSectionRef}
            jobsRef={jobsSectionRef}
          />
        ) : (
        <main className="de-employee-shell knowledge-workspace overflow-hidden rounded-xl bg-[var(--surface-1)] p-3 md:p-4">
          {workspace === 'retrieval' && <>
            <div className="knowledge-workspace-heading">
              <div>
                <div className="text-sm font-semibold">检索验证台</div>
                <p>验证数字伙伴在真实问题下的证据覆盖、相关度与响应性能。</p>
              </div>
              <Badge tone="success"><CheckCircle2 className="mr-1 h-3 w-3" />检索服务可用</Badge>
            </div>
            <div className="knowledge-retrieval-query mt-4">
              <Search className="h-4 w-4 shrink-0 text-[var(--brand)]" />
              <Input
                placeholder="输入业务问题，例如：Redis OOM 如何安全处置？"
                value={testQuery}
                onChange={(event) => setTestQuery(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && testQuery.trim() && retrieveMutation.mutate({ query: testQuery, kb: 'all' })}
                className="border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
              />
              <Button size="sm" disabled={!testQuery.trim() || retrieveMutation.isPending} onClick={() => retrieveMutation.mutate({ query: testQuery, kb: 'all' })}>
                {retrieveMutation.isPending ? '验证中…' : '执行验证'}
              </Button>
            </div>
            <div className="knowledge-retrieval-layout mt-4">
              <section className="knowledge-retrieval-results">
                <div className="knowledge-section-title">
                  <Search className="h-3.5 w-3.5 text-[var(--brand)]" />
                  证据结果
                  <Badge tone="neutral">{testQuery.trim() ? searchResults.length : topChunks.length} 条</Badge>
                </div>
                <div className="mt-4">
                  <EvidenceResultList
                    chunks={testQuery.trim() ? searchResults : topChunks.slice(0, 4)}
                    emptyHint={testQuery.trim() ? '未命中证据，请换一种问法或先完善知识包内容。' : '输入问题并执行验证，或查看下方默认 Top 证据。'}
                    onOpen={setChunkDrawer}
                  />
                </div>
              </section>
              <section className="knowledge-retrieval-health">
                <div className="knowledge-section-title"><Activity className="h-3.5 w-3.5 text-[var(--brand)]" />质量与性能</div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <EvalCard label="召回率" value={formatEvalPercent(normalizedEvalMetrics?.recall)} tone="success" />
                  <EvalCard label="准确率" value={formatEvalPercent(normalizedEvalMetrics?.precision)} tone="info" />
                  <EvalCard label="P95 延迟" value={formatEvalMs(normalizedEvalMetrics?.p95Latency)} tone="primary" />
                  <EvalCard label="缓存命中" value={formatEvalPercent(normalizedEvalMetrics?.hitRate)} tone="purple" />
                </div>
                {canWrite && (
                  <button type="button" className="knowledge-text-action mt-4" onClick={handleRescore}>
                    <RotateCcw className="h-3 w-3" />重新评分并查看差异
                  </button>
                )}
              </section>
            </div>
            <div className="knowledge-pipeline mt-3" aria-label="检索链路说明">
              {PIPELINE.map((stage, index) => (
                <div key={stage.key} className="knowledge-pipeline__stage is-static">
                  <span className="knowledge-pipeline__step">{index + 1}</span>
                  <stage.icon className="h-3.5 w-3.5 text-[var(--brand)]" />
                  <strong>{stage.label}</strong>
                  <small>{stage.capability}</small>
                </div>
              ))}
            </div>
            <section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 md:p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-1.5 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-[var(--brand)]" />评测与发布门禁</div><p className="mt-1 text-[11px] text-[var(--text-muted)]">以标准问题集验证混合召回、重排质量、引用正确性与延迟，再决定是否发布版本。</p></div>{canWrite && <Button size="sm" variant="secondary" disabled={!knowledgePackages[0] || evaluationMutation.isPending} onClick={() => { const target = knowledgePackages.find((item) => item.status === 'published') ?? knowledgePackages[0]; const profile = retrievalProfiles.find((item) => item.packageId === target?.id); if (target && profile) evaluationMutation.mutate({ packageId: target.id, profileId: profile.id }); }}><Activity className="h-3.5 w-3.5" />运行评测</Button>}</div><div className="mt-3 grid gap-3 lg:grid-cols-2">{evaluations.slice(0, 2).map((item) => { const packageItem = knowledgePackages.find((record) => record.id === item.packageId); return <article key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{packageItem?.name ?? item.packageId}</span><Badge tone={item.status === 'passed' ? 'success' : item.status === 'needs_review' ? 'warn' : 'error'}>{item.status === 'passed' ? '通过' : item.status === 'needs_review' ? '需复核' : '未通过'}</Badge></div><div className="mt-3 grid grid-cols-5 gap-2 text-[10px]"><MetricCell label="Recall@K" value={`${(item.recallAtK * 100).toFixed(0)}%`} /><MetricCell label="MRR" value={item.mrr.toFixed(2)} /><MetricCell label="nDCG" value={item.ndcg.toFixed(2)} /><MetricCell label="引用正确" value={`${(item.citationAccuracy * 100).toFixed(0)}%`} /><MetricCell label="P95" value={`${item.p95LatencyMs}ms`} /></div><div className="mt-3 border-t border-[var(--border)] pt-2 text-[10px] text-[var(--text-muted)]">{item.baselineVersion} → {item.evaluatedVersion} · {new Date(item.evaluatedAt).toLocaleString('zh-CN')}</div></article>; })}</div></section>
          </>}

          {workspace === 'graph' && <>
            <div className="knowledge-workspace-heading"><div><div className="text-sm font-semibold">图谱与关联</div><p>从原始文档中抽取实体与关系，为影响分析和混合召回提供可回溯的业务上下文。</p></div><Badge tone="brand">证据溯源已启用</Badge></div>
            <KnowledgeGraphCanvas entities={graphEntities} relations={graphRelations} selectedEntityId={selectedGraphEntityId} onSelect={(id) => { setSelectedGraphEntityId(id); const entity = graphEntities.find((item) => item.id === id); if (entity) setGovernanceNotice(`实体「${entity.name}」来自文档 ${entity.sourceDocId} · ${entity.sourceVersion}。`); }} />
          </>}

          {workspace === 'governance' && <>
            <div className="knowledge-workspace-heading"><div><div className="text-sm font-semibold">引用治理</div><p>管理权限、版本、风险策略，并追踪知识包对智能体和工作流的变更影响。</p></div><Badge tone="brand">审计已启用</Badge></div>
            <div className="knowledge-governance-grid mt-3"><section className="knowledge-governance-card"><div className="knowledge-section-title"><ShieldCheck className="h-3.5 w-3.5 text-[var(--brand)]" />访问与保留策略</div><div className="mt-3 space-y-2 text-xs"><div className="knowledge-policy-row"><span><strong>敏感数据检测</strong><small>上传后识别凭据、个人数据与机密内容</small></span><Badge tone={governance?.sensitiveDataDetection ? 'success' : 'warn'}>{governance?.sensitiveDataDetection ? '已启用' : '已暂停'}</Badge></div><label className="knowledge-policy-row"><span><strong>版本保留</strong><small>保留 {governance?.retentionDays ?? 365} 天版本，可审计和回滚</small></span><input type="checkbox" checked={governance?.versionRetention ?? true} disabled={!canWrite || governanceMutation.isPending} onChange={(event) => governanceMutation.mutate({ versionRetention: event.target.checked })} /></label><div className="knowledge-policy-row"><span><strong>高风险操作</strong><small>归档、删除和共享需责任人复核</small></span><Badge tone={governance?.highRiskChangeApproval ? 'warn' : 'error'}>{governance?.highRiskChangeApproval ? '受控' : '未受控'}</Badge></div></div></section><section className="knowledge-governance-card"><div className="knowledge-section-title"><Users className="h-3.5 w-3.5 text-[var(--brand)]" />智能体影响范围</div><div className="mt-3 space-y-2">{citationTrace.length ? citationTrace.slice(0, 3).map((citation) => <button key={citation.docId} type="button" onClick={() => setActiveModal('citationAgents')} className="knowledge-impact-row"><span className="min-w-0"><strong>{citation.title}</strong><small>最后引用：{citation.lastUsed ?? '—'}</small></span><span className="font-mono text-[var(--brand)]">{citation.citeCount ?? citation.count ?? 0} 次</span><ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)]" /></button>) : <EmptyState icon={Users} title="暂无引用影响" description="智能体使用知识后将在此追踪" />}</div></section></div>
            <section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4"><div className="flex items-center justify-between"><div className="knowledge-section-title"><Link2 className="h-3.5 w-3.5 text-[var(--brand)]" />已发布知识包引用</div><Badge tone="neutral">{consumerBindings.length} 个运行时绑定</Badge></div><div className="mt-3 overflow-x-auto"><div className="min-w-[720px] divide-y divide-[var(--border)] text-xs"><div className="grid grid-cols-[1.2fr_.9fr_.8fr_.8fr_.9fr] gap-3 px-2 py-2 text-[10px] text-[var(--text-muted)]"><span>知识包 / 版本</span><span>引用方</span><span>环境</span><span>无结果策略</span><span>检索配置</span></div>{consumerBindings.map((binding) => <div key={binding.id} className="grid grid-cols-[1.2fr_.9fr_.8fr_.8fr_.9fr] gap-3 px-2 py-3"><span><strong className="block">{binding.packageName}</strong><small className="font-mono text-[var(--text-muted)]">{binding.packageVersion}</small></span><span><Badge tone={binding.consumerType === 'workflow' ? 'info' : 'brand'}>{binding.consumerType === 'digital_employee' ? '工作伙伴' : binding.consumerType === 'workflow' ? '工作流' : '执行内核'}</Badge><small className="ml-1 text-[var(--text-muted)]">{binding.consumerName}</small></span><span>{binding.environment === 'production' ? '生产' : binding.environment === 'staging' ? '预发' : '沙箱'}</span><span>{binding.noResultPolicy === 'block' ? '阻断执行' : binding.noResultPolicy === 'handoff' ? '人工接管' : '请求澄清'}</span><span className="font-mono text-[10px]">{binding.profileId}</span></div>)}</div></div></section>
            <div className="knowledge-audit-note mt-3"><ShieldAlert className="h-4 w-4 text-[var(--warning)]" /><span>{knowledgeAudit[0] ? `${knowledgeAudit[0].time} · ${knowledgeAudit[0].action} · ${knowledgeAudit[0].target}` : governanceNotice}</span><button type="button" onClick={() => setWorkspace('assets')}>返回内容资产</button></div>
          </>}
        </main>
        )}
      </div>

      {/* 文档阅读器：宽屏双栏，正文滚动、侧栏信息收敛，避免元数据重复。 */}
      <Modal
        open={showDetails}
        onClose={() => { setShowDetails(false); setEditingContent(false); }}
        title={
          docDetail ? (
            <span className="flex min-w-0 flex-col gap-1.5">
              <span className="truncate">{docDetail.title}</span>
              <span className="flex flex-wrap items-center gap-1.5 font-normal">
                <Badge tone="info">{docDetail.source}</Badge>
                <span className={cn('knowledge-status-dot', docDetail.status === 'ready' ? 'is-ready' : 'is-indexing')}>
                  {docDetail.status === 'ready' ? '已就绪' : '索引中'}
                </span>
                <Badge tone="neutral">{docDetail.version ?? 'v1.0'}</Badge>
                {docDetail.classification && <Badge tone="warn">{docDetail.classification}</Badge>}
              </span>
            </span>
          ) : '内容详情'
        }
        description={docDetail ? `责任人 ${docDetail.author ?? '未指定'} · 更新于 ${docDetail.updatedAt?.slice(0, 10) ?? '—'}` : '正在加载文档内容…'}
        size="2xl"
        bodyClassName="overflow-hidden p-0"
        footer={(
          <>
            <Button variant="secondary" onClick={() => { setShowDetails(false); setEditingContent(false); }}>关闭</Button>
            <Button variant="secondary" onClick={downloadOriginal} disabled={!docDetail}><Download className="h-3.5 w-3.5" />下载原文</Button>
            <Button
              variant="secondary"
              disabled={!topChunks.length}
              onClick={() => { setShowDetails(false); setChunkDrawer(topChunks[0]); }}
            >
              <Hash className="h-3.5 w-3.5" />关联切片
            </Button>
            {canWrite && docDetail && (
              <Button
                variant="danger"
                disabled={deleteDocsMutation.isPending}
                onClick={() => {
                  setShowDetails(false);
                  setEditingContent(false);
                  requestDeleteDocs([docDetail.id]);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />删除
              </Button>
            )}
            {canWrite && (
              <Button variant={editingContent ? 'secondary' : 'primary'} onClick={() => setEditingContent((editing) => !editing)}>
                <Pencil className="h-3.5 w-3.5" />{editingContent ? '退出编辑' : '编辑内容'}
              </Button>
            )}
          </>
        )}
      >
        {!docDetail ? (
          <div className="flex h-[40vh] items-center justify-center text-xs text-[var(--text-muted)]">加载文档内容中…</div>
        ) : (
          <div className="knowledge-doc-detail">
            <DocumentPaperPreview
              content={docDetail.content}
              editing={editingContent}
              canWrite={canWrite}
              metaLabel={`${docDetail.size ?? '—'} · ${docDetail.chunks ?? 0} 切片 · ${docDetail.chunkStrategy ?? '结构切片'}`}
              onToggleEdit={() => setEditingContent((editing) => !editing)}
              onEditBlur={() => setGovernanceNotice(`内容「${docDetail.title}」编辑草稿已更新，发布前需完成复核。`)}
            />

            <aside className="knowledge-doc-detail__aside">
              <section className="knowledge-doc-stat-strip">
                <div>
                  <strong>{formatDocQualityAverage(docDetail.quality)}</strong>
                  <small>综合质量</small>
                </div>
                <div>
                  <strong className="font-mono">{docDetail.citeCount ?? 0}</strong>
                  <small>运行引用</small>
                </div>
                <div>
                  <strong className="font-mono">{docDetail.chunks ?? 0}</strong>
                  <small>切片数</small>
                </div>
              </section>

              <section className="knowledge-doc-meta">
                <div className="knowledge-doc-meta__title">内容质量</div>
                <div className="mt-3 space-y-2.5">
                  <QualityBar label="完整度" value={docQualityBarValue(docDetail.quality?.completeness)} />
                  <QualityBar label="时效性" value={docQualityBarValue(docDetail.quality?.freshness)} />
                  <QualityBar label="引用正确率" value={docQualityBarValue(docDetail.quality?.citationAccuracy)} />
                </div>
              </section>

              <section className="knowledge-doc-impact">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--brand)]">
                    <TrendingUp className="h-3.5 w-3.5" />引用影响
                  </div>
                  <span className="font-mono text-[11px] font-semibold text-[var(--text)]">{docDetail.citeCount ?? 0} 次</span>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-[var(--text-secondary)]">
                  版本变更前请确认智能体与工作流影响范围。
                </p>
                <button
                  type="button"
                  className="knowledge-doc-impact__action"
                  onClick={() => { setShowDetails(false); setWorkspace('governance'); }}
                >
                  查看引用治理 <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </section>

              {docDetail.tags?.length > 0 && (
                <section className="knowledge-doc-meta">
                  <div className="knowledge-doc-meta__title">标签</div>
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {docDetail.tags.map((tag: string) => <Badge key={tag} tone="neutral">#{tag}</Badge>)}
                  </div>
                </section>
              )}

              {docDetail.versions?.length > 0 && (
                <section className="knowledge-doc-meta">
                  <div className="knowledge-doc-meta__title">版本历史</div>
                  <ul className="knowledge-doc-versions">
                    {docDetail.versions.slice(0, 3).map((version: any, index: number) => (
                      <li key={`${version.version}-${version.time}`} className={cn(index === 0 && 'is-current')}>
                        <div className="flex items-center justify-between gap-2">
                          <strong className="font-mono">{version.version}</strong>
                          {index === 0 && <Badge tone="brand">当前</Badge>}
                        </div>
                        <span>{version.time}</span>
                        <small>{version.note}</small>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <button
                type="button"
                className="knowledge-doc-nav"
                onClick={() => { setShowDetails(false); setWorkspace('retrieval'); }}
              >
                <span className="flex items-center gap-1.5"><Search className="h-3.5 w-3.5 text-[var(--brand)]" />前往检索与评测</span>
                <ChevronRight className="h-3.5 w-3.5 text-[var(--brand)]" />
              </button>
            </aside>
          </div>
        )}
      </Modal>

      {/* ====== Modals ====== */}

      <NewKnowledgePackageModal
        open={activeModal === 'newPackage'}
        onClose={() => setActiveModal(null)}
        onSubmit={(form) => createPackageMutation.mutate(form)}
      />

      <ConnectSourceModal
        open={activeModal === 'connectSource'}
        onClose={() => setActiveModal(null)}
        onSubmit={connectSource}
        connecting={sourceMutation.isPending || sourceSyncMutation.isPending}
      />

      <UploadDocModal
        open={activeModal === 'upload'}
        onClose={() => setActiveModal(null)}
        onSubmit={handleUploadDoc}
        uploading={uploadMutation.isPending}
      />

      <ConfirmDialog
        open={reindexConfirm}
        onClose={() => setReindexConfirm(false)}
        onConfirm={handleReindex}
        title="重新索引"
        description="将对全部知识内容重新执行 Embed + Index，预计耗时 5-10 分钟，期间检索仍可使用旧索引。"
        confirmText="开始重建"
      />

      <ConfirmDialog
        open={Boolean(deleteConfirm)}
        onClose={() => { if (!deleteDocsMutation.isPending) setDeleteConfirm(null); }}
        onConfirm={handleDeleteDocs}
        tone="danger"
        title={deleteConfirm && deleteConfirm.ids.length > 1 ? `删除 ${deleteConfirm.ids.length} 项知识文档？` : '删除知识文档？'}
        description={deleteConfirm
          ? `将永久移除「${deleteConfirm.titles.slice(0, 3).join('」「')}${deleteConfirm.titles.length > 3 ? `」等 ${deleteConfirm.titles.length} 项` : '」'}，并清理切片、引用痕迹与本地正文。${deleteConfirm.citeTotal > 0 ? ` 其中累计引用 ${deleteConfirm.citeTotal} 次，删除后下游检索将不再命中。` : ''}`
          : undefined}
        confirmText={deleteDocsMutation.isPending ? '删除中…' : '删除'}
      />

      <CitationAgentsModal
        open={activeModal === 'citationAgents'}
        onClose={() => setActiveModal(null)}
        citation={activeCitation}
      />

      <ChunkDetailModal
        chunk={chunkDrawer}
        docTitle={chunkDrawer ? (docs.find((doc) => doc.id === chunkDrawer.docId)?.title ?? chunkDrawer.source) : undefined}
        canWrite={canWrite}
        onClose={() => setChunkDrawer(null)}
        onRescore={handleRescore}
        onOpenDocument={(docId) => {
          setWorkspace('assets');
          setAssetsView('docs');
          openDocument(docId);
        }}
      />
    </div>
  );
}

/* ===== 子组件 ===== */

function QualityBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-[var(--text-muted)]">{label}</span>
        <span className="font-mono font-semibold text-[var(--text)]">{value == null ? '—' : `${value}%`}</span>
      </div>
      {value != null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
          <div className="h-full rounded-full bg-[var(--brand)] transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
        </div>
      )}
    </div>
  );
}

function EvalCard({ label, value, tone }: { label: string; value: string; tone: 'success' | 'info' | 'primary' | 'purple' }) {
  const color = tone === 'success' ? 'text-[var(--success)]' : tone === 'info' ? 'text-[var(--info)]' : tone === 'primary' ? 'text-[var(--brand)]' : 'text-[var(--purple)]';
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-2">
      <div className="text-[10px] text-[var(--text-muted)]">{label}</div>
      <div className={cn('text-sm font-bold font-mono', color)}>{value}</div>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return <span><small className="block truncate text-[var(--text-muted)]">{label}</small><strong className="mt-0.5 block font-mono text-[11px]">{value}</strong></span>;
}

const GRAPH_NODE_POSITIONS: Record<string, [number, number]> = {
  'kge-api': [135, 96], 'kge-redis': [368, 125], 'kge-runbook': [600, 96], 'kge-owner': [604, 268], 'kge-cve': [138, 266],
};

function KnowledgeGraphCanvas({ entities, relations, selectedEntityId, onSelect }: { entities: KnowledgeGraphEntity[]; relations: KnowledgeGraphRelation[]; selectedEntityId: string | null; onSelect: (id: string) => void }) {
  const [activeType, setActiveType] = useState<KnowledgeGraphEntity['type'] | 'all'>('all');
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const visibleEntities = activeType === 'all' ? entities : entities.filter((entity) => entity.type === activeType);
  const entityIds = new Set(visibleEntities.map((entity) => entity.id));
  const visibleRelations = relations.filter((relation) => entityIds.has(relation.fromId) && entityIds.has(relation.toId));
  const selectedRelation = relations.find((relation) => relation.id === selectedRelationId);
  useEffect(() => {
    if (!selectedEntityId) return;
    const related = relations.find((relation) => relation.fromId === selectedEntityId || relation.toId === selectedEntityId);
    setSelectedRelationId(related?.id ?? null);
  }, [selectedEntityId, relations]);
  const typeOptions: Array<{ key: KnowledgeGraphEntity['type'] | 'all'; label: string }> = [{ key: 'all', label: '全部实体' }, { key: 'service', label: '服务' }, { key: 'asset', label: '资产' }, { key: 'runbook', label: 'Runbook' }, { key: 'vulnerability', label: '漏洞' }, { key: 'owner', label: '责任团队' }];
  const relationFrom = selectedRelation ? entities.find((entity) => entity.id === selectedRelation.fromId) : null;
  const relationTo = selectedRelation ? entities.find((entity) => entity.id === selectedRelation.toId) : null;
  return <><div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-2"><div className="flex flex-wrap gap-1">{typeOptions.map((option) => <button key={option.key} type="button" onClick={() => { setActiveType(option.key); setSelectedRelationId(null); }} className={cn('rounded-md px-2.5 py-1.5 text-[11px] transition-colors', activeType === option.key ? 'bg-[var(--surface-1)] font-semibold text-[var(--brand)] shadow-[0_1px_2px_rgba(15,23,42,.06)]' : 'text-[var(--text-muted)] hover:bg-[var(--surface-1)]')}>{option.label}</button>)}</div><span className="text-[10px] text-[var(--text-muted)]">显示 {visibleEntities.length} 个实体 / {visibleRelations.length} 条关系</span></div><KnowledgeGraphCanvasReadonly entities={visibleEntities} relations={visibleRelations} selectedEntityId={selectedEntityId} onSelect={onSelect} /><section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3"><div className="flex items-center justify-between"><div className="text-xs font-semibold">关系证据</div><span className="text-[10px] text-[var(--text-muted)]">点击关系查看来源</span></div><div className="mt-2 flex flex-wrap gap-2">{visibleRelations.map((relation) => <button key={relation.id} type="button" onClick={() => setSelectedRelationId(relation.id)} className={cn('rounded-md border px-2.5 py-1.5 text-[11px] transition-colors', selectedRelationId === relation.id ? 'border-[var(--brand)]/30 bg-[var(--brand-light)] text-[var(--brand)]' : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--brand)]/30')}><span>{entities.find((entity) => entity.id === relation.fromId)?.name}</span><span className="mx-1 text-[var(--text-muted)]">{relation.type}</span><span>{entities.find((entity) => entity.id === relation.toId)?.name}</span></button>)}</div>{selectedRelation && <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-[11px]"><strong>{relationFrom?.name} → {relationTo?.name}</strong><span className="text-[var(--text-muted)]">关系：{selectedRelation.type}</span><span className="text-[var(--text-muted)]">来源：{selectedRelation.sourceDocId} · {selectedRelation.sourceVersion}</span><span className="font-mono text-[var(--success)]">置信度 {(selectedRelation.confidence * 100).toFixed(0)}%</span></div>}</section></>;
}

function GraphViewport({ children }: { children: React.ReactNode }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const updateZoom = (next: number) => setZoom(Math.min(1.5, Math.max(.7, Number(next.toFixed(2)))));
  const style = { '--knowledge-graph-zoom': String(zoom), '--knowledge-graph-x': `${offset.x}px`, '--knowledge-graph-y': `${offset.y}px` } as CSSProperties;
  return <div className="knowledge-graph-viewport" style={style} onPointerDown={(event) => { if (!(event.target as Element).closest('.knowledge-graph-canvas')) return; dragRef.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { const drag = dragRef.current; if (!drag) return; setOffset({ x: drag.offsetX + event.clientX - drag.x, y: drag.offsetY + event.clientY - drag.y }); }} onPointerUp={(event) => { dragRef.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId); }} onPointerCancel={() => { dragRef.current = null; }} onWheel={(event) => { if (!(event.target as Element).closest('.knowledge-graph-canvas')) return; event.preventDefault(); updateZoom(zoom + (event.deltaY > 0 ? -.1 : .1)); }}><div className="knowledge-graph-viewport__controls"><Button size="sm" variant="ghost" disabled={zoom <= .7} onClick={() => updateZoom(zoom - .1)}>−</Button><Button size="sm" variant="ghost" disabled={zoom >= 1.5} onClick={() => updateZoom(zoom + .1)}>＋</Button><Button size="sm" variant="ghost" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>复位</Button><span>{Math.round(zoom * 100)}%</span></div>{children}</div>;
}

function KnowledgeGraphCanvasReadonly({ entities, relations, selectedEntityId, onSelect }: { entities: KnowledgeGraphEntity[]; relations: KnowledgeGraphRelation[]; selectedEntityId: string | null; onSelect: (id: string) => void }) {
  return <KnowledgeGraphCanvasStatic entities={entities} relations={relations} selectedEntityId={selectedEntityId} onSelect={onSelect} />;
}

function KnowledgeGraphNode({ data, selected }: { data: { entity: KnowledgeGraphEntity }; selected: boolean }) {
  const { entity } = data;
  const palette = entity.type === 'asset' ? ['#eef2ff', '#818cf8', '#4f46e5'] : entity.type === 'service' ? ['#eff6ff', '#60a5fa', '#2563eb'] : entity.type === 'runbook' ? ['#ecfdf5', '#34d399', '#047857'] : entity.type === 'vulnerability' ? ['#fff7ed', '#fb923c', '#c2410c'] : ['#f5f3ff', '#a78bfa', '#7c3aed'];
  return <><Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-[var(--brand)]" /><div className="min-w-[130px] rounded-[10px] border px-3 py-2" style={{ borderColor: selected ? '#4f46e5' : palette[1], borderWidth: selected ? 2 : 1, background: palette[0], boxShadow: selected ? '0 0 0 3px rgba(79,70,229,.12)' : '0 1px 2px rgba(15,23,42,.05)' }}><div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-md bg-white/80 text-[10px] font-bold" style={{ color: palette[2] }}>{entity.type.slice(0, 1).toUpperCase()}</span><span className="min-w-0"><strong className="block truncate text-[11px] text-[var(--text)]">{entity.name}</strong><small className="block text-[9px] text-[var(--text-muted)]">{entity.type} · {(entity.confidence * 100).toFixed(0)}%</small></span></div></div><Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-[var(--brand)]" /></>;
}
const KNOWLEDGE_GRAPH_NODE_TYPES = { knowledgeGraph: KnowledgeGraphNode };

function KnowledgeGraphCanvasStatic({ entities, relations, selectedEntityId, onSelect }: { entities: KnowledgeGraphEntity[]; relations: KnowledgeGraphRelation[]; selectedEntityId: string | null; onSelect: (id: string) => void }) {
  const initialNodes = useMemo<Node[]>(() => entities.map((entity, index) => { const [x, y] = GRAPH_NODE_POSITIONS[entity.id] ?? [80 + (index % 4) * 180, 50 + Math.floor(index / 4) * 130]; return { id: entity.id, type: 'knowledgeGraph', position: { x, y }, data: { entity } }; }), [entities]);
  const initialEdges = useMemo<Edge[]>(() => relations.map((relation) => ({ id: relation.id, source: relation.fromId, target: relation.toId, label: relation.type, animated: false, markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' }, style: { stroke: '#94a3b8', strokeWidth: 1.5 }, labelStyle: { fill: '#64748b', fontSize: 10 }, labelBgStyle: { fill: 'var(--surface-1)', fillOpacity: 1 }, updatable: true })), [relations]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  useEffect(() => { setNodes(initialNodes); }, [initialNodes, setNodes]);
  useEffect(() => { setEdges(initialEdges); }, [initialEdges, setEdges]);
  return <div className="knowledge-reactflow-canvas"><ReactFlow nodes={nodes} edges={edges} nodeTypes={KNOWLEDGE_GRAPH_NODE_TYPES} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeClick={(_, node) => onSelect(node.id)} nodesDraggable edgesUpdatable elementsSelectable defaultViewport={{ x: 0, y: 0, zoom: 1 }} minZoom={.55} maxZoom={1.8} proOptions={{ hideAttribution: true }}><Background gap={18} size={1} color="#e2e8f0" /><Controls showInteractive={false} /></ReactFlow></div>;
}

/** @deprecated Use KnowledgeGraphCanvas (ReactFlow renderer). Kept as a fallback for environments without ReactFlow; will be removed in v2. */
function KnowledgeGraphCanvasLegacy({ entities, relations, selectedEntityId, onSelect }: { entities: KnowledgeGraphEntity[]; relations: KnowledgeGraphRelation[]; selectedEntityId: string | null; onSelect: (id: string) => void }) {
  const positionFor = (entity: KnowledgeGraphEntity, index: number): [number, number] => GRAPH_NODE_POSITIONS[entity.id] ?? [130 + (index % 4) * 170, 90 + Math.floor(index / 4) * 150];
  const selected = entities.find((entity) => entity.id === selectedEntityId) ?? entities[0];
  const toneFor = (type: KnowledgeGraphEntity['type']) => type === 'asset' ? { fill: '#eef2ff', stroke: '#818cf8', text: '#4f46e5' } : type === 'service' ? { fill: '#eff6ff', stroke: '#60a5fa', text: '#2563eb' } : type === 'runbook' ? { fill: '#ecfdf5', stroke: '#34d399', text: '#047857' } : type === 'vulnerability' ? { fill: '#fff7ed', stroke: '#fb923c', text: '#c2410c' } : { fill: '#f5f3ff', stroke: '#a78bfa', text: '#7c3aed' };
  const typeLabel = (type: KnowledgeGraphEntity['type']) => ({ service: '服务', asset: '资产', runbook: 'Runbook', alert: '告警', vulnerability: '漏洞', owner: '责任团队' }[type]);
  return <section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="knowledge-section-title"><Network className="h-3.5 w-3.5 text-[var(--brand)]" />知识关系图谱 <Badge tone="neutral">{entities.length} 个实体 · {relations.length} 条关系</Badge></div><p className="mt-1 text-[11px] text-[var(--text-muted)]">选择节点查看来源证据；关系边表示已抽取且可追溯的业务依赖。</p></div><div className="flex flex-wrap gap-2 text-[10px] text-[var(--text-muted)]"><span>● 服务</span><span>● 资产</span><span>● Runbook</span><span>● 漏洞</span><span>● 责任团队</span></div></div><div className="knowledge-graph-canvas mt-3"><svg viewBox="0 0 740 360" role="img" aria-label="知识图谱实体与关系" preserveAspectRatio="xMidYMid meet"><defs><marker id="knowledge-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" /></marker></defs><g>{relations.map((relation) => { const fromIndex = entities.findIndex((entity) => entity.id === relation.fromId); const toIndex = entities.findIndex((entity) => entity.id === relation.toId); const from = entities[fromIndex]; const to = entities[toIndex]; if (!from || !to) return null; const [x1, y1] = positionFor(from, fromIndex); const [x2, y2] = positionFor(to, toIndex); return <g key={relation.id}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#knowledge-graph-arrow)" /><rect x={(x1 + x2) / 2 - 30} y={(y1 + y2) / 2 - 11} width="60" height="18" rx="9" fill="var(--surface-1)" stroke="#e2e8f0" /><text x={(x1 + x2) / 2} y={(y1 + y2) / 2 + 3.5} textAnchor="middle" fontSize="9" fill="#64748b">{relation.type}</text></g>; })}</g><g>{entities.map((entity, index) => { const [x, y] = positionFor(entity, index); const tone = toneFor(entity.type); const active = entity.id === selected?.id; return <g key={entity.id} transform={`translate(${x} ${y})`} className="knowledge-graph-node" onClick={() => onSelect(entity.id)} role="button" tabIndex={0} aria-label={`选择实体 ${entity.name}`} onKeyDown={(event) => event.key === 'Enter' && onSelect(entity.id)}><rect x="-74" y="-30" width="148" height="60" rx="10" fill={tone.fill} stroke={active ? '#4f46e5' : tone.stroke} strokeWidth={active ? 2.2 : 1.2} /><circle cx="-54" cy="0" r="11" fill="var(--surface-1)" stroke={tone.stroke} /><circle cx="-54" cy="0" r="4" fill={tone.text} /><text x="-35" y="-4" fontSize="11" fontWeight="600" fill="#1e293b">{entity.name.length > 16 ? `${entity.name.slice(0, 15)}…` : entity.name}</text><text x="-35" y="14" fontSize="9" fill="#64748b">{typeLabel(entity.type)} · {(entity.confidence * 100).toFixed(0)}%</text></g>; })}</g></svg></div>{selected && <div className="mt-3 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"><span className="min-w-0"><strong className="block text-xs">{selected.name}</strong><small className="mt-1 block text-[10px] text-[var(--text-muted)]">{typeLabel(selected.type)} · 来自 {selected.sourceDocId} · {selected.sourceVersion}</small></span><span className="text-[11px]"><small className="block text-[var(--text-muted)]">抽取置信度</small><strong className="font-mono text-[var(--success)]">{(selected.confidence * 100).toFixed(0)}%</strong></span><span className="text-[11px]"><small className="block text-[var(--text-muted)]">关联关系</small><strong>{relations.filter((relation) => relation.fromId === selected.id || relation.toId === selected.id).length} 条</strong></span><button type="button" className="text-left text-[11px] text-[var(--brand)] hover:underline" onClick={() => setTimeout(() => document.getElementById('knowledge-graph-evidence')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)}>查看证据</button></div>}<div id="knowledge-graph-evidence" className="mt-3 rounded-lg bg-[var(--brand-light)] px-3 py-2 text-[11px] text-[var(--text-secondary)]"><Brain className="mr-1 inline h-3.5 w-3.5 text-[var(--brand)]" />图谱用于扩展候选证据；实际回答仍需完成权限过滤、混合召回与引用校验。</div></section>;
}

function NewKnowledgePackageModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (form: { name: string; description: string; domain: string; classification: KnowledgePackage['classification'] }) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [domain, setDomain] = useState('SRE');
  const [classification, setClassification] = useState<KnowledgePackage['classification']>('internal');
  return <Modal open={open} onClose={onClose} title="新建知识包" description="知识包是供智能体和工作流引用的版本化知识能力。创建后需经过加工、评测和发布才可被绑定。" size="md" footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button disabled={!name.trim()} onClick={() => onSubmit({ name: name.trim(), description: description.trim(), domain, classification })}>创建知识包</Button></>}><div className="space-y-3"><Field label="知识包名称" required><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：生产故障处置知识包" /></Field><Field label="业务域"><Input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="例如：SRE、安全、财务" /></Field><Field label="说明"><Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明适用范围、主要来源与使用边界" /></Field><Field label="数据分级"><select value={classification} onChange={(event) => setClassification(event.target.value as KnowledgePackage['classification'])} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 text-xs text-[var(--text)]"><option value="internal">内部</option><option value="confidential">机密</option><option value="restricted">受限</option></select></Field><div className="rounded-lg border border-[var(--brand)]/20 bg-[var(--brand-light)] p-3 text-[11px] text-[var(--text-secondary)]"><ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-[var(--brand)]" />发布前将检查加工索引、检索评测和引用影响；本地环境为 Mock 流程演示。</div></div></Modal>;
}

const TEXT_UPLOAD_EXT = /\.(md|markdown|txt|json|ya?ml|csv|log)$/i;

async function readUploadFileContent(file: File): Promise<string> {
  const isText = TEXT_UPLOAD_EXT.test(file.name)
    || file.type.startsWith('text/')
    || file.type === 'application/json'
    || file.type === 'application/markdown';
  if (isText) {
    const content = (await file.text()).replace(/^\uFEFF/, '');
    if (!content.trim()) {
      throw new Error('文件内容为空，请选择有效的 Markdown / 文本文件');
    }
    return content;
  }
  const base = file.name.replace(/\.[^.]+$/, '') || file.name;
  return [
    `# ${base}`,
    '',
    `> 已接收文件「${file.name}」（${Math.max(1, Math.round(file.size / 1024))} KB）。`,
    '>',
    '> 当前控制面可直接阅读 Markdown / 纯文本正文；PDF / Word 需异步解析后才会写入可读内容。',
    '> 若需立即查看正文，请另存为 `.md` 或 `.txt` 后重新上传。',
  ].join('\n');
}

function UploadDocModal({
  open, onClose, onSubmit, uploading = false,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: { title: string; source: string; tags: string; content: string; fileName?: string }) => void;
  uploading?: boolean;
}) {
  const [title, setTitle] = useState('');
  const [source, setSource] = useState(KB_TYPE_OPTIONS[0]);
  const [tags, setTags] = useState('');
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const valid = title.trim().length > 0 && Boolean(file);
  const busy = uploading || reading;

  useEffect(() => {
    if (!open) {
      setTitle('');
      setSource(KB_TYPE_OPTIONS[0]);
      setTags('');
      setDragging(false);
      setFile(null);
      setReading(false);
      setError(null);
    }
  }, [open]);

  const applyFile = (next?: File | null) => {
    if (!next) return;
    setError(null);
    setFile(next);
    setTitle((current) => current.trim() || next.name.replace(/\.[^.]+$/, ''));
  };

  const handleSubmit = async () => {
    if (!valid || busy || !file) return;
    setReading(true);
    setError(null);
    try {
      const content = await readUploadFileContent(file);
      onSubmit({
        title: title.trim(),
        source,
        tags: tags.trim(),
        content,
        fileName: file.name,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取文件失败');
    } finally {
      setReading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="上传文档"
      description="支持 PDF / Word / Markdown / 纯文本。Markdown 与纯文本会直接写入正文，可在详情中阅读。"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>取消</Button>
          <Button disabled={!valid || busy} onClick={() => { void handleSubmit(); }}>
            <Upload className="h-3.5 w-3.5" />
            {reading ? '读取文件…' : uploading ? '上传中…' : '开始上传'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          accept=".pdf,.doc,.docx,.md,.txt,.markdown,.zip"
          onChange={(event) => {
            applyFile(event.target.files?.[0] ?? null);
            event.target.value = '';
          }}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            applyFile(event.dataTransfer.files?.[0] ?? null);
          }}
          className={cn('knowledge-upload-dropzone', dragging && 'is-dragging', file && 'has-file')}
        >
          <span className="knowledge-upload-dropzone__icon">
            <Upload className="h-5 w-5" />
          </span>
          <span className="mt-3 text-xs font-semibold text-[var(--text)]">
            {file ? '重新选择文件' : '拖拽文件到此处，或点击选择'}
          </span>
          <span className="mt-1 text-[10px] text-[var(--text-muted)]">
            PDF / Word / Markdown / 文本 · 最大 50MB · 多文件请打包 zip
          </span>
        </button>

        {file && (
          <div className="knowledge-upload-file">
            <span className="knowledge-upload-file__icon"><FileText className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-xs text-[var(--text)]">{file.name}</strong>
              <small className="text-[10px] text-[var(--text-muted)]">
                {Math.max(1, Math.round(file.size / 1024))} KB · {TEXT_UPLOAD_EXT.test(file.name) ? '将读取正文并写入详情' : '二进制文件将进入解析队列'}
              </small>
            </span>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
              onClick={() => { setFile(null); fileInputRef.current?.click(); }}
            >
              更换
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-[11px] text-[var(--danger)]">
            {error}
          </div>
        )}

        <Field label="文档标题" required>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：Redis 故障 Runbook v3.3"
            className="de-employee-input bg-[var(--bg)]"
            onKeyDown={(event) => event.key === 'Enter' && void handleSubmit()}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="文档分类">
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="de-employee-input h-9 w-full rounded-lg bg-[var(--bg)] px-2.5 text-xs text-[var(--text)]"
            >
              {KB_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </Field>
          <Field label="标签">
            <Input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="redis, oom, 生产"
              className="de-employee-input bg-[var(--bg)]"
            />
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">多个标签用逗号分隔，便于检索与治理筛选</p>
          </Field>
        </div>

        <div className="knowledge-upload-hint">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
          <span>
            上传后将执行敏感内容检测，并进入接入加工队列。Markdown / 纯文本正文会随请求一并提交，可在详情中直接阅读。
          </span>
        </div>
      </div>
    </Modal>
  );
}

function CitationAgentsModal({
  open, onClose, citation,
}: {
  open: boolean;
  onClose: () => void;
  citation: any;
}) {
  return (
    <Modal open={open} onClose={onClose} title="引用此文档的智能体" size="md">
      {!citation ? (
        <EmptyState icon={Sparkles} title="暂无数据" />
      ) : (
        <div className="space-y-2">
          <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-xs">
            <div className="font-semibold text-sm">{citation.title}</div>
            <div className="text-[10px] text-[var(--text-muted)] mt-0.5">最近引用 {citation.lastUsed} · 累计 {citation.citeCount} 次</div>
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-2 mb-1">引用方</div>
          <div className="grid grid-cols-2 gap-2">
            {(citation.usedBy ?? []).map((u: string) => (
              <div key={u} className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-xs flex items-center justify-between">
                <span className="font-mono">{u}</span>
                <Badge tone="brand" className="text-[9px]">{Math.floor(Math.random() * 30) + 5} 次</Badge>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[var(--text-muted)] mt-2">提示：升级文档版本时，所有引用方将在下次检索时自动切换到新版本。</p>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
        {label}{required && <span className="text-[var(--danger)]"> *</span>}
      </label>
      {children}
    </div>
  );
}
