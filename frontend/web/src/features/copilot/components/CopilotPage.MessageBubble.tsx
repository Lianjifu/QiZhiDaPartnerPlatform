/** MessageBubble — single message unit. Sub-components extracted to satisfy gates. */
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { AlertCircle, CheckCircle2, Code, Copy, Download, Pencil, RotateCcw, ShieldAlert, Square, ThumbsDown, ThumbsUp, Trash2, Wrench } from 'lucide-react';
import { Avatar, Badge } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { DigitalPartnerAvatar } from '@/features/partners/components/DigitalPartnerAvatar';
import { Markdown } from '@/components/Markdown';
import { TurnThoughtPanel } from '@/features/copilot/turn-narrative/turn-thought-panel';
import { extractSkillArtifacts, type SkillArtifactLink } from '@/features/copilot/lib/artifact-links';
import { formatAssistantDisplayContent, formatExecutionDetails } from '@/features/copilot/lib/message-display';
import { extractPageOutline } from '@/features/copilot/lib/page-outline';
import { formatShanghaiTime } from '@/features/copilot/lib/shanghai-time';
import type { ChatMessageEx, FeedbackKind, Signer } from '@/hooks/types';
import type { DigitalPartner } from '@qzda/web-types';
import type { WorkbenchContextTab } from '@/features/copilot/lib/workbench';
import { ERROR_HINT, STATUS_LABEL } from '@/features/copilot/lib/message-status';
import { MessageCapabilityTrace, RiskDecisionCard } from './CopilotPage.MessageTrace';
import { ArtifactOutline, SkillArtifactDownloadCard } from './CopilotPage.ArtifactCard';
import { CitationsList, ToolCallDetails } from './CopilotPage.ToolCallDetails';
import { ApprovalCard } from './CopilotPage.ApprovalCard';

