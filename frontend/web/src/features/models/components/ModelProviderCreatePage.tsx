/**
 * 接入供应商独立页：先接入凭据，再配置模型路由策略。
 */
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Boxes, Route } from 'lucide-react';
import { Badge, Button, toast } from '@qzda/web-ui';
import { KnowledgeStudioRail } from '@/features/knowledge/components/KnowledgeStudioRail';
import { useModelsController } from './useModelsController';
import { ModelsModalsProviderForm } from './ModelsModals.ProviderForm';
import { ModelsModalsCreatePolicy, ModelsModalsPolicyDetail } from './ModelsModals.Policy';
import { ModelsModalsConfirm } from './ModelsModals.Confirm';

type Step = 'connect' | 'routing';
const STEPS: Array<{ key: Step; index: string; label: string; hint: string }> = [
  { key: 'connect', index: '01', label: '接入供应商', hint: '协议、端点与凭据' },
  { key: 'routing', index: '02', label: '模型路由策略', hint: '主模型与降级链' },
];

export default function ModelProviderCreatePage() {
  const c = useModelsController();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const createdId = params.get('id') ?? '';
  const step: Step = params.get('step') === 'routing' ? 'routing' : 'connect';
  const provider = c.providers.find((item) => item.id === createdId) ?? null;
  const preferredModelIds = useMemo(() => (provider?.models ?? []).map((model) => model.id), [provider]);
  const go = (next: Step) => {
    const nextParams = new URLSearchParams();
    if (createdId) nextParams.set('id', createdId);
    if (next === 'routing') nextParams.set('step', 'routing');
    setParams(nextParams, { replace: true });
  };

  return (
    <div className="de-partner-wizard wf-studio" data-testid="page-models-provider-create">
      <header className="de-partner-wizard__top">
        <div className="min-w-0">
          <Link to="/models" className="de-partner-wizard__back"><ArrowLeft className="h-3.5 w-3.5" />返回模型服务</Link>
          <div className="mt-2 flex flex-wrap items-end gap-x-3">
            <h1>{provider?.name || '接入供应商'}</h1>
            <p>先接入并验证连通性，再配置可发布的路由策略。</p>
          </div>
        </div>
        {provider && <Badge tone="info">已接入</Badge>}
      </header>
      <div className="de-partner-wizard__body">
        <KnowledgeStudioRail
          sequential
          label="接入路径"
          current={step}
          onSelect={(key) => {
            if (key === 'routing' && !createdId) return;
            go(key);
          }}
          steps={STEPS.map((item) => ({
            ...item,
            status: item.key === 'connect'
              ? (provider ? '已接入' : '进行中')
              : (c.selectedPolicy ? '已创建草稿' : (createdId ? '可配置' : '接入后继续')),
          }))}
        />
        <section className="de-partner-wizard__main wf-studio__main knowledge-pkg-create-shell">
          <div className="h-full min-h-0 overflow-y-auto p-3 md:p-4">
            {step === 'connect' ? (
              <div className="knowledge-pkg-create">
                <div className="knowledge-pkg-create__main">
                  <section className="knowledge-pkg-create__block">
                    <header className="knowledge-pkg-create__block-head">
                      <span>01</span>
                      <div>
                        <h2>连接信息</h2>
                        <p>选择协议并填写端点、凭据与默认模型。凭据只在提交时写入服务端。</p>
                      </div>
                    </header>
                    <ModelsModalsProviderForm
                      embedded
                      canWrite={c.canWrite}
                      workspaceId={c.currentWorkspaceId}
                      creating={c.createProvider.isPending}
                      onCancel={() => navigate('/models')}
                      onSubmit={(payload) => c.createProvider.mutate(payload, {
                        onSuccess: (item) => {
                          toast.success('供应商已接入，正在验证连通性…');
                          setParams({ id: item.id, step: 'routing' }, { replace: true });
                          c.testProvider.mutate(
                            { id: item.id, reason: '接入后自动连通性验证' },
                            {
                              onSuccess: (result) => toast.success(result.providerStatus === 'active' ? '连通性验证通过，供应商已可用' : '连通性验证通过'),
                              onError: c.reportError,
                            },
                          );
                        },
                        onError: c.reportError,
                      })}
                    />
                  </section>
                </div>
                <aside className="knowledge-pkg-create__aside">
                  <div className="knowledge-pkg-create__preview">
                    <div className="knowledge-pkg-create__preview-kicker">接入路径</div>
                    <h3>创建后进入路由策略</h3>
                    <p>不必回到目录。连通性会在创建后自动探测一次。</p>
                  </div>
                  <ol className="knowledge-pkg-create__path">
                    {STEPS.map((item) => (
                      <li key={item.key} className={item.key === 'connect' ? 'is-current' : undefined}>
                        <em>{item.index}</em>
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.hint}</small>
                        </span>
                      </li>
                    ))}
                  </ol>
                  <p className="knowledge-pkg-create__aside-note">
                    <Boxes className="h-3.5 w-3.5" />
                    测试连接不落库；创建后才会写入凭据引用。
                  </p>
                </aside>
              </div>
            ) : (
              <div className="knowledge-pkg-create">
                <div className="knowledge-pkg-create__main">
                  <section className="knowledge-pkg-create__block">
                    <header className="knowledge-pkg-create__block-head">
                      <span>02</span>
                      <div>
                        <h2>模型路由策略</h2>
                        <p>{provider ? `为「${provider.name}」配置主模型与降级链，校验通过后即可发布。` : '请先完成供应商接入。'}</p>
                      </div>
                    </header>
                    {c.selectedPolicy ? (
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
                    ) : (
                      <ModelsModalsCreatePolicy
                        canWrite={c.canWrite}
                        workspaceId={c.currentWorkspaceId}
                        models={c.models}
                        preferredModelIds={preferredModelIds}
                        onSubmit={(payload) => c.setCreatePolicyPayload(payload)}
                      />
                    )}
                  </section>
                </div>
                <aside className="knowledge-pkg-create__aside">
                  <div className="knowledge-pkg-create__preview">
                    <div className="knowledge-pkg-create__preview-kicker">供应商</div>
                    <h3>{provider?.name ?? '未接入'}</h3>
                    <div className="knowledge-pkg-create__preview-tags">
                      {(provider?.models ?? []).slice(0, 4).map((model) => (
                        <Badge key={model.id} tone="neutral">{model.name}</Badge>
                      ))}
                    </div>
                    <p>草稿 → 校验 → 发布。已发布快照才可被数字伙伴引用。</p>
                  </div>
                  <p className="knowledge-pkg-create__aside-note">
                    <Route className="h-3.5 w-3.5" />
                    可先创建草稿，稍后再校验发布。
                  </p>
                </aside>
              </div>
            )}
          </div>
        </section>
      </div>
      <footer className="wf-studio__foot">
        <Button variant="ghost" onClick={() => (step === 'connect' ? navigate('/models') : go('connect'))}>
          {step === 'connect' ? '取消' : '上一步：接入供应商'}
        </Button>
        {step === 'routing' && (
          <Button onClick={() => navigate(createdId ? `/models/providers/${encodeURIComponent(createdId)}` : '/models')}>
            完成并打开详情
          </Button>
        )}
      </footer>
      <ModelsModalsConfirm c={c} />
    </div>
  );
}
