import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ListTree, Minus, Plus, Type } from 'lucide-react';
import { Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { renderMarkdownDocument, type MarkdownOutlineItem } from './markdown-doc';

export type PaperWidth = 'comfortable' | 'standard' | 'wide';
export type PaperFontScale = 'sm' | 'md' | 'lg';

const WIDTH_CLASS: Record<PaperWidth, string> = {
  comfortable: 'is-width-comfortable',
  standard: 'is-width-standard',
  wide: 'is-width-wide',
};

const FONT_CLASS: Record<PaperFontScale, string> = {
  sm: 'is-font-sm',
  md: 'is-font-md',
  lg: 'is-font-lg',
};

function MarkdownArticle({ text }: { text?: string | null }) {
  const rendered = useMemo(() => renderMarkdownDocument(text), [text]);
  if (rendered.isEmpty) {
    return <div className="knowledge-paper-empty">暂无正文，请重新上传 Markdown / 纯文本文件。</div>;
  }
  if (rendered.isUploadStub) {
    return (
      <div className="knowledge-paper-empty is-warn">
        <p className="font-semibold text-[var(--text)]">未保存文件正文</p>
        <p className="mt-2 leading-relaxed">当前记录只有标题占位。请重新上传 `.md` / `.txt` 文件后再预览。</p>
      </div>
    );
  }
  return <article className="knowledge-md" dangerouslySetInnerHTML={{ __html: rendered.html }} />;
}

function OutlineNav({
  items,
  activeId,
  onSelect,
}: {
  items: MarkdownOutlineItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!items.length) {
    return <div className="knowledge-paper-toc__empty">暂无二级/三级标题</div>;
  }
  return (
    <nav className="knowledge-paper-toc__list" aria-label="文档目录">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={cn('knowledge-paper-toc__item', item.level === 3 && 'is-h3', activeId === item.id && 'is-active')}
          onClick={() => onSelect(item.id)}
        >
          {item.title}
        </button>
      ))}
    </nav>
  );
}

export function DocumentPaperPreview({
  content,
  editing,
  canWrite,
  metaLabel,
  onToggleEdit,
  onEditBlur,
}: {
  content?: string | null;
  editing: boolean;
  canWrite: boolean;
  metaLabel?: string;
  onToggleEdit: () => void;
  onEditBlur?: () => void;
}) {
  const [width, setWidth] = useState<PaperWidth>('wide');
  const [fontScale, setFontScale] = useState<PaperFontScale>('md');
  const [tocOpen, setTocOpen] = useState(true);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [showBackTop, setShowBackTop] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const outline = useMemo(() => renderMarkdownDocument(content).outline, [content]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const onScroll = () => setShowBackTop(root.scrollTop > 240);
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [editing]);

  const scrollToHeading = (id: string) => {
    const root = scrollRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!target) return;
    root.scrollTo({ top: Math.max(0, target.offsetTop - 24), behavior: 'smooth' });
    setActiveHeadingId(id);
  };

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const bumpFont = (delta: -1 | 1) => {
    const order: PaperFontScale[] = ['sm', 'md', 'lg'];
    const index = order.indexOf(fontScale);
    setFontScale(order[Math.min(order.length - 1, Math.max(0, index + delta))]!);
  };

  return (
    <section className="knowledge-doc-detail__reader knowledge-paper-reader">
      <div className="knowledge-doc-detail__reader-head knowledge-paper-toolbar">
        <div className="knowledge-doc-mode" role="tablist" aria-label="阅读模式">
          <button type="button" role="tab" aria-selected={!editing} className={cn(!editing && 'is-active')} onClick={() => editing && onToggleEdit()}>
            阅读
          </button>
          {canWrite && (
            <button type="button" role="tab" aria-selected={editing} className={cn(editing && 'is-active')} onClick={() => !editing && onToggleEdit()}>
              编辑
            </button>
          )}
        </div>

        <div className="knowledge-paper-toolbar__controls">
          {!editing && (
            <>
              <button
                type="button"
                className={cn('knowledge-paper-tool', tocOpen && 'is-active')}
                onClick={() => setTocOpen((open) => !open)}
                title="目录"
              >
                <ListTree className="h-3.5 w-3.5" />目录
              </button>
              <span className="knowledge-paper-tool-group" aria-label="字号">
                <button type="button" className="knowledge-paper-tool" disabled={fontScale === 'sm'} onClick={() => bumpFont(-1)} title="减小字号">
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="knowledge-paper-tool-label"><Type className="h-3 w-3" />字号</span>
                <button type="button" className="knowledge-paper-tool" disabled={fontScale === 'lg'} onClick={() => bumpFont(1)} title="增大字号">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </span>
              <span className="knowledge-paper-tool-group" role="group" aria-label="页宽">
                {([
                  ['comfortable', '舒适'],
                  ['standard', '适中'],
                  ['wide', '宽'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={cn('knowledge-paper-tool', width === key && 'is-active')}
                    onClick={() => setWidth(key)}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </>
          )}
          {metaLabel && <span className="knowledge-paper-meta">{metaLabel}</span>}
        </div>
      </div>

      <div className={cn('knowledge-paper-stage', tocOpen && !editing && 'has-toc')}>
        {!editing && tocOpen && (
          <aside className="knowledge-paper-toc">
            <div className="knowledge-paper-toc__title">目录</div>
            <OutlineNav items={outline} activeId={activeHeadingId} onSelect={scrollToHeading} />
          </aside>
        )}

        <div ref={scrollRef} className="knowledge-doc-detail__reader-body knowledge-paper-scroll">
          <div className={cn('knowledge-paper-sheet', WIDTH_CLASS[width], FONT_CLASS[fontScale], editing && 'is-editing')}>
            {editing ? (
              <textarea
                key={content?.slice(0, 24) ?? 'empty'}
                defaultValue={content ?? ''}
                className="knowledge-doc-editor"
                spellCheck={false}
                onBlur={onEditBlur}
                aria-label="编辑文档正文"
              />
            ) : (
              <MarkdownArticle text={content} />
            )}
          </div>
        </div>
      </div>

      {showBackTop && !editing && (
        <Button size="sm" variant="secondary" className="knowledge-paper-backtop" onClick={scrollToTop}>
          <ArrowUp className="h-3.5 w-3.5" />回到顶部
        </Button>
      )}
    </section>
  );
}
