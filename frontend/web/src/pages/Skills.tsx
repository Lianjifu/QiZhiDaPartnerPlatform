import { useState, useMemo, useEffect } from 'react';
import { useApiMutation, useApiQuery, useApiUploadMutation } from '@/services/query';
import { Badge, Button, Input, KpiCard } from '@qzda/web-ui';
import {
  Wrench, ShieldAlert, ShieldCheck, Settings, Search, AlertTriangle, CheckCircle2, Box, Star, Globe, Activity, History,
  Play, RefreshCw, Lock, Container, Eye, Terminal, Sparkles, Trash2, GitBranch, Cpu,
  Save, List, LayoutGrid, Power, ArrowUpCircle, Upload, Network,
} from 'lucide-react';
import { cn } from '@qzda/web-utils';
import type { Skill, SkillAuditEvent, SkillImpactReport, SkillInstallPreflight, SkillPermission, SkillGovernancePolicy, SkillLifecycleStatus, SkillRuntimeHealth, WorkflowSkill } from '@qzda/web-types';
import { Link, useSearchParams } from 'react-router-dom';
import { Modal, ConfirmDialog, EmptyState, RoleReadonlyBanner } from '@/components/shared';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useT } from '@/i18n';
import { defaultSkillsTab, roleCanMutate, rolePageCopy, visibleSkillsTabs } from '@/features/role-nav/role-nav';
import {
  KIND_META, KIND_PROFILE, buildHealthBySkillId, buildReferenceBySkillId, enrichSkillRow,
  type ModalKind, type SkillCenterTab, type SkillRow,
} from '@/features/skills/skill-ui';
import {
  ImportSkillModal, CapabilityConfigModal, StoreSkillDetail, Stat, X,
} from '@/features/skills/skill-modals';
import { IntegrationWorkspace } from '@/features/skills/integration-workspace';
import { GovernanceWorkspace } from '@/features/skills/governance-workspace';
import { PlatformToolsWorkspace } from '@/features/skills/platform-tools-workspace';

const VALID_TABS: SkillCenterTab[] = ['workspace', 'store', 'platformTools', 'workflowSkills', 'integration', 'governance'];
const EMPTY_SKILLS: Skill[] = [];
const EMPTY_CATALOG: Skill[] = [];
const EMPTY_HEALTH: SkillRuntimeHealth[] = [];
const EMPTY_WORKFLOW_SKILLS: WorkflowSkill[] = [];

function dedupeSkillsById<T extends { id: string }>(skills: T[]): T[] {
  const seen = new Map<string, T>();
  for (const skill of skills) {
    seen.set(skill.id, skill);
  }
  return Array.from(seen.values());
}

function resolveTab(raw: string | null, roleDefault: SkillCenterTab): SkillCenterTab {
  if (raw === 'atomic') return 'workspace';
  if (raw && VALID_TABS.includes(raw as SkillCenterTab)) return raw as SkillCenterTab;
  return roleDefault;
}

