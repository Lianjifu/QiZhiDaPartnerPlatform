/**
 * CopilotPage.ContextAside — right context drawer (overview/evidence/tasks/etc).
 */
import { useCopilotContext } from '@/features/copilot/components/useCopilotController';
import { ContextDrawerPanel as CopilotPageContextPanel } from '@/features/copilot/components/CopilotPage.ContextPanel';
import { ExpertContextPanel } from '@/features/copilot/components/ExpertContextPanel';

export function CopilotPageContextAside() {
  const ctrl = useCopilotContext();
  const { detailsOpen, contextTab, visibleContextTabs, currentSession,
    activeEmployee, sendModelId, availableTools,
    closeContext, setContextTab, openContext, jumpToMessage,
    openCitation, contextMessages, selectedContextMessage,
    selectedDocumentArtifact, sessionExpertContext, messageExpertContext,
    sessionMode,
  } = ctrl;
  const focusedCitation = ctrl.s.focusedCitation;
  const handoffActive = ctrl.s.handoffActive;
  const handoffOwner = ctrl.s.handoffOwner;
  const riskLevel = ctrl.s.riskLevel;
  const nextAction = '请查看会话总结';

  if (!detailsOpen) return null;

  return (
    <aside className="copilot-context" aria-label="上下文抽屉">
      <div className="copilot-context__tabs" role="tablist">
        {visibleContextTabs.map((t) => (
          <button
            key={t.tab}
            type="button"
            role="tab"
            aria-selected={contextTab === t.tab}
            className={contextTab === t.tab ? 'is-active' : ''}
            onClick={() => setContextTab(t.tab)}
          >
            {t.label}{typeof t.count === 'number' ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>
      <div className="copilot-context__body">
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
            nextAction={nextAction}
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
          <div className="copilot-context__admin">
            <p className="text-[var(--text-muted)] text-xs">管理员运行控制台（路由/模型/审计）由 ModelCenter / AuditPage 管理。</p>
          </div>
        )}
      </div>
      <div className="copilot-context__foot">
        <button type="button" className="copilot-context__close" onClick={closeContext}>关闭</button>
      </div>
    </aside>
  );
}
