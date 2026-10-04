/**
 * 接入数据源入口：连接后同步，产物进入知识包加工 → 评测 → 图谱 → 版本。
 */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { Field } from './KnowledgeShared';
import { useKnowledgeController } from './useKnowledgeController';
import { ConnectSourceFormView } from './ConnectSourceForm';
import { packageStatusLabel } from '@/features/knowledge/knowledge-ui';

export default function KnowledgeSourcePage() {
  const c = useKnowledgeController();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [packageId, setPackageId] = useState(params.get('package') ?? '');
  const pkg = c.knowledgePackages.find((item) => item.id === packageId) ?? null;
  const connecting = c.sourceMutation.isPending || c.sourceSyncMutation.isPending;

  return (
    <div className="de-partner-wizard wf-studio" data-testid="page-knowledge-source">
      <header className="de-partner-wizard__top">
        <div className="min-w-0">
          <Link to="/knowledge" className="de-partner-wizard__back"><ArrowLeft className="h-3.5 w-3.5" />返回知识中心</Link>
          <div className="mt-2 flex flex-wrap items-end gap-x-3">
            <h1>接入数据源</h1>
            <p>连接 Git / API / Webhook 后同步数据，产物进入所选知识包的加工与评测。</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pkg ? (
            <>
              <Badge tone="info">{pkg.name}</Badge>
              <Badge tone="neutral">{packageStatusLabel(pkg.status)}</Badge>
            </>
          ) : (
            <Badge tone="warn">请选择知识包</Badge>
          )}
        </div>
      </header>
      <div className="de-partner-wizard__body" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
        <section className="de-partner-wizard__main" style={{ overflow: 'auto', padding: 16 }}>
          <div className="mx-auto mb-4 max-w-4xl">
            <Field label="归属知识包" required>
              <select value={packageId} onChange={(event) => setPackageId(event.target.value)} className="de-employee-input h-9 w-full rounded-lg bg-[var(--bg)] px-2.5 text-xs">
                <option value="">请选择知识包</option>
                {c.knowledgePackages.map((item) => (
                  <option key={item.id} value={item.id}>{item.name} · {item.status === 'published' ? '已发布' : '草稿'}</option>
                ))}
              </select>
              {c.knowledgePackages.length === 0 && (
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  还没有知识包，请先 <Link className="text-[var(--brand)] underline" to="/knowledge/packages/new">新建知识包</Link>。
                </p>
              )}
            </Field>
          </div>
          <ConnectSourceFormView
            connecting={connecting}
            onSubmit={(form) => {
              if (!packageId) return;
              void c.connectSource(form).then((source) => {
                if (source) navigate(`/knowledge/packages/${encodeURIComponent(packageId)}?step=processing`);
              });
            }}
            footer={({ valid, submit }) => (
              <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
                <p className="max-w-sm text-[11px] leading-5 text-[var(--text-muted)]">
                  <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-[var(--brand)]" />
                  确认后进入该包「加工」。直接传文件请走目录的「上传内容」。
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => navigate('/knowledge')}>取消</Button>
                  <Button disabled={!valid || !packageId || connecting || !c.canWrite} onClick={submit}>
                    {connecting ? '接入中…' : '确认接入并进入加工'}
                  </Button>
                </div>
              </div>
            )}
          />
        </section>
      </div>
    </div>
  );
}
