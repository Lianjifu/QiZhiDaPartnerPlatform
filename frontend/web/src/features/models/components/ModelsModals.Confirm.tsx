/**
 * 模型中心 · 全部确认弹层（M08 P1 拆分）。
 *
 * 原 ModelsPage.tsx 中 8 个 ConfirmDialog 收拢至本文件；
 * 业务状态由 useModelsController 提供的控制器读取；本文件只渲染 + 转发。
 */
import { toast } from '@qzda/web-ui';
import { ConfirmDialog } from '@/components/shared';
import type { ModelsController } from './useModelsController';

export function ModelsModalsConfirm({ c }: { c: ModelsController }) {
  return (
    <>
      <CreatePolicyConfirm c={c} />
      <SavePolicyDraftConfirm c={c} />
      <ValidatePolicyConfirm c={c} />
      <PublishPolicyConfirm c={c} />
      <UnpublishPolicyConfirm c={c} />
      <RollbackTargetConfirm c={c} />
      <DrillConfirm c={c} />
      <DeleteProviderConfirm c={c} />
    </>
  );
}

function CreatePolicyConfirm({ c }: { c: ModelsController }) {
  return (
    <ConfirmDialog
      open={Boolean(c.createPolicyPayload)}
      onClose={() => c.setCreatePolicyPayload(null)}
      onConfirm={() => {
        if (!c.createPolicyPayload) return;
        c.createPolicy.mutate(c.createPolicyPayload, {
          onSuccess: (policy) => {
            toast.success('路由草稿已创建，请继续校验后发布');
            c.setCreatePolicyPayload(null);
            c.setCreatePolicyOpen(false);
            c.setPolicyDrawer(policy.id);
            c.setPolicyDetailTab('validate');
          },
          onError: c.reportError,
        });
      }}
      title="确认创建路由草稿？"
      description={`${String(c.createPolicyPayload?.level ?? '')} 策略将以草稿保存；创建后需完成校验才能发布不可变版本。`}
      confirmText="确认创建"
    />
  );
}

function SavePolicyDraftConfirm({ c }: { c: ModelsController }) {
  return (
    <ConfirmDialog
      open={Boolean(c.savePolicyDraft)}
      onClose={() => c.setSavePolicyDraft(null)}
      onConfirm={() => {
        if (!c.savePolicyDraft) return;
        c.updatePolicy.mutate(c.savePolicyDraft, {
          onSuccess: () => {
            toast.success('草稿已保存，已发布快照未改动；请重新校验后再发布');
            c.setSavePolicyDraft(null);
            c.setPolicyDetailTab('validate');
          },
          onError: c.reportError,
        });
      }}
      title="确认保存路由草稿？"
      description={c.selectedPolicy?.status === 'published'
        ? '保存会回到草稿态并清空校验结果，不会改写已发布快照；需重新校验后才能再次发布。'
        : '保存后需重新校验；校验通过才可发布版本。'}
      confirmText="确认保存"
    />
  );
}

function ValidatePolicyConfirm({ c }: { c: ModelsController }) {
  return (
    <ConfirmDialog
      open={Boolean(c.validatePolicyTarget)}
      onClose={() => c.setValidatePolicyTarget(null)}
      onConfirm={() => {
        if (!c.validatePolicyTarget) return;
        c.validatePolicy.mutate({ id: c.validatePolicyTarget.id }, {
          onSuccess: (policy) => {
            toast[policy.status === 'ready' ? 'success' : 'warn'](
              policy.status === 'ready' ? '校验通过，可以发布版本' : '校验未通过，请按问题修正草稿',
            );
            c.setValidatePolicyTarget(null);
            if (policy.status === 'ready') c.setPolicyDetailTab('validate');
          },
          onError: c.reportError,
        });
      }}
      title="确认执行路由校验？"
      description="将检查主/降级模型可用性、供应商状态、出境约束与降级链完整性。"
      confirmText="确认校验"
    />
  );
}

function PublishPolicyConfirm({ c }: { c: ModelsController }) {
  return (
    <ConfirmDialog
      open={Boolean(c.publishPolicy)}
      onClose={() => c.setPublishPolicy(null)}
      onConfirm={() => {
        if (!c.publishPolicy) return;
        c.publish.mutate({ id: c.publishPolicy.id, reason: '人工确认发布' }, {
          onSuccess: () => {
            toast.success('路由版本已发布');
            c.setPublishPolicy(null);
            c.setPolicyDetailTab('versions');
          },
          onError: c.reportError,
        });
      }}
      title="发布路由版本？"
      description={c.publishPolicy ? `将为 ${c.publishPolicy.level} 生成不可变版本快照并写入审计。` : ''}
      confirmText="确认发布"
    />
  );
}