export function CopilotPageMessageBubble({
  m, expandedArgs = {}, setExpandedArgs = (() => undefined) as any,
  expandedApproval = {}, setExpandedApproval = (() => undefined) as any,
  onApprove = () => undefined, onContinueRun, onExecuteAuthorized, onCitation = () => undefined,
  onRetry = () => undefined, onCopy = () => undefined, onRegenerate = () => undefined,
  onDelete = () => undefined, onRetryMessage = () => undefined, onFeedback = () => undefined,
  onApproveSigner = () => undefined, onRequestReject = () => undefined, onEdit = () => undefined,
  hoverMsgId = null, setHoverMsgId = (() => undefined) as any, copiedId = null,
  agentName, expertRole, expert, onOpenContext = () => undefined,
  selectedContextMessageId, messageRef, currentUser = null,
  generationStatus, generationElapsedSec,
}: {
  m: ChatMessageEx;
  expandedArgs?: Record<string, boolean>;
  setExpandedArgs?: Dispatch<SetStateAction<Record<string, boolean>>>;
  expandedApproval?: Record<string, boolean>;
  setExpandedApproval?: Dispatch<SetStateAction<Record<string, boolean>>>;
  onApprove?: (msgId: string) => void;
  onContinueRun?: (msgId: string) => void | Promise<void>;
  onExecuteAuthorized?: (msgId: string) => void | Promise<void>;
  onCitation?: (c: import('@/hooks/types').Citation, messageId?: string) => void;
  onRetry?: (name: string) => void;
  onCopy?: (m: ChatMessageEx) => void;
  onEdit?: (m: ChatMessageEx) => void;
  onRegenerate?: (mid: string) => void;
  onDelete?: (mid: string) => void;
  onRetryMessage?: (mid: string) => void;
  onFeedback?: (mid: string, kind: FeedbackKind) => void;
  onApproveSigner?: (mid: string, signerIndex: number) => void;
  onRequestReject?: (mid: string, idx: number) => void;
  hoverMsgId?: string | null;
  setHoverMsgId?: (v: string | null) => void;
  copiedId?: string | null;
  agentName?: string;
  expertRole?: string;
  expert?: Pick<DigitalPartner, 'id' | 'name' | 'department' | 'avatarUrl' | 'capabilities'> | { id: string; name: string; department?: string; avatarUrl?: string; capabilities?: DigitalPartner['capabilities'] };
  onOpenContext?: (tab: WorkbenchContextTab, messageId?: string, artifact?: SkillArtifactLink, options?: { startSlide?: number }) => void;
  selectedContextMessageId?: string;
  messageRef?: (element: HTMLDivElement | null) => void;
  currentUser?: { id: string; name: string; role: 'user' | 'admin' | 'auditor' } | null;
  generationStatus?: string;
  generationElapsedSec?: number;
}) {
  const isUser = m.role === 'user';
  const isTool = m.role === 'tool';
  const isEmpty = !m.content;
  const isStreaming = m.status === 'streaming' || m.status === 'in_flight';
  const agentDisplayName = agentName || m.agentName || (isUser ? '王昊' : isTool ? '能力调用' : '助手');
  const [traceOpen, setTraceOpen] = useState(false);
  const needsDecision = !isUser && /CVE|高危|高风险|影响资产/.test(m.content ?? '');
  const artifacts = useMemo(
    () => (isUser || isTool || !m.content ? [] : extractSkillArtifacts(m.content)),
    [isUser, isTool, m.content],
  );
  const displayContent = useMemo(
    () => formatAssistantDisplayContent(m.content ?? '', artifacts.length > 0),
    [artifacts.length, m.content],
  );
  const executionDetails = useMemo(
    () => formatExecutionDetails(m.content ?? ''),
    [m.content],
  );
  const outline = useMemo(
    () => (isUser || isTool || !m.content ? null : extractPageOutline(m.content)),
    [isUser, isTool, m.content],
  );
  const sanitizedFields = useMemo(() => {
    if (!m.safety || m.safety.action !== 'redact') return undefined;
    const text = m.content ?? '';
    const matches = text.match(/\[已脱敏\]|\[REDACTED\]|<redacted>|<\*\*\*>/gi);
    return matches ? matches.length : 1;
  }, [m.content, m.safety]);
  const expectedPlatformRole: Record<Signer['role'], 'user' | 'admin' | 'auditor'> = { operator: 'user', approver: 'admin', auditor: 'auditor' };
  const isSingleAuth = (m.approvalRequest?.required ?? 2) <= 1;
  const canSign = (signer: Signer) => {
    if (!currentUser || signer.signed) return false;
    if (isSingleAuth) {
      if (currentUser.role === 'admin') return true;
      if (signer.userId && signer.userId === currentUser.id) return true;
      return false;
    }
    return signer.userId === currentUser.id && expectedPlatformRole[signer.role] === currentUser.role;
  };
  const canSingleApprove = isSingleAuth && !!currentUser && m.approvalRequest?.decision === 'pending' && (
    currentUser.role === 'admin'
    || (m.approvalRequest.approverCandidateIds ?? []).includes(currentUser.id)
    || (!!m.approvalRequest.approverRoleHint && currentUser.name.includes(m.approvalRequest.approverRoleHint))
    || (!!m.approvalRequest.signers?.[0]?.userId && m.approvalRequest.signers[0].userId === currentUser.id)
  );
  return (
    <div
      ref={messageRef}
      className={cn('copilot-message group relative', isUser ? 'copilot-message--user flex justify-end' : isTool ? 'copilot-message--tool flex gap-3' : 'copilot-message--assistant flex gap-3', selectedContextMessageId === m.id && 'is-context-selected')}
      data-message-status={m.status}
      onMouseEnter={() => setHoverMsgId(m.id)}
      onMouseLeave={() => setHoverMsgId(null)}
    >
      {!isUser ? (
        <div className="shrink-0 pt-0.5">
          {isTool ? (
            <div className="copilot-message__avatar copilot-message__avatar--tool grid h-7 w-7 place-items-center rounded-full bg-[var(--warning-bg)] text-[var(--warning)]">
              <Wrench className="h-3.5 w-3.5" />
            </div>
          ) : (
            <DigitalPartnerAvatar
              employee={expert ?? { id: 'expert', name: agentDisplayName }}
              size={28}
              className="copilot-message__avatar copilot-message__avatar--assistant"
            />
          )}
        </div>
      ) : null}
      <div className={cn('copilot-message__content min-w-0 space-y-2.5', isUser ? 'max-w-[80%]' : 'w-full max-w-[960px]')}>
        <div className={cn('copilot-message__meta flex items-center gap-1.5 text-[11px]', isUser && 'justify-end')}>
          {isUser ? <Avatar name="王昊" size={20} /> : null}
          <span className="font-semibold text-[var(--text)]">{isUser ? '王昊' : agentDisplayName}</span>
          {!isUser && !isTool && expertRole ? (
            <span className="truncate text-[10px] text-[var(--text-muted)]">{expertRole}</span>
          ) : null}
          {!isUser && m.status ? (
            <span className={cn('inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]', isStreaming && 'text-[var(--brand)]')}>
              {isStreaming ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)] animate-pulse" aria-hidden="true" /> : null}
              {STATUS_LABEL[m.status]}
            </span>
          ) : null}
          {!isUser && m.metrics?.ttftMs !== undefined ? (
            <details className="text-[10px] text-[var(--text-muted)]">
              <summary className="cursor-pointer">运行详情</summary>
              <span className="font-mono">TTFT {m.metrics.ttftMs}ms · {m.metrics.durationMs ? `${(m.metrics.durationMs / 1000).toFixed(1)}s` : ''}{m.metrics.model ? ` · ${m.metrics.model}` : ''}</span>
            </details>
          ) : null}
          <span className="text-[10px] text-[var(--text-muted)] font-mono tabular-nums" title={m.createdAt}>{formatShanghaiTime(m.createdAt)}</span>
          {((m.toolCalls?.length ?? 0) > 0 || isTool) ? <Badge tone="warn" className="text-[9px]">能力调用</Badge> : null}
          {m.approvalRequest ? <Badge tone="error" className="text-[9px]">写操作</Badge> : null}
        </div>

        {!isUser ? (
          <MessageCapabilityTrace
            message={m}
            onOpenContext={onOpenContext}
            expanded={traceOpen}
            onToggle={() => setTraceOpen((open) => !open)}
          />
        ) : null}

        {needsDecision ? <RiskDecisionCard onOpenContext={onOpenContext} messageId={m.id} /> : null}

        {m.status === 'failed' ? (
          <div role="alert" className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2 text-[11px] flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-[var(--danger)]" />
            <span className="text-[var(--text)]">
              {m.error?.message ?? ERROR_HINT[m.error?.category ?? 'unknown']}
            </span>
            <button
              type="button"
              onClick={() => onRetryMessage(m.id)}
              className="ml-auto inline-flex items-center gap-1 text-[10px] text-[var(--danger)] hover:underline"
            >
              <RotateCcw className="h-3 w-3" />重试
            </button>
          </div>
        ) : null}
        {m.status === 'cancelled' ? (
          <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] text-[var(--text-muted)] inline-flex items-center gap-1.5">
            <Square className="h-3 w-3" />生成已停止
          </div>
        ) : null}
        {m.status === 'moderated' && m.safety ? (
          <div role="alert" className="rounded-md border border-[var(--warning)]/30 bg-[var(--warning-bg)] px-3 py-2 text-[11px] flex items-center gap-2">
            <ShieldAlert className="h-3.5 w-3.5 text-[var(--warning)]" />
            <span className="text-[var(--text)]">
              内容安全：{m.safety.flaggedCategory ?? 'policy'} · 已{m.safety.action === 'block' ? '拦截' : m.safety.action === 'redact' ? '脱敏' : '告警'}
            </span>
            {m.safety.redactedText ? (
              <details className="ml-auto text-[10px]">
                <summary className="cursor-pointer text-[var(--text-muted)]">查看脱敏后</summary>
                <pre className="mt-1 max-w-md whitespace-pre-wrap text-[10px]">{m.safety.redactedText}</pre>
              </details>
            ) : null}
          </div>
        ) : null}

        {!isUser && !isTool ? (
          <TurnThoughtPanel message={m} streaming={isStreaming} showNarrative={expert?.capabilities?.cognitive?.showNarrative !== false} />
        ) : null}

        {!isEmpty ? (
          <div className={cn(
            'copilot-message__body relative',
            isUser
              ? 'copilot-message__body--user inline-block max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-[var(--brand)] px-4 py-2.5 text-[14px] text-white shadow-sm'
              : isTool
              ? 'copilot-message__body--tool rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-bg)]/50 px-3 py-2 text-[12px] text-[var(--text-secondary)] font-mono'
              : 'copilot-message__body--assistant max-w-[920px] text-[14.5px] leading-[1.7] text-[var(--text)] break-words',
          )}>
            {isUser ? (
              <span className="whitespace-pre-wrap">{m.content}</span>
            ) : (
              <div className="md-content space-y-3">
                {artifacts.length > 0 ? (
                  <div className="flex flex-col gap-2" role="list" aria-label="可下载产物">
                    {artifacts.map((a) => (
                      <div key={a.href} role="listitem">
                        <SkillArtifactDownloadCard
                          href={a.href}
                          filename={a.filename}
                          downloadName={a.downloadName}
                          title={a.title}
                          kind={a.kind}
                          sanitizedFields={sanitizedFields}
                          onView={() => onOpenContext('document', m.id, a)}
                        />
                      </div>
                    ))}
                    {outline ? (
                      <ArtifactOutline
                        outline={outline}
                        onJump={(page) => onOpenContext('document', m.id, artifacts[0], { startSlide: page })}
                      />
                    ) : null}
                  </div>
                ) : null}
                {displayContent ? <Markdown text={displayContent} /> : null}
                {executionDetails ? (
                  <details className="copilot-execution-details rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px]">
                    <summary className="cursor-pointer select-none font-medium text-[var(--text-muted)] hover:text-[var(--text)]">
                      查看执行明细
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]">
                      {executionDetails}
                    </pre>
                  </details>
                ) : null}
                {isStreaming ? (
                  <span className="inline-block h-3.5 w-1.5 ml-0.5 align-text-bottom bg-[var(--brand)] animate-pulse rounded-sm" aria-hidden="true" />
                ) : null}
              </div>
            )}
          </div>
        ) : isStreaming ? (
          <div className="copilot-message__body copilot-message__body--pending inline-flex items-center gap-2.5 text-[var(--text-muted)] text-sm py-1" role="status" aria-label="消息正在生成">
            <span className="copilot-thinking-dots" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </span>
            <span className="min-w-0 truncate">
              {generationStatus
                || ((m.reasoningSteps?.length ?? 0) > 0 ? '正在生成回复…' : '正在思考')}
            </span>
            {generationElapsedSec != null && generationElapsedSec > 0 ? (
              <span className="font-mono text-[10px] text-[var(--text-muted)]">{generationElapsedSec}s</span>
            ) : null}
          </div>
        ) : null}

        {m.codeBlock ? (
          <div className="copilot-message__code rounded-md border border-[var(--border)] bg-[var(--bg)] overflow-hidden max-w-2xl">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg-elevated)]">
              <div className="flex items-center gap-1.5 text-[10px]">
                <Code className="h-3 w-3 text-[var(--text-muted)]" />
                <span className="font-mono text-[var(--text-muted)]">{m.codeBlock.lang}</span>
              </div>
              <button
                onClick={async () => { try { await navigator.clipboard.writeText(m.codeBlock!.code); } catch {} }}
                className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1"
              >
                <Download className="h-3 w-3" />复制
              </button>
            </div>
            <pre className="overflow-x-auto p-3 text-[11px] font-mono leading-relaxed text-[var(--text)]">
              {m.codeBlock.code}
            </pre>
          </div>
        ) : null}

        {traceOpen && m.toolCalls && m.toolCalls.length > 0 ? (
          <ToolCallDetails
            messageId={m.id}
            toolCalls={m.toolCalls}
            expandedArgs={expandedArgs}
            setExpandedArgs={setExpandedArgs}
            onRetry={onRetry}
          />
        ) : null}

        {traceOpen && m.citations && m.citations.length > 0 ? (
          <CitationsList
            citations={m.citations}
            onCitation={onCitation}
            messageId={m.id}
          />
        ) : null}

        {m.approvalRequest ? (
          <ApprovalCard
            m={m}
            isSingleAuth={isSingleAuth}
            canSign={canSign}
            canSingleApprove={canSingleApprove}
            expandedApproval={expandedApproval}
            setExpandedApproval={setExpandedApproval}
            onApprove={onApprove}
            onApproveSigner={onApproveSigner}
            onRequestReject={onRequestReject}
            onContinueRun={onContinueRun}
            onExecuteAuthorized={onExecuteAuthorized}
            currentUser={currentUser}
          />
        ) : null}

        {!isEmpty ? (
          <div className={cn('copilot-message__actions flex items-center gap-0.5 text-[var(--text-muted)]', isUser ? 'justify-end' : '')}>
            <button
              onClick={() => onCopy(m)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
              title="复制"
              aria-label="复制消息"
            >
              {copiedId === m.id ? <CheckCircle2 className="h-3 w-3 text-[var(--success)]" /> : <Copy className="h-3 w-3" />}
              <span>{copiedId === m.id ? '已复制' : '复制'}</span>
            </button>
            {isUser ? (
              <button onClick={() => onEdit(m)} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]" title="编辑并重新发送" aria-label="编辑并重新发送">
                <Pencil className="h-3 w-3" /><span>编辑</span>
              </button>
            ) : null}
            {!isUser ? (
              <>
                <button
                  onClick={() => onRegenerate(m.id)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                  title="重新生成"
                  aria-label="重新生成"
                  disabled={m.status === 'streaming'}
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>重新生成</span>
                </button>
                <div className="mx-1 h-3 w-px bg-[var(--border)]" aria-hidden="true" />
                <button
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] hover:bg-[var(--bg-hover)]',
                    m.feedback?.kind === 'like' ? 'text-[var(--success)]' : 'hover:text-[var(--text)]',
                  )}
                  title="点赞 · 提交自进化候选"
                  aria-label="点赞"
                  aria-pressed={m.feedback?.kind === 'like'}
                  onClick={() => onFeedback(m.id, m.feedback?.kind === 'like' ? null : 'like')}
                >
                  <ThumbsUp className="h-3 w-3" />
                </button>
                <button
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] hover:bg-[var(--bg-hover)]',
                    m.feedback?.kind === 'dislike' ? 'text-[var(--danger)]' : 'hover:text-[var(--text)]',
                  )}
                  title="点踩 · 提交自进化候选"
                  aria-label="点踩"
                  aria-pressed={m.feedback?.kind === 'dislike'}
                  onClick={() => onFeedback(m.id, m.feedback?.kind === 'dislike' ? null : 'dislike')}
                >
                  <ThumbsDown className="h-3 w-3" />
                </button>
                <button
                  onClick={() => onDelete(m.id)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
                  title="删除"
                  aria-label="删除消息"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}