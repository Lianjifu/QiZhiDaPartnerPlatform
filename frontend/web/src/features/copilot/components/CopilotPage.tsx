/**
 * P2 会话 · Copilot（企业级数字伙伴会话）
 *
 * 20 项核心能力（路由 / 流式 / 状态机 / 审批 / RAG / Tool / 反馈 / 审计 / 分享 / 持久化 / 可观测性 / 调参 / 交接 …）
 * 已被拆分为更小的子组件与 hooks：
 *   - hooks/useCopilotController.ts（≤600L） + useCopilotState / Actions / Effects
 *   - components/CopilotPage.Shell / SessionsAside / Conversation / Header /
 *     Messages / Composer / ContextAside / Modals / FeedbackModal / ExpertPicker /
 *     Closeout / Handoff / Share / helpers / composer / split / context
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
