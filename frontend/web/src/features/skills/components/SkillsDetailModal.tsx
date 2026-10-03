/**
 * 技能中心 · 技能详情 Modal（M09 P1 拆分）。
 *
 * 由原 pages/Skills.tsx 居中技能详情 Modal 抽出（L968-L1415，约 448L）。
 * 自有状态：description expand、test runner、runtime config、permissions override、promote ticket。
 * 数据查询：trace / versions / permissions / impact / governance / runtime / audit。
 * Mutations：testSkill / runtimeMutation / permissionMutation / governanceMutation / publishToCatalog。
 *
 * 不做 rewrite：保持原 onSuccess / onError / Mutation 全部签名不变。
 * 详情面板（runtime / versions / access）已抽到 ./SkillsDetailModal.Panels.tsx。
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@qzda/web-ui';
import {
  CheckCircle2, Eye, Settings, ShieldCheck, Trash2,
} from 'lucide-react';
import { cn } from '@qzda/web-utils';
import { useApiMutation, useApiQuery } from '@/services/query';
import { EmptyState, Modal } from '@/components/shared';
import type { SkillAuditEvent, SkillGovernancePolicy, SkillPermission, SkillRuntimeHealth } from '@qzda/web-types';
import { KIND_META, buildHealthBySkillId, buildReferenceBySkillId, type SkillRow } from './SkillsShared';
import { StoreSkillDetail } from './SkillsModals';
import { RuntimePanel, VersionsPanel, AccessPanel, OverviewPanel } from './SkillsDetailModal.Panels';

const EMPTY_AUDIT: SkillAuditEvent[] = [];
const EMPTY_HEALTH: SkillRuntimeHealth[] = [];

type DetailTab = 'overview' | 'access' | 'versions' | 'runtime';

export function SkillsDetailModal({
  activeId, showDetails, onClose,
  installedRows, detailTab, setDetailTab,
  canWrite, onUninstall, onInstallOpen, onNotice,
}: {
  activeId: string | null;
  showDetails: boolean;
  onClose: () => void;
  installedRows: SkillRow[];
  detailTab: DetailTab;
  setDetailTab: (tab: DetailTab) => void;
  canWrite: boolean;
  onUninstall: (skill: SkillRow) => void;
  onInstallOpen: (skill: SkillRow) => void;
  onNotice: (msg: string) => void;
}) {
  const [detailDescExpanded, setDetailDescExpanded] = useState(false);
  const [showRuntimeConfig, setShowRuntimeConfig] = useState(false);
  const [testRunnerOpen, setTestRunnerOpen] = useState(false);
  const [testCmd, setTestCmd] = useState('');
  const [testOutputs, setTestOutputs] = useState<Array<{ cmd: string; out: string; ms: number; tone: 'success' | 'error' | 'info' }>>([]);
  const [runtimeSettings, setRuntimeSettings] = useState<Record<string, { cacheable: boolean; timeout: string; retries: string }>>({});
  const [permsState, setPermsState] = useState<Record<string, { canCall: boolean; canConfig: boolean }>>({});
  const [promoteTicket, setPromoteTicket] = useState('');

  const detailEnabled = Boolean(activeId);
  const { data: trace } = useApiQuery<any>(['skill', activeId, 'trace'], `/api/skills/${activeId}/trace`, undefined, { enabled: detailEnabled });
  const { data: versionsData } = useApiQuery<any[]>(['skill', activeId, 'versions'], `/api/skills/${activeId}/versions`, undefined, { enabled: detailEnabled });
  const { data: permsData } = useApiQuery<SkillPermission[]>(['skill', activeId, 'permissions'], `/api/skills/${activeId}/permissions`, undefined, { enabled: detailEnabled });
  const { data: governance } = useApiQuery<SkillGovernancePolicy>(['skill', activeId, 'governance'], `/api/skills/${activeId}/governance`, undefined, { enabled: detailEnabled });
  const { data: runtimeConfigData } = useApiQuery<{ cacheable: boolean; timeout: string; retries: string }>(
    ['skill', activeId, 'runtime'],
    `/api/skills/${activeId}/runtime`,
    undefined,
    { enabled: detailEnabled },
  );
  const { data: skillAuditData } = useApiQuery<SkillAuditEvent[]>(['skill', 'audit'], '/api/skills/audit');
  const { data: apiInstalledData } = useApiQuery<any[]>(['skills'], '/api/skills');
  const { data: governanceHealthData } = useApiQuery<SkillRuntimeHealth[]>(
    ['skills', 'governance', 'health'],
    '/api/skills/governance/health',
  );
  const versions = versionsData ?? [];
  const perms = permsData ?? [];
  const skillAudit = skillAuditData ?? EMPTY_AUDIT;
  const governanceHealth = governanceHealthData ?? EMPTY_HEALTH;
  const healthBySkillId = useMemo(() => buildHealthBySkillId(governanceHealth), [governanceHealth]);
  const referenceBySkillId = useMemo(() => buildReferenceBySkillId(governanceHealth), [governanceHealth]);

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

  const candidateRows: SkillRow[] = useMemo(() => {
    if (!activeId) return [];
    const list: SkillRow[] = [...installedRows];
    if (apiInstalledData) {
      for (const s of apiInstalledData) {
        if (!list.some((existing) => existing.id === s.id || existing.name === s.name)) {
          list.push({ ...(s as any), _enriched: true, health: healthBySkillId.get(s.id), references: referenceBySkillId.get(s.id) ?? 0 } as SkillRow);
        }
      }
    }
    return list;
  }, [activeId, installedRows, apiInstalledData, healthBySkillId, referenceBySkillId]);
  const active = candidateRows.find((s) => s.id === activeId) ?? null;
  const activeInstalled = active ? candidateRows.some((s) => s.id === active.id || s.name === active.name) : false;
  const activeRuntimeSettings = active
    ? runtimeSettings[active.id] ?? { cacheable: active.cacheable, timeout: '30', retries: '1' }
    : null;

  const governanceMutation = useApiMutation<SkillGovernancePolicy, Partial<SkillGovernancePolicy>>(
    () => `/api/skills/${activeId}/governance`,
    {
      onSuccess: () => onNotice('运行治理策略已更新，沙箱测试将立即按新策略执行。'),
      onError: (error) => onNotice(error instanceof Error ? error.message : '更新治理策略失败'),
    },
    'PATCH',
  );
  const testSkillMutation = useApiMutation<any, { id: string; command: string }>(({ id }) => `/api/skills/${id}/test`);
  const runtimeMutation = useApiMutation<any, { id: string; cacheable: boolean; timeout: string; retries: string }>(
    ({ id }) => `/api/skills/${id}/runtime`,
    {
      onSuccess: () => onNotice('运行配置已保存（超时/重试将用于下一次沙箱测试）。'),
      onError: (error) => onNotice(error instanceof Error ? error.message : '保存运行配置失败'),
    },
    'PATCH',
  );
  const permissionMutation = useApiMutation<any, { id: string; role: string; canCall: boolean; canConfig: boolean }>(
    ({ id }) => `/api/skills/${id}/permissions`, undefined, 'PATCH',
  );
  const publishToCatalogMutation = useApiMutation<any, { skillId: string; releaseChannel: string; visibilityScope: string; approvalTicket?: string }>(
    '/api/skills/catalog/publish',
    {
      onSuccess: (entry) => onNotice(`已晋升上架「${entry.name}」v${entry.version}（${(entry as any).channelLabel ?? 'promoted'} · ${(entry as any).releaseChannel ?? 'stable'}）`),
      onError: (error) => onNotice(error instanceof Error ? error.message : '晋升上架失败'),
    },
  );

  const currentPerms = useMemo(() => {
    return (perms ?? []).map((p: any) => ({ ...p, ...(permsState[p.role] ?? {}) }));
  }, [perms, permsState]);

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
      onError: (error) => onNotice(error instanceof Error ? error.message : '沙箱测试失败'),
    });
  };

  return (
    <Modal
      open={showDetails}
      onClose={onClose}
      title={active ? `${active.name} · 技能详情` : '技能详情'}
      description={activeInstalled ? '已纳管能力的使用范围、运行治理与变更追溯' : '评估制品的能力边界、兼容性、安全性与安装条件'}
      size="lg"
      bodyClassName="skill-detail-modal skill-detail-modal--split !overflow-hidden px-0 py-0"
      panelClassName="max-w-[760px]"
      footer={!activeInstalled && active ? (
        <>
          <Button variant="ghost" onClick={onClose}>关闭</Button>
          <Button disabled={!canWrite} onClick={() => { onClose(); onInstallOpen(active); }}>
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
                <div className={cn('skill-detail-hero__icon', active.kind === 'skill' ? 'is-skill' : active.kind === 'mcp' ? 'is-mcp' : 'is-tool')}>
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
                      <button type="button" className="skill-detail-hero__desc-toggle" onClick={() => setDetailDescExpanded((open) => !open)}>
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
                    <div className="skill-detail-metric"><span>责任人</span><strong>{active.owner ?? '未分配'}</strong></div>
                    <div className="skill-detail-metric"><span>24h 调用</span><strong className="font-mono">{active.perf?.calls24h ?? 0}</strong></div>
                    <div className="skill-detail-metric">
                      <span>错误率</span>
                      <strong className={cn('font-mono', (active.perf?.errorRate ?? 0) > 1 ? 'text-[var(--danger)]' : 'text-[var(--success)]')}>{active.perf?.errorRate ?? 0}%</strong>
                    </div>
                    <div className="skill-detail-metric"><span>P95</span><strong className="font-mono">{active.perf?.p95Ms ?? 0}ms</strong></div>
                  </>
                ) : (
                  <>
                    <div className="skill-detail-metric"><span>发布方</span><strong>{(active as any).publisher ?? '社区发布方'}</strong></div>
                    <div className="skill-detail-metric"><span>评分</span><strong className="font-mono">{active.rating}</strong></div>
                    <div className="skill-detail-metric"><span>安装量</span><strong className="font-mono">{active.installCount?.toLocaleString() ?? '—'}</strong></div>
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
                      <CheckCircle2 className="h-3.5 w-3.5" />运行测试
                    </button>
                    <button type="button" className="skill-detail-link" disabled={!canWrite} onClick={() => { setShowRuntimeConfig(true); setTestRunnerOpen(false); setDetailTab('overview'); }}>
                      <Settings className="h-3.5 w-3.5" />运行配置
                    </button>
                  </div>
                  <button type="button" className="skill-detail-link is-danger" disabled={!canWrite} onClick={() => onUninstall(active)}>
                    <Trash2 className="h-3.5 w-3.5" />卸载
                  </button>
                </div>
              )}
            </div>

            {activeInstalled ? (
              <div className="skill-detail-tabs" role="tablist" aria-label="技能详情分区">
                {([
                  { key: 'overview', label: '概览与策略' },
                  { key: 'access', label: '权限' },
                  { key: 'versions', label: '版本与发布' },
                  { key: 'runtime', label: '运行与审计' },
                ] as const).map((item) => (
                  <button key={item.key} type="button" role="tab" aria-selected={detailTab === item.key} onClick={() => setDetailTab(item.key)} className={cn(detailTab === item.key && 'is-active')}>{item.label}</button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="skill-detail-scroll">
            {activeInstalled ? <>
              {detailTab === 'overview' && (
                <OverviewPanel
                  active={active}
                  governance={governance}
                  canWrite={canWrite}
                  governanceMutation={governanceMutation}
                  showRuntimeConfig={showRuntimeConfig}
                  activeRuntimeSettings={activeRuntimeSettings}
                  setRuntimeSettings={setRuntimeSettings}
                  runtimeMutation={runtimeMutation}
                  promoteTicket={promoteTicket}
                  setPromoteTicket={setPromoteTicket}
                  publishToCatalogMutation={publishToCatalogMutation}
                />
              )}

              {detailTab === 'runtime' && (
                <RuntimePanel
                  active={active}
                  testRunnerOpen={testRunnerOpen}
                  setTestRunnerOpen={setTestRunnerOpen}
                  testCmd={testCmd}
                  setTestCmd={setTestCmd}
                  testOutputs={testOutputs}
                  handleRunTest={handleRunTest}
                  trace={trace}
                  skillAudit={skillAudit}
                  canWrite={canWrite}
                />
              )}
              {detailTab === 'versions' && <VersionsPanel versions={versions} />}
              {detailTab === 'access' && <AccessPanel currentPerms={currentPerms} canWrite={canWrite} active={active} permissionMutation={permissionMutation} setPermsState={setPermsState} />}
            </> : <StoreSkillDetail skill={active} detailTab={detailTab} setDetailTab={setDetailTab} />}
          </div>
        </>
      ) : (
        <EmptyState icon={Eye} title="选择一项技能查看详情" />
      )}
    </Modal>
  );
}
