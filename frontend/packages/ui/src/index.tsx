/**
 * @qzda/web-ui — PSSP 设计系统组件库
 * 与 docs/视觉设计规范.md Token 对齐
 * 双主题自适应（light / dark）
 */
import { forwardRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@qzda/web-utils';

// ============ Button ============
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const btnBase =
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-all duration-200 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/30 focus-visible:ring-offset-1 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed active:translate-y-0 select-none whitespace-nowrap';

const btnVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--brand)] text-white border border-transparent shadow-[var(--shadow-sm)] ' +
    'hover:bg-[var(--brand-hover)] hover:shadow-[var(--shadow-md)] hover:-translate-y-px',
  secondary:
    'bg-[var(--bg-elevated)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg-hover)]',
  ghost: 'bg-transparent text-[var(--text)] hover:bg-[var(--bg-elevated)]',
  danger:
    'bg-[var(--danger)] text-white border border-transparent shadow-[var(--shadow-sm)] ' +
    'hover:bg-[#dc2626] hover:shadow-[var(--shadow-md)] hover:-translate-y-px',
  outline: 'border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:bg-[var(--bg-hover)] hover:-translate-y-px',
};

const btnSizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-3 text-[13px]',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-6 text-[15px]',
  icon: 'h-9 w-9',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(btnBase, btnVariants[variant], btnSizes[size], className)}
      {...rest}
    >
      {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

// ============ Card ============
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-sm transition-shadow duration-200 hover:shadow-md',
        className,
      )}
      {...rest}
    />
  ),
);
Card.displayName = 'Card';

export const CardHeader = ({ className, ...rest }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center justify-between border-b border-[var(--border)] px-5 py-4', className)} {...rest} />
);
export const CardTitle = ({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('text-base font-semibold text-[var(--text)] flex items-center gap-2', className)} {...rest} />
);
export const CardBody = ({ className, ...rest }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('p-5', className)} {...rest} />
);
export const CardFooter = ({ className, ...rest }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('border-t border-[var(--border)] px-5 py-3', className)} {...rest} />
);

// ============ Input ============
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3.5 text-sm text-[var(--text)]',
        'placeholder:text-[var(--text-muted)] transition-all duration-200',
        'focus:outline-none focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_var(--brand-light)]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
      {...rest}
    />
  ),
);
Input.displayName = 'Input';

// ============ Textarea ============
export const Textarea = forwardRef<HTMLTextAreaElement, HTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...rest }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2.5 text-sm text-[var(--text)]',
        'placeholder:text-[var(--text-muted)] transition-all duration-200',
        'focus:outline-none focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_var(--brand-light)]',
        className,
      )}
      {...rest}
    />
  ),
);
Textarea.displayName = 'Textarea';

// ============ Badge ============
export type BadgeTone = 'neutral' | 'success' | 'warn' | 'error' | 'info' | 'brand' | 'purple';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--bg-hover)] text-[var(--text-secondary)]',
  success: 'bg-[var(--success-bg)] text-[var(--success)]',
  warn: 'bg-[var(--warning-bg)] text-[var(--warning)]',
  error: 'bg-[var(--danger-bg)] text-[var(--danger)]',
  info: 'bg-[var(--info-bg)] text-[var(--info)]',
  brand: 'bg-[var(--brand-light)] text-[var(--brand)]',
  purple: 'bg-[var(--purple-bg)] text-[var(--purple)]',
};

export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium leading-none font-mono',
        badgeTones[tone],
        className,
      )}
      {...rest}
    />
  );
}

// ============ Tag (chip) ============
export function Tag({ children, onClose, className }: { children: ReactNode; onClose?: () => void; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-0.5 text-xs',
        className,
      )}
    >
      {children}
      {onClose && (
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]">
          ×
        </button>
      )}
    </span>
  );
}

