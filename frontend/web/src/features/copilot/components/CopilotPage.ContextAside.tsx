/**
 * CopilotPage.ContextAside — right context drawer (overview/evidence/tasks/etc).
 */
import { X } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import { useCopilotContext } from '@/features/copilot/components/useCopilotController';
import { ContextDrawerPanel as CopilotPageContextPanel } from '@/features/copilot/components/CopilotPage.ContextPanel';
import { ExpertContextPanel } from '@/features/copilot/components/ExpertContextPanel';

export function CopilotPageContextAside() {
  const ctrl = useCopilotContext();
  const { detailsOpen, contextTab, visibleContextTabs, currentSession,
    activeEmployee,
    closeContext, setContextTab, jumpToMessage,
    openCitation, contextMessages, selectedContextMessage,
    selectedDocumentArtifact, sessionExpertContext, messageExpertContext,
    sessionMode,
  } = ctrl;
  const focusedCitation = ctrl.s.focusedCitation;
  const handoffActive = ctrl.s.handoffActive;
  const handoffOwner = ctrl.s.handoffOwner;
  const riskLevel = ctrl.s.riskLevel;

  if (!detailsOpen) return null;

  return (
    <aside
      id="copilot-context"
      className="copilot-agent-details"
      aria-label="会话上下文"
      data-open="true"
    >
      <div className="copilot-agent-details__tabs" role="tablist">
        {visibleContextTabs.map((t) => (
          <button
            key={t.tab}
            type="button"
            role="tab"
            aria-selected={contextTab === t.tab}
            className={cn('copilot-agent-details__tab', contextTab === t.tab && 'is-active')}
            onClick={() => setContextTab(t.tab)}
          >
            {t.label}
            {typeof t.count === 'number' ? (
              <span className="copilot-agent-details__tab-count">{t.count}</span>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          className="copilot-details-close"
          onClick={closeContext}
          aria-label="关闭上下文"
          title="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="copilot-agent-details__body">
        {contextTab === 'overview' && currentSession && (
          <ExpertContextPanel
            employee={activeEmployee}
            overview={sessionExpertContext}
            sessionOverview={sessionExpertContext}
            messageOverview={messageExpertContext}
            scope={selectedContextMessage ? 'message' : 'session'}
            runMode={sessionMode === 'execute' ? 'agent' : 'ask'}
            riskLevel={riskLevel}
            handoffActive={handoffActive}
            handoffOwner={handoffOwner}
            summaryCounts={{
              linkedTasks: sessionExpertContext.citations.length,
              pendingApprovals: sessionExpertContext.pendingApprovals,
              evidence: sessionExpertContext.citations.length,
              executions: sessionExpertContext.tools.total,
            }}
            onOpenTab={(tab) => setContextTab(tab as any)}
            onCitation={(c) => openCitation(c, selectedContextMessage?.id)}
            onJumpMessage={(mid) => jumpToMessage(mid)}
          />
        )}
        {(contextTab === 'evidence' || contextTab === 'audit' || contextTab === 'document' || contextTab === 'tasks' || contextTab === 'approvals') && (
          <CopilotPageContextPanel
            tab={contextTab as 'evidence' | 'audit' | 'document' | 'tasks' | 'approvals'}
            messages={contextMessages}
            onCitation={(c, mid) => openCitation(c, mid ?? selectedContextMessage?.id)}
            focusedCitation={focusedCitation}
            artifact={contextTab === 'document' ? selectedDocumentArtifact : undefined}
          />
        )}
        {contextTab === 'admin' && (
          <div className="p-4 text-[12px] text-[var(--text-muted)]">
            管理员运行控制由模型中心与审计页管理。
          </div>
        )}
      </div>
    </aside>
  );
}
