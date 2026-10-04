/**
 * P2 会话 · Copilot（企业级数字伙伴会话）
 *
 * 拆分为：useCopilotController + CopilotPage.Shell / SessionsAside /
 * Conversation / Header / Messages / Composer / ContextAside / Modals /
 * ExpertPicker / helpers.
 */
import { CopilotContext, useCopilotController } from '@/features/copilot/components/useCopilotController';
import { CopilotPageShell } from '@/features/copilot/components/CopilotPage.Shell';
import { CopilotPageModals } from '@/features/copilot/components/CopilotPage.Modals';

export default function Copilot() {
  const ctrl = useCopilotController();
  return (
    <CopilotContext.Provider value={ctrl}>
      <CopilotPageShell />
      <CopilotPageModals />
    </CopilotContext.Provider>
  );
}
