/**
 * 模型中心 · 所有弹层编排（M08 P1 拆分）。
 *
 * 原 ModelsPage.tsx 中的 Modal wrapper 集中到本文件；
 * 具体内容由 ModelsModals.{ProviderForm,ProviderDetail,Policy,Drill,Confirm} 提供。
 */
import { Modal } from '@/components/shared';
import { routingLevelPurpose } from '@/features/models/model-ui';
import { ModelsModalsCreatePolicy, ModelsModalsPolicyDetail } from './ModelsModals.Policy';
import { ModelsModalsFailoverDrill } from './ModelsModals.Drill';
import { ModelsModalsConfirm } from './ModelsModals.Confirm';
import type { ModelsController } from './useModelsController';

export function ModelsModals({ c }: { c: ModelsController }) {
  return (
    <>
      <Modal
        open={c.createPolicyOpen}
        onClose={() => { c.setCreatePolicyOpen(false); c.setCreatePolicyPayload(null); }}
        title="新建路由草稿"
        description="仅定义调度策略：主/降级模型、数据边界与预算上限。不写入凭据，不执行真实限流。"
        size="md"
        closeOnEscape={!c.createPolicyPayload}
        closeOnBackdrop={!c.createPolicyPayload}
      >
        <ModelsModalsCreatePolicy
          canWrite={c.canWrite}
          workspaceId={c.currentWorkspaceId}
          models={c.models}
          onSubmit={(payload) => c.setCreatePolicyPayload(payload)}
        />
      </Modal>
      <Modal
        open={Boolean(c.selectedPolicy)}
        onClose={() => {
          c.setPolicyDrawer(null);
          c.setPolicyDetailTab(null);
          c.setSavePolicyDraft(null);
          c.setValidatePolicyTarget(null);
        }}
        title={c.selectedPolicy ? `${c.selectedPolicy.level} 路由策略` : '路由策略'}
        description={c.selectedPolicy ? routingLevelPurpose(c.selectedPolicy.level) : '草稿校验通过后才能发布；版本快照不可改写。'}
        size="lg"
        closeOnEscape={!c.savePolicyDraft && !c.validatePolicyTarget && !c.publishPolicy && !c.unpublishPolicy && !c.rollbackTarget}
        closeOnBackdrop={!c.savePolicyDraft && !c.validatePolicyTarget && !c.publishPolicy && !c.unpublishPolicy && !c.rollbackTarget}
      >
        {c.selectedPolicy && (
          <ModelsModalsPolicyDetail
            key={c.selectedPolicy.id}
            policy={c.selectedPolicy}
            models={c.models}
            versions={c.versions}
            canWrite={c.canWrite}
            focusTab={c.policyDetailTab}
            onFocusTabConsumed={() => c.setPolicyDetailTab(null)}
            onSave={(draft) => c.setSavePolicyDraft(draft)}
            onValidate={() => c.setValidatePolicyTarget(c.selectedPolicy ?? null)}
            onPublish={() => c.setPublishPolicy(c.selectedPolicy ?? null)}
            onUnpublish={() => c.setUnpublishPolicy(c.selectedPolicy ?? null)}
            onRollback={(versionId, label) => c.setRollbackTarget({ policyId: c.selectedPolicy?.id ?? '', versionId, label })}
          />
        )}
      </Modal>
      <Modal
        open={c.drillModalOpen}
        onClose={() => { c.setDrillModalOpen(false); c.setConfirmDrillPolicyId(null); }}
        title="sandbox 故障切换演练"
        description="仅在隔离范围验证已发布路由的降级链与审计写入；不改写生产流量，不构成合规证明。"
        size="lg"
        closeOnEscape={!c.confirmDrillPolicyId}
        closeOnBackdrop={!c.confirmDrillPolicyId}
      >
        <ModelsModalsFailoverDrill
          canWrite={c.canWrite}
          models={c.models}
          publishedPolicies={c.publishedPolicies}
          drillPolicyId={c.drillPolicyId}
          onDrillPolicyChange={c.setDrillPolicyId}
          pending={c.runDrill.isPending}
          lastResult={c.lastDrillResult}
          onCancel={() => { c.setDrillModalOpen(false); c.setConfirmDrillPolicyId(null); }}
          onRun={(policyId) => c.setConfirmDrillPolicyId(policyId)}
        />
      </Modal>

      <ModelsModalsConfirm c={c} />
    </>
  );
}
