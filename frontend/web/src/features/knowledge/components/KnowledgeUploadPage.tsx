/**
 * 上传内容入口：直接上传文件到知识包，随后进入加工 → 评测 → 图谱 → 版本。
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { Field } from './KnowledgeShared';
import { KnowledgeUploadForm } from './KnowledgeUploadForm';
import { useKnowledgeController } from './useKnowledgeController';
import { roleCanMutate } from '@/features/role-nav/role-nav';
import { useAuthStore } from '@/stores/authStore';
import { packageStatusLabel } from '@/features/knowledge/knowledge-ui';

export default function KnowledgeUploadPage() {
  const c = useKnowledgeController();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const canWrite = roleCanMutate(useAuthStore((s) => s.user?.role)) && c.canWrite;
  const [packageId, setPackageId] = useState(params.get('package') ?? '');
  const packages = useMemo(() => c.knowledgePackages, [c.knowledgePackages]);
  const pkg = packages.find((item) => item.id === packageId) ?? null;

  return (
    <div className="de-partner-wizard wf-studio" data-testid="page-knowledge-upload">
      <header className="de-partner-wizard__top">
        <div className="min-w-0">
          <Link to="/knowledge" className="de-partner-wizard__back"><ArrowLeft className="h-3.5 w-3.5" />返回知识中心</Link>
          <div className="mt-2 flex flex-wrap items-end gap-x-3">
            <h1>上传内容</h1>
            <p>直接上传文件纳入知识包，提交后进入该包的加工、评测、图谱与版本。</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!canWrite && <Badge tone="neutral">只读</Badge>}
          {pkg && <Badge tone="info">{pkg.name} · {packageStatusLabel(pkg.status)}</Badge>}
        </div>
      </header>
      <div className="de-partner-wizard__body" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
        <section className="de-partner-wizard__main" style={{ overflow: 'auto', padding: 20 }}>
          <div className="mx-auto grid max-w-4xl gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
            <div className="space-y-4">
              <Field label="归属知识包" required>
                <select value={packageId} onChange={(event) => setPackageId(event.target.value)} className="de-employee-input h-9 w-full rounded-lg bg-[var(--bg)] px-2.5 text-xs">
                  <option value="">请选择知识包</option>
                  {packages.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status === 'published' ? '已发布' : '草稿'}</option>)}
                </select>
                {packages.length === 0 && (
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                    还没有知识包，请先 <Link className="text-[var(--brand)] underline" to="/knowledge/packages/new">新建知识包</Link>。
                  </p>
                )}
              </Field>
              <KnowledgeUploadForm
                canWrite={canWrite && Boolean(packageId)}
                submitting={c.uploadMutation.isPending}
                submitLabel="提交并进入加工"
                onSubmit={(payload) => {
                  if (!packageId) return;
                  c.handleUploadDoc({ ...payload, packageId });
                }}
              />
              <Button variant="ghost" onClick={() => navigate('/knowledge')}>取消</Button>
            </div>
            <aside className="knowledge-source-summary">
              <div className="knowledge-source-summary__title">本入口之后</div>
              <dl>
                <div><dt>入口</dt><dd>直接上传文件</dd></div>
                <div><dt>知识包</dt><dd>{pkg?.name ?? '未选择'}</dd></div>
                <div><dt>02</dt><dd>加工</dd></div>
                <div><dt>03</dt><dd>检索评测</dd></div>
                <div><dt>04</dt><dd>知识图谱</dd></div>
                <div><dt>05</dt><dd>版本与引用</dd></div>
              </dl>
              <p className="mt-3 text-[11px] leading-5 text-[var(--text-muted)]">
                <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-[var(--brand)]" />
                提交后打开知识包「加工」。同步类入站请走目录的「接入数据源」。
              </p>
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}
