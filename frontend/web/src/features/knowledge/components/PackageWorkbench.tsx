import { useMemo, useState } from 'react';
import { ArrowRight, Boxes, Search, Trash2, X } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import type { KnowledgePackage } from '@qzda/web-types';
import { cn } from '@qzda/web-utils';
import { ConfirmDialog, EmptyState } from '@/components/shared';
import { packageStatusLabel, packageStatusTone } from '@/features/knowledge/knowledge-ui';

type PackageStatusFilter = 'all' | KnowledgePackage['status'];

const PAGE_SIZE = 12;

export function PackageWorkbench({
  packages,
  canWrite,
  highlightedPackageId,
  busy,
  onCreate,
  onOpenPackage,
  onDelete,
}: {
  packages: KnowledgePackage[];
  canWrite: boolean;
  highlightedPackageId?: string | null;
  busy?: boolean;
  onCreate: () => void;
  onOpenPackage: (pkg: KnowledgePackage) => void;
  onDelete: (pkg: KnowledgePackage) => void;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PackageStatusFilter>('all');
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgePackage | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return packages.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (!q) return true;
      return [item.name, item.description, item.domain, item.owner].some((value) => value.toLowerCase().includes(q));
    });
  }, [packages, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    onDelete(target);
  };

  return (
    <div className="wf-tpl-page">
      <div className="wf-tpl-toolbar">
        <div className="wf-tpl-toolbar__row">
          <div className="wf-tpl-search">
            <Search className="h-3.5 w-3.5" />
            <input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="搜索名称、域、责任人"
              aria-label="搜索知识包"
            />
            {search && (
              <button type="button" className="wf-tpl-search__clear" onClick={() => setSearch('')} aria-label="清除搜索">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="wf-tpl-toolbar__filters">
            {([
              ['all', '全部'],
              ['draft', '草稿'],
              ['review', '加工中'],
              ['published', '已发布'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={cn('wf-tpl-toggle', statusFilter === value && 'is-on')}
                onClick={() => { setStatusFilter(value); setPage(1); }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="wf-tpl-empty">
          <Boxes className="h-8 w-8 text-[var(--text-muted)]" />
          <p className="wf-tpl-empty__title">{packages.length === 0 ? '暂无知识包' : '没有匹配的知识包'}</p>
          <p className="wf-tpl-empty__desc">{packages.length === 0 ? '把内容纳入可版本化的知识包后，再加工、评测并交付给数字伙伴。' : '调整关键词或状态后再试。'}</p>
          {canWrite && packages.length === 0 && (
            <div className="mt-4"><Button size="sm" onClick={onCreate}>新建知识包</Button></div>
          )}
        </div>
      ) : (
        <>
          <div className="wf-tpl-pagebar"><span>共 {filtered.length} 个知识包</span></div>
          <div className="wf-tpl-grid">
            {paged.map((item) => {
              const deleteBlocked = (item.consumers ?? 0) > 0 || item.status === 'published';
              return (
                <article
                  key={item.id}
                  className={cn('wf-tpl-card group', highlightedPackageId === item.id && 'is-active')}
                  role="link"
                  tabIndex={0}
                  aria-label={`打开知识包「${item.name}」`}
                  onClick={() => onOpenPackage(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpenPackage(item);
                    }
                  }}
                >
                  <header className="wf-tpl-card__head">
                    <div className="min-w-0 flex-1">
                      <h3 className="wf-tpl-card__title" title={item.name}>{item.name}</h3>
                      <p className="wf-tpl-card__meta">
                        <span>{item.domain}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.owner}</span>
                      </p>
                    </div>
                    <Badge tone={packageStatusTone(item.status)}>{packageStatusLabel(item.status)}</Badge>
                  </header>
                  <p className="wf-tpl-card__desc">{item.description || '暂无说明'}</p>
                  <div className="wf-tpl-card__stats">
                    <span>{item.currentVersion.version}</span>
                    <span>{item.documentCount} 篇</span>
                    <span>{item.consumers} 引用</span>
                  </div>
                  <footer className="wf-tpl-card__foot">
                    {canWrite && !deleteBlocked ? (
                      <button
                        type="button"
                        className="wf-tpl-ghost wf-tpl-ghost--danger"
                        disabled={busy}
                        onClick={(event) => { event.stopPropagation(); setDeleteTarget(item); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />删除
                      </button>
                    ) : (
                      <span className="wf-tpl-card__owner">{item.classification === 'restricted' ? '受限' : item.classification === 'confidential' ? '机密' : '内部'}</span>
                    )}
                    <span className="wf-tpl-card__go">打开知识包<ArrowRight className="h-3.5 w-3.5" /></span>
                  </footer>
                </article>
              );
            })}
          </div>
          {totalPages > 1 && (
            <nav className="wf-tpl-pager" aria-label="知识包分页">
              <Button size="sm" variant="secondary" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</Button>
              <div className="wf-tpl-pager__pages">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" className={cn('wf-tpl-pager__btn', n === safePage && 'is-active')} onClick={() => setPage(n)}>{n}</button>
                ))}
              </div>
              <Button size="sm" variant="secondary" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>下一页</Button>
            </nav>
          )}
        </>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => { if (!busy) setDeleteTarget(null); }}
        onConfirm={confirmDelete}
        tone="danger"
        title="删除知识包？"
        description={deleteTarget
          ? `将删除「${deleteTarget.name}」及其版本记录；包内文档会保留并解除归属，不会一并删除正文。`
          : undefined}
        confirmText={busy ? '删除中…' : '删除'}
      />
    </div>
  );
}
