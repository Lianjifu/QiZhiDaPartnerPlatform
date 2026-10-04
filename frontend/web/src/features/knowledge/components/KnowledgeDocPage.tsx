/**
 * 知识文档详情：正文、加工、图谱、检索。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, Hash, Pencil, Trash2 } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { useKnowledgeController } from './useKnowledgeController';
import { KnowledgeModals } from './KnowledgeModals';
import { KnowledgeTabJobs } from './KnowledgeTab.Jobs';
import { KnowledgeTabEval } from './KnowledgeTab.Eval';
import { DocumentPaperPreview } from './DocumentPaperPreview';
import { QualityBar } from './KnowledgeShared';
import { KnowledgeStudioRail } from './KnowledgeStudioRail';
import { docQualityBarValue, formatDocQualityAverage } from '@/features/knowledge/knowledge-ui';

type DocStep = 'content' | 'processing' | 'graph' | 'retrieval';
const STEPS: Array<{ key: DocStep; index: string; label: string; hint: string }> = [
  { key: 'content', index: '01', label: '内容', hint: '正文与元数据' },
  { key: 'processing', index: '02', label: '加工', hint: '切片与索引' },
  { key: 'graph', index: '03', label: '图谱', hint: '实体与关系' },
  { key: 'retrieval', index: '04', label: '检索', hint: '证据验证' },
];

function parseStep(raw: string | null): DocStep {
  if (raw === 'processing' || raw === 'graph' || raw === 'retrieval') return raw;
  return 'content';
}

export default function KnowledgeDocPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const c = useKnowledgeController();
  const step = parseStep(params.get('step'));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!id) return;
    c.setDocPreviewId(id);
    setReady(true);
  }, [c.setDocPreviewId, id]);

  const listDoc = c.docs.find((item) => item.id === id);
  const detail = c.docDetail && c.docPreviewId === id ? c.docDetail : listDoc;
  const pkg = c.knowledgePackages.find((item) => item.id === (detail?.packageId ?? listDoc?.packageId));
  const go = (next: DocStep) => setParams(next === 'content' ? {} : { step: next }, { replace: true });

  const jobsForDoc = useMemo(
    () => c.processingJobs.filter((job) => job.source === detail?.title || job.source === listDoc?.title || (pkg && job.packageId === pkg.id)),
    [c.processingJobs, detail?.title, listDoc?.title, pkg],
  );

  return (
    <div className="de-partner-wizard wf-studio" data-testid="page-knowledge-doc">
      <header className="de-partner-wizard__top">
        <div className="min-w-0">
          <Link to={pkg ? `/knowledge/packages/${encodeURIComponent(pkg.id)}` : '/knowledge'} className="de-partner-wizard__back"><ArrowLeft className="h-3.5 w-3.5" />{pkg ? `返回「${pkg.name}」` : '返回知识中心'}</Link>
          <div className="mt-2 flex flex-wrap items-end gap-x-3">
            <h1>{detail?.title ?? '文档详情'}</h1>
            <p>{detail?.source ?? ''}{pkg ? ` · 归属 ${pkg.name}` : ' · 未归包'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {detail?.status && <Badge tone={detail.status === 'ready' || detail.status === 'published' ? 'success' : 'warn'}>{detail.status === 'ready' || detail.status === 'published' ? '已就绪' : '索引中'}</Badge>}
          {pkg && <Button size="sm" variant="outline" onClick={() => navigate(`/knowledge/packages/${encodeURIComponent(pkg.id)}`)}>打开知识包</Button>}
          <Button size="sm" variant="outline" onClick={c.downloadOriginal} disabled={!c.docDetail}><Download className="h-3.5 w-3.5" />下载原文</Button>
        </div>
      </header>
      <div className="de-partner-wizard__body">
        <KnowledgeStudioRail
          label="文档详情分段"
          current={step}
          onSelect={go}
          steps={STEPS}
        />
        <section className={cn('de-partner-wizard__main', 'wf-studio__main')}>
          <div className="h-full min-h-0 overflow-y-auto p-4">
          {step === 'content' && (
            !ready || (!detail && !c.docDetail) ? (
              <div className="grid h-40 place-items-center text-xs text-[var(--text-muted)]">加载文档内容中…</div>
            ) : (
              <div className="knowledge-doc-detail" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 240px', gap: 16 }}>
                <DocumentPaperPreview
                  content={c.docDetail?.content ?? ''}
                  editing={c.editingContent}
                  canWrite={c.canWrite}
                  metaLabel={`${detail?.sizeKb ?? '—'} KB · ${detail?.chunks ?? 0} 切片`}
                  onToggleEdit={() => c.setEditingContent((editing) => !editing)}
                  onEditBlur={() => c.setGovernanceNotice(`内容「${detail?.title}」编辑草稿已更新。`)}
                />
                <aside className="knowledge-doc-detail__aside">
                  <section className="knowledge-doc-stat-strip">
                    <div><strong>{formatDocQualityAverage(c.docDetail?.quality)}</strong><small>综合质量</small></div>
                    <div><strong className="font-mono">{detail?.citeCount ?? 0}</strong><small>运行引用</small></div>
                    <div><strong className="font-mono">{detail?.chunks ?? 0}</strong><small>切片数</small></div>
                  </section>
                  <section className="knowledge-doc-meta">
                    <div className="knowledge-doc-meta__title">内容质量</div>
                    <div className="mt-3 space-y-2.5">
                      <QualityBar label="完整度" value={docQualityBarValue(c.docDetail?.quality?.completeness)} />
                      <QualityBar label="时效性" value={docQualityBarValue(c.docDetail?.quality?.freshness)} />
                      <QualityBar label="引用正确率" value={docQualityBarValue(c.docDetail?.quality?.citationAccuracy)} />
                    </div>
                  </section>
                  {c.canWrite && (
                    <div className="mt-3 flex flex-col gap-2">
                      <Button variant={c.editingContent ? 'secondary' : 'primary'} onClick={() => c.setEditingContent((v) => !v)}><Pencil className="h-3.5 w-3.5" />{c.editingContent ? '退出编辑' : '编辑内容'}</Button>
                      <Button variant="secondary" disabled={!c.topChunks.length} onClick={() => c.setChunkDrawer(c.topChunks[0])}><Hash className="h-3.5 w-3.5" />关联切片</Button>
                      <Button variant="danger" onClick={() => c.requestDeleteDocs([id])}><Trash2 className="h-3.5 w-3.5" />删除</Button>
                    </div>
                  )}
                </aside>
              </div>
            )
          )}
          {step === 'processing' && (
            <div>
              <p className="mb-3 text-xs text-[var(--text-muted)]">本篇相关加工 {jobsForDoc.length} 条。新增文件或数据源请从知识中心入口进入。</p>
              <KnowledgeTabJobs
                c={c}
                packageId={pkg?.id}
                jobs={jobsForDoc}
                onGoEval={() => go('retrieval')}
              />
            </div>
          )}
          {step === 'graph' && <KnowledgeTabEval c={c} mode="graph" sourceDocIds={[id]} />}
          {step === 'retrieval' && <KnowledgeTabEval c={c} mode="retrieval" sourceDocIds={[id]} />}
          </div>
        </section>
      </div>
      <KnowledgeModals c={c} />
    </div>
  );
}
