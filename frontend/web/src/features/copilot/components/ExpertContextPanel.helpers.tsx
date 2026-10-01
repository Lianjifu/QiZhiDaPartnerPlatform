/**
 * ExpertContextPanel — helpers shared by the main panel and its sub-sections.
 * SOURCE_COLOR, Collapsible card, CapChips overflow render, MetaRow label/value, formatToken.
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
    <section className={cn('copilot-ecx-card', open && 'is-open')}>
      <button type="button" className="copilot-ecx-card__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="copilot-ecx-card__icon">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="copilot-ecx-card__title">{title}</span>
        {badge}
        <span className="copilot-ecx-card__chevron">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open ? <div className="copilot-ecx-card__body">{children}</div> : null}
    </section>
  );
}

export function CapChips({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="copilot-ecx-empty-inline">{empty}</p>;
  const shown = items.slice(0, 6);
  const rest = items.length - shown.length;
  return (
    <div className="copilot-ecx-chips">
      {shown.map((item) => <span key={item}>{item}</span>)}
      {rest > 0 ? <span className="is-more">+{rest}</span> : null}
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