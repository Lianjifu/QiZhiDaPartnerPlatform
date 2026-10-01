/**
 * CopilotPage — ToolCallDetails + CitationsList (extracted inline details from MessageBubble).
 */
import {
  AlertCircle, CheckCircle2, Link2, Lock, PlugZap, RotateCcw, ShieldCheck, Wrench,
} from 'lucide-react';
import { Badge } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { ChatMessageEx, Citation } from '@/hooks/types';

const SOURCE_COLOR: Record<string, string> = {
  知识库: 'text-[var(--brand)] bg-[var(--brand-light)]',
  文档: 'text-[var(--info)] bg-[var(--info-bg)]',
  记忆: 'text-[var(--success)] bg-[var(--success-bg)]',
};

export function ToolCallDetails({
  messageId,
  toolCalls,
  expandedArgs,
  setExpandedArgs,
  onRetry,
}: {
  messageId: string;
  toolCalls: NonNullable<ChatMessageEx['toolCalls']>;
  expandedArgs: Record<string, boolean>;
  setExpandedArgs: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onRetry: (name: string) => void;
}) {
  return (
    <div className="copilot-message__toolcalls max-w-[920px] space-y-1.5">
      <div className="flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        <Wrench className="h-3 w-3 text-[var(--brand)]" />能力调用明细 · {toolCalls.length} 项
      </div>
      {toolCalls.map((tc) => {
        const argsKey = `${messageId}-${tc.id}`;
        const isOpen = expandedArgs[argsKey];
        const failed = tc.status === 'failed';
        const denied = tc.status === 'denied' || tc.permission === 'denied';
        return (
          <div
            key={tc.id}
            className={cn(
              'rounded-md border p-2 text-[11px]',
              failed || denied
                ? 'border-[var(--danger)]/40 bg-[var(--danger-bg)]'
                : 'border-[var(--border)] bg-[var(--bg-elevated)]',
            )}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <Wrench className={cn('h-3 w-3', failed || denied ? 'text-[var(--danger)]' : 'text-[var(--brand)]')} />
              <span className="font-mono font-semibold">{tc.name}</span>
              {(tc.permission === 'approval-required' || tc.permission === 'approval_required') && (
                <Badge tone="warn" className="text-[9px]">
                  <ShieldCheck className="mr-0.5 inline h-2.5 w-2.5" />需人工审核
                </Badge>
              )}
              {String(tc.status) === 'pending_authorization' &&
                tc.permission !== 'approval-required' &&
                tc.permission !== 'approval_required' && (
                  <Badge tone="warn" className="text-[9px]">
                    <ShieldCheck className="mr-0.5 inline h-2.5 w-2.5" />待授权
                  </Badge>
                )}
              {tc.permission === 'auto' && (
                <Badge tone="success" className="text-[9px]">
                  <PlugZap className="mr-0.5 inline h-2.5 w-2.5" />auto
                </Badge>
              )}
              {tc.permission === 'denied' && (
                <Badge tone="error" className="text-[9px]">
                  <Lock className="mr-0.5 inline h-2.5 w-2.5" />已拦截
                </Badge>
              )}
              {failed ? (
                <Badge tone="error" className="text-[9px]">
                  <AlertCircle className="mr-0.5 inline h-2.5 w-2.5" />失败
                </Badge>
              ) : tc.status === 'needs_instruction' ? (
                <Badge tone="warn" className="text-[9px]">待补全命令</Badge>
              ) : !denied ? (
                <Badge tone="success" className="text-[9px]">
                  <CheckCircle2 className="mr-0.5 inline h-2.5 w-2.5" />{tc.durationMs}ms
                </Badge>
              ) : null}
              {tc.sandboxId ? (
                <span className="text-[9px] font-mono text-[var(--text-muted)]" title="gVisor 沙箱 ID">
                  [{tc.sandboxId}]
                </span>
              ) : null}
              {tc.traceId ? (
                <span className="text-[9px] font-mono text-[var(--text-muted)]" title="执行 traceId">
                  {tc.traceId}
                </span>
              ) : null}
              {failed ? (
                <button onClick={() => onRetry(tc.name)} className="text-[10px] text-[var(--danger)] hover:underline ml-auto">
                  <RotateCcw className="inline h-2.5 w-2.5 mr-0.5" />自动重试
                </button>
              ) : !failed && !denied ? (
                <button
                  type="button"
                  onClick={() => setExpandedArgs({ ...expandedArgs, [argsKey]: !isOpen })}
                  aria-expanded={!!isOpen}
                  aria-controls={`tool-args-${argsKey}`}
                  className="ml-auto text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]"
                >
                  {isOpen ? '收起' : '参数'}
                </button>
              ) : null}
            </div>
            {tc.error ? (
              <div className="mt-1 text-[10px] font-mono text-[var(--danger)]">{tc.error}</div>
            ) : null}
            {isOpen ? (
              <div id={`tool-args-${argsKey}`} className="mt-1.5 space-y-1 pl-5">
                <pre className="text-[10px] font-mono text-[var(--text-muted)] bg-[var(--bg)] rounded p-1.5 overflow-x-auto">
                  {JSON.stringify(tc.args, null, 2)}
                </pre>
                {tc.result ? (
                  <pre className="text-[10px] font-mono text-[var(--success)] bg-[var(--bg)] rounded p-1.5 overflow-x-auto">
                    → {tc.result}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function CitationsList({
  citations,
  onCitation,
  messageId,
}: {
  citations: Citation[];
  onCitation: (c: Citation, messageId?: string) => void;
  messageId: string;
}) {
  return (
    <div className="cite-block max-w-[920px]">
      <div className="cite-block__title">
        <Link2 className="h-3 w-3 text-[var(--brand)]" />
        装配知识依据 · {citations.length} 项
      </div>
      {citations.map((c, i) => (
        <button
          key={c.id ?? i}
          type="button"
          onClick={() => onCitation(c, messageId)}
          className="block w-full text-left px-2 py-1.5 rounded hover:bg-[var(--bg-hover)] text-[11px] font-mono"
        >
          <span className={cn('nav-pill text-[9px] mr-1', SOURCE_COLOR[c.source])}>{c.source}</span>
          <span className="text-[var(--brand)]">[{i + 1}]</span> {c.source}
          {c.page ? <span className="text-[var(--text-muted)]"> · p.{c.page}</span> : null}
          <span className="text-[var(--success)] ml-2">{(c.score * 100).toFixed(0)}%</span>
        </button>
      ))}
    </div>
  );
}