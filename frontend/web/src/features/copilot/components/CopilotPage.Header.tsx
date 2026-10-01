/**
 * CopilotPage.Header — top header inside the conversation section.
 */
import { AlertTriangle, Activity, MoreHorizontal, Download,
  Share2, Archive, ArchiveRestore, FileDown, Printer,
  MessageSquareWarning, ShieldAlert,
} from 'lucide-react';
import { cn } from '@qzda/web-utils';
import { Badge, Button } from '@qzda/web-ui';
import { useT } from '@/i18n';
import { useCopilotContext } from '@/features/copilot/components/useCopilotController';

export function CopilotPageHeader() {
  const ctrl = useCopilotContext();
  const { s, currentSession, workbench, isGenerating,
    sessionUsage, expertName, expertMeta,
    actions,
  } = ctrl;
  const { t } = useT();
  const runMode = s.runMode;
  const riskLevel = s.riskLevel;
  const handoffActive = s.handoffActive;
  const handoffOwner = s.handoffOwner;
  const isClosed = s.isClosed;

  if (!currentSession) {
    return (
      <header className="app-glass copilot-header px-4 py-3 sm:px-5">
        <div className="copilot-work-header">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--brand-light)] text-[var(--brand)]">
              <Activity className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <span className="copilot-work-title truncate font-semibold">选择或创建一个会话开始协作</span>
            </div>
          </div>
        </div>
      </header>
    );
  }

  const decision = handoffActive
    ? { label: '人工交接', tone: 'warn' as const, text: `写操作已暂停，由 ${handoffOwner} 继续处置。` }
    : workbench.pendingApprovals
      ? { label: '需审批', tone: 'warn' as const, text: `${workbench.pendingApprovals} 项写操作待人工审核 · 打开消息中的审批卡授权` }
      : runMode === 'agent' && riskLevel === 'high'
        ? { label: '需审批', tone: 'warn' as const, text: '高风险执行 · 写操作需人工审核授权' }
        : runMode === 'agent'
          ? { label: '脱敏放行', tone: 'info' as const, text: '执行模式 · 写操作进入审批与审计' }
          : runMode === 'ask'
            ? { label: '仅问答', tone: 'success' as const, text: '只回答不改系统 · 需要变更请切换方案或执行' }
            : { label: '方案优先', tone: 'success' as const, text: '先出计划再确认 · 写操作请切换到执行' };
  const showCost = sessionUsage.tokens > 0;
  const showSanitizedTag = runMode === 'agent' && riskLevel === 'low' && !workbench.pendingApprovals && !handoffActive;

  return (
    <header className="app-glass copilot-header px-4 py-3 sm:px-5">
      <div className="copilot-work-header">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg', workbench.tone === 'warning' ? 'bg-[var(--warning-bg)] text-[var(--warning)]' : 'bg-[var(--brand-light)] text-[var(--brand)]')}>
            {workbench.tone === 'warning' ? <AlertTriangle className="h-5 w-5" /> : <Activity className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="copilot-work-title truncate font-semibold" title={workbench.title}>{workbench.title}</span>
              <Badge tone={workbench.tone === 'warning' ? 'warn' : isGenerating ? 'info' : 'brand'} className="shrink-0 text-[10px]">
                {workbench.pendingApprovals ? '待处置' : isGenerating ? '生成中' : runMode === 'agent' ? '执行模式' : runMode === 'ask' ? '问答中' : '方案中'}
              </Badge>
              {riskLevel !== 'low' && (
                <Badge tone={riskLevel === 'high' ? 'error' : 'warn'} className="shrink-0 text-[10px] font-semibold ring-1 ring-inset ring-current/30">
                  {riskLevel === 'high' ? '高风险' : '中风险'}
                </Badge>
              )}
              {showSanitizedTag && (
                <Badge tone="success" className="shrink-0 text-[10px]">{t('copilot.riskSanitized') ?? '脱敏放行'}</Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
              <span className={cn('copilot-work-decision inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium',
                decision.tone === 'warn' ? 'bg-[var(--warning-bg)] text-[var(--warning)]'
                  : decision.tone === 'info' ? 'bg-[var(--info-bg)] text-[var(--info)]'
                    : 'bg-[var(--success-bg)] text-[var(--success)]')}>
                <ShieldAlert className="h-3 w-3" />{decision.label}
              </span>
              <span className="truncate" title={decision.text}>{decision.text}</span>
              {showCost && (
                <span title={`本会话累计 ${sessionUsage.tokens} tokens`}>
                  {sessionUsage.tokens.toLocaleString()} tokens · ¥{sessionUsage.priced?.toFixed(2) ?? '—'}
                </span>
              )}
              <span>· 协作人：{expertName}</span>
              {expertMeta && <span>· {expertMeta}</span>}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => s.setDebugOpen(true)} aria-label="调试面板">调试</Button>
          <Button variant="ghost" size="sm" onClick={() => s.setHandoffOpen(true)} aria-label="人工交接">
            <MessageSquareWarning className="h-4 w-4" />交接
          </Button>
          <Button variant="ghost" size="sm" onClick={() => s.setCloseoutOpen(true)} aria-label="结案">
            <FileDown className="h-4 w-4" />结案
          </Button>
          <Button variant="ghost" size="sm" onClick={actions.printAuditRecord} aria-label="打印审计记录">
            <Printer className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={actions.toggleArchive} aria-label="归档切换">
            {isClosed || currentSession.lifecycle === 'archived'
              ? <ArchiveRestore className="h-4 w-4" />
              : <Archive className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={actions.shareSession} aria-label="分享会话">
            <Share2 className="h-4 w-4" />
          </Button>
          <div className="relative" ref={s.moreMenuRef}>
            <Button variant="ghost" size="sm" onClick={() => s.setMoreMenuOpen((v) => !v)} aria-label="更多操作">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
            {s.moreMenuOpen && (
              <div className="copilot-more-menu">
                <button onClick={() => { s.setExportSubOpen((v) => !v); }} className="copilot-more-menu__item">
                  <Download className="h-3.5 w-3.5" />导出{s.exportSubOpen && (
                    <div className="copilot-export-sub">
                      <button onClick={() => { actions.handleExport('markdown'); s.setMoreMenuOpen(false); }}>Markdown</button>
                      <button onClick={() => { actions.handleExport('json'); s.setMoreMenuOpen(false); }}>JSON</button>
                    </div>
                  )}
                </button>
                <button onClick={() => { actions.printAuditRecord(); s.setMoreMenuOpen(false); }} className="copilot-more-menu__item">
                  <Printer className="h-3.5 w-3.5" />打印审计
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
