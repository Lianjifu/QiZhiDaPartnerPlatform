/**
 * 供应商详情独立页：查看与编辑接入配置。
 */
import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Route } from 'lucide-react';
import { Badge, Button, toast } from '@qzda/web-ui';
import { useModelsController } from './useModelsController';
import { ModelsModalsProviderDetail } from './ModelsModals.ProviderDetail';
import { ModelsModalsConfirm } from './ModelsModals.Confirm';
import { protocolLabel } from '@/features/models/provider-connect';
import { policyStatusLabel, providerStatusLabel, providerStatusTone, routingLevelPurpose } from '@/features/models/model-ui';

export default function ModelProviderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const c = useModelsController({ providerId: id });
  const provider = c.activeProvider;
  const related = useMemo(() => {
    if (!provider) return [];
    const modelIds = new Set((provider.models ?? []).map((model) => model.id));
    return c.policies.filter((policy) => modelIds.has(policy.primaryModelId) || policy.fallbackModelIds.some((item) => modelIds.has(item)));
  }, [c.policies, provider]);

  return (
    <div className="de-partner-wizard wf-studio" data-testid="page-models-provider-detail">
      <header className="de-partner-wizard__top">
        <div className="min-w-0">
          <Link to="/models" className="de-partner-wizard__back"><ArrowLeft className="h-3.5 w-3.5" />返回模型服务</Link>
          <div className="mt-2 flex flex-wrap items-end gap-x-3">
            <h1>{provider?.name ?? '供应商详情'}</h1>
            <p>{provider ? `${protocolLabel(provider.protocol)} · ${provider.cloudRegion}` : '正在载入…'}</p>
          </div>
        </div>
        {provider && <Badge tone={providerStatusTone(provider.status)}>{providerStatusLabel(provider.status)}</Badge>}
      </header>
      <div className="de-partner-wizard__body de-partner-wizard__body--single knowledge-pkg-create-shell">
        <section className="de-partner-wizard__main wf-studio__main knowledge-pkg-create-shell">
          <div className="h-full min-h-0 overflow-y-auto p-3 md:p-4">
            {!provider ? (
              <div className="grid h-40 place-items-center text-xs text-[var(--text-muted)]">
                {c.providersLoading ? '正在读取供应商…' : '供应商不存在或无权访问。'}
              </div>
            ) : (
              <div className="knowledge-pkg-create">
                <div className="knowledge-pkg-create__main">
                  <section className="knowledge-pkg-create__block">
                    <ModelsModalsProviderDetail
                      key={provider.id}
                      embedded
                      provider={provider}
                      impact={c.activeImpact}
                      canWrite={c.canWrite}
                      workspaceId={c.currentWorkspaceId}
                      onClose={() => navigate('/models')}
                      onSave={(payload) => c.updateProvider.mutate({ id: provider.id, ...payload }, { onSuccess: () => toast.success('供应商资料已更新'), onError: c.reportError })}
                      onTest={() => c.testProvider.mutate({ id: provider.id, reason: '人工连通性验证' }, {
                        onSuccess: (result) => toast.success(result.providerStatus === 'active' ? '验证通过，供应商已可用' : '供应商连通性验证通过'),
                        onError: c.reportError,
                      })}
                      onDisable={() => c.disableProvider.mutate({ id: provider.id, reason: '停止新流量' }, { onSuccess: () => toast.success('供应商已停止新流量'), onError: c.reportError })}
                      onDelete={() => c.setDeleteProvider(provider)}
                      onOpenPolicy={() => navigate(`/models/providers/new?id=${encodeURIComponent(id)}&step=routing`)}
                    />
                  </section>
                </div>
                <aside className="knowledge-pkg-create__aside">
                  <div className="knowledge-pkg-create__preview">
                    <div className="knowledge-pkg-create__preview-kicker">模型路由</div>
                    <h3>{related.length ? `${related.length} 条策略引用` : '尚未被路由引用'}</h3>
                    <p>发布后的路由才会出现在数字伙伴装配里。</p>
                  </div>
                  {related.length === 0 ? (
                    <p className="knowledge-pkg-create__aside-note">
                      <Route className="h-3.5 w-3.5" />
                      还没有策略使用该供应商的模型。
                    </p>
                  ) : (
                    <div className="knowledge-pkg-docs">
                      {related.map((policy) => (
                        <button
                          key={policy.id}
                          type="button"
                          className="knowledge-package-member"
                          onClick={() => navigate(`/models/providers/new?id=${encodeURIComponent(id)}&step=routing`)}
                        >
                          <span className="min-w-0">
                            <strong className="block truncate">{policy.level}</strong>
                            <small>{routingLevelPurpose(policy.level)}</small>
                          </span>
                          <Badge tone={policy.status === 'published' ? 'success' : policy.status === 'ready' ? 'warn' : 'neutral'}>
                            {policyStatusLabel(policy.status)}
                          </Badge>
                        </button>
                      ))}
                    </div>
                  )}
                  {c.canWrite && (
                    <Button size="sm" className="w-full" onClick={() => navigate(`/models/providers/new?id=${encodeURIComponent(id)}&step=routing`)}>
                      配置路由策略
                    </Button>
                  )}
                </aside>
              </div>
            )}
          </div>
        </section>
      </div>
      <footer className="wf-studio__foot">
        <Button variant="ghost" onClick={() => navigate('/models')}>返回目录</Button>
        <Button variant="outline" onClick={() => navigate(`/models/providers/new?id=${encodeURIComponent(id)}&step=routing`)}>配置路由策略</Button>
      </footer>
      <ModelsModalsConfirm c={c} />
    </div>
  );
}
