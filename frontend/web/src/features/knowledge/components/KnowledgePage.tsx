/**
 * 知识中心目录：知识包发现；上传与详情走独立页。
 */
import { useNavigate } from 'react-router-dom';
import { BookOpen, Database, Plus, Upload } from 'lucide-react';
import { Badge } from '@qzda/web-ui';
import { RoleReadonlyBanner } from '@/components/shared';
import { useKnowledgeController } from './useKnowledgeController';
import { KnowledgeTabPackages } from './KnowledgeTab.Packages';
import { KnowledgeModals } from './KnowledgeModals';

export function KnowledgePage() {
  const c = useKnowledgeController();
  const navigate = useNavigate();
  const unassigned = c.docs.filter((doc) => !doc.packageId);
  return (
    <div className="knowledge-page de-employee-page flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5" data-testid="page-knowledge">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <section className="de-employee-shell shrink-0 overflow-hidden rounded-xl bg-[var(--surface-1)]">
          <div className="flex items-start justify-between gap-4 px-4 py-3.5 md:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg">
                  <BookOpen className="h-4 w-4" />
                </div>
                <h1 className="text-base font-semibold text-[var(--text)]">{c.pageCopy.title}</h1>
              </div>
              <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{c.pageCopy.subtitle}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Badge tone="info">{c.workspaceName}</Badge>
              {!c.canWrite && <Badge tone="neutral">只读</Badge>}
              {c.canWrite && (
                <>
                  <button type="button" className="de-employee-btn" onClick={() => navigate('/knowledge/packages/new')}>
                    <Plus className="h-3.5 w-3.5" />新建知识包
                  </button>
                  <button type="button" className="de-employee-btn" onClick={() => navigate('/knowledge/sources/new')}>
                    <Database className="h-3.5 w-3.5" />接入数据源
                  </button>
                  <button type="button" className="de-employee-btn de-employee-btn--primary" onClick={() => navigate('/knowledge/new')}>
                    <Upload className="h-3.5 w-3.5" />上传内容
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="px-4 md:px-5">
            <RoleReadonlyBanner className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]" />
          </div>
        </section>

        {unassigned.length > 0 && (
          <div className="knowledge-package-strip" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span className="text-[11px] text-[var(--text-secondary)]">
              <strong className="text-[var(--warning)]">{unassigned.length}</strong> 篇尚未纳入知识包
            </span>
            {unassigned.slice(0, 6).map((doc) => (
              <button
                key={doc.id}
                type="button"
                className="wf-tpl-tag"
                onClick={() => navigate(`/knowledge/docs/${encodeURIComponent(doc.id)}`)}
              >
                {doc.title}
              </button>
            ))}
            {unassigned.length > 6 && <span className="text-[10px] text-[var(--text-muted)]">等 {unassigned.length} 篇</span>}
          </div>
        )}

        <div className="wf-page__body min-h-0 flex-1 overflow-hidden">
          <div className="de-employee-shell h-full min-h-0 overflow-y-auto rounded-xl bg-[var(--surface-1)]">
            <KnowledgeTabPackages c={c} />
          </div>
        </div>
      </div>
      <KnowledgeModals c={c} />
    </div>
  );
}

export default KnowledgePage;
