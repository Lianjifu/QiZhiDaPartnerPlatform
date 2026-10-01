/**
 * CopilotPage — SkillArtifactDownloadCard + ArtifactOutline + helpers (fetchContentLength, formatFileSize, labelOfCat).
 * Extracted from CopilotPage.tsx to satisfy file-size gates.
 */
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Download, Eye, FileText, Link2, Presentation, ShieldCheck } from 'lucide-react';
import { toast } from '@qzda/web-ui';
import { authHeader } from '@/auth';
import { artifactKindLabel } from '@/features/copilot/lib/artifact-links';
import type { SkillArtifactLink } from '@/features/copilot/lib/artifact-links';
import type { PageOutline } from '@/features/copilot/lib/page-outline';

export function labelOfCat(c: string): string {
  return { agent: '专家', kb: '知识', task: '任务', tool: '工具', collab: '协作' }[c] ?? c;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function fetchContentLength(href: string, timeoutMs = 1500): Promise<number | null> {
  if (typeof fetch !== 'function') return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(href, { method: 'HEAD', credentials: 'same-origin', signal: ctrl.signal, headers: authHeader() });
    if (!res.ok) return null;
    const len = res.headers.get('Content-Length');
    return len ? Number(len) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function SkillArtifactDownloadCard({
  href, filename, downloadName, title, kind, onView, sanitizedFields,
}: {
  href: string;
  filename: string;
  downloadName: string;
  title: string;
  kind: SkillArtifactLink['kind'];
  onView?: () => void;
  /** 已脱敏的敏感字段数；> 0 时显示右上徽章 */
  sanitizedFields?: number;
}) {
  const label = artifactKindLabel(kind);
  const saveAs = downloadName || filename;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  const Icon = kind === 'pptx' ? Presentation : FileText;

  useEffect(() => {
    let cancelled = false;
    void fetchContentLength(href).then((n) => {
      if (!cancelled) setSize(n);
    });
    return () => {
      cancelled = true;
    };
  }, [href]);

  const handleDownload = async (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const { downloadArtifactSafely } = await import('@/features/copilot/components/DocumentPreview');
      await downloadArtifactSafely(href, saveAs);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '文件下载失败');
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = () => {
    onView?.();
  };

  const handleCopyPath = async (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no clipboard permission — silently ignore */
    }
  };

  const subtitleParts = [label, saveAs];
  if (size != null) subtitleParts.push(formatFileSize(size));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      }}
      className="copilot-artifact-card group flex max-w-[480px] flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3.5 py-3 transition-colors hover:border-[var(--brand)]/45 hover:bg-[var(--brand-light)]/40"
      aria-label={`查看 ${title}`}
    >
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${kind === 'pptx' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : kind === 'pdf' ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300' : 'bg-[var(--brand-light)] text-[var(--brand)]'}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="block truncate text-[13px] font-semibold text-[var(--text)]">{title}</div>
          <div className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)]">
            {subtitleParts.join(' · ')}
          </div>
        </div>
        {typeof sanitizedFields === 'number' && sanitizedFields > 0 ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--success)]/12 px-1.5 py-0.5 text-[10px] font-medium text-[var(--success)]"
            title="本轮产出已自动替换敏感字段"
          >
            <ShieldCheck className="h-3 w-3" />
            已脱敏 {sanitizedFields} 处
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={handleDownload}
          aria-busy={busy}
          className="inline-flex items-center gap-1 rounded-md bg-[var(--brand)] px-2.5 py-1 text-[11px] font-medium text-white shadow-sm hover:bg-[var(--brand-hover)]"
        >
          <Download className="h-3.5 w-3.5" />
          {busy ? '下载中…' : '下载'}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleOpen();
          }}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1 text-[11px] font-medium text-[var(--text)] hover:border-[var(--brand)]/40 hover:text-[var(--brand)]"
        >
          <Eye className="h-3.5 w-3.5" />
          预览
        </button>
        <button
          type="button"
          onClick={handleCopyPath}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] hover:border-[var(--brand)]/40 hover:text-[var(--text)]"
          title="复制相对路径"
        >
          <Link2 className="h-3 w-3" />
          {copied ? '已复制' : '路径'}
        </button>
      </div>
    </div>
  );
}

export function ArtifactOutline({
  outline,
  onJump,
}: {
  outline: PageOutline;
  onJump: (page: number) => void;
}) {
  return (
    <div className="copilot-outline mt-1.5">
      <div className="flex items-baseline justify-between">
        <div className="text-[11px] font-medium text-[var(--text-muted)]">
          页面结构 · {outline.pages.length} 页
        </div>
        <div className="text-[10px] text-[var(--text-muted)]">点击跳转预览</div>
      </div>
      <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
        {outline.pages.map((p, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onJump(i + 1)}
            className="copilot-outline__chip shrink-0 inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-[11px] text-[var(--text)] hover:border-[var(--brand)]/40 hover:bg-[var(--brand-light)]/30"
          >
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-[var(--bg-hover)] px-1 font-mono text-[9px] font-medium text-[var(--text-muted)]">
              P{i + 1}
            </span>
            <span className="max-w-[140px] truncate font-medium">{p}</span>
          </button>
        ))}
      </div>
    </div>
  );
}