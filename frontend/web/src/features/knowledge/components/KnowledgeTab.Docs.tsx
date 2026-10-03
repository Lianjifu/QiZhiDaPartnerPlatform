/**
 * 知识中心 · 内容文档 tab（M07 P1 拆分）。
 *
 * 资产区的「内容文档」视图：搜索 / 状态 / 来源筛选 + 批量操作 + 分页表格；
 * 单文档阅读器（详情弹层）由 KnowledgeModals.DocDetail 承担，避免本文件超 400L。
 */
import { Boxes, ChevronRight, Eye, FileText, Search, ShieldCheck, Tag as TagIcon, Trash2, Upload as UploadIcon } from 'lucide-react';
import { Badge, Button, Input } from '@qzda/web-ui';
import { EmptyState } from '@/components/shared';
import { cn } from '@qzda/web-utils';
import { CONTENT_PAGE_SIZE, docOwnerLabel, docVersionFromTitle } from './KnowledgeShared';
import type { KnowledgeController } from './useKnowledgeController';

export function KnowledgeTabDocs({ c }: { c: KnowledgeController }) {
  return (
    <>
      {c.knowledgePackages.length > 0 && (
        <button type="button" className="knowledge-package-strip" onClick={() => c.setAssetsView('packages')}>
          <span className="flex min-w-0 items-center gap-2">
            <Boxes className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
            <span className="truncate text-[11px] text-[var(--text-secondary)]">
              <strong className="font-semibold text-[var(--text)]">{c.publishedPackageCount}</strong> 个已发布知识包
              {c.pendingPackageCount > 0 && (
                <> · <strong className="font-semibold text-[var(--warning)]">{c.pendingPackageCount}</strong> 个待发布</>
              )}
              <span className="text-[var(--text-muted)]"> · 向智能体与工作流交付稳定版本</span>
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-[var(--brand)]">
            管理知识包 <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </button>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-3 md:px-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">内容列表</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">按来源、生命周期与检索影响持续运营企业知识内容。</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input
              placeholder="搜索标题、来源…"
              value={c.searchQ}
              onChange={(event) => { c.setSearchQ(event.target.value); c.setContentPage(1); }}
              className="de-employee-input h-8 w-48 bg-[var(--bg)] pl-8 text-xs md:w-56"
            />
          </div>
          <div className="knowledge-filter-group" role="group" aria-label="状态筛选">
            {(['all', 'ready', 'indexing'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => { c.setStatusFilter(status); c.setContentPage(1); }}
                className={cn(c.statusFilter === status && 'is-active')}
              >
                {status === 'all' ? '全部' : status === 'ready' ? '已就绪' : '索引中'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-y border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2.5 md:px-5">
        <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">来源</span>
        <button
          type="button"
          onClick={() => { c.setTagFilter(null); c.setContentPage(1); }}
          className={cn('knowledge-source-chip', !c.tagFilter && 'is-active')}
        >全部</button>
        {c.allTags.map((source) => (
          <button
            key={`source:${source}`}
            type="button"
            onClick={() => { c.setTagFilter(c.tagFilter === source ? null : source); c.setContentPage(1); }}
            className={cn('knowledge-source-chip', c.tagFilter === source && 'is-active')}
          >
            <TagIcon className="h-3 w-3" />{source}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-[var(--text-muted)]">共 {c.filteredDocs.length} 条</span>
      </div>

      {c.selectedCount > 0 && c.canWrite && (
        <div className="knowledge-bulk-bar mx-4 mt-3 md:mx-5">
          <span>已选择 {c.selectedCount} 项资产</span>
          <Button size="sm" variant="secondary" disabled={c.reviewMutation.isPending} onClick={() => c.reviewMutation.mutate({ ids: c.selectedDocumentIds })}>
            <ShieldCheck className="h-3 w-3" />{c.reviewMutation.isPending ? '提交中…' : '发起复核'}
          </Button>
          <Button size="sm" variant="danger" disabled={c.deleteDocsMutation.isPending} onClick={() => c.requestDeleteDocs(c.selectedDocumentIds)}>
            <Trash2 className="h-3 w-3" />删除
          </Button>
          <Button size="sm" variant="secondary" onClick={() => c.setSelectedDocumentIds([])}>取消选择</Button>
        </div>
      )}

      {c.filteredDocs.length === 0 ? (
        <div className="p-6">
          <EmptyState
            icon={FileText}
            title="没有匹配的内容"
            description="尝试清除筛选条件，或上传新的企业知识文档。"
            action={c.canWrite ? (
              <Button size="sm" onClick={() => c.setActiveModal('upload')}>
                <UploadIcon className="h-3.5 w-3.5" />上传文档
              </Button>
            ) : undefined}
          />
        </div>
      ) : (
        <>
          <DocsTable c={c} />
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-[var(--text-muted)] md:px-5" style={{ boxShadow: 'inset 0 1px 0 rgba(15,23,42,0.06)' }}>
            <span>第 {c.activeContentPage} / {c.contentPageCount} 页 · 每页 {CONTENT_PAGE_SIZE} 条</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={c.activeContentPage === 1} onClick={() => c.setContentPage((page) => Math.max(1, page - 1))}>上一页</Button>
              <Button size="sm" variant="secondary" disabled={c.activeContentPage === c.contentPageCount} onClick={() => c.setContentPage((page) => Math.min(c.contentPageCount, page + 1))}>下一页</Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function DocsTable({ c }: { c: KnowledgeController }) {
  return (
    <div className="knowledge-asset-table knowledge-asset-table--flush">
      <div className="knowledge-asset-table__head">
        <span />
        <span>内容</span>
        <span>来源与状态</span>
        <span>质量与规模</span>
        <span>影响</span>
        <span>更新</span>
        <span className="text-right">操作</span>
      </div>
      {c.paginatedDocs.map((doc) => (
        <div
          key={doc.id}
          className={cn('knowledge-asset-row', doc.id === c.docPreviewId && c.showDetails && 'is-selected')}
          onClick={() => c.openDocument(doc.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => event.key === 'Enter' && c.openDocument(doc.id)}
        >
          <span>
            {c.canWrite && (
              <input
                type="checkbox"
                checked={c.selectedDocumentIds.includes(doc.id)}
                onClick={(event) => event.stopPropagation()}
                onChange={() => c.toggleDocument(doc.id)}
                aria-label={`选择 ${doc.title}`}
              />
            )}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2.5">
              <span className="knowledge-doc-icon"><FileText className="h-3.5 w-3.5" /></span>
              <span className="min-w-0">
                <strong className="block truncate text-[12px] text-[var(--text)]">{doc.title}</strong>
                <small>责任人 {docOwnerLabel(doc)} · {docVersionFromTitle(doc.title)}</small>
              </span>
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{doc.source}</Badge>
            <span className={cn('knowledge-status-dot', doc.status === 'ready' ? 'is-ready' : 'is-indexing')}>
              {doc.status === 'ready' ? '已就绪' : '索引中'}
            </span>
          </span>
          <span>
            <strong className="font-mono text-xs text-[var(--text)]">{doc.chunks}</strong>
            <small>{doc.sizeKb} KB · {doc.status === 'ready' ? '质量正常' : '等待构建'}</small>
          </span>
          <span>
            <strong className="font-mono text-xs text-[var(--text)]">{doc.citeCount}</strong>
            <small>引用次数</small>
          </span>
          <span className="text-[11px] tabular-nums text-[var(--text-secondary)]">{doc.updatedAt.slice(0, 10)}</span>
          <span className="knowledge-row-actions justify-self-end">
            <button
              type="button"
              className="knowledge-row-action"
              onClick={(event) => { event.stopPropagation(); c.openDocument(doc.id); }}
            >
              <Eye className="h-3.5 w-3.5" />详情
            </button>
            {c.canWrite && (
              <button
                type="button"
                className="knowledge-row-action is-danger"
                disabled={c.deleteDocsMutation.isPending}
                onClick={(event) => { event.stopPropagation(); c.requestDeleteDocs([doc.id]); }}
              >
                <Trash2 className="h-3.5 w-3.5" />删除
              </button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}