// ============ Progress ============
export function Progress({ value, max = 100, tone = 'primary', className }: { value: number; max?: number; tone?: 'primary' | 'success' | 'warn' | 'error'; className?: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const color =
    tone === 'success'
      ? 'bg-gradient-to-r from-[var(--success)] to-[#059669]'
      : tone === 'warn'
        ? 'bg-gradient-to-r from-[var(--warning)] to-[#d97706]'
        : tone === 'error'
          ? 'bg-gradient-to-r from-[var(--danger)] to-[#dc2626]'
          : 'bg-gradient-to-r from-[var(--brand)] to-[var(--purple)]';
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded bg-[var(--bg-hover)]', className)}>
      <div className={cn('h-full transition-all duration-300 rounded', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ============ Separator ============
export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-[var(--border)]', className)} />;
}

// ============ Avatar ============
export function Avatar({ name, src, size = 28, className }: { name: string; src?: string; size?: number; className?: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initial = name?.[0]?.toUpperCase() ?? '?';
  const hue = Array.from(name || '').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
  const bg = `linear-gradient(135deg, hsl(${Math.abs(hue) % 360}, 65%, 55%), hsl(${(Math.abs(hue) + 60) % 360}, 65%, 50%))`;
  return (
    <div
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full text-white font-semibold shadow-sm', className)}
      style={{ width: size, height: size, background: bg, fontSize: size * 0.42 }}
    >
      {src && !imageFailed ? <img src={src} alt={name} onError={() => setImageFailed(true)} className="h-full w-full rounded-full object-cover" /> : initial}
    </div>
  );
}

// ============ Tabs ============
export interface TabItem {
  key: string;
  label: ReactNode;
  badge?: ReactNode;
}

export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (k: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex border-b border-[var(--border)] gap-1', className)}>
      {items.map((it) => {
        const active = value === it.key;
        return (
          <button
            key={it.key}
            onClick={() => onChange(it.key)}
            className={cn(
              'relative flex items-center gap-1.5 px-5 py-3 text-sm transition-colors duration-200',
              active
                ? 'text-[var(--brand)] font-semibold'
                : 'text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--bg-elevated)]',
            )}
          >
            {it.label}
            {it.badge}
            {active && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--brand)]" />}
          </button>
        );
      })}
    </div>
  );
}

// ============ Status Dot ============
export function Dot({ tone = 'success' }: { tone?: 'success' | 'warning' | 'danger' | 'idle' }) {
  const color =
    tone === 'success' ? 'bg-[var(--success)]'
    : tone === 'warning' ? 'bg-[var(--warning)]'
    : tone === 'danger' ? 'bg-[var(--danger)]'
    : 'bg-[var(--text-muted)]';
  const animate = tone !== 'idle' ? 'animate-pulse' : '';
  return <span className={cn('inline-block h-2 w-2 rounded-full mr-1.5', color, animate)} />;
}

// ============ Skeleton ============
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-[var(--bg-hover)]', className)} />;
}

// ============ Empty ============
export function Empty({ title, description, icon, action }: { title: string; description?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      {icon && <div className="text-4xl text-[var(--text-muted)] opacity-30">{icon}</div>}
      <div className="text-base font-semibold text-[var(--text-secondary)]">{title}</div>
      {description && <div className="max-w-xs text-sm text-[var(--text-muted)]">{description}</div>}
      {action}
    </div>
  );
}

// ============ Spinner ============
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', className)}
      style={{ width: size, height: size }}
    />
  );
}

// ============ Modal ============
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="rounded-2xl bg-[var(--surface-1)] border border-[var(--border)] shadow-[0_20px_60px_rgba(15,23,42,0.16)]"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5">
            <div className="text-[15px] font-semibold">{title}</div>
            <button className="grid h-8 w-8 place-items-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]" onClick={onClose}>
              ✕
            </button>
          </div>
        )}
        <div className="max-h-[72vh] overflow-y-auto bg-[var(--bg-elevated)]/20 p-6">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--bg-elevated)]/50 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

// ============ Toast ============
type ToastItem = { id: number; tone: 'success' | 'warn' | 'error' | 'info'; text: string };

const listeners: Array<(t: ToastItem) => void> = [];
let counter = 0;

export const toast = {
  success: (text: string) => emit('success', text),
  warn: (text: string) => emit('warn', text),
  error: (text: string) => emit('error', text),
  info: (text: string) => emit('info', text),
};

function emit(tone: ToastItem['tone'], text: string) {
  const item = { id: ++counter, tone, text };
  listeners.forEach((l) => l(item));
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useState(() => {
    listeners.push((it) => {
      setItems((arr) => [...arr, it]);
      setTimeout(() => setItems((arr) => arr.filter((x) => x.id !== it.id)), 3000);
    });
  });
  const toneClass: Record<ToastItem['tone'], string> = {
    success: 'border-[var(--success)]/40 bg-[var(--surface-1)] text-[var(--success)]',
    warn: 'border-[var(--warning)]/40 bg-[var(--surface-1)] text-[var(--warning)]',
    error: 'border-[var(--danger)]/40 bg-[var(--surface-1)] text-[var(--danger)]',
    info: 'border-[var(--info)]/40 bg-[var(--surface-1)] text-[var(--info)]',
  };
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex flex-col gap-2">
      {items.map((it) => (
        <div
          key={it.id}
          className={cn(
            'pointer-events-auto min-w-[200px] rounded-lg border bg-[var(--surface-1)] px-4 py-2.5 text-sm shadow-lg',
            toneClass[it.tone],
          )}
        >
          {it.text}
        </div>
      ))}
    </div>
  );
}

