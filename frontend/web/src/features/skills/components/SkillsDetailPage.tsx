/**
 * 技能详情 · 三段式现代重设（M11 P1.5）。
 *
 *   ── 左 ~70% 主栏：当前 tab 的内容
 *     · 概览 tab：身份 + 安全策略 + 调用契约 + 24h 摘要 + 权限矩阵 + 版本历史 + 最近运行 + 相关技能
 *     · 运行 tab：测试运行器 / 执行 trace / 治理审计
 *   ── 右 ~280px sticky 侧栏：运行健康 sparkline + 快速操作 + 所有者
 *   ── 顶部 hero：back + 名称 + 类型徽标 + 版本 + 风险 + 生命周期
 *   ── 2 个 tab：概览 / 运行（权限 + 版本已合并进概览）
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { Skill, SkillAuditEvent, SkillPermission, SkillRuntimeHealth, SkillGovernancePolicy } from '@qzda/web-types';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { roleCanMutate } from '@/features/role-nav/role-nav';
import {
  KIND_META, buildHealthBySkillId, buildReferenceBySkillId,
  enrichSkillRow, isBuiltinSource, skillLifecycleLabel, skillSourceLabel,
  type SkillRow,
} from './SkillsShared';
import { RuntimePanel } from './SkillsDetailModal.Panels';
import { SkillsOverviewDashboard } from './SkillsOverviewDashboard';
import { SkillsDetailSidebar } from './SkillsDetailSidebar';

type DetailTab = 'overview' | 'runtime';
type PermState = Record<string, { canCall: boolean; canConfig: boolean }>;
type RuntimeSettings = Record<string, { cacheable: boolean; timeout: string; retries: string }>;

const TABS: Array<{ key: DetailTab; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'runtime', label: '运行' },
];

function parseStep(raw: string | null): DetailTab {
  if (raw === 'runtime') return 'runtime';
  return 'overview';
}

const EMPTY_AUDIT: SkillAuditEvent[] = [];

export default function SkillsDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canWrite = Boolean(user?.permissions.includes('skill.write')) && roleCanMutate(user?.role);
  const step = parseStep(params.get('step'));
  const [notice, setNotice] = useState<string | null>(null);
  const [permsState, setPermsState] = useState<PermState>({});
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings>({});
  const [promoteTicket, setPromoteTicket] = useState('');

  const { data: skills } = useApiQuery<Skill[]>(['skills'], '/api/skills');
  const installedRows = useMemo<SkillRow[]>(
    () => (skills ?? []).map((item) => enrichSkillRow(item, new Map())),
    [skills],
  );
  const active = installedRows.find((item) => item.id === id) ?? null;
  const meta = active ? KIND_META[active.kind] ?? KIND_META.skill : KIND_META.skill;
  const lifecycle = active?.lifecycleStatus ?? 'enabled';
  const builtin = isBuiltinSource(active?.source);

  const uninstallMutation = useApiMutation<unknown, { id: string }>(
    ({ id: skillId }) => `/api/skills/${skillId}/uninstall`,
  );

  const detailEnabled = Boolean(id);
  const { data: trace } = useApiQuery<any>(['skill', id, 'trace'], `/api/skills/${id}/trace`, undefined, { enabled: detailEnabled });
  const { data: versionsData } = useApiQuery<any[]>(['skill', id, 'versions'], `/api/skills/${id}/versions`, undefined, { enabled: detailEnabled });
  const { data: permsData } = useApiQuery<SkillPermission[]>(['skill', id, 'permissions'], `/api/skills/${id}/permissions`, undefined, { enabled: detailEnabled });
  const { data: governance } = useApiQuery<SkillGovernancePolicy>(['skill', id, 'governance'], `/api/skills/${id}/governance`, undefined, { enabled: detailEnabled });
  const { data: runtimeConfigData } = useApiQuery<{ cacheable: boolean; timeout: string; retries: string }>(
    ['skill', id, 'runtime'],
    `/api/skills/${id}/runtime`,
    undefined,
    { enabled: detailEnabled },
  );
  const { data: skillAuditData } = useApiQuery<SkillAuditEvent[]>(['skill', 'audit'], '/api/skills/audit');
  const { data: apiInstalledData } = useApiQuery<any[]>(['skills'], '/api/skills');
  const { data: governanceHealthData } = useApiQuery<SkillRuntimeHealth[]>(
    ['skills', 'governance', 'health'],
    '/api/skills/governance/health',
  );

  const skillAudit = skillAuditData ?? EMPTY_AUDIT;
  const versions = versionsData ?? [];
  const healthBySkillId = useMemo(() => buildHealthBySkillId(governanceHealthData), [governanceHealthData]);
  const referenceBySkillId = useMemo(() => buildReferenceBySkillId(governanceHealthData), [governanceHealthData]);

  const candidateRows: SkillRow[] = useMemo(() => {
    if (!id) return installedRows;
    const list: SkillRow[] = [...installedRows];
    if (apiInstalledData) {
      for (const s of apiInstalledData) {
        if (!list.some((existing) => existing.id === s.id || existing.name === s.name)) {
          list.push({
            ...(s as any),
            _enriched: true,
            health: healthBySkillId.get(s.id),
            references: referenceBySkillId.get(s.id) ?? 0,
          } as SkillRow);
        }
      }
    }
    return list;
  }, [id, installedRows, apiInstalledData, healthBySkillId, referenceBySkillId]);
  const activeResolved = active ?? candidateRows.find((s) => s.id === id) ?? null;

  const activeRuntimeSettings = activeResolved
    ? runtimeSettings[activeResolved.id] ?? {
        cacheable: activeResolved.cacheable,
        timeout: String((runtimeConfigData?.timeout as unknown as string) ?? '30'),
        retries: String((runtimeConfigData?.retries as unknown as string) ?? '1'),
      }
    : null;

  const [testRunnerOpen, setTestRunnerOpen] = useState(false);
  const [testCmd, setTestCmd] = useState('');
  const [testOutputs, setTestOutputs] = useState<Array<{ cmd: string; out: string; ms: number; tone: 'success' | 'error' | 'info' }>>([]);
  const testSkillMutation = useApiMutation<any, { id: string; command: string }>(({ id: skillId }) => `/api/skills/${skillId}/test`, {
    onError: (err) => setNotice(err instanceof Error ? err.message : '沙箱测试失败'),
  });
  const handleRunTest = () => {
    if (!activeResolved || !testCmd.trim()) return;
    const cmd = testCmd.trim();
    testSkillMutation.mutate({ id: activeResolved.id, command: cmd }, {
      onSuccess: (result) => {
        setTestOutputs((prev) => [{
          cmd,
          out: [
            String(result.output ?? ''),
            result.runtime ? `runtime=${result.runtime}` : '',
            result.sim ? 'mode=policy-sim（runtime 不可达）' : '',
            result.correlationId ? `corr=${result.correlationId}` : '',
          ].filter(Boolean).join('\n'),
          ms: Number(result.durationMs ?? 0),
          tone: (result.status === 'success' ? 'success' : 'error') as 'success' | 'error',
        }, ...prev].slice(0, 6));
      },
    });
  };

  const governanceMutation = useApiMutation<SkillGovernancePolicy, Partial<SkillGovernancePolicy>>(
    () => `/api/skills/${id}/governance`,
    {
      onSuccess: () => setNotice('运行治理策略已更新，沙箱测试将立即按新策略执行。'),
      onError: (error) => setNotice(error instanceof Error ? error.message : '更新治理策略失败'),
    },
    'PATCH',
  );
  const runtimeMutation = useApiMutation<any, { id: string; cacheable: boolean; timeout: string; retries: string }>(
    ({ id: skillId }) => `/api/skills/${skillId}/runtime`,
    {
      onSuccess: () => setNotice('运行配置已保存（超时/重试将用于下一次沙箱测试）。'),
      onError: (error) => setNotice(error instanceof Error ? error.message : '保存运行配置失败'),
    },
    'PATCH',
  );
  const permissionMutation = useApiMutation<any, { id: string; role: string; canCall: boolean; canConfig: boolean }>(
    ({ id: skillId }) => `/api/skills/${skillId}/permissions`, undefined, 'PATCH',
  );
  const publishToCatalogMutation = useApiMutation<any, { skillId: string; releaseChannel: string; visibilityScope: string; approvalTicket?: string }>(
    '/api/skills/catalog/publish',
    {
      onSuccess: (entry) => setNotice(`已晋升上架「${entry.name}」v${entry.version}`),
      onError: (error) => setNotice(error instanceof Error ? error.message : '晋升上架失败'),
    },
  );

  const currentPerms = useMemo(() => {
    return (permsData ?? []).map((p: any) => ({ ...p, ...(permsState[p.role] ?? {}) }));
  }, [permsData, permsState]);

  const go = (next: DetailTab) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('step', next);
    setParams(nextParams, { replace: true });
  };

  const doUninstall = () => {
    if (!activeResolved || !canWrite || builtin) return;
    uninstallMutation.mutate({ id: activeResolved.id }, {
      onSuccess: () => navigate('/skills', { replace: true }),
      onError: (error) => setNotice(error instanceof Error ? error.message : '卸载失败'),
    });
  };

  return (
    <div className="de-partner-wizard" data-testid="page-skills-detail">
      <header className="skill-page-hero">
        <div className="skill-page-hero__top">
          <div className="min-w-0">
            <Link to="/skills" className="de-partner-wizard__back">
              <ArrowLeft className="h-3.5 w-3.5" />技能资产
            </Link>
            <div className="skill-page-hero__title-row">
              <h1>{activeResolved?.name ?? '技能详情'}</h1>
              {activeResolved && (
                <>
                  <Badge tone="neutral">{meta.label}</Badge>
                  <Badge tone="info">{skillSourceLabel(activeResolved.source)}</Badge>
                  <span className="font-mono text-xs text-[var(--text-muted)]">v{activeResolved.version}</span>
                  <span className={cn(
                    'knowledge-status-dot',
                    lifecycle === 'enabled' ? 'is-ready' :
                      lifecycle === 'quarantined' || lifecycle === 'pending_approval' ? 'is-failed' : 'is-indexing',
                  )}>
                    {skillLifecycleLabel(lifecycle)}
                  </span>
                </>
              )}
            </div>
            <p className="skill-page-hero__desc">
              {activeResolved ? activeResolved.description : '查看已纳管能力的策略、权限、版本与运行。'}
            </p>
          </div>
          <div className="skill-page-hero__actions">
            <Button variant="ghost" onClick={() => navigate('/skills')}>返回目录</Button>
          </div>
        </div>
      </header>

      {notice && (
        <div className="mx-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--text-secondary)] md:mx-5">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-[var(--brand)]">知道了</button>
        </div>
      )}

      <div className="px-4 md:px-5">
        <div className="de-employee-tabs flex overflow-x-auto" role="tablist" aria-label="技能详情分区">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={step === item.key}
              className={cn('de-employee-tab px-3 py-2.5 text-xs', step === item.key && 'is-active')}
              onClick={() => go(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="skill-page-body">
        <div className="skill-page-main">
          {!activeResolved ? (
            <div className="skill-page-empty">
              <p>选择一项技能查看详情</p>
              <Button variant="secondary" onClick={() => navigate('/skills')}>返回技能中心</Button>
            </div>
          ) : step === 'overview' ? (
            <SkillsOverviewDashboard
              active={activeResolved}
              installedRows={candidateRows}
              governance={governance}
              canWrite={canWrite}
              governanceMutation={governanceMutation}
              showRuntimeConfig={Boolean(activeRuntimeSettings)}
              activeRuntimeSettings={activeRuntimeSettings}
              setRuntimeSettings={setRuntimeSettings}
              runtimeMutation={runtimeMutation}
              promoteTicket={promoteTicket}
              setPromoteTicket={setPromoteTicket}
              publishToCatalogMutation={publishToCatalogMutation}
              trace={trace}
              skillAudit={skillAudit}
              currentPerms={currentPerms}
              permissionMutation={permissionMutation}
              setPermsState={setPermsState}
              versions={versions}
            />
          ) : (
            <RuntimePanel
              active={activeResolved}
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
        </div>

        {activeResolved && (
          <SkillsDetailSidebar
            active={activeResolved}
            canWrite={canWrite}
            onRunTest={() => go('runtime')}
            onOpenRuntimeConfig={() => go('overview')}
            onUninstall={doUninstall}
            onOpenStore={() => navigate('/skills/new')}
            onNotice={setNotice}
          />
        )}
      </div>
    </div>
  );
}
