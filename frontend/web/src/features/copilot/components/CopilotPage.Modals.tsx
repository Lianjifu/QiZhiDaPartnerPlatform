/**
 * CopilotPage.Modals — expert picker, feedback, and approval rejection.
 */
import { toast } from '@qzda/web-ui';
import { useCopilotContext } from '@/features/copilot/components/useCopilotController';
import { AuthorizationModal } from '@/components/AuthorizationModal';
import { CopilotPageFeedbackModal } from '@/features/copilot/components/CopilotPage.FeedbackModal';
import { ExpertPickerModal } from '@/features/copilot/components/CopilotPage.ExpertPicker';

export function CopilotPageModals() {
  const ctrl = useCopilotContext();
  const { s, actions } = ctrl;

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
  if (s.feedbackOpen) {
    const target = s.chat.activeSession?.messages.find((m) => m.id === s.feedbackOpen);
    return (
      <CopilotPageFeedbackModal
        open
        messageId={s.feedbackOpen}
        onClose={() => s.setFeedbackOpen(null)}
        onSubmit={(payload) => {
          if (s.feedbackOpen) {
            s.chat.setFeedback(s.feedbackOpen, {
              kind: target?.feedback?.kind ?? 'dislike',
              tags: payload.tags,
              comment: payload.comment,
            });
          }
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
  return null;
}
