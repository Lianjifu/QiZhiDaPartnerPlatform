/**
 * CopilotPage.Conversation — identity header + message stream + composer.
 */
import { RoleReadonlyBanner } from '@/components/shared';
import { CopilotPageHeader } from '@/features/copilot/components/CopilotPage.Header';
import { CopilotPageMessages } from '@/features/copilot/components/CopilotPage.Messages';
import { CopilotPageComposer } from '@/features/copilot/components/CopilotPage.Composer';

export function CopilotPageConversation() {
  return (
    <section className="copilot-conversation flex min-w-0 min-h-0 flex-1 flex-col bg-[var(--bg)] overflow-hidden">
      <RoleReadonlyBanner className="mx-4 mt-2 flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)] sm:mx-5" />
      <CopilotPageHeader />
      <CopilotPageMessages />
      <CopilotPageComposer />
    </section>
  );
}
