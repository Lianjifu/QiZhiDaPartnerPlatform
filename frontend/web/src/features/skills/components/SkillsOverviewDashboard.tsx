/**
 * 技能详情 · 概览 tab · 重设计 v2（M11 P1.5）。
 *
 * 信息架构（在原 8 段基础上做减法 + 视觉强化）：
 *   1. 身份档案（kind-specific icon + meta 网格 + 标签）
 *   2. 调用契约（kind 对应 entry/inputs/outputs/guarded）
 *   3. 安全策略（隔离 + 治理策略 + 晋升 + 配置 — 四件套上下串联）
 *   4. 权限矩阵（紧凑角色 chip + 双 toggle）
 *   5. 版本与发布（紧凑时间线）
 *   6. 最近运行与治理（合并 trace + audit）
 *   7. 相关技能（同 kind 推荐卡片）
 *
 * 24h 健康 sparkline 与调用/错误率/P95 等指标集中在 sidebar 的『运行健康』，
 * 概览不再重复。
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, Boxes, CheckCircle2, FileCode2, History,
  Lock, ShieldCheck, Wrench, X,
} from 'lucide-react';
import { Badge } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { SkillAuditEvent, SkillPermission } from '@qzda/web-types';
import { KIND_META, KIND_PROFILE, type SkillRow } from './SkillsShared';
import { OverviewPanel } from './SkillsDetailModal.Panels';
import { EmptyState } from '@/components/shared';

type OverviewPanelProps = React.ComponentProps<typeof OverviewPanel>;

type IdentityRow = { label: string; value: React.ReactNode; mono?: boolean };

function ContractForKind(kind: SkillRow['kind'], name: string): { entry: string; inputs: string[]; outputs: string[]; guarded: string[] } {
  if (kind === 'mcp') {
    return {
      entry: `mcp://${name}`,
      inputs: ['JSON-RPC request (tools/call)'],
      outputs: ['JSON-RPC response (content[])'],
      guarded: ['外部 HTTP 调用', 'OAuth / Token 认证'],
    };
  }
  if (kind === 'tool') {
    return {
      entry: `${name}.invoke(payload)`,
      inputs: ['OpenAPI schema (request body)'],
      outputs: ['schema-validated response'],
      guarded: ['写操作门禁', '鉴权刷新', '审计写入'],
    };
  }
  return {
    entry: `${name}.sh`,
    inputs: ['argv (string[])'],
    outputs: ['stdout / stderr / exit code'],
    guarded: ['syscall 拦截', '网络命名空间', '文件只读挂载'],
  };
}

export function SkillsOverviewDashboard({
  active,
  installedRows,
  governance,
  canWrite,
  governanceMutation,
  showRuntimeConfig,
  activeRuntimeSettings,
  setRuntimeSettings,
  runtimeMutation,
  promoteTicket,
  setPromoteTicket,
  publishToCatalogMutation,
  trace,
  skillAudit,
  currentPerms,
  permissionMutation,
  setPermsState,
  versions,
}: Omit<OverviewPanelProps, 'active'> & {
  active: SkillRow;
  installedRows: SkillRow[];
  trace: any;
  skillAudit: SkillAuditEvent[];
  currentPerms: SkillPermission[];
  permissionMutation: any;
  setPermsState: React.Dispatch<React.SetStateAction<Record<string, { canCall: boolean; canConfig: boolean }>>>;
  versions: any[];
}) {
  const profile = KIND_PROFILE[active.kind] ?? KIND_PROFILE.skill;
  const Icon = KIND_META[active.kind]?.icon ?? Wrench;
  const safeVersions = versions ?? [];
  const contract = ContractForKind(active.kind, active.name);

  const identityRows: IdentityRow[] = useMemo(() => {
    const rows: IdentityRow[] = [
      { label: '类型', value: KIND_META[active.kind]?.label ?? '技能', mono: true },
      { label: '来源', value: active.source ?? '—', mono: true },
      { label: '版本', value: `v${active.version}`, mono: true },
      { label: '责任人', value: active.owner ?? '未分配' },
      { label: '所属团队', value: active.team ?? '平台默认' },
      { label: '最近核验', value: active.lastVerifiedAt ?? '—', mono: true },
      { label: '风险等级', value: active.riskLevel === 'high' ? '高' : active.riskLevel === 'mid' ? '中' : '低' },
    ];
    return rows;
  }, [active]);

  const relatedSkills = useMemo(() => {
    return installedRows
      .filter((row) => row.id !== active.id && row.kind === active.kind)
      .slice(0, 4);
  }, [installedRows, active.id, active.kind]);

  const recentEvents = useMemo(() => {
    type Event = { ts: string; source: 'trace' | 'audit'; tone: 'info' | 'warn' | 'error' | 'success'; label: string };
    const out: Event[] = [];
    if (trace?.trace) {
      for (const line of trace.trace) {
        out.push({
          ts: line.ts,
          source: 'trace',
          tone: line.level === 'error' ? 'error' : line.level === 'warn' ? 'warn' : 'info',
          label: `[${line.level}] ${line.text}`,
        });
      }
    }
    for (const event of skillAudit) {
      if (!event.target?.includes?.(active.name)) continue;
      out.push({
        ts: event.time,
        source: 'audit',
        tone: event.result === 'failed' ? 'error' : 'success',
        label: event.action,
      });
    }
    return out
      .sort((a, b) => (b.ts > a.ts ? 1 : -1))
      .slice(0, 5);
  }, [trace, skillAudit, active.name]);

  return (
    <div className="skill-overview-dashboard">
      <section className="skill-overview-dashboard__row skill-overview-dashboard__row--top">
        <article className="skill-overview-card skill-overview-card--identity">
          <header className="skill-overview-card__head">
            <span className="skill-overview-card__icon" data-kind={active.kind}>
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h3>{profile.caption}</h3>
              <p>{active.name} · {profile.primaryLabel} {profile.primaryValue}</p>
            </div>
          </header>
          <dl className="skill-overview-card__grid">
            {identityRows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd className={cn(row.mono && 'font-mono')}>{row.value}</dd>
              </div>
            ))}
            {active.tags?.length ? (
              <div className="skill-overview-card__full">
                <dt>标签</dt>
                <dd>
                  <ul className="skill-overview-chip-list">
                    {active.tags.map((tag: string) => <li key={tag}>{tag}</li>)}
                  </ul>
                </dd>
              </div>
            ) : null}
          </dl>
        </article>

        <article className="skill-overview-card skill-overview-card--contract">
          <header className="skill-overview-card__head">
            <FileCode2 className="h-4 w-4 text-[var(--brand)]" />
            <div className="min-w-0">
              <h3>调用契约</h3>
              <p>{profile.secondaryLabel} · {profile.secondaryValue}</p>
            </div>
          </header>
          <dl className="skill-overview-card__kv">
            <div>
              <dt>入口</dt>
              <dd className="font-mono text-[var(--brand)]">{contract.entry}</dd>
            </div>
            <div>
              <dt>入参</dt>
              <dd>{contract.inputs.map((item) => <span key={item} className="skill-overview-chip skill-overview-chip--info">{item}</span>)}</dd>
            </div>
            <div>
              <dt>出参</dt>
              <dd>{contract.outputs.map((item) => <span key={item} className="skill-overview-chip">{item}</span>)}</dd>
            </div>
            <div>
              <dt>受限动作</dt>
              <dd>
                <ul className="skill-overview-chip-list">
                  {contract.guarded.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="skill-overview-card skill-overview-card--security">
        <header className="skill-overview-card__head">
          <ShieldCheck className="h-4 w-4 text-[var(--brand)]" />
          <div className="min-w-0">
            <h3>安全策略</h3>
            <p>执行隔离 · 生产治理 · 写审批 · 运行配置</p>
          </div>
        </header>
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
      </section>

      <section className="skill-overview-dashboard__row skill-overview-dashboard__row--duo">
        <article className="skill-overview-card skill-overview-card--access">
          <header className="skill-overview-card__head">
            <Lock className="h-4 w-4 text-[var(--brand)]" />
            <div className="min-w-0">
              <h3>权限矩阵</h3>
              <p>角色 × 调用 / 配置</p>
            </div>
          </header>
          {currentPerms.length === 0 ? (
            <p className="skill-overview-card__empty">暂无权限记录。</p>
          ) : (
            <table className="skill-overview-perms">
              <thead>
                <tr>
                  <th>角色</th>
                  <th>调用</th>
                  <th>配置</th>
                </tr>
              </thead>
              <tbody>
                {currentPerms.map((p: any) => (
                  <tr key={p.role}>
                    <td><strong>{p.role}</strong></td>
                    <td>
                      <button
                        type="button"
                        disabled={!canWrite}
                        onClick={() => permissionMutation.mutate(
                          { id: active.id, role: p.role, canCall: !p.canCall, canConfig: p.canConfig },
                          { onSuccess: (saved: any) => setPermsState((s) => ({ ...s, [saved.role]: { canCall: saved.canCall, canConfig: saved.canConfig } })) },
                        )}
                        className={cn('skill-overview-perm-toggle', p.canCall && 'is-on')}
                        aria-pressed={p.canCall}
                      >
                        {p.canCall ? <CheckCircle2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        disabled={!canWrite}
                        onClick={() => permissionMutation.mutate(
                          { id: active.id, role: p.role, canCall: p.canCall, canConfig: !p.canConfig },
                          { onSuccess: (saved: any) => setPermsState((s) => ({ ...s, [saved.role]: { canCall: saved.canCall, canConfig: saved.canConfig } })) },
                        )}
                        className={cn('skill-overview-perm-toggle', p.canConfig && 'is-on')}
                        aria-pressed={p.canConfig}
                      >
                        {p.canConfig ? <CheckCircle2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>

        <article className="skill-overview-card skill-overview-card--versions">
          <header className="skill-overview-card__head">
            <History className="h-4 w-4 text-[var(--brand)]" />
            <div className="min-w-0">
              <h3>版本与发布</h3>
              <p>当前 v{active.version}</p>
            </div>
            <Badge tone="neutral" className="ml-auto text-[9px]">{safeVersions.length} 个版本</Badge>
          </header>
          {safeVersions.length === 0 ? (
            <EmptyState icon={History} title="暂无版本记录" description="后续升级、回滚和发布记录会在此处沉淀。" />
          ) : (
            <ol className="skill-overview-versions">
              {safeVersions.slice(0, 4).map((v) => (
                <li key={v.version}>
                  <div className="skill-overview-versions__head">
                    <span className="font-mono font-bold">v{v.version}</span>
                    <Badge tone={v.type === 'major' ? 'error' : v.type === 'minor' ? 'info' : 'neutral'} className="text-[9px]">{v.type}</Badge>
                    <span className="font-mono text-[10px] text-[var(--text-muted)] ml-auto">{v.date}</span>
                  </div>
                  <ul className="skill-overview-versions__notes">
                    {v.notes?.slice(0, 3).map((n: string, i: number) => (
                      <li key={i} className={cn(n.startsWith('+') ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>{n}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </article>
      </section>

      <section className="skill-overview-card skill-overview-card--timeline">
        <header className="skill-overview-card__head">
          <Activity className="h-4 w-4 text-[var(--brand)]" />
          <div className="min-w-0">
            <h3>最近运行与治理</h3>
            <p>合并执行 trace 与治理审计事件，时间倒序</p>
          </div>
          <Badge tone="neutral" className="ml-auto text-[9px]">{recentEvents.length} 条</Badge>
        </header>
        {recentEvents.length === 0 ? (
          <p className="skill-overview-card__empty">暂无运行 trace 或审计记录。</p>
        ) : (
          <ol className="skill-overview-timeline">
            {recentEvents.map((event, i) => (
              <li key={`${event.ts}-${i}`} data-tone={event.tone}>
                <span className="skill-overview-timeline__dot" aria-hidden />
                <span className="skill-overview-timeline__ts font-mono">{event.ts}</span>
                <span className={cn(
                  'skill-overview-timeline__label',
                  event.tone === 'error' && 'text-[var(--danger)]',
                  event.tone === 'warn' && 'text-[var(--warning)]',
                  event.tone === 'success' && 'text-[var(--success)]',
                )}>
                  <ShieldCheck className="inline h-3 w-3" />
                  {event.label}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {relatedSkills.length > 0 && (
        <section className="skill-overview-card skill-overview-card--related">
          <header className="skill-overview-card__head">
            <Boxes className="h-4 w-4 text-[var(--brand)]" />
            <div className="min-w-0">
              <h3>相关技能</h3>
              <p>同类型 · 按安装量倒序</p>
            </div>
          </header>
          <ul className="skill-overview-related">
            {relatedSkills.map((row) => {
              const RelatedIcon = KIND_META[row.kind]?.icon ?? Wrench;
              return (
                <li key={row.id}>
                  <Link to={`/skills/${row.id}`} className="skill-overview-related__link">
                    <span className="skill-overview-related__icon" data-kind={row.kind}>
                      <RelatedIcon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <strong>{row.name}</strong>
                      <span className="font-mono">v{row.version}</span>
                    </div>
                    <span className="skill-overview-related__meta">{(row.installCount ?? 0).toLocaleString()} 安装</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
