/**
 * CopilotPage — ContextDrawerPanel (right aside tab body for evidence / tasks / approvals / audit / document).
 * Extracted from CopilotPage.tsx to satisfy file-size gates.
 */
import { Activity, FileText, Hash, Link2, ListChecksIcon, ShieldCheck } from 'lucide-react';
import { Badge } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { Citation, ChatMessageEx } from '@/hooks/types';
import type { SkillArtifactLink } from '@/features/copilot/lib/artifact-links';
import { DocumentPreviewPanel } from '@/features/copilot/components/DocumentPreview';
import type { WorkbenchContextTab } from '@/features/copilot/lib/workbench';

const SOURCE_COLOR: Record<string, string> = {
  知识库: 'text-[var(--brand)] bg-[var(--brand-light)]',
  文档: 'text-[var(--info)] bg-[var(--info-bg)]',
  记忆: 'text-[var(--success)] bg-[var(--success-bg)]',
};

export function ContextDrawerPanel({
  tab,
  messages,
  onCitation,
  focusedCitation,
  artifact,
  startSlide,
}: {
  tab: Exclude<WorkbenchContextTab, 'overview' | 'admin'>;
  messages: ChatMessageEx[];
  onCitation: (citation: Citation, messageId?: string) => void;
  focusedCitation?: Citation | null;
  artifact?: SkillArtifactLink;
  startSlide?: number;
}) {
  const evidence = messages.flatMap((message) =>
    (message.citations ?? []).map((citation) => ({ ...citation, __messageId: message.id })),
  );
  const tasks = messages.flatMap((message) => {
    const id = message.linkedTaskId ?? message.approvalRequest?.ticketId;
    return id
      ? [{ id, title: message.approvalRequest?.action ?? '会话关联任务', status: message.approvalRequest?.decision ?? 'pending' }]
      : [];
  });
  const approvals = messages.flatMap((message) =>
    message.approvalRequest ? [{ id: message.id, approval: message.approvalRequest }] : [],
  );
  const audit = messages.flatMap((message) => [
    ...(message.toolCalls ?? []).map((tool) => ({
      id: tool.id,
      time: message.createdAt,
      text: `${tool.name} · ${tool.status}`,
      tone: (tool.status === 'failed' || tool.status === 'denied' ? 'error' : 'success') as 'error' | 'success',
    })),
    ...(message.approvalRequest
      ? [
          {
            id: `${message.id}-approval`,
            time: message.createdAt,
            text: `审批 · ${message.approvalRequest.decision}`,
            tone: (message.approvalRequest.decision === 'rejected' ? 'error' : 'success') as 'error' | 'success',
          },
        ]
      : []),
  ]);
  const meta = {
    document: { label: '生成文档', hint: '阅读已落盘的 Word / PPT 预览', icon: FileText },
    evidence: { label: '证据引用', hint: '回答所依据的可追溯来源', icon: Link2 },
    tasks: { label: '关联任务', hint: '需要持续跟进的执行事项', icon: ListChecksIcon },
    approvals: { label: '审批队列', hint: '涉及人工确认的受控动作', icon: ShieldCheck },
    audit: { label: '审计记录', hint: '工具、审批与状态变更流水', icon: Activity },
  }[tab];
  const PanelIcon = meta.icon;
  const empty = (label: string) => (
    <div className="copilot-details-empty">
      <span className="copilot-details-empty__icon">
        <PanelIcon className="h-4 w-4" />
      </span>
      <strong>暂无{label}</strong>
      <span>当前会话还没有可展示的记录</span>
    </div>
  );

  if (tab === 'document') {
    return artifact ? <DocumentPreviewPanel artifact={artifact} startSlide={startSlide} /> : empty('生成文档');
  }
  if (tab === 'evidence') {
    return (
      <section className="copilot-details-panel">
        <div className="copilot-details-panel__intro">
          <div className="copilot-details-panel__title">
            <PanelIcon className="h-4 w-4" />
            {meta.label}
          </div>
          <div>{meta.hint}</div>
        </div>
        {focusedCitation ? (
          <div className="copilot-citation-focus">
            <div className="copilot-citation-focus__header">
              <span>
                <Hash className="mr-1 inline h-3 w-3 text-[var(--text-muted)]" />当前引用
              </span>
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                {focusedCitation.page ? `p.${focusedCitation.page}` : '可追溯'}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className={cn('nav-pill text-[9px]', SOURCE_COLOR[focusedCitation.source] ?? 'text-[var(--text-secondary)] bg-[var(--bg-elevated)]')}>
                {focusedCitation.source ?? focusedCitation.source ?? '来源'}
              </span>
              <span className="truncate text-xs font-semibold">
                {focusedCitation.docId ?? focusedCitation.source ?? '关联文档'}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2 text-[10px]">
              <span className="text-[var(--text-muted)]">相关度</span>
              <span className="copilot-confidence-bar">
                <span style={{ width: `${(focusedCitation.score ?? 0) * 100}%` }} />
              </span>
              <span className="font-mono text-[var(--success)]">
                {((focusedCitation.score ?? 0) * 100).toFixed(0)}%
              </span>
            </div>
            <div className="copilot-citation-focus__text">
              {focusedCitation.text ??
                '已定位到该来源。当前引用由会话检索结果生成，可继续回到中栏查看关联消息。'}
            </div>
          </div>
        ) : null}
        {evidence.length ? (
          <div className="copilot-details-list">
            {evidence.map((citation) => (
              <button
                key={citation.id}
                type="button"
                onClick={() => onCitation(citation, citation.__messageId)}
                className={cn(
                  'copilot-context-item copilot-context-item--button',
                  focusedCitation?.id === citation.id && 'is-focused',
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn('nav-pill text-[9px]', SOURCE_COLOR[citation.source] ?? 'text-[var(--text-secondary)] bg-[var(--bg-elevated)]')}>
                    {citation.source}
                  </span>
                  <span className="truncate text-xs font-semibold">{citation.docId || citation.source}</span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[10px]">
                  <span className="text-[var(--text-muted)]">置信度</span>
                  <span className="copilot-confidence-bar">
                    <span style={{ width: `${citation.score * 100}%` }} />
                  </span>
                  <span className="font-mono text-[var(--text-secondary)]">{(citation.score * 100).toFixed(0)}%</span>
                  <span className="ml-auto text-[var(--text-muted)]">{citation.page ? `p.${citation.page}` : '可追溯'}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          empty('证据')
        )}
      </section>
    );
  }
  if (tab === 'tasks') {
    return (
      <section className="copilot-details-panel">
        <div className="copilot-details-panel__intro">
          <div className="copilot-details-panel__title">
            <PanelIcon className="h-4 w-4" />
            {meta.label}
          </div>
          <div>{meta.hint}</div>
        </div>
        {tasks.length ? (
          <div className="copilot-details-list">
            {tasks.map((task) => (
              <div key={task.id} className="copilot-context-item">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-semibold">{task.title}</span>
                  <Badge tone={task.status === 'approved' ? 'success' : 'warn'}>
                    {task.status === 'approved' ? '已通过' : '待处理'}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                  <span>任务 ID</span>
                  <span className="font-mono">{task.id}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          empty('关联任务')
        )}
      </section>
    );
  }
  if (tab === 'approvals') {
    return (
      <section className="copilot-details-panel">
        <div className="copilot-details-panel__intro">
          <div className="copilot-details-panel__title">
            <PanelIcon className="h-4 w-4" />
            {meta.label}
          </div>
          <div>{meta.hint}</div>
        </div>
        {approvals.length ? (
          <div className="copilot-details-list">
            {approvals.map(({ id, approval }) => (
              <div key={id} className="copilot-context-item copilot-context-item--approval">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-semibold">受控审批</span>
                  <Badge
                    tone={
                      approval.decision === 'approved'
                        ? 'success'
                        : approval.decision === 'rejected'
                          ? 'error'
                          : 'warn'
                    }
                  >
                    {approval.decision === 'approved'
                      ? '已通过'
                      : approval.decision === 'rejected'
                        ? '已拒绝'
                        : '待审批'}
                  </Badge>
                </div>
                <p className="mt-2 break-words text-[11px] leading-5 text-[var(--text-secondary)]">
                  {approval.action}
                </p>
                <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                  <span>签署进度</span>
                  <span className="font-mono">
                    {approval.signed}/{approval.required} 已签
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          empty('待审批事项')
        )}
      </section>
    );
  }
  return (
    <section className="copilot-details-panel">
      <div className="copilot-details-panel__intro">
        <div className="copilot-details-panel__title">
          <PanelIcon className="h-4 w-4" />
          {meta.label}
        </div>
        <div>{meta.hint}</div>
      </div>
      {audit.length ? (
        <div className="copilot-details-list">
          {audit.map((item) => (
            <div key={item.id} className="copilot-context-item copilot-context-item--audit">
              <span className={cn('copilot-audit-dot', item.tone === 'error' ? 'copilot-audit-dot--error' : 'copilot-audit-dot--success')} />
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[var(--text)]">{item.text}</div>
                <div className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">
                  {item.time.slice(11, 19)} · {item.id}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        empty('审计事件')
      )}
    </section>
  );
}