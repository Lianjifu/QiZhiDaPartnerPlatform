/**
 * 专家上下文概览面板（P0–P3）
 * 现代 SaaS 侧栏：轻量工具条 + 卡片分区 + 可折叠明细。
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, Brain, BriefcaseBusiness, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Database, Download, ExternalLink, Search, Shield, Wrench,
} from 'lucide-react';
import { Badge, Button, toast } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { Citation } from '@/hooks/types';
import type { DigitalPartner } from '@qzda/web-types';
import type { RunMode } from './composer-mode';
import {
  buildExpertEvidencePack,
  deriveExpertJobContract,
  deriveTurnProgress,
  formatEvidencePackMarkdown,
  type ExpertContextOverview,
} from './expert-context';
import { TurnTaskList } from './turn-narrative/turn-task-list';

const SOURCE_COLOR: Record<string, string> = {
  知识库: 'text-[var(--brand)] bg-[var(--brand-light)]',
  文档: 'text-[var(--info)] bg-[var(--info-bg)]',
  记忆: 'text-[var(--success)] bg-[var(--success-bg)]',
};

type WorkbenchTab = 'overview' | 'evidence' | 'tasks' | 'approvals' | 'audit' | 'admin';

function Collapsible({
  title,
  icon: Icon,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: typeof BriefcaseBusiness;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cn('copilot-ecx-card', open && 'is-open')}>
      <button type="button" className="copilot-ecx-card__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="copilot-ecx-card__icon">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="copilot-ecx-card__title">{title}</span>
        {badge}
        <span className="copilot-ecx-card__chevron">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open ? <div className="copilot-ecx-card__body">{children}</div> : null}
    </section>
  );
}

function CapChips({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="copilot-ecx-empty-inline">{empty}</p>;
  const shown = items.slice(0, 6);
  const rest = items.length - shown.length;
  return (
    <div className="copilot-ecx-chips">
      {shown.map((item) => <span key={item}>{item}</span>)}
      {rest > 0 ? <span className="is-more">+{rest}</span> : null}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="copilot-ecx-meta__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatToken(n: number | null): string {
  if (n == null) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function ExpertContextPanel(props: {
  employee: DigitalPartner | null | undefined;
  overview: ExpertContextOverview;
  sessionOverview: ExpertContextOverview;
  messageOverview: ExpertContextOverview | null;
  scope: 'session' | 'message';
  runMode: RunMode;
  riskLevel: 'low' | 'medium' | 'high';
  handoffActive: boolean;
  handoffOwner?: string;
  nextAction?: string;
  summaryCounts: { linkedTasks: number; pendingApprovals: number; evidence: number; executions: number };
  onOpenTab: (tab: WorkbenchTab) => void;
  onCitation: (c: Citation) => void;
  onJumpMessage?: (messageId: string) => void;
  onPickExpert?: () => void;
  turnProgress?: ReturnType<typeof deriveTurnProgress>;
}) {
  const {
    employee, overview, sessionOverview, messageOverview, scope,
    runMode, riskLevel, handoffActive, handoffOwner, nextAction, summaryCounts,
    onOpenTab, onCitation, onJumpMessage, onPickExpert, turnProgress = [],
  } = props;
  const contract = useMemo(() => deriveExpertJobContract(employee), [employee]);
  const [showCompare, setShowCompare] = useState(false);

  const exportPack = async () => {
    const pack = buildExpertEvidencePack({
      scope,
      employee,
      runMode,
      riskLevel,
      overview,
      sessionOverview,
      messageOverview: messageOverview ?? undefined,
    });
    const markdown = formatEvidencePackMarkdown(pack);
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success('证据包已复制到剪贴板（Markdown）');
    } catch {
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `expert-evidence-${Date.now()}.md`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('证据包已下载');
    }
  };

  const metricPills = [
    { tab: 'approvals' as const, label: '待审', value: summaryCounts.pendingApprovals, tone: 'warn' as const },
    { tab: 'evidence' as const, label: '证据', value: summaryCounts.evidence, tone: 'success' as const },
    { tab: 'tasks' as const, label: '任务', value: summaryCounts.linkedTasks, tone: 'brand' as const },
    { tab: 'audit' as const, label: '执行', value: summaryCounts.executions, tone: 'neutral' as const },
  ].filter((item) => item.value > 0);

  const assembled = [...(contract?.skills ?? []), ...(contract?.tools ?? []), ...(contract?.workflows ?? [])];
  const hasFailures = overview.tools.failed > 0 || overview.timeline.some((i) => i.tone === 'error' || i.tone === 'warn');

  return (
    <div className="copilot-ecx">
      {/* 轻量工具条：不再重复模式/风险（头部已有） */}
      <div className="copilot-ecx-toolbar">
        <div className="copilot-ecx-toolbar__main">
          {nextAction ? (
            <p className="copilot-ecx-toolbar__next">{nextAction}</p>
          ) : (
            <p className="copilot-ecx-toolbar__hint">
              {scope === 'message' ? '当前按单条消息展示依据' : '会话级依据与岗位契约'}
              {handoffActive && handoffOwner ? ` · 已由 ${handoffOwner} 接管` : ''}
            </p>
          )}
          {metricPills.length > 0 ? (
            <div className="copilot-ecx-pills">
              {metricPills.map((item) => (
                <button
                  key={item.tab}
                  type="button"
                  className={cn('copilot-ecx-pill', `is-${item.tone}`)}
                  onClick={() => onOpenTab(item.tab)}
                >
                  {item.label}
                  <strong>{item.value}</strong>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" className="copilot-ecx-toolbar__export" onClick={() => void exportPack()} title="导出证据包">
          <Download className="h-3.5 w-3.5" />
          <span>导出</span>
        </button>
      </div>

      <div className="copilot-ecx-stack">
        {messageOverview ? (
          <div className="copilot-ecx-card copilot-ecx-card--soft">
            <button type="button" className="copilot-ecx-card__head" onClick={() => setShowCompare((v) => !v)} aria-expanded={showCompare}>
              <span className="copilot-ecx-card__icon"><Shield className="h-3.5 w-3.5" /></span>
              <span className="copilot-ecx-card__title">范围对比</span>
              <Badge tone="neutral" className="text-[9px]">会话 / 消息</Badge>
              <span className="copilot-ecx-card__chevron">
                {showCompare ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </span>
            </button>
            {showCompare ? (
              <div className="copilot-ecx-card__body">
                <div className="copilot-ecx-compare-grid">
                  {[
                    ['引用', sessionOverview.citations.length, messageOverview.citations.length],
                    ['工具', sessionOverview.tools.total, messageOverview.tools.total],
                    ['记忆', sessionOverview.memoryHits.length, messageOverview.memoryHits.length],
                    ['待审', sessionOverview.pendingApprovals, messageOverview.pendingApprovals],
                  ].map(([label, sessionVal, msgVal]) => (
                    <div key={String(label)} className="copilot-ecx-compare-grid__item">
                      <span>{label}</span>
                      <strong><em>{sessionVal}</em><i>/</i>{msgVal}</strong>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <Collapsible
          title="岗位契约"
          icon={BriefcaseBusiness}
          badge={contract ? <Badge tone="success" className="text-[9px]">在岗</Badge> : <Badge tone="neutral" className="text-[9px]">未绑定</Badge>}
        >
          {contract ? (
            <div className="copilot-ecx-contract">
              <div className="copilot-ecx-identity">
                <div className="copilot-ecx-identity__role">{contract.role}</div>
                <div className="copilot-ecx-identity__meta">
                  <span>{contract.name}</span>
                  <span>·</span>
                  <span>{contract.department}</span>
                  <span>·</span>
                  <span className="font-mono">v{contract.version}</span>
                </div>
                {contract.description ? <p className="copilot-ecx-identity__desc">{contract.description}</p> : null}
              </div>

              <dl className="copilot-ecx-meta">
                <MetaRow label="服务对象" value={contract.serviceObject} />
                <MetaRow label="环境" value={<span className="font-mono">{contract.environment}</span>} />
                <MetaRow label="模型" value={<span className="font-mono">{contract.model}</span>} />
                {contract.evaluationScore != null ? (
                  <MetaRow label="评测" value={<span className="font-mono">{contract.evaluationScore}</span>} />
                ) : null}
              </dl>

              <div className="copilot-ecx-split">
                <div>
                  <div className="copilot-ecx-kicker">职责</div>
                  {contract.responsibilities.length ? (
                    <ul className="copilot-ecx-bullets">
                      {contract.responsibilities.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  ) : <p className="copilot-ecx-empty-inline">未配置</p>}
                </div>
                <div>
                  <div className="copilot-ecx-kicker">禁止项</div>
                  {contract.prohibitedActions.length ? (
                    <ul className="copilot-ecx-bullets is-warn">
                      {contract.prohibitedActions.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  ) : <p className="copilot-ecx-empty-inline">未配置</p>}
                </div>
              </div>

              <div>
                <div className="copilot-ecx-kicker">知识包</div>
                <CapChips items={contract.knowledge} empty="尚未装配知识包" />
              </div>
              <div>
                <div className="copilot-ecx-kicker">技能 / 工具 / 流程</div>
                <CapChips items={assembled} empty="尚未装配" />
              </div>

              <div className="copilot-ecx-contract__foot">
                <span>负责人 {contract.owner} · 升级 {contract.escalationOwner}</span>
                <Link to="/partners" className="copilot-ecx-link">
                  岗位配置 <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="copilot-ecx-empty">
              <p>当前会话尚未绑定在岗数字伙伴。</p>
              {onPickExpert ? <Button size="sm" onClick={onPickExpert}>选择专家</Button> : null}
            </div>
          )}
        </Collapsible>

        <Collapsible
          title="检索与证据"
          icon={Database}
          defaultOpen={overview.citations.length > 0 || overview.rag.attempted}
          badge={
            <Badge tone={overview.rag.attempted ? (overview.rag.hitCount > 0 ? 'success' : 'neutral') : 'neutral'} className="text-[9px]">
              {overview.rag.attempted ? (overview.rag.hitCount > 0 ? `${overview.rag.hitCount} 命中` : '无命中') : '未触发'}
            </Badge>
          }
        >
          <div className="copilot-ecx-kpi">
            <div>
              <span>状态</span>
              <strong>{overview.rag.label}</strong>
            </div>
            <div>
              <span>命中</span>
              <strong className="font-mono">{overview.rag.hitCount}</strong>
            </div>
            <div>
              <span>Token</span>
              <strong className="font-mono">{formatToken(overview.tokenUsed)}</strong>
            </div>
            <div>
              <span>模型</span>
              <strong className="truncate font-mono">{overview.modelLabel ?? '—'}</strong>
            </div>
          </div>
          {(overview.providerLabel || overview.durationMs != null || overview.rag.backend) ? (
            <p className="copilot-ecx-footnote">
              {overview.rag.backend ? `后端 ${overview.rag.backend}` : null}
              {overview.providerLabel ? `${overview.rag.backend ? ' · ' : ''}供应商 ${overview.providerLabel}` : null}
              {overview.durationMs != null ? ` · ${overview.durationMs}ms` : null}
              {overview.snapshotIds[0] ? ` · ${overview.snapshotIds[0]}` : null}
            </p>
          ) : null}

          {overview.tokenUsed != null ? (
            <div className="copilot-ecx-meter" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (overview.tokenUsed / 200000) * 100)}%` }} />
            </div>
          ) : null}

          {overview.citations.length === 0 ? (
            <p className="copilot-ecx-empty-inline mt-2">本范围尚无可追溯引用。</p>
          ) : (
            <div className="copilot-ecx-list mt-2">
              {overview.citations.map((c) => (
                <button key={c.id} type="button" onClick={() => onCitation(c)} className="copilot-ecx-cite">
                  <div className="copilot-ecx-cite__top">
                    <span className={cn('copilot-ecx-cite__src', SOURCE_COLOR[c.source])}>{c.source}</span>
                    <span className="copilot-ecx-cite__id">{c.docId || c.source}</span>
                    {c.page != null ? <span className="copilot-ecx-cite__page">p.{c.page}</span> : null}
                  </div>
                  {c.text ? <p className="copilot-ecx-cite__text">{c.text}</p> : null}
                  <div className="copilot-ecx-cite__score">
                    <div className={cn('copilot-confidence-bar', c.score >= 0.85 ? 'is-high' : c.score >= 0.7 ? 'is-mid' : 'is-low')}>
                      <span style={{ width: `${Math.min(100, Math.max(0, c.score * 100))}%` }} />
                    </div>
                    <span className="font-mono">{(c.score * 100).toFixed(0)}%</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Collapsible>

        <Collapsible
          title="记忆命中"
          icon={Brain}
          defaultOpen={overview.memoryHits.length > 0}
          badge={<Badge tone={overview.memoryHits.length ? 'success' : 'neutral'} className="text-[9px]">{overview.memoryHits.length}</Badge>}
        >
          {overview.memoryHits.length === 0 ? (
            <p className="copilot-ecx-empty-inline">无跨会话记忆命中。</p>
          ) : (
            <ul className="copilot-ecx-memory">
              {overview.memoryHits.map((m) => (
                <li key={m.id}>
                  <span className="copilot-ecx-memory__layer">{m.layer}</span>
                  <span className="copilot-ecx-memory__title">{m.title}</span>
                  {m.score != null ? <span className="font-mono text-[10px] text-[var(--text-muted)]">{(m.score * 100).toFixed(0)}%</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Collapsible>

        <Collapsible
          title="工具调用"
          icon={Wrench}
          defaultOpen={overview.tools.total > 0}
          badge={
            <Badge tone={overview.tools.failed > 0 ? 'error' : overview.tools.total ? 'brand' : 'neutral'} className="text-[9px]">
              {overview.tools.failed > 0 ? `${overview.tools.failed} 失败` : overview.tools.total}
            </Badge>
          }
        >
          {overview.tools.total === 0 ? (
            <p className="copilot-ecx-empty-inline">本范围尚未调用工具。</p>
          ) : (
            <>
              <div className="copilot-ecx-kpi copilot-ecx-kpi--4">
                <div><span>成功</span><strong className="is-ok">{overview.tools.success}</strong></div>
                <div><span>失败</span><strong className={overview.tools.failed ? 'is-bad' : undefined}>{overview.tools.failed}</strong></div>
                <div><span>平均</span><strong className="font-mono">{overview.tools.avgMs != null ? `${overview.tools.avgMs}ms` : '—'}</strong></div>
                <div><span>合计</span><strong className="font-mono">{overview.tools.total}</strong></div>
              </div>
              <ul className="copilot-ecx-tools">
                {overview.toolItems.map((t) => (
                  <li key={t.id} className={cn((t.status === 'failed' || t.status === 'denied') && 'is-error')}>
                    <button type="button" className="copilot-ecx-tools__row" onClick={() => onJumpMessage?.(t.messageId)}>
                      <span className="copilot-ecx-tools__name">{t.name}</span>
                      <Badge
                        tone={t.status === 'success' ? 'success' : t.status === 'denied' || t.status === 'failed' ? 'error' : 'neutral'}
                        className="text-[9px]"
                      >
                        {t.status}
                      </Badge>
                      {t.durationMs != null ? <span className="font-mono text-[10px] text-[var(--text-muted)]">{t.durationMs}ms</span> : null}
                      {t.approvalPending ? <Badge tone="warn" className="text-[9px]">待审</Badge> : null}
                    </button>
                    {t.error ? <p className="copilot-ecx-tools__err">{t.error}</p> : null}
                    {t.permission ? <p className="copilot-ecx-footnote">权限 {t.permission}</p> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Collapsible>

        <Collapsible
          title="本回合进度"
          icon={Clock}
          defaultOpen={turnProgress.length > 0}
          badge={<Badge tone={turnProgress.some((t) => t.status === 'running') ? 'brand' : 'neutral'} className="text-[9px]">{turnProgress.length}</Badge>}
        >
          {turnProgress.length === 0 ? (
            <p className="copilot-ecx-empty-inline">当前范围暂无任务进度。</p>
          ) : (
            <TurnTaskList tasks={turnProgress} />
          )}
        </Collapsible>

        <Collapsible
          title="活动时间线"
          icon={Clock}
          defaultOpen={hasFailures}
          badge={<Badge tone={hasFailures ? 'warn' : 'neutral'} className="text-[9px]">{overview.timeline.length}</Badge>}
        >
          {overview.timeline.length === 0 ? (
            <p className="copilot-ecx-empty-inline">暂无活动记录。</p>
          ) : (
            <div className="activity-timeline">
              {overview.timeline.map((a, i) => {
                const TimelineIcon = a.tone === 'success'
                  ? CheckCircle2
                  : a.tone === 'warn'
                    ? AlertTriangle
                    : a.tone === 'error'
                      ? AlertCircle
                      : Search;
                return (
                  <button
                    key={`${a.text}-${a.time}-${i}`}
                    type="button"
                    className="activity-timeline__item activity-timeline__item--btn"
                    onClick={() => a.messageId && onJumpMessage?.(a.messageId)}
                  >
                    <div className={cn('activity-timeline__dot', `activity-timeline__dot--${a.tone}`)}>
                      <TimelineIcon className="h-3 w-3" />
                    </div>
                    <div className="activity-timeline__content">
                      <div className="activity-timeline__text">{a.text}</div>
                      <div className="activity-timeline__time">{a.time}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Collapsible>
      </div>
    </div>
  );
}
