/**
 * 通用页面骨架屏 — loading 态
 * 用于 useApiQuery isLoading 时占位（避免空白）
 */
import { cn } from '@qzda/web-utils';

export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-4 p-6', className)} role="status" aria-label="加载中">
      {/* 顶部 hero */}
      <div className="flex items-start justify-between">
        <div>
          <div className="h-8 w-48 bg-[var(--bg-hover)] rounded animate-pulse" />
          <div className="h-3 w-72 bg-[var(--bg-hover)] rounded mt-2 animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 bg-[var(--bg-hover)] rounded animate-pulse" />
          <div className="h-9 w-24 bg-[var(--bg-hover)] rounded animate-pulse" />
        </div>
      </div>

      {/* KPI 6 卡 */}
      <div className="grid grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">
            <div className="h-3 w-12 bg-[var(--bg-hover)] rounded animate-pulse" />
            <div className="h-7 w-20 bg-[var(--bg-hover)] rounded mt-3 animate-pulse" />
            <div className="h-2 w-24 bg-[var(--bg-hover)] rounded mt-2 animate-pulse" />
          </div>
        ))}
      </div>

      {/* 内容行 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 h-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] animate-pulse" />
        <div className="h-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] animate-pulse" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-56 rounded-lg border border-[var(--border)] bg-[var(--bg)] animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export function CardSkeleton({ className, rows = 3 }: { className?: string; rows?: number }) {
  return (
    <div className={cn('rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4 space-y-2', className)} role="status" aria-label="加载中">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-[var(--bg-hover)] animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-2/3 bg-[var(--bg-hover)] rounded animate-pulse" />
            <div className="h-2 w-1/2 bg-[var(--bg-hover)] rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function KpiSkeleton() {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3" role="status" aria-label="加载中">
      <div className="h-2.5 w-12 bg-[var(--bg-hover)] rounded animate-pulse" />
      <div className="h-6 w-20 bg-[var(--bg-hover)] rounded mt-2 animate-pulse" />
      <div className="h-2 w-16 bg-[var(--bg-hover)] rounded mt-1.5 animate-pulse" />
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] overflow-hidden" role="status" aria-label="加载中">
      <div className="bg-[var(--bg-elevated)] h-9 flex items-center px-3 gap-3">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-2.5 flex-1 bg-[var(--bg-hover)] rounded animate-pulse" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 flex items-center px-3 gap-3 border-t border-[var(--border)]">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-2.5 flex-1 bg-[var(--bg-hover)] rounded animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}