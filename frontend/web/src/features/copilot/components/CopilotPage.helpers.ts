/**
 * CopilotPage helpers — interfaces, types, constants, and pure helpers.
 * Extracted from CopilotPage.tsx to satisfy file-size gates.
 */
import { Bot, BriefcaseBusiness, Download, FileText, ListChecks, Search, Sparkles, Users, Wrench, Workflow, X } from 'lucide-react';
import type { ChatSession, MessageStatus, Signer } from '@/hooks/types';
import { parseReasoningEffort, parseRunMode } from '@/features/copilot/lib/composer-mode';
import { formatShanghaiDate, formatShanghaiTime, parseDate, SHANGHAI_TIME_ZONE } from '@/features/copilot/lib/shanghai-time';

export interface SessionItem {
  id: string;
  workspaceId?: string;
  ownerId?: string;
  correlationId?: string;
  conversationId?: string;
  title?: string;
  preview?: string;
  agent?: string;
  digitalPartnerId?: string;
  digitalPartnerName?: string;
  status?: 'active' | 'done' | 'closed' | 'archived' | string;
  createdAt?: string;
  updatedAt?: string;
  lastMessageAt?: string;
  pinned?: boolean;
  unread?: number;
  sessionMode?: 'investigate' | 'execute' | string;
  runMode?: 'ask' | 'plan' | 'agent' | string;
  reasoningEffort?: 'off' | 'standard' | 'deep' | string;
  riskLevel?: 'low' | 'medium' | 'high' | string;
  handoff?: { active?: boolean; ownerId?: string; ownerName?: string; at?: string; note?: string };
  closeSummary?: string;
  shareToken?: string;
}

export function sessionGroup(lastMessageAt: string | undefined | null): ChatSession['group'] {
  const day = parseDate(lastMessageAt);
  if (!day) return 'earlier';
  const today = new Date();
  const delta = Math.floor(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
      - new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()) / 86_400_000,
  );
  return delta <= 0 ? 'today' : delta === 1 ? 'yesterday' : delta < 7 ? 'week' : 'earlier';
}

export function sessionTime(lastMessageAt: string | undefined | null) {
  const date = parseDate(lastMessageAt);
  if (!date) return '—';
  const today = new Date();
  const sameDay = formatShanghaiDate(date) === formatShanghaiDate(today);
  return sameDay
    ? formatShanghaiTime(date)
    : new Intl.DateTimeFormat('zh-CN', { timeZone: SHANGHAI_TIME_ZONE, month: 'numeric', day: 'numeric' }).format(date);
}

export function toChatSession(session: SessionItem): ChatSession {
  const stamp = session.lastMessageAt || session.updatedAt || session.createdAt;
  const created = parseDate(session.createdAt)?.getTime() ?? parseDate(stamp)?.getTime() ?? Date.now();
  const updated = parseDate(session.updatedAt)?.getTime() ?? parseDate(stamp)?.getTime() ?? created;
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    ownerId: session.ownerId,
    conversationId: session.conversationId ?? session.id,
    title: session.title || '未命名会话',
    preview: session.preview || '暂无消息',
    agent: session.digitalPartnerName ?? session.agent ?? (session.digitalPartnerId ? '岗位专家' : '助手'),
    digitalPartnerId: session.digitalPartnerId,
    digitalPartnerName: session.digitalPartnerName ?? session.agent,
    status: session.status === 'closed' || session.status === 'done'
      ? 'closed'
      : session.status === 'archived' ? 'archived' : 'active',
    lifecycle: session.status === 'closed' || session.status === 'done' ? 'idle' : 'active',
    group: sessionGroup(stamp),
    time: sessionTime(stamp),
    pinned: session.pinned,
    messages: [],
    createdAt: created,
    lastActiveAt: updated,
    sessionMode: session.sessionMode === 'execute' ? 'execute' : 'investigate',
    runMode: parseRunMode(session.runMode) ?? undefined,
    reasoningEffort: parseReasoningEffort(session.reasoningEffort) ?? undefined,
    riskLevel: session.riskLevel === 'high' || session.riskLevel === 'low' ? session.riskLevel : 'medium',
    handoff: session.handoff,
    closeSummary: session.closeSummary,
    shareToken: session.shareToken,
  };
}

export function sessionInWorkspace(
  session: Pick<ChatSession, 'id' | 'workspaceId'> | SessionItem | undefined,
  workspaceId: string,
) {
  if (!session?.id) return false;
  return (session.workspaceId ?? 'w1') === workspaceId;
}

export const escapeHtml = (value: string) =>
  value.replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char] ?? char));

export const STATUS_TONE: Record<MessageStatus, string> = {
  queued: 'neutral',
  in_flight: 'info',
  streaming: 'info',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'neutral',
  expired: 'warn',
  moderated: 'error',
};

export const SLASH_ICON: Record<string, any> = {
  Bot, Search, ListChecks, Wrench, Workflow, FileText, Sparkles, Users, X, Download,
};

export interface AgentMeta {
  id: string; name: string; version: string; category: string;
  rating: number; ratingCount: number; lastActive: string;
  installCount: number; responseP95: number; totalTokens: number;
  sla: number; errorRate: number; knowledgeBases: number; tools: number; languages: string[];
  description?: string;
}

export interface ContextSelection {
  open: boolean;
  scope: 'message' | 'session';
  tab: import('@/features/copilot/lib/workbench').WorkbenchContextTab;
  messageId?: string;
  artifact?: import('@/features/copilot/lib/artifact-links').SkillArtifactLink;
  startSlide?: number;
  pinned: boolean;
}

export interface ComposerAttachment {
  name: string;
  size: string;
  type: 'file' | 'image';
  id?: string;
  uploading?: boolean;
  error?: string;
}

export const SOURCE_COLOR: Record<string, string> = {
  知识库: 'text-[var(--brand)] bg-[var(--brand-light)]',
  文档: 'text-[var(--info)] bg-[var(--info-bg)]',
  记忆: 'text-[var(--success)] bg-[var(--success-bg)]',
};

export const EXPECTED_ROLES: Record<Signer['role'], 'user' | 'admin' | 'auditor'> = {
  operator: 'user',
  approver: 'admin',
  auditor: 'auditor',
};

export interface CurrentUserIdentity {
  id: string;
  name: string;
  role: 'user' | 'admin' | 'auditor';
}

// Re-export for callers that imported from CopilotPage.helpers
export { parseDate, formatShanghaiDate, formatShanghaiTime, SHANGHAI_TIME_ZONE };
