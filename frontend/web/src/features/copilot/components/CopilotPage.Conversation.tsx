/**
 * CopilotPage.Conversation — header + meta strip + message stream + composer column.
 */
import { useCopilotContext } from '@/features/copilot/components/useCopilotController';
import { RoleReadonlyBanner } from '@/components/shared';
import { CopilotPageHeader } from '@/features/copilot/components/CopilotPage.Header';
import { CopilotPageMessages } from '@/features/copilot/components/CopilotPage.Messages';
import { CopilotPageComposer } from '@/features/copilot/components/CopilotPage.Composer';
import { CopilotPageMetaStrip } from '@/features/copilot/components/CopilotPage.MetaStrip';

export function CopilotPageConversation() {
  const ctrl = useCopilotContext();
  const { currentSession, openAuditTab } = ctrl;
  const turnCount = currentSession?.messages.filter((m: any) => m.role === 'assistant').length ?? 0;
  const totalTokens = currentSession?.messages.reduce((sum: number, m: any) => sum + (m.metrics?.promptTokens ?? 0) + (m.metrics?.completionTokens ?? 0), 0) ?? 0;
  return (
    <section className="copilot-conversation flex min-w-0 min-h-0 flex-1 flex-col bg-[var(--bg)] overflow-hidden">
      <div className="px-4 pt-2 sm:px-5">
        <RoleReadonlyBanner className="mb-1 flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]" />
      </div>
      <CopilotPageHeader />
      <CopilotPageMetaStrip
        turnCount={turnCount}
        totalTokens={totalTokens}
        lastActiveAt={currentSession?.lastActiveAt ?? null}
        onOpenAudit={openAuditTab ? () => openAuditTab('session') : undefined}
      />
      <CopilotPageMessages />
      <CopilotPageComposer />
    </section>
  );
}
