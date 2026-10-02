/**
 * 工作流页面 state + handlers controller hook（M06 P1 拆分）。
 * 原 pages/Workflows.tsx 内 1600+ 行 hook 逻辑 → 此处拆出，模板归一化
 * 在 workflow-template-helpers.ts，避免控制器膨胀。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MarkerType, applyNodeChanges, type Edge, type Node, type NodeChange, type NodeMouseHandler, type Connection } from 'reactflow';
import type { DigitalPartner, Workflow, WorkflowNodeKind, WorkflowSkill } from '@qzda/web-types';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  ALL_WORKFLOW_TEMPLATES, DEPARTMENT_OPTIONS, deriveTemplateBlockers, diffTemplateUpgrade,
  filterByIndustry, isPersonalTemplate, isPlatformTemplate, isTemplateReusable,
  loadConnectorBindings, matchDepartmentKey, saveConnectorBindings,
  type ConnectorBindings, type DepartmentKey, type TemplateOrigin, type TemplateUpgradeDiff,
  type WorkflowTemplateAsset,
} from '@/features/workflows/department-templates';
import { defaultWorkflowTab, roleCanMutate, visibleWorkflowTabs } from '@/features/role-nav/role-nav';
import {
  cloneSnapshot, draftToFlow, evaluateWorkflowStructure, EMPTY_NODES, EMPTY_EDGES,
  mapRemoteVersion, NODE_DESCS, NODE_LABELS, NODE_LIB, SAMPLE_NODES, SAMPLE_EDGES,
  templateSnapshot,
  type GenerationResult, type GenerationVars, type SidePanelKey, type TabKey,
  type VersionSnapshot, type WorkflowRunRecord, type WorkflowValidation, type Snapshot,
} from './WorkflowsShared';
import { normalizeTemplateAsset } from './workflow-template-helpers';

export type Toast = { msg: string; tone: 'success' | 'error' | 'info' };
export type ShowToast = (msg: string, tone?: Toast['tone']) => void;
export type { SidePanelKey, TabKey, GenerationResult, GenerationVars, VersionSnapshot, Snapshot };

const apiErr = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback).replace(/^E_[A-Z_]+:\s*/, '');

export type WorkflowsController = ReturnType<typeof useWorkflowsController>;

