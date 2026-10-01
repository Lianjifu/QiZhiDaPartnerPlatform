/**
 * CopilotPage.Modals — all modals (expert, model, tools, closeout, handoff, share, feedback, debug).
 */
import { toast } from '@qzda/web-ui';
import { useCopilotContext } from '@/features/copilot/components/useCopilotController';
import { AuthorizationModal } from '@/components/AuthorizationModal';
import { DebugPanel } from '@/components/DebugPanel';
import { CopilotPageFeedbackModal } from '@/features/copilot/components/CopilotPage.FeedbackModal';
import { ExpertPickerModal } from '@/features/copilot/components/CopilotPage.ExpertPicker';
import { CloseoutModal } from '@/features/copilot/components/CopilotPage.Closeout';
import { HandoffModal } from '@/features/copilot/components/CopilotPage.Handoff';
import { ShareDialog } from '@/features/copilot/components/CopilotPage.Share';

export function CopilotPageModals() {
  const ctrl = useCopilotContext();
  const { s, currentSession, isAdmin, actions } = ctrl;

  if (s.modelOpen && isAdmin) {
    return (
      <AuthorizationModal
        open
        onClose={() => s.setModelOpen(false)}
        title="模型中心"
        description="选择该会话使用的模型"
        canApprove={false}
        eligibilityMessage="管理员专属入口"
        onApprove={async () => undefined}
      />
    );
  }
  if (s.toolsOpen && isAdmin) {
    return (
      <AuthorizationModal
        open
        onClose={() => s.setToolsOpen(false)}
        title="工具配置"
        description="选择会话可用的工具"
        canApprove={false}
        eligibilityMessage="管理员专属入口"
        onApprove={async () => undefined}
      />
    );
  }
  if (s.expertPickerOpen) {
    return (
      <ExpertPickerModal
        open
        mode={s.expertPickerMode}
        query={s.expertPickerQuery}
        setQuery={s.setExpertPickerQuery}
        blockedReason={s.rebindBlockedReason}
        experts={ctrl.filteredExperts}
        onPick={actions.startSessionWithExpert}
        onClose={() => { s.setExpertPickerOpen(false); s.setExpertPickerQuery(''); s.setRebindBlockedReason(null); }}
      />
    );
  }
  if (s.closeoutOpen) {
    return (
      <CloseoutModal
        open
        session={currentSession}
        onClose={() => s.setCloseoutOpen(false)}
      />
    );
  }
  if (s.handoffOpen) {
    return (
      <HandoffModal
        open
        session={currentSession}
        onClose={() => s.setHandoffOpen(false)}
      />
    );
  }
  if (s.shareDialog.open) {
    return (
      <ShareDialog
        open
        token={s.shareDialog.token}
        onCopy={actions.copyShareUrl}
        onClose={() => s.setShareDialog({ open: false })}
      />
    );
  }
  if (s.feedbackOpen) {
    return (
      <CopilotPageFeedbackModal
        open
        messageId={s.feedbackOpen}
        onClose={() => s.setFeedbackOpen(null)}
        onSubmit={(payload) => {
          toast.success('反馈已提交');
          s.setFeedbackOpen(null);
        }}
      />
    );
  }
  if (s.rejectionReason.open) {
    return (
      <AuthorizationModal
        open
        onClose={() => s.setRejectionReason((r) => ({ ...r, open: false }))}
        title="拒绝授权"
        description="填写拒绝原因"
        canApprove={false}
        eligibilityMessage="审批席位不可用，请刷新后重试"
        onApprove={async () => undefined}
      />
    );
  }
  if (s.debugOpen) {
    return (
      <DebugPanel
        open
        onClose={() => s.setDebugOpen(false)}
        session={currentSession}
        agentMeta={ctrl.agentMeta}
      />
    );
  }
  return null;
}