/* ============ 企业级共享组件（Copilot / Tasks / Agents 通用） ============ */

export type KpiTone = 'brand' | 'info' | 'success' | 'warn' | 'error' | 'neutral';

const KPI_TONE_COLOR: Record<KpiTone, string> = {
  brand: 'text-[var(--brand)]',
  info: 'text-[var(--info)]',
  success: 'text-[var(--success)]',
  warn: 'text-[var(--warning)]',
  error: 'text-[var(--danger)]',
  neutral: 'text-[var(--text)]',
};

/** 顶部 KPI 卡（数字 + 标签 + 可选子文本 + 图标） */
export function KpiCard({
  label, value, sub, tone = 'brand', icon: Icon, className, size = 'compact',
}: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: KpiTone; icon?: any; className?: string;
  /** comfortable 用于页面级运营摘要，compact 保持原有紧凑布局 */
  size?: 'compact' | 'comfortable';
}) {
  const comfortable = size === 'comfortable';
  return (
    <div className={cn(
      'border border-[var(--border)] bg-[var(--bg)] flex items-center',
      comfortable ? 'rounded-xl p-4 gap-3 min-h-[84px] shadow-[0_2px_8px_rgba(15,23,42,0.04)]' : 'rounded-md p-2.5 gap-2',
      className,
    )}>
      {Icon && <Icon className={cn(comfortable ? 'h-5 w-5' : 'h-3.5 w-3.5', 'shrink-0', KPI_TONE_COLOR[tone])} />}
      <div className="min-w-0">
        <div className={cn(comfortable ? 'text-xs' : 'text-[10px]', 'text-[var(--text-muted)] uppercase tracking-wider font-semibold leading-none')}>{label}</div>
        <div className={cn(comfortable ? 'text-2xl mt-1' : 'text-base mt-0.5', 'font-bold font-mono leading-tight', KPI_TONE_COLOR[tone])}>
          {value}
          {sub && <span className={cn(comfortable ? 'text-xs' : 'text-[10px]', 'text-[var(--text-muted)] font-normal ml-1')}>{sub}</span>}
        </div>
      </div>
    </div>
  );
}

/** 紧凑型 KPI 单元（无图标，更小） */
export function KpiMini({ label, value, tone = 'neutral', className, size = 'compact' }: { label: string; value: ReactNode; tone?: KpiTone; className?: string; size?: 'compact' | 'comfortable' }) {
  return (
    <div className={cn(size === 'comfortable' ? 'rounded-lg bg-[var(--bg)] border border-[var(--border)] px-3 py-2' : 'rounded bg-[var(--bg)] border border-[var(--border)] px-2 py-1', className)}>
      <div className={cn('text-[var(--text-muted)]', size === 'comfortable' ? 'text-xs' : 'text-[9px]')}>{label}</div>
      <div className={cn('font-mono font-semibold', size === 'comfortable' ? 'text-sm mt-0.5' : 'text-[11px]', KPI_TONE_COLOR[tone])}>{value}</div>
    </div>
  );
}

/** label-value 行（统计页 / 详情面板用） */
export function Row({ label, value, className, size = 'compact' }: { label: string; value: ReactNode; className?: string; size?: 'compact' | 'comfortable' }) {
  return (
    <div className={cn(size === 'comfortable' ? 'flex items-center justify-between gap-3 text-xs py-1.5' : 'flex items-center justify-between gap-2 text-[10px] py-0.5', className)}>
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-semibold text-right">{value}</span>
    </div>
  );
}

/** 表单字段标签 + 子元素 */
export function FormField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">{label}</div>
      {children}
    </div>
  );
}

/** 筛选分组（左侧筛选栏） */
export function FilterGroup({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('px-3', className)}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">{title}</div>
      {children}
    </div>
  );
}

/** 筛选单选行（标签 + 数量徽标） */
export function FilterRadio({
  active, onClick, label, count, dot, tone,
}: {
  active: boolean; onClick: () => void; label: string; count?: number; dot?: string; tone?: 'success' | 'warning' | 'danger' | 'idle';
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between rounded-md px-2 py-1 text-[11px]',
        active ? 'bg-[var(--brand-light)] text-[var(--brand)] font-semibold' : 'hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]',
      )}
    >
      <span className="flex items-center gap-1.5">
        {dot && <span className={cn('h-2 w-2 rounded-full', dot.replace('border-', 'bg-'))} />}
        {!dot && tone && tone !== 'idle' && <Dot tone={tone} />}
        {label}
      </span>
      {count !== undefined && <span className="font-mono text-[10px] opacity-70">{count}</span>}
    </button>
  );
}

