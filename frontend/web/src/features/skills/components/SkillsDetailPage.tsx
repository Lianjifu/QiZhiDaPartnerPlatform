/**
 * 技能详情：顶部分区 + 主栏内容 + 右侧摘要，不再使用空步骤轨。
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Play, Settings, Trash2 } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { Skill } from '@qzda/web-types';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { roleCanMutate } from '@/features/role-nav/role-nav';
import { SkillsDetailModal } from './SkillsDetailModal';
import {
  KIND_META, enrichSkillRow, isBuiltinSource, skillLifecycleLabel, skillSourceLabel, type SkillRow,
} from './SkillsShared';
import type { DetailTab } from './SkillsDetailModal.Panels';

const TABS: Array<{ key: DetailTab; label: string }> = [
  { key: 'overview', label: '概览与策略' },
  { key: 'access', label: '权限' },
  { key: 'versions', label: '版本与发布' },
  { key: 'runtime', label: '运行与审计' },
];

function parseStep(raw: string | null): DetailTab {
  if (raw === 'access' || raw === 'versions' || raw === 'runtime' || raw === 'overview') return raw;
  return 'overview';
}

export default function SkillsDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canWrite = Boolean(user?.permissions.includes('skill.write')) && roleCanMutate(user?.role);
  const step = parseStep(params.get('step'));
  const [notice, setNotice] = useState<string | null>(null);

  const { data: skills } = useApiQuery<Skill[]>(['skills'], '/api/skills');
  const installedRows = useMemo<SkillRow[]>(
    () => (skills ?? []).map((item) => enrichSkillRow(item, new Map())),
    [skills],
  );
  const active = installedRows.find((item) => item.id === id) ?? null;
  const builtin = isBuiltinSource(active?.source);
  const meta = KIND_META[active?.kind ?? 'skill'] ?? KIND_META.skill;
  const lifecycle = active?.lifecycleStatus ?? 'enabled';

  const uninstallMutation = useApiMutation<unknown, { id: string }>(({ id: skillId }) => `/api/skills/${skillId}/uninstall`);

  const go = (next: DetailTab) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('step', next);
    setParams(nextParams, { replace: true });
  };

  return (
    <div className="de-partner-wizard" data-testid="page-skills-detail">
      <header className="de-partner-wizard__top">
        <div className="min-w-0">
          <Link to="/skills" className="de-partner-wizard__back">
            <ArrowLeft className="h-3.5 w-3.5" />技能资产
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1>{active?.name ?? '技能详情'}</h1>
            {active && (
              <>
                <Badge tone="neutral">{meta.label}</Badge>
                <Badge tone="info">{skillSourceLabel(active.source)}</Badge>
                <span className={cn('knowledge-status-dot', lifecycle === 'enabled' ? 'is-ready' : lifecycle === 'quarantined' || lifecycle === 'pending_approval' ? 'is-failed' : 'is-indexing')}>
                  {skillLifecycleLabel(lifecycle)}
                </span>
              </>
            )}
          </div>
          <p className="line-clamp-2">{active ? active.description : '查看已纳管能力的策略、权限、版本与运行。'}</p>
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
      <div className="de-partner-wizard__body de-partner-wizard__body--single knowledge-pkg-create-shell">
        <div className="h-full min-h-0 overflow-y-auto p-3 md:p-4">
          <div className="knowledge-pkg-create">
            <div className="knowledge-pkg-create__main">
              <section className="knowledge-pkg-create__block skill-page-detail">
                <SkillsDetailModal
                  hideShell
                  activeId={id}
                  showDetails
                  onClose={() => navigate('/skills')}
                  installedRows={installedRows}
                  detailTab={step}
                  setDetailTab={go}
                  canWrite={canWrite}
                  onUninstall={(skill) => {
                    if (!canWrite || isBuiltinSource(skill.source)) return;
                    uninstallMutation.mutate({ id: skill.id }, {
                      onSuccess: () => navigate('/skills', { replace: true }),
                      onError: (error) => setNotice(error instanceof Error ? error.message : '卸载失败'),
                    });
                  }}
                  onInstallOpen={() => navigate('/skills/new?source=store')}
                  onNotice={setNotice}
                />
              </section>
            </div>
            <aside className="knowledge-pkg-create__aside">
              <div className="knowledge-pkg-create__preview">
                <div className="knowledge-pkg-create__preview-kicker">运行摘要</div>
                <h3>v{active?.version ?? '—'}</h3>
                <p>风险{active?.riskLevel === 'high' ? '高' : active?.riskLevel === 'mid' ? '中' : '低'} · {active?.owner ?? '未分配'}</p>
                <div className="knowledge-pkg-create__preview-tags">
                  <span>24h {active?.perf?.calls24h ?? 0} 次</span>
                  <span>错误率 {active?.perf?.errorRate ?? 0}%</span>
                  <span>P95 {active?.perf?.p95Ms ?? 0}ms</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Button size="sm" onClick={() => go('runtime')}><Play className="h-3.5 w-3.5" />运行测试</Button>
                <Button size="sm" variant="secondary" disabled={!canWrite} onClick={() => go('overview')}><Settings className="h-3.5 w-3.5" />运行配置</Button>
                {!builtin && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-[var(--danger)]"
                    disabled={!canWrite}
                    onClick={() => active && uninstallMutation.mutate({ id: active.id }, {
                      onSuccess: () => navigate('/skills', { replace: true }),
                      onError: (error) => setNotice(error instanceof Error ? error.message : '卸载失败'),
                    })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />卸载
                  </Button>
                )}
                {builtin && <p className="knowledge-pkg-create__aside-note">出厂技能随岗位包提供，目录中不卸载。</p>}
              </div>
            </aside>
          </div>
        </div>
      </div>
      <footer className="de-partner-wizard__footer">
        <Button variant="ghost" onClick={() => navigate('/skills')}>返回目录</Button>
      </footer>
    </div>
  );
}