export function useWorkflowsController() {
  const navigate = useNavigate();
  const userRole = useAuthStore((s) => s.user?.role);
  const canWrite = useAuthStore((s) => s.hasPermission('workflow.write')) && roleCanMutate(userRole);
  const canExecute = useAuthStore((s) => s.hasPermission('workflow.execute')) && roleCanMutate(userRole);
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const workflowTabs = visibleWorkflowTabs(userRole);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId ?? 'w1');

  const [tab, setTab] = useState<TabKey>(() => defaultWorkflowTab(userRole));
  const [sidePanel, setSidePanel] = useState<SidePanelKey>('library');
  const [librarySearchQ, setLibrarySearchQ] = useState('');
  const [canvasSearchQ, setCanvasSearchQ] = useState('');
  const [nodes, setNodes] = useState<Node[]>(EMPTY_NODES);
  const [edges, setEdges] = useState<Edge[]>(EMPTY_EDGES);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [filterGroup, setFilterGroup] = useState<DepartmentKey | 'all'>('office');
  const [filterIndustry, setFilterIndustry] = useState<string>('all');
  const [templateOriginFilter, setTemplateOriginFilter] = useState<TemplateOrigin>('platform');
  const [showAdvancedLibrary, setShowAdvancedLibrary] = useState(false);
  const [workspaceDeptOnly, setWorkspaceDeptOnly] = useState(false);
  const [connectorBindings, setConnectorBindings] = useState<ConnectorBindings>(() => loadConnectorBindings(currentWorkspaceId));
  const [upgradeDiff, setUpgradeDiff] = useState<{ template: WorkflowTemplateAsset; diff: TemplateUpgradeDiff } | null>(null);
  const [webhookEnabled, setWebhookEnabled] = useState(true);
  const [activeVersion, setActiveVersion] = useState('');
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const [versionDiffOpen, setVersionDiffOpen] = useState(false);
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [versionCenterSelectedId, setVersionCenterSelectedId] = useState<string>('');
  const [diffBaseId, setDiffBaseId] = useState<string>('');
  const [rollbackTargetId, setRollbackTargetId] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<WorkflowTemplateAsset | null>(null);
  const [aiGenerateOpen, setAiGenerateOpen] = useState(false);
  const [generationStep, setGenerationStep] = useState<'input' | 'preview'>('input');
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null);
  const [generationPrompt, setGenerationPrompt] = useState('当生产 Redis 触发 OOM 告警时，由数字伙伴研判处置路径，经双重审批后执行受控恢复，写入审计并通知值班负责人');
  const [generationConstraints, setGenerationConstraints] = useState<GenerationVars['constraints']>({ riskLevel: 'L2', requireApproval: true, requireAudit: true, requireRollback: true });
  const [generationModel, setGenerationModel] = useState('企业默认模型');

  const { data: generationHistoryData } = useApiQuery<GenerationResult[]>(['workflow-generations'], '/api/workflows/generations');
  const generationHistory = generationHistoryData ?? [];
  const { data: templateAssetsData, refetch: refetchTemplates } = useApiQuery<Array<Partial<WorkflowTemplateAsset> & { id: string; name: string }>>(['workflow-templates'], '/api/workflow-templates');
  const templateAssets = templateAssetsData ?? [];
  const { data: employeesData } = useApiQuery<DigitalPartner[]>(['digital-employees'], '/api/partners');
  const workspaceDepartments = useMemo(() => {
    const keys = new Set<DepartmentKey>();
    for (const employee of employeesData ?? []) {
      const key = matchDepartmentKey(employee.department);
      if (key) keys.add(key);
    }
    return keys;
  }, [employeesData]);
  const { data: workflowListData } = useApiQuery<Array<Pick<Workflow, 'id'>>>(['workflows', currentWorkspaceId], '/api/workflows');
  const workflowList = Array.isArray(workflowListData) ? workflowListData : [];
  const workflowId = workflowList[0]?.id ?? '';
  const { data: workflowDraft } = useApiQuery<Workflow>(['workflow-draft', currentWorkspaceId, workflowId], `/api/workflows/${workflowId || '__none__'}`, undefined, { enabled: Boolean(workflowId) });
  const { data: remoteVersionsData, refetch: refetchVersions } = useApiQuery<Array<Parameters<typeof mapRemoteVersion>[0]>>(
    ['workflow-versions', currentWorkspaceId, workflowId], `/api/workflows/${workflowId || '__none__'}/versions`, undefined, { enabled: Boolean(workflowId) },
  );
  const remoteVersions = Array.isArray(remoteVersionsData) ? remoteVersionsData : [];
  const draftHydratedRef = useRef(false);
  const [cleanBaseline, setCleanBaseline] = useState(() => JSON.stringify({ nodes: EMPTY_NODES, edges: EMPTY_EDGES }));
  const [draftGate, setDraftGate] = useState<import('./WorkflowsShared').DraftGate | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflightResult, setPreflightResult] = useState<WorkflowValidation | null>(null);
  const [preflightVersion, setPreflightVersion] = useState<string | null>(null);
  const [nodeLibraryOpen, setNodeLibraryOpen] = useState(false);
  const [focusRunId, setFocusRunId] = useState<string | null>(null);
  const { data: workflowRunsData } = useApiQuery<WorkflowRunRecord[]>(['workflow-runs'], '/api/workflow-runs');
  const workflowRuns = workflowRunsData ?? [];
  const { data: workflowSkillsData, refetch: refetchWorkflowSkills } = useApiQuery<WorkflowSkill[]>(['workflow-skills'], '/api/workflow-skills');
  const workflowSkills = workflowSkillsData ?? [];
  const [skillName, setSkillName] = useState('生产故障处置流程技能');
  const [skillDesc, setSkillDesc] = useState('由工作流程发布的标准作业能力，可供数字伙伴在能力装配中引用。');
  const [skillSourceVersion, setSkillSourceVersion] = useState('');
  const [skillRiskLevel, setSkillRiskLevel] = useState<WorkflowSkill['riskLevel']>('mid');

  const [toast, setToast] = useState<Toast | null>(null);
  const showToast = useCallback<ShowToast>((msg, tone = 'success') => { setToast({ msg, tone }); setTimeout(() => setToast(null), 2200); }, []);

  const generateWorkflowApi = useApiMutation<GenerationResult, GenerationVars>('/api/workflows/generate', {
    onSuccess: (result) => { setGenerationResult(result); setGenerationStep('preview'); showToast('已生成可编辑草稿，请专家复核后再应用', 'success'); },
    onError: () => showToast('生成失败，请调整处置目标后重试', 'error'),
  });
  const discardGenerationApi = useApiMutation<GenerationResult, { id: string }>((vars) => `/api/workflows/generations/${vars.id}/discard`, { onSuccess: () => showToast('已放弃本次生成结果', 'info') });
  const applyGenerationApi = useApiMutation<GenerationResult, { id: string }>(({ id }) => `/api/workflows/generations/${id}/apply`, { onError: () => showToast('生成草稿与审计未提交，当前画布未变更', 'error') });
  const validateWorkflowApi = useApiMutation<WorkflowValidation, { workflowId?: string; revisionId?: string; nodes: unknown[]; edges: unknown[] }>(
    (vars) => `/api/workflows/${vars.workflowId ?? workflowId}/validate`,
    {
      onSuccess: (result) => { setPreflightResult(result); setPreflightVersion(activeVersion); setPreflightOpen(true); },
      onError: () => showToast('运行前校验失败，请稍后重试', 'error'),
    },
  );
  const runWorkflowApi = useApiMutation<WorkflowRunRecord, Record<string, unknown>>(
    (vars) => `/api/workflows/${String((vars as { workflowId?: string }).workflowId ?? workflowId)}/run`,
    {
      onSuccess: (run) => { setPreflightOpen(false); setFocusRunId(run.id); setTab('history'); showToast(`已创建沙箱运行记录 ${run.id}`, 'success'); },
      onError: (err) => showToast(apiErr(err, '工作流执行请求失败'), 'error'),
    },
  );
  const saveWorkflowApi = useApiMutation<Workflow, { workflowId: string; nodes: unknown[]; edges: unknown[]; version: string; desc?: string }>(
    (vars) => `/api/workflows/${vars.workflowId}/draft`, { onError: () => showToast('服务端保存失败，本地草稿仍已保留', 'error') }, 'PUT',
  );
  const publishWorkflowApi = useApiMutation<{ publishedVersion?: VersionSnapshot }, { workflowId: string; version: string }>(
    (vars) => `/api/workflows/${vars.workflowId}/publish`,
    {
      onSuccess: (result) => { setVersionMenuOpen(false); refetchVersions(); showToast((result as any)?.publishedVersion?.id ? `已发布版本 ${(result as any).publishedVersion.id}` : '已发布当前草稿版本', 'success'); },
      onError: (err) => showToast(apiErr(err, '发布提交失败，请先完成运行前校验'), 'error'),
    },
  );
  const createVersionApi = useApiMutation<VersionSnapshot, { workflowId: string; label?: string; desc?: string; parentVersionId?: string; nodes: unknown[]; edges: unknown[] }>(
    (vars) => `/api/workflows/${vars.workflowId}/versions`,
    {
      onSuccess: (version) => { refetchVersions(); setActiveVersion(version.id); setVersionCenterSelectedId(version.id); setVersionMenuOpen(false); showToast(`已另存版本 ${version.label}`, 'success'); },
      onError: (err) => showToast(apiErr(err, '另存版本失败'), 'error'),
    },
  );
  const createPersonalTemplateApi = useApiMutation<
    Partial<WorkflowTemplateAsset> & { id: string; name: string },
    { name: string; description?: string; department?: string; sequence?: string[]; graph?: { nodes: unknown[]; edges: unknown[] }; risk?: string }
  >('/api/workflow-templates', {
    invalidateKeys: [['workflow-templates']],
    onSuccess: (tpl) => { setTemplateOriginFilter('personal'); setTab('templates'); showToast(`已保存个人模板「${tpl.name}」`, 'success'); void refetchTemplates(); },
    onError: (err) => showToast(apiErr(err, '保存个人模板失败'), 'error'),
  });
  const deletePersonalTemplateApi = useApiMutation<{ ok: boolean; id: string }, { id: string }>(
    (vars) => `/api/workflow-templates/${vars.id}`, { invalidateKeys: [['workflow-templates']], onSuccess: () => { showToast('已删除个人模板', 'info'); void refetchTemplates(); }, onError: (err) => showToast(apiErr(err, '删除失败'), 'error') }, 'DELETE',
  );
  const rollbackVersionApi = useApiMutation<{ draft: any; version: VersionSnapshot; restoredFrom: string }, { workflowId: string; versionId: string }>(
    (vars) => `/api/workflows/${vars.workflowId}/rollback`,
    {
      onSuccess: (result) => {
        refetchVersions();
        const mapped = mapRemoteVersion(result.version as any);
        const next = cloneSnapshot(mapped);
        setNodes(next.nodes); setEdges(next.edges); setActiveVersion(mapped.id); setSelectedNodeId(next.nodes[0]?.id ?? null);
        historyRef.current = { stack: [next], idx: 0 };
        setRollbackTargetId(null); setVersionMenuOpen(false); setTab('canvas');
        showToast(`已从 ${result.restoredFrom} 回滚并生成草稿 ${mapped.id}`, 'success');
      },
      onError: (err) => showToast(apiErr(err, '回滚失败'), 'error'),
    },
  );
  const releaseRequestApi = useApiMutation<unknown, { resourceType: 'workflow'; resourceName: string; risk: 'low' | 'medium' | 'high' }>('/api/release-approvals', {
    onSuccess: () => { setVersionMenuOpen(false); showToast('已提交生产发布申请，等待管理员审批', 'success'); },
    onError: () => showToast('发布申请提交失败，请稍后重试', 'error'),
  });
  const publishAsSkillApi = useApiMutation<WorkflowSkill, { workflowId: string; version: string; name: string; description: string; riskLevel: WorkflowSkill['riskLevel']; validationPassed: boolean; draftBlocked: boolean }>(
    (vars) => `/api/workflows/${vars.workflowId}/publish-as-skill`,
    {
      onSuccess: (skill) => {
        refetchWorkflowSkills();
        showToast(skill.status === 'published' ? `已发布流程技能「${skill.name}」` : `高风险技能「${skill.name}」已提交为草稿，待管理员治理发布后方可装配`, skill.status === 'published' ? 'success' : 'info');
      },
      onError: (err) => showToast(apiErr(err, '发布技能失败，请确认流程版本已校验'), 'error'),
    },
  );

  useEffect(() => { if (tab === 'publishSkill') setSkillSourceVersion(activeVersion); }, [tab, activeVersion]);

  // Mirror isDirty for callbacks declared earlier in the file.
  const isDirtyRef = useRef(false);
  const requestProductionRelease = useCallback(() => {
    if (draftGate?.blocked) { showToast(`模板依赖未就绪，无法发布：${draftGate.reasons[0] ?? '请先完成授权'}`, 'error'); return; }
    if (isDirtyRef.current) { showToast('请先保存草稿后再发布版本', 'error'); return; }
    if (isAdmin) publishWorkflowApi.mutate({ workflowId, version: activeVersion });
    else releaseRequestApi.mutate({ resourceType: 'workflow', resourceName: `工作流 ${activeVersion}`, risk: 'medium' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftGate, isAdmin, workflowId, activeVersion]);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [draggedKind, setDraggedKind] = useState<WorkflowNodeKind | null>(null);
  const historyRef = useRef<{ stack: Snapshot[]; idx: number }>({ stack: [{ nodes: EMPTY_NODES, edges: EMPTY_EDGES }], idx: 0 });
  useEffect(() => {
    if (!remoteVersions.length) return;
    const mapped = remoteVersions.map(mapRemoteVersion);
    setVersions(mapped);
    setActiveVersion((p) => (p && mapped.some((i) => i.id === p) ? p : (mapped[0]?.id ?? '')));
    setSkillSourceVersion((p) => (p && mapped.some((i) => i.id === p) ? p : (mapped[0]?.id ?? '')));
    setVersionCenterSelectedId((p) => p && mapped.some((i) => i.id === p) ? p : (mapped[0]?.id ?? ''));
    setDiffBaseId((p) => p && mapped.some((i) => i.id === p) ? p : (mapped.find((i) => i.id !== mapped[0]?.id)?.id ?? mapped[0]?.id ?? ''));
  }, [remoteVersions]);

  useEffect(() => { draftHydratedRef.current = false; }, [workflowId]);
  useEffect(() => {
    if (!workflowDraft || draftHydratedRef.current) return;
    draftHydratedRef.current = true;
    const flow = draftToFlow(workflowDraft);
    const snapshot = cloneSnapshot(flow);
    setNodes(snapshot.nodes); setEdges(snapshot.edges);
    historyRef.current = { stack: [snapshot], idx: 0 };
    setSelectedNodeId(null);
    setCleanBaseline(JSON.stringify({ nodes: snapshot.nodes, edges: snapshot.edges }));
  }, [workflowDraft, workflowId]);

  const pushHistory = useCallback((next: Snapshot) => {
    const h = historyRef.current;
    h.stack = h.stack.slice(0, h.idx + 1);
    h.stack.push(cloneSnapshot(next));
    if (h.stack.length > 50) h.stack.shift();
    h.idx = h.stack.length - 1;
  }, []);
  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.idx <= 0) { showToast('已是最早版本，无法撤销', 'info'); return; }
    h.idx -= 1; const snap = h.stack[h.idx]; setNodes(snap.nodes); setEdges(snap.edges); showToast('已撤销', 'info');
  }, [showToast]);
  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.idx >= h.stack.length - 1) { showToast('已是最新版本，无法重做', 'info'); return; }
    h.idx += 1; const snap = h.stack[h.idx]; setNodes(snap.nodes); setEdges(snap.edges); showToast('已重做', 'info');
  }, [showToast]);

  const reactFlowRef = useRef<any>(null);
  const focusNode = useCallback((id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node || !reactFlowRef.current) return;
    const { x, y } = node.position;
    reactFlowRef.current.setCenter?.(x + 70, y + 30, { zoom: 1.3, duration: 500 });
    setSelectedNodeId(id); setSidePanel('debug'); showToast(`已定位到节点 ${id}`, 'info');
  }, [nodes, showToast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      if (e.key === 'Escape') {
        if (contextMenu) { setContextMenu(null); return; }
        if (versionMenuOpen) { setVersionMenuOpen(false); return; }
        if (previewTemplate) { setPreviewTemplate(null); return; }
      }
      if (isInput) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 's') { e.preventDefault(); saveCanvasRef.current?.(); return; }
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) { e.preventDefault(); deleteNodeRef.current?.(selectedNodeId); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, contextMenu, versionMenuOpen, previewTemplate, undo, redo]);

  const availableTemplates = useMemo(() => {
    const fromApi = templateAssets.length > 0
      ? templateAssets.map((item) => normalizeTemplateAsset(item, connectorBindings))
      : (templateOriginFilter === 'personal' ? [] : ALL_WORKFLOW_TEMPLATES.map((item) => normalizeTemplateAsset(item, connectorBindings)));
    const byId = new Map(fromApi.map((item) => [item.id, item]));
    if (templateOriginFilter === 'platform') for (const item of ALL_WORKFLOW_TEMPLATES) if (!byId.has(item.id)) byId.set(item.id, normalizeTemplateAsset(item, connectorBindings));
    return filterByIndustry(Array.from(byId.values()), filterIndustry);
  }, [templateAssets, connectorBindings, filterIndustry, templateOriginFilter]);
  const filteredTemplates = availableTemplates.filter((t) => {
    if (templateOriginFilter === 'platform' ? !isPlatformTemplate(t) : !isPersonalTemplate(t)) return false;
    if (templateOriginFilter === 'platform' && !showAdvancedLibrary && t.library === 'advanced') return false;
    if (filterGroup !== 'all' && t.department !== filterGroup) return false;
    if (workspaceDeptOnly && workspaceDepartments.size > 0 && !workspaceDepartments.has(t.department)) return false;
    return true;
  });
  const platformTemplateCount = availableTemplates.filter((t) => isPlatformTemplate(t) && t.library === 'default').length;
  const personalTemplateCount = availableTemplates.filter((t) => isPersonalTemplate(t)).length;
  const filteredLibrary = NODE_LIB.filter((k) => !librarySearchQ || NODE_LABELS[k].includes(librarySearchQ) || NODE_DESCS[k].toLowerCase().includes(librarySearchQ.toLowerCase()));
  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) || null, [nodes, selectedNodeId]);
  const rfNodes = useMemo<Node[]>(() => nodes.map((n) => ({ ...n, selected: n.id === selectedNodeId, data: { ...n.data, id: n.id } })), [nodes, selectedNodeId]);
  const rfEdges = useMemo<Edge[]>(() => edges.map((e) => ({ ...e, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' }, style: { stroke: '#94a3b8', strokeWidth: 1.2 } })), [edges]);

  const nodeDragSnapshotRef = useRef<Snapshot | null>(null);
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((prev) => {
      const next = applyNodeChanges(changes, prev);
      const positionChanges = changes.filter((change) => change.type === 'position');
      if (positionChanges.length) {
        if (positionChanges.some((change) => change.type === 'position' && change.dragging) && !nodeDragSnapshotRef.current) nodeDragSnapshotRef.current = cloneSnapshot({ nodes: prev, edges });
        if (positionChanges.some((change) => change.type === 'position' && !change.dragging)) { pushHistory({ nodes: next, edges }); nodeDragSnapshotRef.current = null; }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, pushHistory]);

  const addNode = useCallback((kind: WorkflowNodeKind, position?: { x: number; y: number }) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    const id = `n${Date.now().toString(36)}`;
    const pos = position ?? { x: 200 + Math.random() * 200, y: 240 + Math.random() * 120 };
    const newNode: Node = { id, type: 'custom', position: pos, data: { kind, label: NODE_LABELS[kind] } };
    setNodes((prev) => { const next = [...prev, newNode]; pushHistory({ nodes: next, edges }); return next; });
    setSelectedNodeId(id); setSidePanel('properties'); showToast(`已添加节点 ${NODE_LABELS[kind]}（${id}）`, 'success');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, pushHistory, showToast]);

  const deleteNode = useCallback((id: string) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    setNodes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      setEdges((prevE) => { const nextE = prevE.filter((e) => e.source !== id && e.target !== id); pushHistory({ nodes: next, edges: nextE }); return nextE; });
      return next;
    });
    if (selectedNodeId === id) setSelectedNodeId(null);
    showToast(`节点 ${id} 已删除`, 'info');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, selectedNodeId, pushHistory, showToast]);

  const duplicateNode = useCallback((id: string) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    const src = nodes.find((n) => n.id === id); if (!src) return;
    const newId = `n${Date.now().toString(36)}`;
    const cloned: Node = { ...src, id: newId, position: { x: src.position.x + 40, y: src.position.y + 40 }, data: { ...src.data, label: (src.data?.label ?? NODE_LABELS[src.data.kind as WorkflowNodeKind]) + ' (副本)' } };
    setNodes((prev) => { const next = [...prev, cloned]; pushHistory({ nodes: next, edges }); return next; });
    setSelectedNodeId(newId); showToast(`节点 ${id} 已复制为 ${newId}`, 'success');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, nodes, pushHistory, showToast]);

  const patchNodes = useCallback((id: string, mutator: (n: Node) => Node) => {
    setNodes((prev) => { const next = prev.map((n) => (n.id === id ? mutator(n) : n)); pushHistory({ nodes: next, edges }); return next; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, pushHistory]);
  const updateNodeLabel = useCallback((id: string, label: string) => { if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; } patchNodes(id, (n) => ({ ...n, data: { ...n.data, label } })); }, [canWrite, patchNodes, showToast]);
  const updateNodeDescription = useCallback((id: string, desc: string) => { if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; } patchNodes(id, (n) => ({ ...n, data: { ...n.data, desc } })); }, [canWrite, patchNodes, showToast]);
  const updateNodeNote = useCallback((id: string, note: string) => { if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; } patchNodes(id, (n) => ({ ...n, data: { ...n.data, note } })); }, [canWrite, patchNodes, showToast]);
  const patchNodeData = useCallback((id: string, patch: Record<string, unknown>) => { if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; } patchNodes(id, (n) => ({ ...n, data: { ...n.data, ...patch } })); }, [canWrite, patchNodes, showToast]);
  const structureIssues = useMemo(() => evaluateWorkflowStructure(nodes, edges), [nodes, edges]);
  const disableNode = useCallback((id: string) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    const wasDisabled = nodes.find((n) => n.id === id)?.data?.disabled;
    patchNodes(id, (n) => ({ ...n, data: { ...n.data, disabled: !n.data?.disabled } }));
    showToast(`节点 ${id} ${wasDisabled ? '已启用' : '已禁用'}（运行时跳过）`, 'info');
  }, [canWrite, nodes, patchNodes, showToast]);

  const clearCanvas = useCallback(() => { if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; } setClearConfirmOpen(true); }, [canWrite, showToast]);
  const confirmClearCanvas = useCallback(() => {
    setNodes([]); setEdges([]); pushHistory({ nodes: [], edges: [] }); setSelectedNodeId(null); showToast('画布已清空（本地草稿）', 'info');
  }, [pushHistory, showToast]);
  const resetCanvas = useCallback(() => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    const snapshot = cloneSnapshot({ nodes: SAMPLE_NODES.map((node) => ({ ...node, data: { ...node.data }, position: { ...node.position } })), edges: SAMPLE_EDGES.map((edge) => ({ ...edge })) });
    setNodes(snapshot.nodes); setEdges(snapshot.edges); pushHistory(snapshot); setSelectedNodeId(null); setDraftGate(null); showToast('已加载示例编排模板（需保存草稿才会写入服务端）', 'success');
  }, [canWrite, pushHistory, showToast]);

  const saveCanvas = useCallback(() => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    const id = activeVersion;
    const version = versions.find((item) => item.id === id);
    if (version?.status === 'published') { showToast('已发布版本不可覆盖，请先另存为新草稿', 'error'); return; }
    const snapshot = cloneSnapshot({ nodes, edges });
    setVersions((prev) => prev.map((item) => item.id === id ? { ...item, nodes: snapshot.nodes, edges: snapshot.edges, nodeCount: snapshot.nodes.length, edgeCount: snapshot.edges.length, evidenceMode: 'recorded', time: '刚刚', desc: '保存当前本地草稿' } : item));
    saveWorkflowApi.mutate({ workflowId, nodes: nodes.map((node) => ({ id: node.id, kind: node.data?.kind, label: node.data?.label, data: node.data, position: node.position })), edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })), version: id, desc: '保存当前本地草稿' }, { onSuccess: () => refetchVersions() });
    setCleanBaseline(JSON.stringify({ nodes: snapshot.nodes, edges: snapshot.edges }));
    showToast(`已保存 ${version?.label ?? id}（工作流草稿）`, 'success');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVersion, canWrite, edges, nodes, saveWorkflowApi, versions, workflowId]);

  const saveAsVersion = useCallback((label?: string) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    if (!nodes.length) { showToast('空画布不能另存版本', 'error'); return; }
    createVersionApi.mutate({ workflowId, label, desc: '从当前画布另存的草稿版本', parentVersionId: activeVersion, nodes: nodes.map((node) => ({ id: node.id, kind: node.data?.kind, label: node.data?.label, data: node.data, position: node.position })), edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVersion, canWrite, createVersionApi, edges, nodes, workflowId]);

  const loadSnapshot = useCallback((snapshot: Snapshot, versionId: string) => {
    const next = cloneSnapshot(snapshot);
    setNodes(next.nodes); setEdges(next.edges); setActiveVersion(versionId); setSkillSourceVersion(versionId);
    setSelectedNodeId(next.nodes[0]?.id ?? null); pushHistory(next);
    setCleanBaseline(JSON.stringify({ nodes: next.nodes, edges: next.edges }));
  }, [pushHistory]);

  const runWorkflow = useCallback(() => {
    if (!canExecute) { showToast('当前账号没有工作流执行权限', 'error'); return; }
    if (draftGate?.blocked) { showToast(`模板依赖未授权，禁止试运行：${draftGate.reasons[0] ?? '请先完成依赖授权'}`, 'error'); return; }
    if (!nodes.length) { showToast('画布为空，无法运行工作流', 'error'); return; }
    const blocking = evaluateWorkflowStructure(nodes, edges).filter((i) => i.severity === 'failed');
    if (blocking.length) { showToast(blocking[0].message, 'error'); return; }
    const revisionId = ['rev_', 'tpl_', 'ver_', 'pub_'].some((p) => activeVersion.startsWith(p)) ? activeVersion : undefined;
    validateWorkflowApi.mutate({ workflowId, revisionId, nodes: nodes.map((node) => ({ id: node.id, kind: node.data?.kind, label: node.data?.label, data: node.data })), edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVersion, canExecute, draftGate, edges, nodes, validateWorkflowApi, workflowId]);

  const openAIGenerator = useCallback(() => { if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; } navigate('/workflows/orchestration'); }, [canWrite, navigate, showToast]);
  const submitGeneration = useCallback(() => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    if (generationPrompt.trim().length < 8) { showToast('请至少描述 8 个字符的业务目标', 'error'); return; }
    generateWorkflowApi.mutate({ prompt: generationPrompt.trim(), constraints: generationConstraints, workspaceId: currentWorkspaceId, model: generationModel });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, generateWorkflowApi, generationConstraints, generationModel, generationPrompt, currentWorkspaceId]);
  const applyGeneration = useCallback(async () => {
    if (!canWrite || !generationResult) return;
    const activeSnapshot = versions.find((version) => version.id === activeVersion);
    const hasUnsavedChanges = !activeSnapshot || JSON.stringify({ nodes, edges }) !== JSON.stringify({ nodes: activeSnapshot.nodes, edges: activeSnapshot.edges });
    if (hasUnsavedChanges && !window.confirm('当前画布存在未保存修改。AI 辅助编排将另存为新的隔离草稿，是否继续？')) return;
    const applied = await applyGenerationApi.mutateAsync({ id: generationResult.id });
    if (!applied.revisionId) { showToast('服务端未返回草稿版本，未应用生成结果', 'error'); return; }
    const snapshot: Snapshot = {
      nodes: applied.workflow.nodes.map((node) => ({ id: node.id, type: 'custom', position: node.position, data: { kind: node.kind, label: node.label, desc: node.description } } as Node)),
      edges: applied.workflow.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
    };
    setNodes(snapshot.nodes); setEdges(snapshot.edges);
    setVersions((previous) => previous.some((version) => version.id === applied.revisionId) ? previous : [{ id: applied.revisionId!, label: `${applied.revisionId} · AI 草稿`, time: '刚刚', desc: `AI 辅助编排 · ${applied.promptDigest ?? applied.id}`, nodes: cloneSnapshot(snapshot).nodes, edges: cloneSnapshot(snapshot).edges }, ...previous]);
    setActiveVersion(applied.revisionId); pushHistory(snapshot); setSelectedNodeId(snapshot.nodes[0]?.id ?? null);
    setTab('canvas'); setSidePanel('properties'); setAiGenerateOpen(false);
    showToast(`已创建隔离草稿 ${applied.revisionId}，专家复核后可发布为流程技能供数字伙伴装配`, 'success');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVersion, applyGenerationApi, canWrite, edges, generationResult, nodes, pushHistory, versions]);
  const discardGeneration = useCallback(() => { if (generationResult) discardGenerationApi.mutate({ id: generationResult.id }); setAiGenerateOpen(false); setGenerationResult(null); setGenerationStep('input'); }, [discardGenerationApi, generationResult]);

  const createTemplateDraft = useCallback((template: WorkflowTemplateAsset) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    const asset = normalizeTemplateAsset(template, connectorBindings);
    const snapshot = templateSnapshot(asset);
    const currentSnapshot = versions.find((version) => version.id === activeVersion);
    const hasUnsavedChanges = !currentSnapshot || JSON.stringify({ nodes, edges }) !== JSON.stringify({ nodes: currentSnapshot.nodes, edges: currentSnapshot.edges });
    if (hasUnsavedChanges && !window.confirm('当前画布存在未保存修改。模板将创建为新的隔离草稿，是否继续？')) return;
    const revisionId = `tpl_${asset.id}_${Date.now().toString(36)}`;
    const reasons = asset.blockers.length ? asset.blockers : deriveTemplateBlockers(asset);
    const blocked = !isTemplateReusable(asset);
    const provenance = { sourceTemplateId: asset.id, sourceTemplateVersion: asset.version, certification: asset.certification, degraded: Boolean(asset.healthHint) };
    setNodes(snapshot.nodes); setEdges(snapshot.edges);
    setVersions((previous) => [{ id: revisionId, label: `${asset.version} · 模板草稿`, time: '刚刚', desc: `sourceTemplateId=${asset.id}@${asset.version} · ${asset.name} · ${asset.owner}${asset.healthHint ? ` · ${asset.healthHint}` : ''}`, nodes: cloneSnapshot(snapshot).nodes, edges: cloneSnapshot(snapshot).edges }, ...previous]);
    setActiveVersion(revisionId); pushHistory(snapshot); setSelectedNodeId(snapshot.nodes[0]?.id ?? null);
    setDraftGate({ blocked, reasons: reasons.length ? reasons : (blocked ? ['存在未满足的依赖或治理条件'] : []), templateId: asset.id, templateName: asset.name, templateVersion: asset.version, owner: asset.owner, sourceTemplateId: provenance.sourceTemplateId, sourceTemplateVersion: provenance.sourceTemplateVersion, degraded: provenance.degraded, healthHint: asset.healthHint });
    setTab('canvas'); setSidePanel('properties');
    showToast(blocked ? `已基于「${asset.name}」创建隔离草稿（依赖未授权，试运行与发布已禁用）` : asset.healthHint ? `已基于「${asset.name}」创建隔离草稿（${asset.healthHint}）` : `已基于「${asset.name}」创建隔离草稿（溯源 ${asset.id}@${asset.version}）`, blocked ? 'info' : 'success');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, connectorBindings, edges, nodes, pushHistory, versions]);

  const saveAsPersonalTemplate = useCallback(() => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    if (!nodes.length) { showToast('空画布不能保存为个人模板', 'error'); return; }
    const defaultName = versions.find((v) => v.id === activeVersion)?.label?.replace(/^v?\d[\w.-]*\s*[·•-]?\s*/, '') || '我的流程模板';
    const name = window.prompt('个人模板名称', defaultName || '我的流程模板'); if (name == null) return;
    const trimmed = name.trim(); if (!trimmed) { showToast('模板名称不能为空', 'error'); return; }
    const sequence = nodes.map((n) => String(n.data?.kind ?? 'task'));
    createPersonalTemplateApi.mutate({ name: trimmed, description: `由画布另存 · ${nodes.length} 节点 / ${edges.length} 连线`, department: filterGroup === 'all' ? 'it' : filterGroup, sequence, graph: { nodes: nodes.map((n) => ({ id: n.id, kind: n.data?.kind, label: n.data?.label, position: n.position })), edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })) }, risk: 'L2' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVersion, canWrite, createPersonalTemplateApi, edges, filterGroup, nodes, versions]);

  const deletePersonalTemplate = useCallback((template: WorkflowTemplateAsset) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    if (!isPersonalTemplate(template)) { showToast('平台内置模板不可删除', 'error'); return; }
    if (!window.confirm(`确认删除个人模板「${template.name}」？此操作不可恢复。`)) return;
    deletePersonalTemplateApi.mutate({ id: template.id });
  }, [canWrite, deletePersonalTemplateApi, showToast]);

  const bindConnectorSlot = useCallback((slotName: string, binding = `workspace:${slotName}`) => {
    const next = { ...connectorBindings, [slotName]: binding };
    setConnectorBindings(next); saveConnectorBindings(currentWorkspaceId, next); showToast(`已绑定槽位 ${slotName}`, 'success');
  }, [connectorBindings, currentWorkspaceId, showToast]);

  const openUpgradeDiff = useCallback((template: WorkflowTemplateAsset) => {
    const latest = availableTemplates.find((t) => t.id === template.id) ?? template;
    const current = draftGate?.sourceTemplateId === template.id ? { ...template, version: draftGate.sourceTemplateVersion || template.version } : { ...template, version: '0.9.0' };
    const previewLatest = template.changelog.some((c) => c.version !== template.version)
      ? { ...latest, version: template.changelog.map((c) => c.version).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1) || latest.version } : latest;
    const diff = diffTemplateUpgrade(current, previewLatest);
    if (!diff.available && template.id === 'wf.fin.expense') {
      setUpgradeDiff({ template, diff: diffTemplateUpgrade({ ...template, version: '1.0.0' }, { ...template, version: '1.1.0', sequence: [...template.sequence, 'schedule'], connectors: [...template.connectors, { slot: 'budget.check', label: '预算校验', required: false, capability: 'budget.check' }], changelog: [...template.changelog] }) });
      return;
    }
    setUpgradeDiff({ template, diff });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTemplates, draftGate]);

  const exportWorkflow = useCallback(() => {
    const data = { version: '1.0', exportedAt: new Date().toISOString(), nodes: nodes.map((n) => ({ id: n.id, kind: n.data?.kind, label: n.data?.label, desc: n.data?.desc, note: n.data?.note, position: n.position, disabled: !!n.data?.disabled })), edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `workflow-${activeVersion}-${Date.now()}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast(`已导出工作流（${nodes.length} 节点 / ${edges.length} 连线）`, 'success');
  }, [nodes, edges, activeVersion, showToast]);

  const saveCanvasRef = useRef(saveCanvas); saveCanvasRef.current = saveCanvas;
  const deleteNodeRef = useRef(deleteNode); deleteNodeRef.current = deleteNode;
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    if (edges.some((e) => e.source === connection.source && e.target === connection.target)) { showToast('连线已存在', 'info'); return; }
    const newEdge: Edge = { id: `e${connection.source}-${connection.target}-${Date.now().toString(36)}`, source: connection.source!, target: connection.target! };
    setEdges((prev) => { const next = [...prev, newEdge]; pushHistory({ nodes, edges: next }); return next; });
    showToast(`已连线：${connection.source} → ${connection.target}`, 'success');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, nodes, pushHistory, showToast]);
  const deleteEdge = useCallback((id: string) => { setEdges((prev) => { const next = prev.filter((e) => e.id !== id); pushHistory({ nodes, edges: next }); showToast(`连线 ${id} 已删除`, 'info'); return next; }); }, [nodes, pushHistory, showToast]);
  const searchMatch = useMemo(() => {
    if (!canvasSearchQ || tab !== 'canvas') return null;
    const q = canvasSearchQ.trim().toLowerCase(); if (!q) return null;
    return nodes.find((n) => n.id.toLowerCase() === q || (n.data?.label ?? '').toLowerCase().includes(q) || (n.data?.kind ?? '').toLowerCase().includes(q));
  }, [canvasSearchQ, nodes, tab]);
  const onNodeClick: NodeMouseHandler = useCallback((_, node) => { setSelectedNodeId(node.id); setSidePanel('properties'); }, []);
  const onNodeContextMenu: NodeMouseHandler = useCallback((event, node) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id }); setSelectedNodeId(node.id); }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('application/wf-node') as WorkflowNodeKind;
    if (!kind || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const screenPosition = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const position = reactFlowRef.current?.screenToFlowPosition ? reactFlowRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY }) : reactFlowRef.current?.project ? reactFlowRef.current.project(screenPosition) : { x: screenPosition.x - 80, y: screenPosition.y - 30 };
    addNode(kind, position); setDraggedKind(null);
  }, [addNode]);

  const activeSnapshot = versions.find((version) => version.id === activeVersion);
  const isDirty = useMemo(() => {
    const current = JSON.stringify({ nodes, edges });
    if (cleanBaseline) return current !== cleanBaseline;
    if (!activeSnapshot) return false;
    if (!activeSnapshot.nodes.length && !activeSnapshot.edges.length && activeSnapshot.evidenceMode === 'synthetic') return false;
    return current !== JSON.stringify({ nodes: activeSnapshot.nodes, edges: activeSnapshot.edges });
  }, [activeSnapshot, cleanBaseline, edges, nodes]);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);
  useEffect(() => { if (!isDirty) return; setPreflightResult(null); setPreflightVersion(null); }, [isDirty]);
  useEffect(() => { setPreflightResult(null); setPreflightVersion(null); }, [activeVersion]);
  const skillValidationReady = Boolean(preflightResult?.passed && preflightVersion === skillSourceVersion && skillSourceVersion === activeVersion && !isDirty);
  const canPublishSkill = Boolean(canWrite && skillName.trim() && !isDirty && !draftGate?.blocked && skillValidationReady);
  const skillGateSteps = useMemo(() => {
    const versionAligned = skillSourceVersion === activeVersion;
    const validated = Boolean(preflightResult?.passed && preflightVersion === skillSourceVersion);
    return [
      { key: 'draft', title: '画布草稿已保存', detail: isDirty ? '存在未保存修改，请先保存' : '当前版本与画布一致且无脏数据', ok: !isDirty },
      { key: 'version', title: '来源版本已加载到画布', detail: versionAligned ? `${skillSourceVersion} 已是画布当前版本` : `请先在版本管理加载 ${skillSourceVersion}`, ok: versionAligned },
      { key: 'validate', title: '运行前校验已通过', detail: validated ? `校验通过 · ${skillSourceVersion}` : '请对本版本执行并通过运行前校验', ok: validated },
      { key: 'deps', title: '模板依赖就绪', detail: draftGate?.blocked ? (draftGate.reasons[0] ?? '依赖未授权') : '无阻断依赖，可进入发布', ok: !draftGate?.blocked },
    ] as const;
  }, [activeVersion, draftGate, isDirty, preflightResult?.passed, preflightVersion, skillSourceVersion]);
  const skillGateHint = isDirty ? '请先保存画布草稿后再发布技能' : draftGate?.blocked ? '来源模板依赖未授权，完成授权前不可发布技能' : !skillValidationReady ? '发布前须对画布当前版本完成并通过运行前校验' : null;
  const publishedSkillCount = workflowSkills.filter((skill) => skill.status === 'published').length;
  const draftSkillCount = workflowSkills.filter((skill) => skill.status === 'draft').length;
  const publishSkill = useCallback(() => {
    if (draftGate?.blocked) { showToast(`模板依赖未授权，禁止发布技能：${draftGate.reasons[0]}`, 'error'); return; }
    if (!skillValidationReady) { showToast('请先对当前画布版本完成运行前校验', 'error'); return; }
    publishAsSkillApi.mutate({ workflowId, version: skillSourceVersion, name: skillName.trim(), description: skillDesc.trim(), riskLevel: skillRiskLevel, validationPassed: true, draftBlocked: Boolean(draftGate?.blocked) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftGate, skillValidationReady, publishAsSkillApi, workflowId, skillSourceVersion, skillName, skillDesc, skillRiskLevel]);

  return {
    navigate, canWrite, canExecute, isAdmin, workflowTabs,
    tab, setTab, sidePanel, setSidePanel, librarySearchQ, setLibrarySearchQ, canvasSearchQ, setCanvasSearchQ,
    nodes, edges, selectedNodeId, setSelectedNodeId,
    contextMenu, setContextMenu, clearConfirmOpen, setClearConfirmOpen,
    filterGroup, setFilterGroup, filterIndustry, setFilterIndustry, templateOriginFilter, setTemplateOriginFilter,
    showAdvancedLibrary, setShowAdvancedLibrary, workspaceDeptOnly, setWorkspaceDeptOnly,
    connectorBindings, setConnectorBindings, upgradeDiff, setUpgradeDiff, webhookEnabled, setWebhookEnabled,
    activeVersion, setActiveVersion, versionMenuOpen, setVersionMenuOpen, versionDiffOpen, setVersionDiffOpen,
    versions, setVersions, versionCenterSelectedId, setVersionCenterSelectedId, diffBaseId, setDiffBaseId, rollbackTargetId, setRollbackTargetId,
    previewTemplate, setPreviewTemplate, aiGenerateOpen, setAiGenerateOpen, generationStep, setGenerationStep,
    generationResult, setGenerationResult, generationPrompt, setGenerationPrompt, generationConstraints, setGenerationConstraints, generationModel, setGenerationModel,
    generationHistory, templateAssets, refetchTemplates, employeesData, workspaceDepartments,
    workflowId, workflowDraft, remoteVersions, draftGate, setDraftGate, preflightOpen, setPreflightOpen,
    preflightResult, setPreflightResult, preflightVersion, setPreflightVersion, nodeLibraryOpen, setNodeLibraryOpen,
    toast, showToast, generateWorkflowApi, discardGenerationApi, applyGenerationApi, validateWorkflowApi,
    focusRunId, setFocusRunId, workflowRuns, runWorkflowApi, saveWorkflowApi, publishWorkflowApi,
    createVersionApi, createPersonalTemplateApi, deletePersonalTemplateApi, rollbackVersionApi, releaseRequestApi,
    workflowSkills, refetchWorkflowSkills, publishAsSkillApi,
    skillName, setSkillName, skillDesc, setSkillDesc, skillSourceVersion, setSkillSourceVersion, skillRiskLevel, setSkillRiskLevel,
    requestProductionRelease, wrapperRef, draggedKind, setDraggedKind, historyRef, undo, redo, reactFlowRef, focusNode,
    availableTemplates, filteredTemplates, platformTemplateCount, personalTemplateCount, filteredLibrary,
    selectedNode, rfNodes, rfEdges, onNodesChange, addNode, deleteNode, duplicateNode,
    updateNodeLabel, updateNodeDescription, updateNodeNote, patchNodeData,
    structureIssues, disableNode, clearCanvas, confirmClearCanvas, resetCanvas, saveCanvas, saveAsVersion, loadSnapshot,
    runWorkflow, openAIGenerator, submitGeneration, applyGeneration, discardGeneration, createTemplateDraft,
    saveAsPersonalTemplate, deletePersonalTemplate, bindConnectorSlot, openUpgradeDiff, exportWorkflow,
    onConnect, deleteEdge, searchMatch, onNodeClick, onNodeContextMenu, handleDragOver, handleDrop,
    isDirty, activeSnapshot, skillValidationReady, canPublishSkill, skillGateSteps, skillGateHint,
    publishedSkillCount, draftSkillCount, publishSkill, currentWorkspaceId, saveCanvasRef, deleteNodeRef, refetchVersions,
    DEPARTMENT_OPTIONS,
  };
}