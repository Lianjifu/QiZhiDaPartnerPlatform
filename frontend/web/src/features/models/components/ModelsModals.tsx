/**
 * 模型中心 · 所有弹层编排（M08 P1 拆分）。
 *
 * 原 ModelsPage.tsx 中的 Modal wrapper 集中到本文件；
 * 具体内容由 ModelsModals.{ProviderForm,ProviderDetail,Policy,Drill,Confirm} 提供。
 */
import { toast } from '@qzda/web-ui';
import { Modal } from '@/components/shared';
import { routingLevelPurpose } from '@/features/models/model-ui';
import { ModelsModalsProviderForm } from './ModelsModals.ProviderForm';
import { ModelsModalsProviderDetail } from './ModelsModals.ProviderDetail';
import { ModelsModalsCreatePolicy, ModelsModalsPolicyDetail } from './ModelsModals.Policy';
import { ModelsModalsFailoverDrill } from './ModelsModals.Drill';
import { ModelsModalsConfirm } from './ModelsModals.Confirm';
import type { ModelsController } from './useModelsController';

export function ModelsModals({ c }: { c: ModelsController }) {
  const activeProvider = c.activeProvider;
  return (
    <>
      <Modal
        open={c.providerModal === 'new'}
        onClose={() => c.setProviderModal(null)}
        title="接入供应商"
        description="按主流大模型协议填写连接信息；凭据仅提交时写入服务端引用，成功后不回显。"
        size="lg"
      >
        <ModelsModalsProviderForm
          canWrite={c.canWrite}
          workspaceId={c.currentWorkspaceId}
          creating={c.createProvider.isPending}
          onCancel={() => c.setProviderModal(null)}
          onSubmit={(payload) => c.createProvider.mutate(payload, {
            onSuccess: (provider) => {
              toast.success('供应商已接入，正在验证连通性…');
              c.setProviderModal(null);
              c.testProvider.mutate(
                { id: provider.id, reason: '接入后自动连通性验证' },
                {
                  onSuccess: (result) => toast.success(result.providerStatus === 'active' ? '连通性验证通过，供应商已可用' : '连通性验证通过'),
                  onError: c.reportError,
                },
              );
            },
            onError: c.reportError,
          })}
        />
      </Modal>
      <Modal
        open={Boolean(activeProvider)}
        onClose={() => c.setProviderModal(null)}
        title={activeProvider?.name ?? '模型配置'}
        description="查看与编辑分开：查看态只读并验证已保存配置；编辑态修改后保存才会生效。"
        size="lg"
      >
        {activeProvider && (
          <ModelsModalsProviderDetail
            key={activeProvider.id}
            provider={activeProvider}
            impact={c.activeImpact}
            canWrite={c.canWrite}
            workspaceId={c.currentWorkspaceId}
            onClose={() => c.setProviderModal(null)}
            onSave={(payload) => c.updateProvider.mutate({ id: activeProvider.id, ...payload }, { onSuccess: () => toast.success('供应商资料已更新'), onError: c.reportError })}
            onTest={() => c.testProvider.mutate({ id: activeProvider.id, reason: '人工连通性验证' }, {
              onSuccess: (result) => toast.success(result.providerStatus === 'active' ? '验证通过，供应商已可用' : '供应商连通性验证通过'),
              onError: c.reportError,
            })}
            onDisable={() => c.disableProvider.mutate({ id: activeProvider.id, reason: '停止新流量' }, { onSuccess: () => toast.success('供应商已停止新流量'), onError: c.reportError })}
            onDelete={() => c.setDeleteProvider(activeProvider)}
            onOpenPolicy={(policyId) => {
              c.setProviderModal(null);
              c.setWorkspace('routing');
              c.setPolicyDrawer(policyId);
              c.setPolicyDetailTab('validate');
            }}
          />
        )}
      </Modal>
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
