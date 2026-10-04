/**
 * CopilotPage.MetaStrip — single-row session meta (turns / tokens / last
 * activity / audit shortcut). Rendered between the page header and the
 * message stream.
 */
import { useNavigate } from 'react-router-dom';
import { Activity, Clock, Hash, ShieldCheck } from 'lucide-react';

export function CopilotPageMetaStrip({
  turnCount,
  totalTokens,
  lastActiveAt,
  onOpenAudit,
}: {
  turnCount: number;
  totalTokens: number;
  lastActiveAt?: string | null;
  onOpenAudit?: () => void;
}) {
  const navigate = useNavigate();
  const rel = lastActiveAt ? relativeFromNow(lastActiveAt) : '尚无活动';
  return (
    <div
      className="copilot-meta-strip flex h-8 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 text-[11px] text-[var(--text-secondary)] sm:px-5"
      role="status"
      aria-label="会话元信息"
    >
      <span className="inline-flex items-center gap-1">
        <Hash className="h-3 w-3" />
        <span className="tabular-nums">{turnCount}</span>
        <span>轮</span>
      </span>
      <span aria-hidden="true" className="text-[var(--text-muted)]">·</span>
      <span className="inline-flex items-center gap-1">
        <Activity className="h-3 w-3" />
        <span className="tabular-nums">{totalTokens.toLocaleString()}</span>
        <span>tokens</span>
      </span>
      <span aria-hidden="true" className="text-[var(--text-muted)]">·</span>
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3 w-3" />
        <span>{rel}</span>
      </span>
      {onOpenAudit ? (
        <>
          <span aria-hidden="true" className="text-[var(--text-muted)]">·</span>
          <button
            type="button"
            onClick={onOpenAudit}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
            aria-label="查看会话审计"
          >
            <ShieldCheck className="h-3 w-3" />
            <span>查看会话审计</span>
          </button>
        </>
      ) : null}
      <span className="ml-auto text-[var(--text-muted)]">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="hover:text-[var(--text)]"
          aria-label="返回"
        >返回</button>
      </span>
    </div>
  );
}

function relativeFromNow(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}
