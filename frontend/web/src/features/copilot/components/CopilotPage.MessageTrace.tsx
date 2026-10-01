/**
 * CopilotPage — MessageCapabilityTrace + RiskDecisionCard + small inline helpers.
 * Extracted from CopilotPage.tsx to satisfy file-size gates.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Link2, ListChecksIcon, ShieldCheck, Wrench } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { ChatMessageEx } from '@/hooks/types';
import type { SkillArtifactLink } from '@/features/copilot/lib/artifact-links';

export type WorkbenchContextTab = 'overview' | 'evidence' | 'tasks' | 'approvals' | 'audit' | 'admin';

export function MessageCapabilityTrace({
  message,
  onOpenContext,
}: {
  message: ChatMessageEx;
  onOpenContext: (tab: WorkbenchContextTab, messageId?: string, artifact?: SkillArtifactLink, options?: { startSlide?: number }) => void;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const toolCount = message.toolCalls?.length ?? 0;
  const citeCount = message.citations?.length ?? 0;
  const taskRef = message.linkedTaskId ?? message.approvalRequest?.ticketId;
  const hasApproval = Boolean(message.approvalRequest);
  if (!toolCount && !citeCount && !hasApproval && !taskRef) return null;
  const okTools = message.toolCalls?.filter((item) => item.status === 'success').length ?? 0;

  return (
    <div className="copilot-message-workcards flex max-w-[920px] flex-wrap items-center gap-1.5" aria-label="岗位能力调用与依据">
      {toolCount > 0 && (
        <button type="button" onClick={() => onOpenContext('audit', message.id)} className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand)]">
          <Wrench className="h-3 w-3 text-[var(--brand)]" />能力调用 {toolCount} · {okTools} 成功
        </button>
      )}
      {citeCount > 0 && (
        <button type="button" onClick={() => onOpenContext('evidence', message.id)} className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand)]">
          <Link2 className="h-3 w-3 text-[var(--brand)]" />依据 {citeCount}
        </button>
      )}
      {hasApproval && (
        <button type="button" onClick={() => onOpenContext('approvals', message.id)} className="inline-flex items-center gap-1 rounded-md border border-[var(--warning)]/40 bg-[var(--warning-bg)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:border-[var(--warning)]">
          <ShieldCheck className="h-3 w-3 text-[var(--warning)]" />受控审批 {message.approvalRequest!.signed}/{message.approvalRequest!.required}
        </button>
      )}
      {taskRef && (
        <button type="button" onClick={() => onOpenContext('tasks', message.id)} className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:border-[var(--brand)]">
          <ListChecksIcon className="h-3 w-3 text-[var(--brand)]" />任务 {taskRef}
        </button>
      )}
    </div>
  );
}

export function RiskDecisionCard({ onOpenContext, messageId }: {
  onOpenContext: (tab: WorkbenchContextTab, messageId?: string) => void;
  messageId: string;
}) {
  return (
    <section className="max-w-[760px] rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-bg)]/25 p-3" aria-label="风险处置建议">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)]" />风险处置建议
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
            已识别高风险项。建议先核验受影响资产，再生成受控修复任务并发起人工复核。
          </p>
        </div>
        <Badge tone="warn" className="shrink-0 text-[10px]">需复核</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => onOpenContext('evidence', messageId)}>查看受影响资产</Button>
        <Button size="sm" onClick={() => onOpenContext('tasks', messageId)}>生成修复任务</Button>
        <Button size="sm" variant="secondary" onClick={() => onOpenContext('approvals', messageId)}>发起人工复核</Button>
      </div>
    </section>
  );
}

export function Mini({ label, value, tone }: { label: string; value: ReactNode; tone?: 'success' }) {
  return (
    <span className="copilot-mini-stat">
      <span className="copilot-mini-stat__label">{label}</span>
      <span className={cn('copilot-mini-stat__value', tone === 'success' && 'is-success')}>{value}</span>
    </span>
  );
}

export function AgentDetailsCollapsed({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="copilot-agent-details-collapsed" onClick={onOpen}>
      打开专家上下文
    </button>
  );
}