function UnpublishPolicyConfirm({ c }: { c: ModelsController }) {
  return (
    <ConfirmDialog
      open={Boolean(c.unpublishPolicy)}
      onClose={() => c.setUnpublishPolicy(null)}
      onConfirm={() => {
        if (!c.unpublishPolicy) return;
        c.unpublish.mutate({ id: c.unpublishPolicy.id, reason: '人工取消发布' }, {
          onSuccess: () => {
            toast.success(`${c.unpublishPolicy!.level} 路由已取消发布，可替换模型或删除相关供应商`);
            c.setUnpublishPolicy(null);
            c.setPolicyDetailTab('validate');
            void c.impactQuery.refetch();
          },
          onError: c.reportError,
        });
      }}
      title="取消发布路由？"
      description={c.unpublishPolicy
        ? `将把 ${c.unpublishPolicy.level} 从已发布回退为草稿；历史版本快照保留。取消后引用该策略的供应商可再删除。`
        : ''}
      confirmText="确认取消发布"
      tone="danger"
    />
  );
}

function RollbackTargetConfirm({ c }: { c: ModelsController }) {
  return (
    <ConfirmDialog
      open={Boolean(c.rollbackTarget)}
      onClose={() => c.setRollbackTarget(null)}
      onConfirm={() => {
        if (!c.rollbackTarget) return;
        c.rollback.mutate({ id: c.rollbackTarget.policyId, versionId: c.rollbackTarget.versionId, reason: '人工确认回滚' }, {
          onSuccess: () => {
            toast.success('已创建回滚版本');
            c.setRollbackTarget(null);
            c.setPolicyDetailTab('versions');
          },
          onError: c.reportError,
        });
      }}
      title="回滚到历史版本？"
      description={c.rollbackTarget ? `将基于 ${c.rollbackTarget.label} 创建新的已发布版本，历史快照不会被改写。` : ''}
      confirmText="确认回滚"
      tone="danger"
    />
  );
}

function DrillConfirm({ c }: { c: ModelsController }) {
  return (
    <ConfirmDialog
      open={Boolean(c.confirmDrillPolicyId)}
      onClose={() => c.setConfirmDrillPolicyId(null)}
      onConfirm={() => {
        if (!c.confirmDrillPolicyId) return;
        const policyId = c.confirmDrillPolicyId;
        c.runDrill.mutate({ policyId, scope: 'sandbox', reason: '控制面隔离演练' }, {
          onSuccess: (result: any) => {
            c.setLastDrillResult({
              policyId: result.policyId ?? policyId,
              fromModelId: result.fromModelId,
              toModelId: result.toModelId,
              correlationId: result.correlationId,
              status: result.status ?? 'passed',
            });
            c.setConfirmDrillPolicyId(null);
            toast.success('sandbox 故障切换演练通过');
            void c.refetchAudit();
            void c.refetchGovernance();
          },
          onError: c.reportError,
        });
      }}
      title="确认执行 sandbox 演练？"
      description={c.confirmDrillPolicy
        ? `将对 ${c.confirmDrillPolicy.level} 已发布路由验证主模型 → 一级降级切流，并写入模型审计；不切换生产流量。`
        : '仅在隔离范围验证降级链。'}
      confirmText="确认演练"
    />
  );
}

function DeleteProviderConfirm({ c }: { c: ModelsController }) {
  return (
    <ConfirmDialog
      open={Boolean(c.deleteProvider)}
      onClose={() => c.setDeleteProvider(null)}
      onConfirm={() => {
        if (!c.deleteProvider) return;
        c.removeProvider.mutate(
          { id: c.deleteProvider.id, reason: '人工确认删除' },
          {
            onSuccess: () => {
              toast.success('供应商已删除');
              c.setDeleteProvider(null);
              c.setProviderModal(null);
            },
            onError: c.reportError,
          },
        );
      }}
      title={`删除供应商「${c.deleteProvider?.name ?? ''}」？`}
      description="删除后凭据引用一并清理。若仍被已发布路由引用，请先取消发布或替换模型后再删除。"
      confirmText="删除"
      tone="danger"
    />
  );
}
