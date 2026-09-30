import { useMemo, useState } from 'react';
import { Badge, Button, Input } from '@qzda/web-ui';
import { Boxes, FileText, Layers, PlayCircle, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react';
import type { KnowledgeDoc, KnowledgePackage } from '@qzda/web-types';
import { cn } from '@qzda/web-utils';
import { ConfirmDialog, EmptyState, Modal } from '@/components/shared';
import {
  packageReadyToPublish,
  packageStatusLabel,
  packageStatusTone,
} from '@/features/knowledge/knowledge-ui';

type PackageStatusFilter = 'all' | KnowledgePackage['status'];

export function PackageWorkbench({
  packages,
  docs,
  canWrite,
  highlightedPackageId,
  busy,
  onCreate,
  onOpenDoc,
  onProcess,
  onPublish,
  onAttach,
  onDelete,
  onViewBindings,
}: {
  packages: KnowledgePackage[];
  docs: KnowledgeDoc[];
  canWrite: boolean;
  highlightedPackageId?: string | null;
  busy?: boolean;
  onCreate: () => void;
  onOpenDoc: (docId: string) => void;
  onProcess: (pkg: KnowledgePackage) => void;
  onPublish: (pkg: KnowledgePackage) => void;
  onAttach: (pkg: KnowledgePackage, docIds: string[]) => void;
  onDelete: (pkg: KnowledgePackage) => void;
  onViewBindings: () => void;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PackageStatusFilter>('all');
  const [activeId, setActiveId] = useState<string | null>(highlightedPackageId ?? null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgePackage | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return packages.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (!q) return true;
      return [item.name, item.description, item.domain, item.owner].some((value) => value.toLowerCase().includes(q));
    });
  }, [packages, search, statusFilter]);

  const active = packages.find((item) => item.id === activeId) ?? null;
  const memberDocs = useMemo(() => {
    if (!active) return [];
    const ids = new Set(active.documentIds ?? []);
    return docs.filter((doc) => ids.has(doc.id) || doc.packageId === active.id);
  }, [active, docs]);

  const attachCandidates = useMemo(() => {
    if (!active) return [];
    const owned = new Set(active.documentIds ?? []);
    return docs.filter((doc) => !owned.has(doc.id) && doc.packageId !== active.id);
  }, [active, docs]);

  const requestDelete = (pkg: KnowledgePackage) => {
    setDeleteTarget(pkg);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    if (activeId === target.id) {
      setActiveId(null);
      setAttachOpen(false);
    }
    onDelete(target);
  };

  return (
    <>
      <div className="knowledge-package-toolbar px-5 py-4 md:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 max-w-xl">
            <h2 className="text-sm font-semibold text-[var(--text)]">知识包交付</h2>
            <p className="mt-1.5 text-xs leading-5 text-[var(--text-muted)]">
              以稳定版本、检索策略和权限范围向智能体与工作流交付知识能力。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
              <Input
                placeholder="搜索名称、域、责任人…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="de-employee-input h-8 w-48 bg-[var(--bg)] pl-8 text-xs md:w-56"
              />
            </div>
            <div className="knowledge-filter-group" role="group" aria-label="知识包状态">
              {([
                ['all', '全部'],
                ['draft', '草稿'],
                ['review', '加工中'],
                ['published', '已发布'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  className={cn(statusFilter === value && 'is-active')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="p-8">
          <EmptyState
            icon={Boxes}
            title={packages.length === 0 ? '暂无知识包' : '没有匹配的知识包'}
            description={packages.length === 0 ? '将运营完成的内容打包为可版本化、可授权的交付单元。' : '尝试清除筛选，或新建知识包。'}
            action={canWrite ? <Button size="sm" onClick={onCreate}><Plus className="h-3.5 w-3.5" />新建知识包</Button> : undefined}
          />
        </div>
      ) : (
        <div className="knowledge-package-grid">
          {filtered.map((item) => {
            const publishGate = packageReadyToPublish(item);
            const deleteBlocked = (item.consumers ?? 0) > 0;
            return (
              <article
                key={item.id}
                className={cn('knowledge-package-card group', (highlightedPackageId === item.id || activeId === item.id) && 'is-active')}
                role="button"
                tabIndex={0}
                onClick={() => setActiveId(item.id)}
                onKeyDown={(event) => event.key === 'Enter' && setActiveId(item.id)}
              >
                <div className="knowledge-package-card__head">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold leading-5 text-[var(--text)]">{item.name}</div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <Badge tone={packageStatusTone(item.status)}>{packageStatusLabel(item.status)}</Badge>
                      <Badge tone="neutral">{item.currentVersion.version}</Badge>
                      <Badge tone="info">{item.classification === 'restricted' ? '受限' : item.classification === 'confidential' ? '机密' : '内部'}</Badge>
                    </div>
                  </div>
                  <span className="knowledge-package-card__icon"><Boxes className="h-3.5 w-3.5" /></span>
                </div>

                <p className="knowledge-package-card__desc">{item.description || '暂无说明'}</p>

                <div className="knowledge-package-card__stats">
                  <span><strong>{item.documentCount}</strong><small>资产</small></span>
                  <span><strong>{item.currentVersion.qualityScore || '—'}%</strong><small>质量</small></span>
                  <span><strong>{item.consumers}</strong><small>引用方</small></span>
                </div>

                <div className="knowledge-package-card__meta">
                  <span className="truncate">{item.domain} · {item.owner}</span>
                  <span className="truncate font-mono text-[10px]">{item.currentVersion.indexVersion}</span>
                </div>

                <div className="knowledge-package-card__actions" onClick={(event) => event.stopPropagation()}>
                  {item.status === 'published' ? (
                    <button type="button" className="knowledge-package-card__link" onClick={onViewBindings}>查看引用</button>
                  ) : canWrite ? (
                    <button
                      type="button"
                      className="knowledge-package-card__link"
                      disabled={busy || !publishGate.ok}
                      title={publishGate.reason}
                      onClick={() => onPublish(item)}
                    >
                      发布
                    </button>
                  ) : null}
                  {canWrite && (
                    <button
                      type="button"
                      className="knowledge-package-card__link"
                      disabled={busy}
                      onClick={() => { setActiveId(item.id); setAttachOpen(true); }}
                    >
                      纳管
                    </button>
                  )}
                  {canWrite && (
                    <button
                      type="button"
                      className="knowledge-package-card__link is-danger"
                      disabled={busy || deleteBlocked}
                      title={deleteBlocked ? '仍有引用方，无法删除' : '删除知识包'}
                      onClick={() => requestDelete(item)}
                    >
                      删除
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(active)}
        onClose={() => { setActiveId(null); setAttachOpen(false); }}
        title={active?.name ?? '知识包'}
        description={active ? `${active.domain} · ${packageStatusLabel(active.status)} · ${active.currentVersion.version}` : undefined}
        size="lg"
        closeOnEscape={!attachOpen && !deleteTarget}
        closeOnBackdrop={!attachOpen && !deleteTarget}
        bodyClassName="knowledge-package-detail-body"
        panelClassName="knowledge-package-detail-modal"
        footer={active ? (
          <div className="knowledge-package-detail-footer">
            <div className="knowledge-package-detail-footer__secondary">
              <Button variant="ghost" onClick={() => setActiveId(null)}>关闭</Button>
              {canWrite && (
                <Button
                  variant="danger"
                  disabled={busy || (active.consumers ?? 0) > 0}
                  title={(active.consumers ?? 0) > 0 ? '仍有引用方，无法删除' : undefined}
                  onClick={() => requestDelete(active)}
                >
                  <Trash2 className="h-3.5 w-3.5" />删除
                </Button>
              )}
            </div>
            {canWrite && (
              <div className="knowledge-package-detail-footer__primary">
                {memberDocs.length > 0 && (
                  <Button variant="secondary" disabled={busy} onClick={() => setAttachOpen(true)}>
                    <Plus className="h-3.5 w-3.5" />纳管文档
                  </Button>
                )}
                <Button
                  variant="secondary"
                  disabled={busy || !(active.documentIds?.length || active.documentCount)}
                  onClick={() => onProcess(active)}
                >
                  <Layers className="h-3.5 w-3.5" />启动加工
                </Button>
                {active.status === 'published' ? (
                  <Button onClick={onViewBindings}><ShieldCheck className="h-3.5 w-3.5" />查看引用</Button>
                ) : (
                  <Button
                    disabled={busy || !packageReadyToPublish(active).ok}
                    title={packageReadyToPublish(active).reason}
                    onClick={() => onPublish(active)}
                  >
                    <PlayCircle className="h-3.5 w-3.5" />发布版本
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : undefined}
      >
        {active && (
          <div className="knowledge-package-detail">
            <p className="knowledge-package-detail__desc">{active.description || '暂无说明'}</p>

            <section className="knowledge-package-detail-stats" aria-label="知识包指标">
              <div><strong>{active.documentCount}</strong><small>纳管文档</small></div>
              <div><strong>{active.currentVersion.qualityScore || '—'}%</strong><small>质量分</small></div>
              <div><strong>{active.consumers}</strong><small>运行时引用</small></div>
              <div><strong className="is-mono-sm">{active.currentVersion.indexVersion}</strong><small>索引版本</small></div>
            </section>

            <div className="knowledge-package-detail__columns">
              <section className="knowledge-package-detail__panel">
                <div className="knowledge-package-detail__panel-head">
                  <h3>包内文档</h3>
                  <Badge tone="neutral">{memberDocs.length}</Badge>
                </div>
                {memberDocs.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title="尚未纳管文档"
                    description="先把内容文档纳入本包，才能加工与发布。"
                    action={canWrite ? <Button size="sm" onClick={() => setAttachOpen(true)}><Plus className="h-3.5 w-3.5" />纳管文档</Button> : undefined}
                  />
                ) : (
                  <div className="knowledge-package-detail__list">
                    {memberDocs.map((doc) => (
                      <button
                        key={doc.id}
                        type="button"
                        className="knowledge-package-member"
                        onClick={() => onOpenDoc(doc.id)}
                      >
                        <span className="min-w-0">
                          <strong className="block truncate">{doc.title}</strong>
                          <small>{doc.source} · {doc.status === 'ready' || doc.status === 'published' ? '已就绪' : doc.status === 'indexing' || doc.status === 'parsing' ? '索引中' : doc.status}</small>
                        </span>
                        <Badge tone="neutral">{doc.chunks} 切片</Badge>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="knowledge-package-detail__panel">
                <div className="knowledge-package-detail__panel-head">
                  <h3>版本历史</h3>
                  <Badge tone="neutral">{active.versions.length}</Badge>
                </div>
                <div className="knowledge-package-detail__list">
                  {active.versions.map((version) => (
                    <div key={version.id} className="knowledge-package-version">
                      <span className="min-w-0">
                        <strong className="font-mono">{version.version}</strong>
                        <small className="block">{version.changeSummary || '—'}</small>
                      </span>
                      <span className="text-right">
                        <Badge tone={packageStatusTone(version.status)}>{packageStatusLabel(version.status)}</Badge>
                        <small className="mt-1.5 block text-[11px] text-[var(--text-muted)]">
                          {version.publishedAt ? version.publishedAt.slice(0, 10) : version.indexVersion}
                        </small>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}
      </Modal>

      <AttachDocsModal
        open={attachOpen && Boolean(active)}
        onClose={() => setAttachOpen(false)}
        candidates={attachCandidates}
        busy={busy}
        onSubmit={(docIds) => {
          if (!active) return;
          onAttach(active, docIds);
          setAttachOpen(false);
        }}
      />

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
    </>
  );
}

function AttachDocsModal({
  open,
  onClose,
  candidates,
  onSubmit,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  candidates: KnowledgeDoc[];
  onSubmit: (docIds: string[]) => void;
  busy?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const visible = candidates.filter((doc) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return doc.title.toLowerCase().includes(q) || doc.source.toLowerCase().includes(q);
  });

  return (
    <Modal
      open={open}
      onClose={() => { setSelected([]); setQuery(''); onClose(); }}
      title="纳管文档到知识包"
      description="选择要纳入当前交付单元的内容文档。已发布知识包纳管后会回到「加工中」，需重新发布。"
      size="md"
      footer={(
        <>
          <Button variant="ghost" onClick={() => { setSelected([]); setQuery(''); onClose(); }}>取消</Button>
          <Button
            disabled={busy || selected.length === 0}
            onClick={() => {
              onSubmit(selected);
              setSelected([]);
              setQuery('');
            }}
          >
            纳管 {selected.length || ''} 篇
          </Button>
        </>
      )}
    >
      <div className="space-y-3">
        <Input placeholder="筛选标题或来源…" value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 text-xs" />
        {visible.length === 0 ? (
          <EmptyState icon={FileText} title="没有可纳管文档" description="当前工作区文档均已归属本包，或请先上传内容。" />
        ) : (
          <div className="max-h-[360px] space-y-1.5 overflow-y-auto">
            {visible.map((doc) => {
              const checked = selected.includes(doc.id);
              return (
                <label key={doc.id} className={cn('knowledge-package-attach-row', checked && 'is-active')}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setSelected((prev) => (checked ? prev.filter((id) => id !== doc.id) : [...prev, doc.id]))}
                  />
                  <span className="min-w-0">
                    <strong className="block truncate text-xs">{doc.title}</strong>
                    <small className="text-[10px] text-[var(--text-muted)]">{doc.source} · {doc.packageId ? `当前包 ${doc.packageId}` : '未归属'}</small>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
