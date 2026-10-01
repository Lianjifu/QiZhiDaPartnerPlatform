/**
 * CopilotPage — ApprovalCard (extracted inline approval rendering from MessageBubble).
 */
import { AlertCircle, CheckCircle2, ShieldCheck, X } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { ChatMessageEx, Signer } from '@/hooks/types';

export function ApprovalCard({
  m,
  isSingleAuth,
  canSign,
  canSingleApprove,
  expandedApproval,
  setExpandedApproval,
  onApprove,
  onApproveSigner,
  onRequestReject,
  onContinueRun,
  onExecuteAuthorized,
  currentUser,
}: {
  m: ChatMessageEx;
  isSingleAuth: boolean;
  canSign: (signer: Signer) => boolean;
  canSingleApprove: boolean;
  expandedApproval: Record<string, boolean>;
  setExpandedApproval: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onApprove: (msgId: string) => void;
  onApproveSigner: (msgId: string, signerIndex: number) => void;
  onRequestReject: (msgId: string, idx: number) => void;
  onContinueRun?: (msgId: string) => void | Promise<void>;
  onExecuteAuthorized?: (msgId: string) => void | Promise<void>;
  currentUser: { id: string; name: string; role: 'user' | 'admin' | 'auditor' } | null;
}) {
  if (!m.approvalRequest) return null;
  return (
    <div className="copilot-message__approval rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 max-w-md">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--danger)] mb-1 flex-wrap">
        <ShieldCheck className="h-3.5 w-3.5" />
        {isSingleAuth ? '受控变更 · 人工审核' : '受控变更 · 待审核'}
        {m.approvalRequest.reason ? (
          <Badge tone="warn" className="text-[9px] ml-1">{m.approvalRequest.reason}</Badge>
        ) : null}
        {m.approvalRequest.ticketId ? (
          <span className="text-[10px] font-mono text-[var(--text-muted)]">· {m.approvalRequest.ticketId}</span>
        ) : null}
        <span className="ml-auto text-[10px] font-mono text-[var(--text-muted)]">
          {m.approvalRequest.signed}/{m.approvalRequest.required}
        </span>
      </div>
      <div className="text-[11px] text-[var(--text)] mb-2 font-mono break-all">{m.approvalRequest.action}</div>
      {(m.approvalRequest.planSummary || m.approvalRequest.skillTurn?.summary) ? (
        <div className="mb-2 rounded border border-[var(--border)] bg-[var(--bg)]/60 px-2 py-1.5 text-[10px] text-[var(--text-secondary)]">
          <span className="text-[var(--text-muted)]">Skill Turn：</span>
          {m.approvalRequest.planSummary ?? m.approvalRequest.skillTurn?.summary}
          {m.approvalRequest.skillTurn?.steps && m.approvalRequest.skillTurn.steps.length > 0 ? (
            <ol className="mt-1 list-inside list-decimal space-y-0.5">
              {m.approvalRequest.skillTurn.steps.map((step, i) => (
                <li key={step.id ?? i}>
                  {step.title ?? step.action ?? `步骤 ${i + 1}`}
                  {m.approvalRequest!.decision !== 'pending' && step.status ? ` · ${step.status}` : ''}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
      {m.approvalRequest.resource ? (
        <div className="text-[10px] text-[var(--text-muted)] mb-2">
          资源：<span className="font-mono">{m.approvalRequest.resource}</span>
        </div>
      ) : null}

      <div className="flex gap-1 mb-2" aria-label={`签名进度 ${m.approvalRequest.signed}/${m.approvalRequest.required}`}>
        {m.approvalRequest.signers.map((s, i) => (
          <div
            key={i}
            className={cn(
              'flex-1 h-1.5 rounded-full',
              s.signed ? (s.role === 'auditor' ? 'bg-[var(--info)]' : 'bg-[var(--success)]') : 'bg-[var(--bg)]',
            )}
            title={`${s.name}（${s.role}）${s.signedAt ? ` · ${s.signedAt.slice(11, 19)}` : ''}`}
          />
        ))}
      </div>

      <div className="space-y-1 mb-2">
        {m.approvalRequest.signers.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[10px]">
            <span className={cn('w-3 inline-block', s.signed ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>
              {s.signed ? '✓' : '○'}
            </span>
            <span className={cn('flex-1', s.signed ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>{s.name}</span>
            <Badge tone={s.role === 'auditor' ? 'info' : 'neutral'} className="text-[9px]">{s.role}</Badge>
            {s.signedAt ? (
              <span className="text-[9px] font-mono text-[var(--text-muted)]">{s.signedAt.slice(11, 19)}</span>
            ) : null}
            {s.signatureHash ? (
              <span className="text-[9px] font-mono text-[var(--text-muted)]" title="签名 hash">
                #{s.signatureHash.slice(-6)}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      {m.approvalRequest.decision === 'pending' ? (
        <div className="flex gap-1.5 flex-wrap">
          {isSingleAuth ? (
            <>
              <Button
                size="sm"
                variant={canSingleApprove ? 'danger' : 'secondary'}
                disabled={!canSingleApprove}
                title={canSingleApprove ? '使用当前登录身份审核授权' : '需管理员或授权人审核'}
                onClick={() => onApprove(m.id)}
              >
                <ShieldCheck className="h-3 w-3" />审核授权
              </Button>
              {canSingleApprove ? (
                <Button size="sm" variant="secondary" onClick={() => onRequestReject(m.id, 0)}>
                  <X className="h-3 w-3" />拒绝
                </Button>
              ) : null}
            </>
          ) : (
            <>
              {m.approvalRequest.signers.map((s, i) => (
                !s.signed ? (
                  <Button
                    key={i}
                    size="sm"
                    variant={canSign(s) ? 'danger' : 'secondary'}
                    disabled={!canSign(s)}
                    title={canSign(s) ? '使用当前登录身份签发' : `仅 ${s.name} 可签发`}
                    onClick={() => onApproveSigner(m.id, i)}
                  >
                    <ShieldCheck className="h-3 w-3" />
                    {canSign(s) ? `批准（${s.name}）` : `待 ${s.name} 签发`}
                  </Button>
                ) : null
              ))}
              {m.approvalRequest.signers.some((s) => !s.signed && canSign(s)) ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const idx = m.approvalRequest!.signers.findIndex((s) => !s.signed && canSign(s));
                    if (idx >= 0) onRequestReject(m.id, idx);
                  }}
                >
                  <X className="h-3 w-3" />拒绝
                </Button>
              ) : null}
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpandedApproval({ ...expandedApproval, [m.id]: !expandedApproval[m.id] })}
          >
            详情
          </Button>
        </div>
      ) : null}
      {m.approvalRequest.decision === 'approved' ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {!m.content.includes('—— 授权后执行结果 ——') ? (
            <Badge tone="warn" className="text-[10px]">
              <ShieldCheck className="mr-1 inline h-3 w-3" />
              {isSingleAuth ? '已授权 · 待执行' : '已通过 · 待执行'}
              {m.approvalRequest.decidedAt ? (
                <span className="ml-1 font-mono">{m.approvalRequest.decidedAt.slice(11, 19)}</span>
              ) : null}
            </Badge>
          ) : m.content.includes('执行失败')
            || (m.toolCalls ?? []).some((tc) => tc.status === 'failed')
            || (m.approvalRequest.skillTurn?.steps ?? []).some((s) => s.status === 'failed' || s.status === 'needs_instruction') ? (
            <Badge tone="error" className="text-[10px]">
              <AlertCircle className="mr-1 inline h-3 w-3" />执行失败
            </Badge>
          ) : (
            <Badge tone="success" className="text-[10px]">
              <CheckCircle2 className="mr-1 inline h-3 w-3" />
              {isSingleAuth ? '已授权并执行' : '已通过并执行'}
              {m.approvalRequest.decidedAt ? (
                <span className="ml-1 font-mono">{m.approvalRequest.decidedAt.slice(11, 19)}</span>
              ) : null}
            </Badge>
          )}
          {!m.linkedTaskId && !m.content.includes('—— 授权后执行结果 ——') && onExecuteAuthorized ? (
            <Button
              size="sm"
              variant="primary"
              title="授权已完成，点击开始执行"
              onClick={() => void onExecuteAuthorized(m.id)}
            >
              开始执行
            </Button>
          ) : null}
          {(m.canContinueRun || m.nextRunCommand) && onContinueRun ? (
            <Button
              size="sm"
              variant="primary"
              title={m.nextRunCommand ? `继续执行 ${m.nextRunCommand}` : '继续执行 run'}
              onClick={() => void onContinueRun(m.id)}
            >
              继续执行 run
            </Button>
          ) : null}
        </div>
      ) : null}
      {m.approvalRequest.decision === 'rejected' ? (
        <Badge tone="error" className="text-[10px]">
          <X className="mr-1 inline h-3 w-3" />
          已拒绝
          {m.approvalRequest.decidedAt ? (
            <span className="ml-1 font-mono">{m.approvalRequest.decidedAt.slice(11, 19)}</span>
          ) : null}
        </Badge>
      ) : null}

      {expandedApproval[m.id] ? (
        <div className="mt-2 pt-2 border-t border-[var(--border)] text-[10px] space-y-1">
          <div className="text-[var(--text-muted)]">审计字段：</div>
          <div>policyHash：<span className="font-mono">{m.approvalRequest.policyHash ?? '—'}</span></div>
          <div>resource：<span className="font-mono">{m.approvalRequest.resource ?? '—'}</span></div>
          <div>reason：<span className="font-mono">{m.approvalRequest.reason ?? '—'}</span></div>
        </div>
      ) : null}
    </div>
  );
}