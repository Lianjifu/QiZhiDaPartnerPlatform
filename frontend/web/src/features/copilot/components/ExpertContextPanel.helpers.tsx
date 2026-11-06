/**
 * ExpertContextPanel — helpers shared by the main panel and its sub-sections.
 * SOURCE_COLOR, Collapsible section, CapChips overflow render, MetaRow label/value, formatToken.
 *
 * 视觉口径：抽屉本身已经是一个面板，内部不再套卡片 —— 分段之间用一条 hairline 区分，
 * 避免"抽屉 → 卡片 → 内容格"三层框线叠在一起。
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, BriefcaseBusiness } from 'lucide-react';
import { cn } from '@qzda/web-utils';

export const SOURCE_COLOR: Record<string, string> = {
  知识库: 'text-[var(--brand)] bg-[var(--brand-light)]',
  文档: 'text-[var(--info)] bg-[var(--info-bg)]',
  记忆: 'text-[var(--success)] bg-[var(--success-bg)]',
};

export function Collapsible({
  title,
  icon: Icon,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: typeof BriefcaseBusiness;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cn('copilot-ecx-section', open && 'is-open')}>
      <button type="button" className="copilot-ecx-section__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="copilot-ecx-section__icon">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="copilot-ecx-section__title">{title}</span>
        {badge}
        <span className="copilot-ecx-section__chevron">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open ? <div className="copilot-ecx-section__body">{children}</div> : null}
    </section>
  );
}

/** 能力清单：默认只列前几项，"+N" 可点开看全部。 */
export function CapChips({ items, empty }: { items: string[]; empty: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return <p className="copilot-ecx-empty-inline">{empty}</p>;
  const limit = 6;
  const shown = expanded ? items : items.slice(0, limit);
  const rest = items.length - limit;
  return (
    <div className="copilot-ecx-chips">
      {shown.map((item) => <span key={item} title={item}>{item}</span>)}
      {rest > 0 ? (
        <button type="button" className="is-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起' : `+${rest} 项`}
        </button>
      ) : null}
    </div>
  );
}

/** 能力分组：一行小标题（工具 28）+ 能力 chip，比把三类混在一堆 chip 里好读。 */
export function CapGroup({ label, items, empty }: { label: string; items: string[]; empty: string }) {
  return (
    <div className="copilot-ecx-capgroup">
      <span className="copilot-ecx-capgroup__label">
        {label}
        {items.length > 0 ? <em>{items.length}</em> : null}
      </span>
      <CapChips items={items} empty={empty} />
    </div>
  );
}

export function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="copilot-ecx-meta__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function formatToken(n: number | null): string {
  if (n == null) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