/** 筛选 chip（用于分类/评分/标签） */
export function ChipBtn({
  label, active, onClick, tone,
}: {
  label: string; active: boolean; onClick: () => void; tone?: 'error' | 'warn' | 'info' | 'brand' | 'neutral';
}) {
  const activeBg = !tone || tone === 'neutral' ? 'bg-[var(--brand)] text-white' :
    tone === 'error' ? 'bg-[var(--danger)] text-white' :
    tone === 'warn' ? 'bg-[var(--warning)] text-white' :
    tone === 'info' ? 'bg-[var(--info)] text-white' :
    'bg-[var(--brand)] text-white';
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2 py-0.5 rounded-md text-[10px] font-mono transition-colors',
        active ? activeBg : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-hover)]',
      )}
    >
      {label}
    </button>
  );
}

/** 详情面板的标签分组（带图标 + 标题） */
export function Section({ label, icon: Icon, children, className }: { label: string; icon?: any; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      {children}
    </div>
  );
}

/** 右侧可折叠面板的收起态：slim 40px handle，写竖排文字，hover 高亮 */
export function CollapsedPanelHandle({
  label = '详情',
  Icon,
  onOpen,
  HintIcon,
  hint = '点击展开详情',
}: {
  label?: string; Icon?: any; onOpen?: () => void; HintIcon?: any; hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={hint}
      title={hint}
      className="group flex h-full w-10 flex-col items-center justify-center gap-3 border-l border-[var(--border)] bg-[var(--bg-elevated)] hover:bg-[var(--brand-light)] hover:border-[var(--brand)] transition-colors"
    >
      {Icon && <Icon className="h-3.5 w-3.5 text-[var(--text-muted)] group-hover:text-[var(--brand)]" />}
      <span
        className="select-none text-[10px] font-semibold tracking-widest text-[var(--text-muted)] group-hover:text-[var(--brand)]"
        style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
      >
        {label}
      </span>
      <div className="h-12 w-px bg-[var(--border)] group-hover:bg-[var(--brand)]" />
      {HintIcon && <HintIcon className="h-3.5 w-3.5 text-[var(--text-muted)] group-hover:text-[var(--brand)] animate-pulse" />}
    </button>
  );
}

/** 三段式页面头部：标题 + 副标题 + 可选 actions */
export function PageHeader({
  title, subtitle, icon: Icon, badge, actions, className,
}: {
  title: string; subtitle?: ReactNode; icon?: any; badge?: string; actions?: ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--bg)] px-5 py-3', className)}>
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon className="h-4 w-4 text-[var(--brand)] shrink-0" />}
        <div className="min-w-0">
          <h1 className="text-sm font-semibold flex items-center gap-2">
            {title}
            {badge && <Badge tone="brand" className="text-[9px]">{badge}</Badge>}
          </h1>
          {subtitle && <div className="text-[10px] text-[var(--text-muted)] mt-0.5 font-mono">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
  );
}

// ChevronLeft icon 已被替换为 HintIcon prop，由调用方注入
// 无需在 web-ui 中依赖 lucide-react

/** 可折叠分组（左侧筛选栏） */
export function CollapsibleSection({
  title,
  icon,
  children,
  collapsed,
  onToggle,
  className,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  return (
    <div className={cn('px-3', className)}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? `展开 ${title}` : `收起 ${title}`}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1.5 px-1 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text)] transition-colors rounded hover:bg-[var(--bg-hover)]"
      >
        {icon && <span className="h-3.5 w-3.5 shrink-0">{icon}</span>}
        <span className="flex-1 text-left">{title}</span>
        <span className={cn('transition-transform duration-200 ease-out', collapsed ? 'rotate-[-90deg]' : 'rotate-0')}>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </span>
      </button>
      <div className={cn('overflow-hidden transition-all duration-200 ease-in-out', collapsed ? 'max-h-0 opacity-0' : 'max-h-[1000px] opacity-100')}>
        {children}
      </div>
    </div>
  );
}

/** 下箭头图标（内联 SVG）- 使用 fill 模式确保箭头可见 */
function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <path d="M7 10l5 5 5-5z" />
    </svg>
  );
}