export default function Skills() {
  const { t } = useT();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const pageCopy = rolePageCopy('skills', user?.role);
  const allowedTabs = visibleSkillsTabs(user?.role);
  const canWrite = Boolean(user?.permissions.includes('skill.write')) && roleCanMutate(user?.role);
  const currentWorkspace = useWorkspaceStore((state) => state.current);
  const workspaceName = currentWorkspace?.name ?? 'ACME 生产';
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTabRaw = searchParams.get('tab');
  const [tab, setTab] = useState<SkillCenterTab>(() => {
    const preferred = defaultSkillsTab(user?.role);
    const resolved = resolveTab(initialTabRaw, preferred);
    return allowedTabs.includes(resolved) ? resolved : preferred;
  });
  const [typeFilters, setTypeFilters] = useState<Record<'workspace' | 'store' | 'integration' | 'governance', 'all' | Skill['kind']>>({ workspace: initialTabRaw === 'atomic' ? 'skill' : 'all', store: 'all', integration: 'all', governance: 'all' });

  useEffect(() => {
    const nextRaw = searchParams.get('tab');
    const preferred = defaultSkillsTab(user?.role);
    const allowed = visibleSkillsTabs(user?.role);
    if (nextRaw === 'atomic') {
      setTypeFilters((filters) => ({ ...filters, workspace: 'skill' }));
      const params = new URLSearchParams(searchParams);
      params.delete('tab');
      setSearchParams(params, { replace: true });
      setTab('workspace');
      return;
    }
    const next = resolveTab(nextRaw, preferred);
    const resolved = allowed.includes(next) ? next : preferred;
    setTab((current) => (current === resolved ? current : resolved));
  }, [searchParams, setSearchParams, user?.role]);

  const selectTab = (next: SkillCenterTab) => {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'workspace') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };
  const [lifecycleFilter, setLifecycleFilter] = useState<'all' | SkillLifecycleStatus>('all');
  const [workspaceFocus, setWorkspaceFocus] = useState<'all' | 'enabled' | 'pending' | 'upgradeable' | 'attention'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list');
  const [storeSearchQ, setStoreSearchQ] = useState('');
  const [storeRiskFilter, setStoreRiskFilter] = useState<'all' | 'low' | 'mid' | 'high'>('all');
  const [storeChannelFilter, setStoreChannelFilter] = useState<'all' | 'builtin' | 'registry' | 'promoted'>('all');
  const [storeReleaseFilter, setStoreReleaseFilter] = useState<'all' | 'stable' | 'beta'>('all');
  const [promoteTicket, setPromoteTicket] = useState('');
  const [certifiedOnly, setCertifiedOnly] = useState(false);
  const [storePreview, setStorePreview] = useState<{ skill: any; preflight: SkillInstallPreflight } | null>(null);
  const [approvalTicket, setApprovalTicket] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const [storePage, setStorePage] = useState(1);
  const storePageSize = 8;
  const [upgradePlan, setUpgradePlan] = useState<any | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [testRunnerOpen, setTestRunnerOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeModal, setActiveModal] = useState<ModalKind>(null);
  const [batchConfirm, setBatchConfirm] = useState<'upgrade' | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'access' | 'versions' | 'runtime'>('overview');
  const [detailDescExpanded, setDetailDescExpanded] = useState(false);
  const [showRuntimeConfig, setShowRuntimeConfig] = useState(false);
  const [runtimeSettings, setRuntimeSettings] = useState<Record<string, { cacheable: boolean; timeout: string; retries: string }>>({});
  const [operationNotice, setOperationNotice] = useState<string | null>(null);

  const [installed, setInstalled] = useState<SkillRow[]>([]);
  const [searchQ, setSearchQ] = useState('');
  const { data: apiInstalledData } = useApiQuery<Skill[]>(['skills'], '/api/skills');
  const { data: apiCatalogData } = useApiQuery<{
    items: Skill[];
    meta?: { demoNotice?: string; channels?: Array<{ id: string; label: string }> };
  }>(['skills', 'catalog'], '/api/skills/catalog');
  const { data: governanceHealthData } = useApiQuery<SkillRuntimeHealth[]>(
    ['skills', 'governance', 'health'],
    '/api/skills/governance/health',
    undefined,
    { enabled: tab === 'workspace' || tab === 'governance' },
  );
  const apiInstalled = apiInstalledData ?? EMPTY_SKILLS;
  const apiCatalog = apiCatalogData?.items ?? EMPTY_CATALOG;
  const catalogMeta = apiCatalogData?.meta;
  const governanceHealth = governanceHealthData ?? EMPTY_HEALTH;
  const healthBySkillId = useMemo(() => buildHealthBySkillId(governanceHealth), [governanceHealth]);
  const referenceBySkillId = useMemo(() => buildReferenceBySkillId(governanceHealth), [governanceHealth]);
  const { data: workflowSkillsData, refetch: refetchWorkflowSkills } = useApiQuery<WorkflowSkill[]>(['workflow-skills'], '/api/workflow-skills');
  const workflowSkills = workflowSkillsData ?? EMPTY_WORKFLOW_SKILLS;
  const promoteWorkflowSkillApi = useApiMutation<WorkflowSkill, { id: string }>(
    (vars) => `/api/workflow-skills/${vars.id}/publish`,
    {
      onSuccess: (skill) => {
        refetchWorkflowSkills();
        setOperationNotice(`已治理发布流程技能「${skill.name}」`);
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : '治理发布失败';
        setOperationNotice(message.replace(/^E_[A-Z_]+:\s*/, ''));
      },
    },
  );

  useEffect(() => {
    if (apiInstalledData == null) return;
    setInstalled(dedupeSkillsById(apiInstalledData.map((skill) => enrichSkillRow(skill, healthBySkillId))));
  }, [apiInstalledData, healthBySkillId]);

  // 测试运行器输入与输出
  const [testCmd, setTestCmd] = useState('');
  const [testOutputs, setTestOutputs] = useState<Array<{ cmd: string; out: string; ms: number; tone: 'success' | 'error' | 'info' }>>([]);

  // 权限矩阵（state 化）
  const [permsState, setPermsState] = useState<Record<string, { canCall: boolean; canConfig: boolean }>>({});

  // 不同 tab 的数据源
  const tabList: SkillRow[] = useMemo(() => {
    if (tab === 'workspace') return installed;
    if (tab === 'store') return apiCatalog.map((skill) => enrichSkillRow(skill as Skill, new Map())) as SkillRow[];
    return installed;
  }, [tab, installed, apiCatalog]);
  const typeFilter = tab === 'workspace' || tab === 'store' || tab === 'integration' || tab === 'governance' ? typeFilters[tab] : 'all';

  const attentionSkillIds = useMemo(
    () => new Set(governanceHealth.filter((h) => h.status === 'attention' || h.status === 'incident').map((h) => h.skillId)),
    [governanceHealth],
  );

  const filtered = useMemo(() => {
    return tabList
      .filter((s) => typeFilter === 'all' || s.kind === typeFilter)
      .filter((s) => tab !== 'workspace' || lifecycleFilter === 'all' || s.lifecycleStatus === lifecycleFilter)
      .filter((s) => {
        if (tab !== 'workspace' || workspaceFocus === 'all') return true;
        if (workspaceFocus === 'enabled') return (s.lifecycleStatus ?? 'enabled') === 'enabled';
        if (workspaceFocus === 'pending') return s.lifecycleStatus === 'pending_approval';
        if (workspaceFocus === 'upgradeable') return Boolean(s.hasUpdate);
        return attentionSkillIds.has(s.id);
      })
      .filter((s) => tab !== 'workspace' || !searchQ || s.name.toLowerCase().includes(searchQ.toLowerCase()) || (s.description ?? '').toLowerCase().includes(searchQ.toLowerCase()))
      .filter((s: any) => tab !== 'store' || (
        (!storeSearchQ || `${s.name} ${s.description} ${s.publisher ?? ''} ${s.channelLabel ?? ''}`.toLowerCase().includes(storeSearchQ.toLowerCase()))
        && (storeRiskFilter === 'all' || s.riskLevel === storeRiskFilter)
        && (storeChannelFilter === 'all' || s.channel === storeChannelFilter)
        && (storeReleaseFilter === 'all' || s.releaseChannel === storeReleaseFilter)
        && (!certifiedOnly || s.signed === true)
      ));
  }, [tabList, typeFilter, lifecycleFilter, workspaceFocus, attentionSkillIds, searchQ, tab, storeSearchQ, storeRiskFilter, storeChannelFilter, storeReleaseFilter, certifiedOnly]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedSkills = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage]);
  const storeTotalPages = Math.max(1, Math.ceil(filtered.length / storePageSize));
  const pagedStoreSkills = useMemo(() => filtered.slice((storePage - 1) * storePageSize, storePage * storePageSize), [filtered, storePage]);

  useEffect(() => { setCurrentPage(1); }, [tab, typeFilter, lifecycleFilter, workspaceFocus, searchQ, storeSearchQ, storeRiskFilter, storeChannelFilter, storeReleaseFilter, certifiedOnly]);
  useEffect(() => { if (tab === 'store') setStorePage(1); }, [tab, typeFilter, storeSearchQ, storeRiskFilter, storeChannelFilter, storeReleaseFilter, certifiedOnly]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);
  useEffect(() => { if (storePage > storeTotalPages) setStorePage(storeTotalPages); }, [storePage, storeTotalPages]);

  const active = tabList.find((s) => s.id === activeId);
  const activeInstalled = Boolean(active && installed.some((skill) => skill.id === active.id || skill.name === active.name));
  const activeRuntimeSettings = active
    ? runtimeSettings[active.id] ?? { cacheable: active.cacheable, timeout: '30', retries: '1' }
    : null;
  const tabSummary = {
    workspace: t('module.skills.summary.workspace'),
    store: t('module.skills.summary.store'),
    integration: t('module.skills.summary.integration'),
    governance: t('module.skills.summary.governance'),
    workflowSkills: t('module.skills.summary.workflowSkills'),
    platformTools: '平台工具与运行时工具（通用岗位包）',
  }[tab];

  const enabledCount = useMemo(() => installed.filter((s) => (s.lifecycleStatus ?? 'enabled') === 'enabled').length, [installed]);
  const pendingApprovalCount = useMemo(() => installed.filter((s) => s.lifecycleStatus === 'pending_approval').length, [installed]);
  const upgradeableCount = useMemo(() => installed.filter((s) => s.hasUpdate).length, [installed]);
  const attentionCount = useMemo(() => governanceHealth.filter((h) => h.status === 'attention' || h.status === 'incident').length, [governanceHealth]);

  const openSkillDetails = (id: string, options?: { test?: boolean; detailTab?: 'overview' | 'access' | 'versions' | 'runtime' }) => {
    setActiveId(id);
    setShowDetails(true);
    setDetailTab(options?.detailTab ?? 'overview');
    setShowRuntimeConfig(false);
    setTestRunnerOpen(!!options?.test);
    setDetailDescExpanded(false);
  };

  const detailEnabled = Boolean(activeId);
  const { data: trace } = useApiQuery<any>(['skill', activeId, 'trace'], `/api/skills/${activeId}/trace`, undefined, { enabled: detailEnabled });
  const { data: versionsData } = useApiQuery<any[]>(['skill', activeId, 'versions'], `/api/skills/${activeId}/versions`, undefined, { enabled: detailEnabled });
  const { data: permsData } = useApiQuery<SkillPermission[]>(['skill', activeId, 'permissions'], `/api/skills/${activeId}/permissions`, undefined, { enabled: detailEnabled });
  const { data: impact } = useApiQuery<SkillImpactReport>(['skill', activeId, 'impact'], `/api/skills/${activeId}/impact`, undefined, { enabled: detailEnabled });
  const { data: governance } = useApiQuery<SkillGovernancePolicy>(['skill', activeId, 'governance'], `/api/skills/${activeId}/governance`, undefined, { enabled: detailEnabled });
  const { data: runtimeConfigData } = useApiQuery<{ cacheable: boolean; timeout: string; retries: string }>(
    ['skill', activeId, 'runtime'],
    `/api/skills/${activeId}/runtime`,
    undefined,
    { enabled: detailEnabled },
  );
  useEffect(() => {
    if (!activeId || !runtimeConfigData) return;
    setRuntimeSettings((prev) => ({
      ...prev,
      [activeId]: {
        cacheable: Boolean(runtimeConfigData.cacheable),
        timeout: String(runtimeConfigData.timeout ?? '30'),
        retries: String(runtimeConfigData.retries ?? '1'),
      },
    }));
  }, [activeId, runtimeConfigData]);
  const { data: skillAuditData } = useApiQuery<SkillAuditEvent[]>(['skill', 'audit'], '/api/skills/audit');
  const versions = versionsData ?? [];
  const perms = permsData ?? [];
  const skillAudit = skillAuditData ?? [];
  const importSkillsMutation = useApiMutation<Skill[], { items: Array<Partial<Skill>> }>('/api/skills/import');
  const importPackageMutation = useApiUploadMutation<Skill>('/api/skills/import-package', {
    onSuccess: (skill) => {
      appendInstalled([skill]);
      setOperationNotice(`已导入技能包「${skill.name}」v${skill.version}${skill.hasScripts ? '（含可执行脚本）' : ''}`);
      setActiveModal(null);
    },
    onError: (error) => setOperationNotice(error instanceof Error ? error.message : '导入技能包失败'),
  });
  const publishToCatalogMutation = useApiMutation<Skill, {
    skillId: string; releaseChannel: string; visibilityScope: string; approvalTicket?: string;
  }>('/api/skills/catalog/publish', {
    onSuccess: (entry) => {
      setOperationNotice(`已晋升上架「${entry.name}」v${entry.version}（${(entry as any).channelLabel ?? 'promoted'} · ${(entry as any).releaseChannel ?? 'stable'}）`);
      setPromoteTicket('');
    },
    onError: (error) => setOperationNotice(error instanceof Error ? error.message : '晋升上架失败'),
  });
  const syncCatalogMutation = useApiMutation<{ acceptedCount: number; rejectedCount: number }, { seedDemo?: boolean; items?: any[] }>(
    '/api/skills/catalog/sync',
    {
      onSuccess: (result) => setOperationNotice(`Registry 同步完成：接受 ${result.acceptedCount}，拒绝 ${result.rejectedCount}`),
      onError: (error) => setOperationNotice(error instanceof Error ? error.message : 'Registry 同步失败'),
    },
  );
  const installSkillMutation = useApiMutation<Skill, any>(({ id }) => `/api/skills/${id}/install`);
  const uninstallSkillMutation = useApiMutation<any, { id: string }>(({ id }) => `/api/skills/${id}/uninstall`);
  const upgradeSkillMutation = useApiMutation<Skill, { id: string }>(({ id }) => `/api/skills/${id}/upgrade`);
  const upgradePlanMutation = useApiMutation<any, { id: string; targetVersion?: string }>(({ id }) => `/api/skills/${id}/upgrade-plan`);
  const lifecycleMutation = useApiMutation<Skill, { id: string; lifecycleStatus: SkillLifecycleStatus }>(
    ({ id }) => `/api/skills/${id}/lifecycle`,
    {
      onSuccess: (skill) => {
        setInstalled((prev) => prev.map((item) => (item.id === skill.id ? enrichSkillRow({ ...item, ...skill }, healthBySkillId) : item)));
        setOperationNotice(`已将「${skill.name}」更新为 ${skill.lifecycleStatus === 'enabled' ? '启用' : skill.lifecycleStatus === 'disabled' ? '暂停' : skill.lifecycleStatus}`);
      },
      onError: (error) => setOperationNotice(error instanceof Error ? error.message : '更新技能状态失败'),
    },
    'PATCH',
  );
  const governanceMutation = useApiMutation<SkillGovernancePolicy, Partial<SkillGovernancePolicy>>(
    () => `/api/skills/${activeId}/governance`,
    {
      onSuccess: () => setOperationNotice('运行治理策略已更新，沙箱测试将立即按新策略执行。'),
      onError: (error) => setOperationNotice(error instanceof Error ? error.message : '更新治理策略失败'),
    },
    'PATCH',
  );
  const testSkillMutation = useApiMutation<any, { id: string; command: string }>(({ id }) => `/api/skills/${id}/test`);
  const runtimeMutation = useApiMutation<any, { id: string; cacheable: boolean; timeout: string; retries: string }>(
    ({ id }) => `/api/skills/${id}/runtime`,
    {
      onSuccess: () => setOperationNotice('运行配置已保存（超时/重试将用于下一次沙箱测试）。'),
      onError: (error) => setOperationNotice(error instanceof Error ? error.message : '保存运行配置失败'),
    },
    'PATCH',
  );
  const permissionMutation = useApiMutation<any, { id: string; role: string; canCall: boolean; canConfig: boolean }>(({ id }) => `/api/skills/${id}/permissions`, undefined, 'PATCH');
  const configureMcpMutation = useApiMutation<Skill, { name: string; endpoint: string; authMode: string; protocol: string }>('/api/mcp-connections');
  const configureToolMutation = useApiMutation<Skill, { name: string; endpoint: string; schema: string }>('/api/tools');
  const preflightMutation = useApiMutation<SkillInstallPreflight, { id: string }>(({ id }) => `/api/skills/${id}/preflight`);
  const openUpgradePlan = (skill: SkillRow) => {
    if (!canWrite) return;
    setActiveId(skill.id);
    upgradePlanMutation.mutate({ id: skill.id, targetVersion: skill.upgradeVersion }, { onSuccess: (plan) => { setUpgradePlan(plan); setActiveModal('upgrade'); }, onError: (error) => setOperationNotice(error instanceof Error ? error.message : '无法生成升级预检') });
  };

  // 初始化权限 state
  const currentPerms = useMemo(() => {
    return (perms ?? []).map((p: any) => ({
      ...p,
      ...(permsState[p.role] ?? {}),
    }));
  }, [perms, permsState]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  // Handlers
  const handleInstallFromStore = (storeItem: any) => {
    if (!canWrite) return;
    preflightMutation.mutate({ id: storeItem.id }, {
      onSuccess: (preflight) => {
        setApprovalTicket('');
        setStorePreview({ skill: storeItem, preflight });
      },
      onError: (error) => setOperationNotice(error instanceof Error ? error.message : '安装预检失败'),
    });
  };

  const appendInstalled = (skills: Skill[]) => {
    setInstalled((prev) => [...prev, ...skills.map((skill) => enrichSkillRow(skill, healthBySkillId))]);
  };

  const confirmStoreInstall = () => {
    if (!storePreview || !canWrite) return;
    const { skill, preflight } = storePreview;
    if (preflight.decision === 'blocked') {
      setOperationNotice(preflight.reason ?? '预检未通过，无法安装');
      setStorePreview(null);
      return;
    }
    if (preflight.requiresApproval && !approvalTicket.trim()) {
      setOperationNotice('该能力需要审批单号后才能安装');
      return;
    }
    installSkillMutation.mutate(
      { ...skill, approvalTicket: preflight.requiresApproval ? approvalTicket.trim() : undefined },
      {
        onSuccess: (installedSkill) => {
          appendInstalled([installedSkill]);
          setOperationNotice(preflight.requiresApproval
            ? `已凭审批单 ${approvalTicket.trim()} 完成安装，可继续分配给智能体或工作流。`
            : '技能已安装到技能列表，可继续分配给智能体或工作流。');
          setStorePreview(null);
          setApprovalTicket('');
        },
        onError: (error) => setOperationNotice(error instanceof Error ? error.message : '安装失败'),
      },
    );
  };

  const handleUninstall = () => {
    if (!active || !canWrite) return;
    const skillId = active.id;
    const skillName = active.name;
    uninstallSkillMutation.mutate(
      { id: skillId },
      {
        onSuccess: () => {
          setInstalled((prev) => prev.filter((s) => s.id !== skillId));
          setActiveId(null);
          setShowDetails(false);
          setActiveModal(null);
          setOperationNotice(`已卸载「${skillName}」`);
        },
        onError: (error) => {
          setOperationNotice(error instanceof Error ? error.message : '卸载失败，请查看影响分析');
          setActiveModal(null);
        },
      },
    );
  };

  const handleBatchUpgrade = () => {
    if (!canWrite) return;
    selected.forEach((id) => upgradeSkillMutation.mutate({ id }, { onSuccess: (updated) => setInstalled((prev) => prev.map((item) => item.id === updated.id ? enrichSkillRow({ ...item, ...updated }, healthBySkillId) : item)) }));
    setSelected(new Set());
    setBatchConfirm(null);
  };

  const handleImport = (raw: string) => {
    if (!canWrite) return;
    let items: Array<Partial<Skill>> = [];
    try {
      const obj = JSON.parse(raw);
      items = (Array.isArray(obj) ? obj : [obj]).filter((item: any) => item.name);
    } catch {
      items = raw.split('\n').map((name) => name.trim()).filter(Boolean).map((name) => ({ name, kind: 'skill', description: `从粘贴内容导入 · ${name}`, riskLevel: 'mid', cacheable: false }));
    }
    importSkillsMutation.mutate({ items }, {
      onSuccess: (created) => { appendInstalled(created); setActiveModal(null); setOperationNotice(`已导入 ${created.length} 项技能`); },
      onError: (error) => setOperationNotice(error instanceof Error ? error.message : '导入失败'),
    });
  };

  const handleImportPackage = (file: File) => {
    if (!canWrite) return;
    const form = new FormData();
    form.append('file', file);
    importPackageMutation.mutate(form);
  };

  const handleRunTest = () => {
    if (!active || !testCmd.trim()) return;
    testSkillMutation.mutate({ id: active.id, command: testCmd }, {
      onSuccess: (result) => setTestOutputs((prev) => [{
        cmd: testCmd,
        out: [
          String(result.output ?? ''),
          result.runtime ? `runtime=${result.runtime}` : '',
          result.sim ? 'mode=policy-sim（runtime 不可达）' : '',
          result.correlationId ? `corr=${result.correlationId}` : '',
        ].filter(Boolean).join('\n'),
        ms: Number(result.durationMs),
        tone: (result.status === 'success' ? 'success' : 'error') as 'success' | 'error',
      }, ...prev].slice(0, 6)),
      onError: (error) => setOperationNotice(error instanceof Error ? error.message : '沙箱测试失败'),
    });
  };

  const riskIcon = (risk: string) => {
    if (risk === 'high') return <ShieldAlert className="h-3 w-3" />;
    if (risk === 'mid') return <AlertTriangle className="h-3 w-3" />;
    return <ShieldCheck className="h-3 w-3" />;
  };

  const skillTabs = [
    { key: 'workspace' as const, labelKey: 'module.skills.tabs.installed', icon: Wrench, count: installed.length },
    { key: 'store' as const, labelKey: 'module.skills.tabs.store', icon: Sparkles, count: apiCatalog.length },
    { key: 'platformTools' as const, labelKey: 'module.skills.tabs.platformTools' as const, label: '平台工具', icon: Cpu, count: 26 },
    { key: 'workflowSkills' as const, labelKey: 'module.skills.tabs.workflowSkills', icon: GitBranch, count: workflowSkills.length },
    { key: 'integration' as const, labelKey: 'module.skills.tabs.integration', icon: Network, count: null },
    { key: 'governance' as const, labelKey: 'module.skills.tabs.governance', icon: ShieldCheck, count: attentionCount },
  ].filter((item) => allowedTabs.includes(item.key));

  return (
    <div className="de-employee-page h-full min-w-0 overflow-y-auto overscroll-contain bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5">
      <div className="space-y-3">
        <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
          <div className="flex items-start justify-between gap-4 px-4 py-3.5 md:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg">
                  <Wrench className="h-4 w-4" />
                </div>
                <h1 className="text-base font-semibold text-[var(--text)]">{pageCopy.title}</h1>
              </div>
              <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{pageCopy.subtitle}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Badge tone="info">{workspaceName}</Badge>
              {!canWrite && <Badge tone="neutral">只读</Badge>}
              {canWrite && (
                <>
                  <button type="button" className="de-employee-btn de-employee-btn--primary" onClick={() => selectTab('integration')}>
                    <Upload className="h-3.5 w-3.5" />{t('module.skills.cta.connect')}
                  </button>
                  <button type="button" className="de-employee-btn" onClick={() => selectTab('store')}>
                    <Sparkles className="h-3.5 w-3.5" />{t('module.skills.cta.store')}
                  </button>
                </>
              )}
              {tab === 'workspace' && selected.size > 0 && canWrite && (
                <div className="flex items-center gap-2 rounded-md bg-[var(--brand-light)] px-2 py-1 text-xs text-[var(--brand)]">
                  <span>已选 {selected.size}</span>
                  <Button size="sm" variant="secondary" onClick={() => setBatchConfirm('upgrade')}>
                    <RefreshCw className="h-3 w-3" />批量升级
                  </Button>
                </div>
              )}
            </div>
          </div>
          {operationNotice && (
            <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--text-secondary)] md:mx-5">
              <span>{operationNotice}</span>
              <button type="button" onClick={() => setOperationNotice(null)} className="text-[var(--brand)]">知道了</button>
            </div>
          )}
          {tab !== 'workflowSkills' && tab !== 'integration' && tab !== 'governance' && tab !== 'platformTools' && (
            <p className="px-4 pb-2 text-xs text-[var(--text-muted)] md:px-5">{tabSummary}</p>
          )}
          {tab === 'platformTools' && (
            <p className="px-4 pb-2 text-xs text-[var(--text-muted)] md:px-5">{tabSummary}</p>
          )}
          <div className="px-4 md:px-5"><RoleReadonlyBanner className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]" /></div>
          <div className="de-employee-tabs flex overflow-x-auto px-3" role="tablist" aria-label="技能中心分区">
            {skillTabs.map((item) => {
              const TabIcon = item.icon;
              return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                onClick={() => selectTab(item.key)}
                className={cn('de-employee-tab flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-xs transition-colors', tab === item.key && 'is-active')}
              >
                <TabIcon className="h-3.5 w-3.5" />
                {('label' in item && item.label) ? item.label : t(item.labelKey)}
                {item.count != null && <Badge tone={item.key === 'workspace' ? 'brand' : item.key === 'workflowSkills' ? 'purple' : 'neutral'} className="ml-1">{item.count}</Badge>}
              </button>
            );})}
          </div>
        </section>

        <div className="pb-4">
          {tab === 'platformTools' ? (
            <section className="de-employee-shell rounded-xl bg-[var(--surface-1)] p-4 md:p-5">
              <PlatformToolsWorkspace />
            </section>
          ) : tab === 'workflowSkills' ? (
            <section className="skills-workflow">
              <div className="skills-workflow__intro">
                <div className="min-w-0 flex-1">
                  <p className="skills-workflow__intro-text">
                    流程技能来自「工作流程 → 发布技能」。仅<strong>已发布</strong>项可装配给数字伙伴；「调用需审批」表示执行时需双重审批。高风险草稿需管理员完成治理发布。
                  </p>
                  <div className="skills-workflow__links">
                    <Link to="/workflows">前往工作流程</Link>
                    <Link to="/partners">数字伙伴装配</Link>
                  </div>
                </div>
              </div>

              <div className="skills-workflow__shell">
                <header className="skills-workflow__header">
                  <div>
                    <h3>流程技能清单</h3>
                    <p>{workflowSkills.length} 项 · 均回链流程版本</p>
                  </div>
                </header>

                {workflowSkills.length ? (
                  <div className="skills-workflow__list">
                    {workflowSkills.map((skill) => (
                      <article key={skill.id} className="skills-workflow-card">
                        <div className="skills-workflow-card__main">
                          <div className="skills-workflow-card__icon">
                            <GitBranch className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                              <h4>{skill.name}</h4>
                              <span className={cn(
                                'skills-workflow-card__risk',
                                skill.riskLevel === 'high' ? 'is-high' : skill.riskLevel === 'mid' ? 'is-mid' : 'is-low',
                              )}>
                                {skill.riskLevel === 'high' ? '高风险' : skill.riskLevel === 'mid' ? '中风险' : '低风险'}
                              </span>
                            </div>
                            <p className="skills-workflow-card__desc">{skill.description}</p>
                            <div className="skills-workflow-card__meta">
                              <span className="font-mono">{skill.sourceWorkflowId}</span>
                              <span>·</span>
                              <span className="font-mono">{skill.sourceVersionId}</span>
                            </div>
                          </div>
                        </div>
                        <div className="skills-workflow-card__aside">
                          <div className="skills-workflow-card__tags">
                            <Badge tone={skill.status === 'published' ? 'success' : skill.status === 'draft' ? 'warn' : 'neutral'}>
                              {skill.status === 'published' ? '已发布' : skill.status === 'draft' ? '待治理发布' : skill.status}
                            </Badge>
                            {skill.approvalRequired && <Badge tone="warn">调用需审批</Badge>}
                            {skill.rollbackSupported && <Badge tone="info">可回滚</Badge>}
                          </div>
                          {canWrite && skill.status === 'draft' && (
                            <Button size="sm" variant="secondary" loading={promoteWorkflowSkillApi.isPending} onClick={() => promoteWorkflowSkillApi.mutate({ id: skill.id })}>
                              治理发布
                            </Button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="px-5 py-10">
                    <EmptyState icon={GitBranch} title="暂无流程技能" description="在工作流程完成编排校验后，通过「发布技能」写入此处。" />
                  </div>
                )}
              </div>
            </section>
          ) : tab === 'integration' ? (
            <IntegrationWorkspace canWrite={canWrite} onImport={() => setActiveModal('importSkill')} onMcp={() => setActiveModal('configureMcp')} onTool={() => setActiveModal('configureTool')} />
          ) : tab === 'governance' ? (
            <GovernanceWorkspace canWrite={canWrite} onOpenSkill={(id) => openSkillDetails(id)} />
          ) : (
          <>
          {tab === 'store' && (
            <div className="skills-store-shell mb-5 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]">
              <div className="skills-store-toolbar">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h3 className="skills-store-toolbar__title">{t('module.skills.tabs.store')}</h3>
                    <Badge tone="neutral" className="text-[10px]">{filtered.length} 项</Badge>
                    <Badge tone="info" className="text-[10px]">三层来源</Badge>
                  </div>
                  <p className="mt-1.5 max-w-[72ch] text-[12px] leading-5 text-[var(--text-muted)]">
                    {catalogMeta?.demoNotice
                      ?? '安装前将执行发布方、签名、依赖与风险预检；生产来源以 Registry 同步与工作区晋升为主。'}
                  </p>
                </div>
                {isAdmin && canWrite && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={syncCatalogMutation.isPending}
                    onClick={() => syncCatalogMutation.mutate({ seedDemo: true })}
                  >
                    同步 Registry
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-5 py-4">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
                  <Input value={storeSearchQ} onChange={(event) => setStoreSearchQ(event.target.value)} placeholder="搜索技能、系统或发布方" className="h-9 w-60 pl-8 text-xs" />
                </div>
                <div className="flex rounded-lg bg-[var(--bg-elevated)] p-1" role="tablist" aria-label="商店能力类型">
                  {(['all', 'skill', 'mcp', 'tool'] as const).map((kind) => (
                    <button key={kind} type="button" role="tab" aria-selected={typeFilter === kind} onClick={() => setTypeFilters((filters) => ({ ...filters, store: kind }))} className={cn('rounded-md px-3 py-1.5 text-[11px]', typeFilter === kind ? 'bg-[var(--surface-1)] font-semibold text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]')}>
                      {kind === 'all' ? '全部类型' : kind.toUpperCase()}
                    </button>
                  ))}
                </div>
                <select value={storeChannelFilter} onChange={(event) => setStoreChannelFilter(event.target.value as typeof storeChannelFilter)} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[11px]" aria-label="来源筛选">
                  <option value="all">全部来源</option>
                  <option value="builtin">平台内置</option>
                  <option value="registry">企业 Registry</option>
                  <option value="promoted">工作区晋升</option>
                </select>
                <select value={storeReleaseFilter} onChange={(event) => setStoreReleaseFilter(event.target.value as typeof storeReleaseFilter)} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[11px]" aria-label="发布频道">
                  <option value="all">全部频道</option>
                  <option value="stable">stable</option>
                  <option value="beta">beta</option>
                </select>
                <select value={storeRiskFilter} onChange={(event) => setStoreRiskFilter(event.target.value as typeof storeRiskFilter)} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[11px]" aria-label="风险筛选">
                  <option value="all">全部风险</option>
                  <option value="low">低风险</option>
                  <option value="mid">中风险</option>
                  <option value="high">高风险</option>
                </select>
                <label className="ml-auto flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                  <input type="checkbox" checked={certifiedOnly} onChange={(event) => setCertifiedOnly(event.target.checked)} className="accent-[var(--brand)]" />
                  仅企业认证
                </label>
              </div>
            </div>
          )}
          {tab === 'workspace' ? (
            <div className="space-y-3">
              <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {([
                  { key: 'enabled' as const, label: '已启用', value: enabledCount, icon: CheckCircle2, tone: 'success' as const },
                  { key: 'pending' as const, label: '待审批', value: pendingApprovalCount, icon: RefreshCw, tone: 'warn' as const },
                  { key: 'upgradeable' as const, label: '可升级', value: upgradeableCount, icon: ArrowUpCircle, tone: 'brand' as const },
                  { key: 'attention' as const, label: '需关注', value: attentionCount, icon: AlertTriangle, tone: attentionCount ? 'warn' as const : 'neutral' as const },
                ]).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={cn('skills-kpi-chip text-left', workspaceFocus === item.key && 'is-active')}
                    onClick={() => {
                      setWorkspaceFocus((prev) => (prev === item.key ? 'all' : item.key));
                      setLifecycleFilter('all');
                    }}
                  >
                    <KpiCard label={item.label} value={item.value} sub="项" icon={item.icon} tone={item.tone} size="compact" className="border-0 bg-transparent p-0 shadow-none" />
                  </button>
                ))}
              </section>

              <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
                <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 md:px-5" style={{ boxShadow: 'var(--saas-divider)' }}>
                  <div className="knowledge-assets-segment" role="tablist" aria-label="能力类型筛选">
                    {(['all', 'skill', 'mcp', 'tool'] as const).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        role="tab"
                        aria-selected={typeFilters.workspace === kind}
                        className={cn(typeFilters.workspace === kind && 'is-active')}
                        onClick={() => setTypeFilters((filters) => ({ ...filters, workspace: kind }))}
                      >
                        {kind === 'all' ? '全部' : kind === 'skill' ? 'Skill' : kind === 'mcp' ? 'MCP' : 'Tool'}
                        <span className="knowledge-assets-segment__count">
                          {kind === 'all' ? installed.length : installed.filter((s) => s.kind === kind).length}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-muted)]" />
                      <Input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="搜索技能..." className="de-employee-input h-8 w-44 bg-[var(--bg)] pl-7 text-xs md:w-52" />
                    </div>
                    <select value={lifecycleFilter} onChange={(event) => { setLifecycleFilter(event.target.value as typeof lifecycleFilter); setWorkspaceFocus('all'); }} className="de-employee-input h-8 rounded-lg bg-[var(--bg)] px-2 text-[11px] text-[var(--text-secondary)]">
                      <option value="all">全部状态</option>
                      <option value="enabled">已启用</option>
                      <option value="disabled">已暂停</option>
                      <option value="pending_approval">待审批</option>
                      <option value="quarantined">已隔离</option>
                      <option value="deprecated">已废弃</option>
                    </select>
                    <div className="flex overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg)]">
                      <button type="button" aria-label="列表视图" onClick={() => setViewMode('list')} className={cn('grid h-8 w-8 place-items-center', viewMode === 'list' ? 'bg-[var(--brand-light)] text-[var(--brand)]' : 'text-[var(--text-muted)]')}><List className="h-3.5 w-3.5" /></button>
                      <button type="button" aria-label="卡片视图" onClick={() => setViewMode('cards')} className={cn('grid h-8 w-8 place-items-center', viewMode === 'cards' ? 'bg-[var(--brand-light)] text-[var(--brand)]' : 'text-[var(--text-muted)]')}><LayoutGrid className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                </div>

                {viewMode === 'list' ? (
                  <>
                    <div className="skills-inventory-table">
                      <div className="skills-inventory-table__head">
                        <span />
                        <span>技能资产</span>
                        <span>状态</span>
                        <span>来源 / 责任</span>
                        <span>版本</span>
                        <span>引用</span>
                        <span>最近验证</span>
                        <span className="text-right">操作</span>
                      </div>
                      {pagedSkills.map((skill) => {
                        const meta = KIND_META[skill.kind];
                        const refCount = referenceBySkillId.get(skill.id) ?? 0;
                        const referenced = refCount > 0;
                        const lifecycle = skill.lifecycleStatus ?? 'enabled';
                        const lifecycleLabel = lifecycle === 'enabled' ? '已启用' : lifecycle === 'disabled' ? '已暂停' : lifecycle === 'pending_approval' ? '待审批' : lifecycle === 'quarantined' ? '已隔离' : '已废弃';
                        const statusClass = lifecycle === 'enabled' ? 'is-ready' : lifecycle === 'quarantined' || lifecycle === 'pending_approval' ? 'is-failed' : 'is-indexing';
                        const riskLabel = skill.riskLevel === 'high' ? '高风险' : skill.riskLevel === 'mid' ? '中风险' : '低风险';
                        return (
                          <div key={skill.id} className="skills-inventory-table__row" onClick={() => openSkillDetails(skill.id)} role="button" tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && openSkillDetails(skill.id)}>
                            <span className="flex items-center">
                              <input aria-label={`选择 ${skill.name}`} type="checkbox" checked={selected.has(skill.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleSelect(skill.id)} className="accent-[var(--brand)]" />
                            </span>
                            <span className="min-w-0">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[var(--brand-light)] text-[var(--brand)]"><meta.icon className="h-3.5 w-3.5" /></span>
                                <span className="min-w-0">
                                  <span className="flex items-center gap-1.5">
                                    <strong className="truncate text-[12px] text-[var(--text)]">{skill.name}</strong>
                                    <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">{meta.label}</span>
                                  </span>
                                  <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">{skill.description}</span>
                                </span>
                              </span>
                            </span>
                            <span>
                              <span className={cn('knowledge-status-dot', statusClass)}>{lifecycleLabel}</span>
                              <span className={cn('mt-1 block text-[10px]', skill.riskLevel === 'high' ? 'text-[var(--danger)]' : skill.riskLevel === 'mid' ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]')}>{riskLabel}</span>
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[11px] text-[var(--text)]">{skill.source === 'market' ? '技能商店' : skill.source === 'mcp' ? 'MCP 接入' : skill.source === 'tool' ? 'Tool 接入' : '导入'}</span>
                              <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">{skill.owner ?? '未分配'}</span>
                            </span>
                            <span className="font-mono text-[11px]">
                              v{skill.version}
                              {skill.hasUpdate && <span className="ml-1 text-[10px] font-sans text-[var(--warning)]">可升级</span>}
                            </span>
                            <span>
                              <button type="button" onClick={(event) => { event.stopPropagation(); openSkillDetails(skill.id); }} className={cn('skills-ref-link', referenced && 'is-active')}>
                                {referenced ? `${refCount} 处` : '未引用'}
                              </button>
                            </span>
                            <span className="text-[11px] text-[var(--text-muted)]">{skill.lastVerifiedAt ?? '尚未验证'}</span>
                            <span className="justify-self-end">
                              {canWrite ? (
                                <span className="flex items-center gap-1">
                                  <button type="button" className="knowledge-row-action" onClick={(event) => { event.stopPropagation(); lifecycleMutation.mutate({ id: skill.id, lifecycleStatus: lifecycle === 'enabled' ? 'disabled' : 'enabled' }); }}>
                                    {lifecycle === 'enabled' ? <><Power className="h-3.5 w-3.5" />暂停</> : <><Play className="h-3.5 w-3.5" />启用</>}
                                  </button>
                                  {skill.hasUpdate && (
                                    <button type="button" className="knowledge-row-action" onClick={(event) => { event.stopPropagation(); openUpgradePlan(skill); }}>
                                      <ArrowUpCircle className="h-3.5 w-3.5" />升级
                                    </button>
                                  )}
                                </span>
                              ) : <span className="text-[10px] text-[var(--text-muted)]">只读</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {filtered.length === 0 && <div className="p-8"><EmptyState icon={Wrench} title="没有匹配的技能资产" description="调整筛选条件或清除搜索后重试" /></div>}
                    {filtered.length > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs md:px-5" style={{ boxShadow: 'var(--saas-divider)' }}>
                        <span className="text-[var(--text-muted)]">共 {filtered.length} 项，每页 {pageSize} 项{workspaceFocus !== 'all' ? ' · 已按摘要筛选' : ''}</span>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="outline" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>上一页</Button>
                          {Array.from({ length: totalPages }, (_, index) => index + 1).slice(Math.max(0, currentPage - 3), currentPage + 2).map((page) => (
                            <button key={page} type="button" onClick={() => setCurrentPage(page)} className={cn('grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-xs', page === currentPage ? 'bg-[var(--brand)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')}>{page}</button>
                          ))}
                          <Button size="sm" variant="outline" disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>下一页</Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : filtered.length === 0 ? (
                  <div className="p-8"><EmptyState icon={Wrench} title="没有匹配的技能" description="尝试清除搜索或切换分类" /></div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 md:p-4 xl:grid-cols-3 2xl:grid-cols-4">
                    {pagedSkills.map((s) => {
                      const meta = KIND_META[s.kind];
                      const profile = KIND_PROFILE[s.kind];
                      const Icon = meta.icon;
                      return (
                        <div key={s.id} onClick={() => openSkillDetails(s.id)} className={cn('skill-catalog-card tile-brandable relative flex min-h-[220px] flex-col gap-3 rounded-xl border border-l-[3px] border-[var(--border)] bg-[var(--bg)] p-4 text-left cursor-pointer', profile.rail)}>
                          <input type="checkbox" checked={selected.has(s.id)} onChange={(e) => { e.stopPropagation(); toggleSelect(s.id); }} onClick={(e) => e.stopPropagation()} className="accent-[var(--brand)] absolute top-3 right-3" />
                          <div className="flex items-start gap-2 pr-5">
                            <div className={cn('grid h-9 w-9 place-items-center rounded-lg shrink-0', profile.iconSurface)}><Icon className="h-4 w-4" /></div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold">{s.name}</span><span className="font-mono text-[10px] text-[var(--text-muted)]">{meta.label}</span></div>
                              <div className="mt-1 truncate text-[11px] text-[var(--text-muted)]">v{s.version} · {profile.caption}</div>
                            </div>
                          </div>
                          <p className="line-clamp-2 text-[12px] leading-5 text-[var(--text-secondary)]">{s.description}</p>
                          <div className="mt-auto flex items-center justify-between gap-2 text-[10px] text-[var(--text-muted)]">
                            <span>{s.riskLevel === 'high' ? '高风险' : s.riskLevel === 'mid' ? '中风险' : '低风险'} · {s.calls}</span>
                            <span className="inline-flex gap-1">
                              <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); openSkillDetails(s.id, { test: true }); }}><Terminal className="h-3 w-3" />测试</Button>
                              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openSkillDetails(s.id); }}><Eye className="h-3 w-3" />详情</Button>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={tab === 'store' ? Sparkles : Wrench}
              title={tab === 'store' ? '商店暂无匹配技能' : '没有匹配的技能'}
              description={tab === 'store' ? '试试切换类型、风险或认证筛选，或等待新上架' : '尝试清除搜索或切换分类'}
            />
          ) : (
            <div className="skills-store-grid">
              {pagedStoreSkills.map((s) => {
                const meta = KIND_META[s.kind];
                const profile = KIND_PROFILE[s.kind];
                const Icon = meta.icon;
                const isInInstalled = installed.some((i) => i.id === s.id || i.name === s.name);
                const market = s as any;
                return (
                  <div
                    key={s.id}
                    onClick={() => openSkillDetails(s.id)}
                    className={cn('skill-store-card tile-brandable', isInInstalled && 'is-installed')}
                  >
                    <div className="flex items-start gap-3.5">
                      <div className={cn('grid h-10 w-10 place-items-center rounded-xl shrink-0', profile.iconSurface)}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--text)]">{s.name}</span>
                          <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">{meta.label}</span>
                          {isInInstalled && <span className="knowledge-status-dot is-ready ml-auto shrink-0">已安装</span>}
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-[12px] leading-5 text-[var(--text-muted)]">{s.description}</p>
                      </div>
                    </div>

                    <div className="skill-store-card__specs">
                      <div>
                        <span>{profile.primaryLabel}</span>
                        <strong>{profile.primaryValue}</strong>
                      </div>
                      <div>
                        <span>{profile.secondaryLabel}</span>
                        <strong>{profile.secondaryValue}</strong>
                      </div>
                    </div>

                    <div className="skill-store-card__meta">
                      {s.riskLevel === 'high' ? (
                        <span className="is-high">高风险</span>
                      ) : s.riskLevel === 'mid' ? (
                        <span className="is-mid">中风险</span>
                      ) : (
                        <span className="is-low">低风险</span>
                      )}
                      <span className="font-mono">v{s.version}</span>
                      <span className="inline-flex items-center gap-1 text-[var(--warning)]"><Star className="h-3.5 w-3.5 fill-current" />{s.rating}</span>
                      <span>安装 {s.installCount?.toLocaleString() ?? '—'}</span>
                      <span className={cn(s.cacheable ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>{s.cacheable ? '可缓存' : '无缓存'}</span>
                    </div>

                    <dl className="skill-store-card__foot">
                      <div><dt>来源</dt><dd>{market.channelLabel ?? (market.channel === 'registry' ? '企业 Registry' : market.channel === 'promoted' ? '工作区晋升' : '平台内置')}</dd></div>
                      <div><dt>频道</dt><dd className="font-mono">{market.releaseChannel ?? 'stable'}</dd></div>
                      <div><dt>发布方</dt><dd>{market.publisher ?? '社区发布方'}</dd></div>
                      <div><dt>签名</dt><dd className={market.signed ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>{market.signed ? '已验证' : '待验证'}</dd></div>
                    </dl>

                    <Button
                      size="sm"
                      variant={isInInstalled ? 'secondary' : 'primary'}
                      className="mt-1 w-full"
                      disabled={isInInstalled || !canWrite}
                      onClick={(e) => { e.stopPropagation(); handleInstallFromStore(s); }}
                    >
                      {isInInstalled ? <><CheckCircle2 className="h-3.5 w-3.5" />已在启用清单</> : <><ShieldCheck className="h-3.5 w-3.5" />预检并安装</>}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
          {tab === 'store' && filtered.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="text-[var(--text-muted)]">共 {filtered.length} 项，每页 {storePageSize} 项</span>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" disabled={storePage === 1} onClick={() => setStorePage((page) => Math.max(1, page - 1))}>上一页</Button>
                {Array.from({ length: storeTotalPages }, (_, index) => index + 1).slice(Math.max(0, storePage - 3), storePage + 2).map((page) => (
                  <button key={page} type="button" onClick={() => setStorePage(page)} className={cn('grid h-8 min-w-8 place-items-center rounded-md px-1.5 text-xs', page === storePage ? 'bg-[var(--brand)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')}>{page}</button>
                ))}
                <Button size="sm" variant="outline" disabled={storePage === storeTotalPages} onClick={() => setStorePage((page) => Math.min(storeTotalPages, page + 1))}>下一页</Button>
              </div>
            </div>
          )}
          </>
          )}
        </div>
      </div>

      {/* 技能详情 · 居中模态 */}
      <Modal
        open={showDetails}
        onClose={() => setShowDetails(false)}
        title={active ? `${active.name} · 技能详情` : '技能详情'}
        description={activeInstalled ? '已纳管能力的使用范围、运行治理与变更追溯' : '评估制品的能力边界、兼容性、安全性与安装条件'}
        size="lg"
        bodyClassName="skill-detail-modal skill-detail-modal--split !overflow-hidden px-0 py-0"
        panelClassName="max-w-[760px]"
        footer={!activeInstalled && active ? (
          <>
            <Button variant="ghost" onClick={() => setShowDetails(false)}>关闭</Button>
            <Button disabled={!canWrite} onClick={() => { setShowDetails(false); handleInstallFromStore(active); }}>
              <ShieldCheck className="h-3.5 w-3.5" />预检并安装
            </Button>
          </>
        ) : undefined}
      >
        {active ? (
          <>
            <div className="skill-detail-chrome">
            <div className="skill-detail-hero">
              <div className="skill-detail-hero__top">
                <div className={cn('skill-detail-hero__icon',
                  active.kind === 'skill' ? 'is-skill' :
                  active.kind === 'mcp' ? 'is-mcp' :
                  'is-tool',
                )}>
                  {(() => { const Icon = KIND_META[active.kind].icon; return <Icon className="h-5 w-5" />; })()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="skill-detail-hero__title-row">
                    <strong className="skill-detail-hero__name">{active.name}</strong>
                    <span className="skill-detail-hero__meta-chip">{KIND_META[active.kind].label}</span>
                    <span className="skill-detail-hero__meta-chip font-mono">v{active.version}</span>
                    {activeInstalled ? (
                      <span className={cn('knowledge-status-dot', (active.lifecycleStatus ?? 'enabled') === 'enabled' ? 'is-ready' : (active.lifecycleStatus === 'pending_approval' || active.lifecycleStatus === 'quarantined') ? 'is-failed' : 'is-indexing')}>
                        {(active.lifecycleStatus ?? 'enabled') === 'enabled' ? '已启用' : active.lifecycleStatus === 'pending_approval' ? '待审批' : active.lifecycleStatus === 'disabled' ? '已暂停' : active.lifecycleStatus === 'quarantined' ? '已隔离' : '已废弃'}
                      </span>
                    ) : (
                      <span className="knowledge-status-dot is-indexing">未安装</span>
                    )}
                  </div>
                  <div className="skill-detail-hero__desc-wrap">
                    <p className={cn('skill-detail-hero__desc', !detailDescExpanded && 'is-clamped')}>{active.description}</p>
                    {active.description.length > 120 && (
                      <button
                        type="button"
                        className="skill-detail-hero__desc-toggle"
                        onClick={() => setDetailDescExpanded((open) => !open)}
                      >
                        {detailDescExpanded ? '收起' : '展开全部'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="skill-detail-hero__metrics" aria-label="关键指标">
                <div className="skill-detail-metric">
                  <span>风险</span>
                  <strong className={cn(active.riskLevel === 'high' ? 'text-[var(--danger)]' : active.riskLevel === 'mid' ? 'text-[var(--warning)]' : 'text-[var(--success)]')}>
                    {active.riskLevel === 'high' ? '高' : active.riskLevel === 'mid' ? '中' : '低'}
                  </strong>
                </div>
                {activeInstalled ? (
                  <>
                    <div className="skill-detail-metric">
                      <span>责任人</span>
                      <strong>{active.owner ?? '未分配'}</strong>
                    </div>
                    <div className="skill-detail-metric">
                      <span>24h 调用</span>
                      <strong className="font-mono">{active.perf?.calls24h ?? 0}</strong>
                    </div>
                    <div className="skill-detail-metric">
                      <span>错误率</span>
                      <strong className={cn('font-mono', (active.perf?.errorRate ?? 0) > 1 ? 'text-[var(--danger)]' : 'text-[var(--success)]')}>{active.perf?.errorRate ?? 0}%</strong>
                    </div>
                    <div className="skill-detail-metric">
                      <span>P95</span>
                      <strong className="font-mono">{active.perf?.p95Ms ?? 0}ms</strong>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="skill-detail-metric">
                      <span>发布方</span>
                      <strong>{(active as any).publisher ?? '社区发布方'}</strong>
                    </div>
                    <div className="skill-detail-metric">
                      <span>评分</span>
                      <strong className="font-mono">{active.rating}</strong>
                    </div>
                    <div className="skill-detail-metric">
                      <span>安装量</span>
                      <strong className="font-mono">{active.installCount?.toLocaleString() ?? '—'}</strong>
                    </div>
                    <div className="skill-detail-metric">
                      <span>签名</span>
                      <strong className={cn((active as any).signed ? 'text-[var(--success)]' : 'text-[var(--warning)]')}>{(active as any).signed ? '已验证' : '待验证'}</strong>
                    </div>
                  </>
                )}
              </div>

              {activeInstalled && (
                <div className="skill-detail-hero__actions">
                  <div className="skill-detail-hero__actions-primary">
                    <button type="button" className="skill-detail-link is-primary" onClick={() => { setTestRunnerOpen(true); setShowRuntimeConfig(false); setDetailTab('runtime'); }}>
                      <Terminal className="h-3.5 w-3.5" />运行测试
                    </button>
                    <button type="button" className="skill-detail-link" disabled={!canWrite} onClick={() => { setShowRuntimeConfig(true); setTestRunnerOpen(false); setDetailTab('overview'); }}>
                      <Settings className="h-3.5 w-3.5" />运行配置
                    </button>
                  </div>
                  <button type="button" className="skill-detail-link is-danger" disabled={!canWrite} onClick={() => setActiveModal('uninstall')}>
                    <Trash2 className="h-3.5 w-3.5" />卸载
                  </button>
                </div>
              )}
            </div>

            {activeInstalled ? (
            <div className="skill-detail-tabs" role="tablist" aria-label="技能详情分区">
              {([{ key: 'overview', label: '概览与策略' }, { key: 'access', label: '权限' }, { key: 'versions', label: '版本与发布' }, { key: 'runtime', label: '运行与审计' }] as const).map((item) => (
                <button key={item.key} type="button" role="tab" aria-selected={detailTab === item.key} onClick={() => setDetailTab(item.key)} className={cn(detailTab === item.key && 'is-active')}>{item.label}</button>
              ))}
            </div>
            ) : null}
            </div>

            <div className="skill-detail-scroll">
            {activeInstalled ? <>
            {detailTab === 'overview' && <>
            <div className="skill-detail-overview-grid">
              <div className="skill-detail-panel">
                <div className="skill-detail-panel__title">
                  <Container className="h-3.5 w-3.5 text-[var(--success)]" />
                  执行隔离
                  <small>gVisor · 受控</small>
                </div>
                <dl className="skill-detail-kv skill-detail-kv--stack">
                  <div>
                    <dt>运行时</dt>
                    <dd className="font-mono">runsc · gvisor 20240603</dd>
                  </div>
                  <div>
                    <dt>隔离边界</dt>
                    <dd>
                      <ul className="skill-detail-chip-list">
                        <li>syscall 拦截</li>
                        <li>网络命名空间</li>
                        <li>文件只读挂载</li>
                      </ul>
                    </dd>
                  </div>
                  {active.source === 'package' && (
                    <div>
                      <dt>制品来源</dt>
                      <dd>
                        技能包{active.hasScripts ? ` · ${active.scripts?.length ?? 0} 个脚本` : ''}
                        {active.packageFileName ? <span className="mt-1 block truncate font-mono text-[10px] text-[var(--text-muted)]">{active.packageFileName}</span> : null}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="skill-detail-panel">
                <div className="skill-detail-panel__title"><ShieldCheck className="h-3.5 w-3.5 text-[var(--brand)]" />生产安全策略</div>
                <dl className="skill-detail-kv skill-detail-kv--stack">
                  <div>
                    <dt>密钥引用</dt>
                    <dd className="truncate font-mono text-[var(--brand)]" title={governance?.secretRef}>{governance?.secretRef ?? '加载中'}</dd>
                  </div>
                  <div>
                    <dt>网络出口</dt>
                    <dd>
                      {(governance?.allowedEgress?.length ?? 0) > 0 ? (
                        <ul className="skill-detail-chip-list">
                          {governance!.allowedEgress.map((host) => <li key={host}>{host}</li>)}
                        </ul>
                      ) : (
                        <span className="text-[var(--text-muted)]">无外网出口</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>写操作审批</dt>
                    <dd><Badge tone={governance?.writeApprovalRequired ? 'warn' : 'success'} className="text-[9px]">{governance?.writeApprovalRequired ? '必须审批' : '无需审批'}</Badge></dd>
                  </div>
                </dl>
                {canWrite && (
                  <div className="skill-detail-policy-toggles" role="group" aria-label="安全策略开关">
                    <button
                      type="button"
                      className={cn('skill-detail-toggle', governance?.writeApprovalRequired && 'is-on')}
                      onClick={() => governance && governanceMutation.mutate({ writeApprovalRequired: !governance.writeApprovalRequired })}
                    >
                      <span>写审批</span>
                      <strong>{governance?.writeApprovalRequired ? '开' : '关'}</strong>
                    </button>
                    <button
                      type="button"
                      className={cn('skill-detail-toggle', governance?.dataMaskingEnabled && 'is-on')}
                      onClick={() => governance && governanceMutation.mutate({ dataMaskingEnabled: !governance.dataMaskingEnabled })}
                    >
                      <span>脱敏</span>
                      <strong>{governance?.dataMaskingEnabled ? '开' : '关'}</strong>
                    </button>
                    <button
                      type="button"
                      className={cn('skill-detail-toggle', governance?.circuitBreakerEnabled && 'is-on')}
                      onClick={() => governance && governanceMutation.mutate({ circuitBreakerEnabled: !governance.circuitBreakerEnabled })}
                    >
                      <span>熔断</span>
                      <strong>{governance?.circuitBreakerEnabled ? '开' : '关'}</strong>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {activeInstalled && canWrite && (
              <div className="skill-detail-panel">
                <div className="skill-detail-panel__title"><Sparkles className="h-3.5 w-3.5 text-[var(--brand)]" />晋升到技能商店</div>
                <p className="mb-3 text-[11px] leading-5 text-[var(--text-muted)]">将本工作区已验证技能上架为可安装目录条目；高风险 / 全局可见需审批单号。</p>
                <div className="flex flex-wrap gap-2">
                  <Input value={promoteTicket} onChange={(e) => setPromoteTicket(e.target.value)} placeholder="审批单号（可选/按策略必填）" className="h-8 min-w-[160px] flex-1 text-xs" />
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={publishToCatalogMutation.isPending}
                    onClick={() => active && publishToCatalogMutation.mutate({
                      skillId: active.id,
                      releaseChannel: active.riskLevel === 'high' ? 'beta' : 'stable',
                      visibilityScope: 'workspace',
                      approvalTicket: promoteTicket.trim() || undefined,
                    })}
                  >
                    上架到商店
                  </Button>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={publishToCatalogMutation.isPending}
                      onClick={() => active && publishToCatalogMutation.mutate({
                        skillId: active.id,
                        releaseChannel: 'stable',
                        visibilityScope: 'global',
                        approvalTicket: promoteTicket.trim() || 'APR-GLOBAL',
                      })}
                    >
                      全局上架
                    </Button>
                  )}
                </div>
              </div>
            )}

            {showRuntimeConfig && activeRuntimeSettings && (
              <div className="skill-detail-panel">
                <div className="skill-detail-panel__title">
                  <Settings className="h-3.5 w-3.5 text-[var(--brand)]" />运行配置
                  <Badge tone={active.riskLevel === 'high' ? 'error' : active.riskLevel === 'mid' ? 'warn' : 'success'} className="ml-auto text-[9px]">{active.riskLevel === 'high' ? '高风险变更受控' : '沙箱策略生效'}</Badge>
                </div>
                <div className="space-y-3 text-xs">
                  <label className="flex items-center justify-between gap-3 rounded-lg bg-[var(--bg)] px-3 py-2">
                    <span><span className="block font-medium">结果缓存</span><span className="mt-0.5 block text-[10px] text-[var(--text-muted)]">相同请求命中隔离缓存</span></span>
                    <input type="checkbox" disabled={!canWrite} checked={activeRuntimeSettings.cacheable} onChange={(e) => setRuntimeSettings((settings) => ({ ...settings, [active.id]: { ...activeRuntimeSettings, cacheable: e.target.checked } }))} className="h-4 w-4 accent-[var(--brand)]" />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[10px] font-medium text-[var(--text-muted)]">超时（秒）<Input value={activeRuntimeSettings.timeout} disabled={!canWrite} onChange={(e) => setRuntimeSettings((settings) => ({ ...settings, [active.id]: { ...activeRuntimeSettings, timeout: e.target.value } }))} className="mt-1 h-8 font-mono text-xs" inputMode="numeric" /></label>
                    <label className="text-[10px] font-medium text-[var(--text-muted)]">失败重试<Input value={activeRuntimeSettings.retries} disabled={!canWrite} onChange={(e) => setRuntimeSettings((settings) => ({ ...settings, [active.id]: { ...activeRuntimeSettings, retries: e.target.value } }))} className="mt-1 h-8 font-mono text-xs" inputMode="numeric" /></label>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" disabled={!canWrite} onClick={() => active && activeRuntimeSettings && runtimeMutation.mutate({ id: active.id, ...activeRuntimeSettings }, { onSuccess: () => setShowRuntimeConfig(false) })}><Save className="h-3.5 w-3.5" />保存</Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowRuntimeConfig(false)}>收起</Button>
                  </div>
                </div>
              </div>
            )}
            </>}

            {detailTab === 'runtime' && <>
            <div className="skill-detail-panel">
              <div className="skill-detail-panel__title"><Activity className="h-3.5 w-3.5 text-[var(--brand)]" />24h 运行指标</div>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="调用" value={active.perf?.calls24h ?? 0} />
                <Stat label="错误率" value={`${active.perf?.errorRate ?? 0}%`} tone={(active.perf?.errorRate ?? 0) > 1 ? 'error' : 'success'} />
                <Stat label="P95" value={`${active.perf?.p95Ms ?? 0}ms`} />
              </div>
            </div>

            <div className="skill-detail-panel">
              <div className="skill-detail-panel__title">
                <Terminal className="h-3.5 w-3.5 text-[var(--brand)]" />测试运行器
                <button type="button" className="skill-detail-link ml-auto" onClick={() => setTestRunnerOpen(!testRunnerOpen)}>{testRunnerOpen ? '收起' : '展开'}</button>
              </div>
              {testRunnerOpen ? (
                <div className="space-y-2">
                  <Input
                    placeholder={`${active.name} 命令...`}
                    className="font-mono text-xs h-8"
                    value={testCmd}
                    onChange={(e) => setTestCmd(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRunTest()}
                  />
                  <div className="flex gap-1.5">
                    <Button size="sm" className="flex-1" onClick={handleRunTest}>
                      <Play className="h-3 w-3" />执行（沙箱隔离）
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setTestCmd('')} title="清空">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {testOutputs.length === 0 ? (
                      <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--bg)] p-3 text-center text-[10px] text-[var(--text-muted)]">
                        输入命令并回车，或点击执行
                      </div>
                    ) : (
                      testOutputs.map((o, i) => (
                        <div key={i} className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[10px]">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[var(--text-muted)]">→ {o.cmd}</span>
                            <Badge tone={o.tone} className="text-[9px]">{o.ms}ms</Badge>
                          </div>
                          <pre className={cn(
                            'whitespace-pre-wrap text-[10px]',
                            o.tone === 'error' ? 'text-[var(--danger)]' : o.tone === 'success' ? 'text-[var(--success)]' : 'text-[var(--text-secondary)]',
                          )}>{o.out}</pre>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">在沙箱中试跑命令，验证超时、出口与写审批策略是否符合预期。</p>
              )}
            </div>

            {trace && (
              <div className="skill-detail-panel">
                <div className="skill-detail-panel__title"><Eye className="h-3.5 w-3.5 text-[var(--brand)]" />最近执行 trace</div>
                <div className="max-h-32 space-y-0.5 overflow-y-auto font-mono text-[10px]">
                  {trace.trace?.map((line: any, i: number) => (
                    <div key={i} className="flex gap-2">
                      <span className="shrink-0 text-[var(--text-muted)]">{line.ts}</span>
                      <span className={cn(
                        line.level === 'info' ? 'text-[var(--info)]' :
                        line.level === 'debug' ? 'text-[var(--text-muted)]' :
                        'text-[var(--text-secondary)]',
                      )}>[{line.level}] {line.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="skill-detail-panel">
              <div className="skill-detail-panel__title"><History className="h-3.5 w-3.5 text-[var(--brand)]" />治理审计</div>
              <div className="space-y-1.5 text-[10px]">
                {skillAudit.filter((event) => event.target.includes(active.name)).slice(0, 3).map((event) => (
                  <div key={event.id} className="flex gap-2 rounded bg-[var(--bg)] px-2 py-1.5">
                    <span className="font-mono text-[var(--text-muted)]">{event.time}</span>
                    <span className={event.result === 'failed' ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]'}>{event.action}</span>
                  </div>
                ))}
                {!skillAudit.some((event) => event.target.includes(active.name)) && <span className="text-[var(--text-muted)]">暂无该技能的治理事件</span>}
              </div>
            </div>
            </>}

            {/* 版本历史 */}
            {detailTab === 'versions' && versions.length > 0 && (
              <div className="skill-detail-panel">
                <div className="skill-detail-panel__title">
                  <History className="h-3.5 w-3.5 text-[var(--brand)]" />版本历史
                </div>
                <div className="space-y-2">
                  {versions.slice(0, 3).map((v: any) => (
                    <div key={v.version} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold">v{v.version}</span>
                          <Badge tone={v.type === 'major' ? 'error' : v.type === 'minor' ? 'info' : 'neutral'} className="text-[9px]">{v.type}</Badge>
                        </div>
                        <span className="font-mono text-[10px] text-[var(--text-muted)]">{v.date}</span>
                      </div>
                      <div className="mt-2 space-y-0.5 text-[11px] text-[var(--text-muted)]">
                        {v.notes?.map((n: string, i: number) => (
                          <div key={i} className={cn(n.startsWith('+') ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{n}</div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {detailTab === 'versions' && versions.length === 0 && <EmptyState icon={History} title="暂无版本记录" description="后续升级、回滚和发布记录会在此处沉淀。" />}

            {/* 权限矩阵（可切换） */}
            {detailTab === 'access' && <div className="skill-detail-panel">
              <div className="skill-detail-panel__title">
                <Lock className="h-3.5 w-3.5 text-[var(--brand)]" />权限矩阵
                <span className="ml-auto text-[10px] font-medium text-[var(--text-muted)]">点击切换</span>
              </div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-[var(--text-muted)]">
                    <th className="py-1.5 text-left font-medium">角色</th>
                    <th className="px-2 font-medium">调用</th>
                    <th className="px-2 font-medium">配置</th>
                  </tr>
                </thead>
                <tbody>
                  {currentPerms.map((p: any) => (
                    <tr key={p.role} className="border-t border-[var(--border)]">
                      <td className="py-2 font-semibold">{p.role}</td>
                      <td className="px-2 text-center">
                        <button
                          disabled={!canWrite}
                          onClick={() => active && permissionMutation.mutate({ id: active.id, role: p.role, canCall: !p.canCall, canConfig: p.canConfig }, { onSuccess: (saved) => setPermsState((s) => ({ ...s, [saved.role]: { canCall: saved.canCall, canConfig: saved.canConfig } })) })}
                          className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--bg-hover)] disabled:opacity-50"
                        >
                          {p.canCall ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" /> : <X className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
                        </button>
                      </td>
                      <td className="px-2 text-center">
                        <button
                          disabled={!canWrite}
                          onClick={() => active && permissionMutation.mutate({ id: active.id, role: p.role, canCall: p.canCall, canConfig: !p.canConfig }, { onSuccess: (saved) => setPermsState((s) => ({ ...s, [saved.role]: { canCall: saved.canCall, canConfig: saved.canConfig } })) })}
                          className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-[var(--bg-hover)] disabled:opacity-50"
                        >
                          {p.canConfig ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" /> : <X className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}

            </> : <StoreSkillDetail skill={active} detailTab={detailTab} setDetailTab={setDetailTab} />}
            </div>
          </>
        ) : (
          <EmptyState icon={Wrench} title="选择一项技能查看详情" />
        )}
      </Modal>

      {/* ===== Modals ===== */}
      <ImportSkillModal
        open={activeModal === 'importSkill'}
        onClose={() => setActiveModal(null)}
        onSubmitText={handleImport}
        onSubmitFile={handleImportPackage}
        uploading={importPackageMutation.isPending || importSkillsMutation.isPending}
      />
      <CapabilityConfigModal
        open={activeModal === 'configureMcp'}
        onClose={() => setActiveModal(null)}
        kind="MCP"
        onSubmit={(form) => {
          if (!canWrite) return;
          configureMcpMutation.mutate(
          { name: form.name, endpoint: form.endpoint, authMode: form.authMode ?? 'OAuth', protocol: form.protocol ?? 'mcp-streamable-http' },
          { onSuccess: () => { setOperationNotice('MCP 已完成连接预检并进入工作区能力目录'); setActiveModal(null); } },
        );}}
      />
      <CapabilityConfigModal
        open={activeModal === 'configureTool'}
        onClose={() => setActiveModal(null)}
        kind="Tool"
        onSubmit={(form) => {
          if (!canWrite) return;
          configureToolMutation.mutate(
          { name: form.name, endpoint: form.endpoint, schema: form.schema ?? '{}' },
          { onSuccess: () => { setOperationNotice('Tool 已完成 Schema 校验并进入工作区能力目录'); setActiveModal(null); } },
        );}}
      />
      <Modal
        open={!!storePreview}
        onClose={() => { setStorePreview(null); setApprovalTicket(''); }}
        title={storePreview ? `安装预览 · ${storePreview.skill.name}` : '安装预览'}
        description="安装仅将能力纳管到技能列表，不会自动授予智能体或工作流执行权限。"
        size="lg"
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setStorePreview(null); setApprovalTicket(''); }}>取消</Button>
            <Button
              disabled={!canWrite || storePreview?.preflight.decision === 'blocked' || (storePreview?.preflight.requiresApproval && !approvalTicket.trim())}
              onClick={confirmStoreInstall}
            >
              {storePreview?.preflight.requiresApproval ? '提交审批并安装' : '确认安装'}
            </Button>
          </>
        )}
      >
        {storePreview && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="发布方" value={(storePreview.skill as any).publisher ?? '社区发布方'} />
              <Stat label="签名" value={storePreview.preflight.signatureValid ? '已验证' : '未验证'} tone={storePreview.preflight.signatureValid ? 'success' : 'error'} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="许可证" value={(storePreview.skill as any).license ?? '待确认'} />
              <Stat label="漏洞" value={`${storePreview.preflight.vulnerabilityCount ?? (storePreview.skill as any).vulnerabilityCount ?? 0} 项`} tone={(storePreview.preflight.vulnerabilityCount ?? (storePreview.skill as any).vulnerabilityCount) ? 'error' : 'success'} />
              <Stat label="最近扫描" value={(storePreview.skill as any).lastScannedAt ?? '—'} />
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
              <div className="mb-2 font-semibold">依赖与风险预检</div>
              <div className="space-y-1.5">
                {storePreview.preflight.dependencies.length
                  ? storePreview.preflight.dependencies.map((dependency) => (
                    <div key={dependency.name} className="flex justify-between">
                      <span>{dependency.name}</span>
                      <Badge tone={dependency.status === 'ready' ? 'success' : 'error'} className="text-[9px]">{dependency.status === 'ready' ? '已就绪' : '缺失'}</Badge>
                    </div>
                  ))
                  : <span className="text-[var(--success)]">无额外依赖</span>}
                {(storePreview.preflight.checks?.length ?? 0) > 0 && (
                  <div className="mt-2 space-y-1 border-t border-[var(--border)] pt-2">
                    {storePreview.preflight.checks!.map((check) => (
                      <div key={check.label} className="flex justify-between gap-2">
                        <span>{check.label}</span>
                        <Badge
                          tone={check.status === 'passed' ? 'success' : check.status === 'review' ? 'warn' : 'error'}
                          className="text-[9px]"
                        >
                          {check.status === 'passed' ? '通过' : check.status === 'review' ? '待复核' : '未通过'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 border-t border-[var(--border)] pt-2">
                  适用环境：{((storePreview.skill as any).supportedEnvironments ?? ['待验证']).join('、')}
                  <span className="ml-3">
                    风险等级：
                    <Badge tone={storePreview.skill.riskLevel === 'high' ? 'error' : storePreview.skill.riskLevel === 'mid' ? 'warn' : 'success'} className="ml-1 text-[9px]">
                      {storePreview.skill.riskLevel === 'high' ? '高风险' : storePreview.skill.riskLevel === 'mid' ? '中风险' : '低风险'}
                    </Badge>
                  </span>
                  {storePreview.preflight.requiresApproval && <span className="ml-2 text-[var(--warning)]">需要安全审批</span>}
                  {storePreview.preflight.reason && <p className="mt-2 text-[var(--text-secondary)]">{storePreview.preflight.reason}</p>}
                </div>
              </div>
            </div>
            {storePreview.preflight.requiresApproval && storePreview.preflight.decision !== 'blocked' && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                <label className="mb-1.5 block text-[11px] font-medium text-[var(--text-secondary)]">审批单号 *</label>
                <Input
                  value={approvalTicket}
                  onChange={(event) => setApprovalTicket(event.target.value)}
                  placeholder="例如：APR-2026-0819-01"
                  className="de-employee-input h-9 bg-[var(--bg-elevated)] text-xs"
                />
              </div>
            )}
            <div className="rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] text-[var(--info)]">
              供应链检查包含签名、发布方信任与漏洞扫描；外连与高危命令由技能运行策略在沙箱测试时拦截。
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={activeModal === 'uninstall'}
        onClose={() => setActiveModal(null)}
        onConfirm={handleUninstall}
        title={`卸载 ${active?.name ?? ''}？`}
        description={
          impact && !impact.uninstallAllowed ? (
            <div className="space-y-2 text-[13px] text-[var(--text-secondary)]">
              <p>卸载后将停止所有调用，并自动解除以下引用：</p>
              {(impact.agents?.length ?? 0) > 0 && (
                <p>智能体：{impact.agents.join('、')}</p>
              )}
              {(impact.workflows?.length ?? 0) > 0 && (
                <p>工作流：{impact.workflows.join('、')}</p>
              )}
              {(impact.activeRuns ?? 0) > 0 && (
                <p className="text-[var(--warning)]">仍有 {impact.activeRuns} 个运行中任务，需审批单号后才能强制卸载。</p>
              )}
            </div>
          ) : (
            '卸载后将停止所有调用，正在使用此技能的工作流将失败。'
          )
        }
        confirmText="确认卸载"
        tone="danger"
      />

      <ConfirmDialog
        open={activeModal === 'upgrade'}
        onClose={() => setActiveModal(null)}
        onConfirm={() => { if (active && canWrite) upgradeSkillMutation.mutate({ id: active.id }, { onSuccess: (skill) => { setInstalled((prev) => prev.map((item) => item.id === skill.id ? enrichSkillRow({ ...item, ...skill }, healthBySkillId) : item)); setOperationNotice(`已完成 ${skill.name} 的版本升级，可在审计中查看预检与引用影响。`); setActiveModal(null); } }); }}
        title={`升级 ${active?.name ?? ''}？`}
        description={`将从 v${upgradePlan?.currentVersion ?? active?.version ?? '—'} 升级至 v${upgradePlan?.targetVersion ?? active?.upgradeVersion ?? '下一版本'}。预检：${(upgradePlan?.checks ?? []).map((check: any) => `${check.label}${check.status === 'passed' ? '通过' : '需复核'}`).join('、') || '待生成'}；可回滚至 v${upgradePlan?.rollbackVersion ?? active?.version ?? '—'}。`}
        confirmText="确认升级"
      />

      <ConfirmDialog
        open={batchConfirm === 'upgrade'}
        onClose={() => setBatchConfirm(null)}
        onConfirm={handleBatchUpgrade}
        title={`批量升级 ${selected.size} 项`}
        description="将对选中技能执行 minor 版本升级。生产环境请在维护窗口操作。"
        confirmText="开始升级"
      />
    </div>
  );
}
