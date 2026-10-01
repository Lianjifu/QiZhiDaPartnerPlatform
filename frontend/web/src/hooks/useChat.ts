/**
 * 会话状态管理 hook — 企业级
 *
 * 能力：
 *  - 消息状态机（queued / in_flight / streaming / succeeded / failed / cancelled / expired / moderated）
 *  - 多会话管理（增/删/置顶/星标/分享/归档/TTL）
 *  - 输入 + 草稿 + 历史（↑↓）+ @ 提及
 *  - 流式响应（chunk 级增量、AbortController、可重试）
 *  - 错误分类（network / auth / timeout / rate_limit / content_filter / tool_denied / internal）
 *  - 用户反馈（like / dislike + 标签 + 备注 → RAG eval / 训练）
 *  - 双签审批（operator + auditor + 时间戳 + hash）
 *  - Reasoning / Tool / RAG / 安全字段
 *  - 调试：请求日志（requestId / correlationId / TTFT / tokens / status）
 *  - 持久化：localStorage（带版本 + 容量上限 + 字段裁剪）
 *
 * 兼容：
 *  - 旧 API（setDraft / newSession / delSession / switchSession / togglePin / toggleStar /
 *    send / stop / regenerate / delMessage / approveSign）保持签名与行为
 *  - 旧 state 字段（sessions / activeId / draftInput / typing / inputHistory / requests）保留
 *  - 旧 ChatMessageEx 字段保留（同时新增企业级字段）
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { getApiClient } from '@qzda/web-api';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import { isMockChatMode, streamCopilotTurn, type CopilotSSEEvent } from '@/features/copilot/lib/copilot-stream';
import { applySegmentSSEEvent, createSegmentRouter } from '@/features/copilot/lib/copilot-segment-router';
import { orderAssistantSegments } from '@/features/copilot/lib/segment-message-order';
import { DEFAULT_REPLY_MODE } from '@/features/copilot/lib/composer-mode';
import { fetchCopilotTurnStatus, TURN_RECOVERY_POLL_MS } from '@/features/copilot/lib/pending-turn-recovery';
import {
  appendHumanThought,
  progressLabelFromEvent,
  toHumanThoughtStep,
} from '@/features/copilot/lib/human-thought';
import { parseTurnMeta } from '@/features/copilot/turn-narrative/build-turn-summary';
import { dedupeTurnTasks, mergeTurnTasks } from '@/features/copilot/turn-narrative/turn-task-list';
import {
  isArtifactSegmentEvent,
  mergeArtifactBlockIntoContent,
} from '@/features/copilot/lib/artifact-segment';
import { capSessionMessages } from '@/features/copilot/lib/context-limits';
import { dedupeConversationMessages } from '@/features/copilot/lib/conversation-merge';
import { clearCopilotLastSession, rememberCopilotSession } from '@/lib/copilot-workspace';
import type {
  ChatMessageEx,
  ChatSession,
  PendingTurn,
  SendMessageInput,
  MessageStatus,
  ErrorCategory,
  FeedbackKind,
  FeedbackTag,
  Signer,
  MessageMetrics,
  Citation,
  ToolCall,
  ReasoningStep,
  SafetyInfo,
  ApprovalDecision,
} from './types';
export type { ChatMessageEx, ChatSession };

/* ============ 公共类型 ============ */

export interface RequestLog {
  id: string;
  /** 链路追踪 ID（与消息 correlationId 对齐） */
  correlationId: string;
  ts: number;
  op: 'send' | 'regenerate' | 'stop' | 'approve' | 'delete' | 'create' | 'archive' | 'share' | 'export' | 'feedback';
  mid?: string;
  sid?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  /** 首 token 时间 */
  ttftMs?: number;
  status: 'pending' | 'streaming' | 'success' | 'aborted' | 'error';
  errorCategory?: ErrorCategory;
  error?: string;
}

interface State {
  /* 兼容字段 */
  sessions: Record<string, ChatSession>;
  activeId: string;
  draftInput: string;
  inputHistory: string[];
  typing: boolean;
  abortRef: { current: AbortController | null };
  requests: RequestLog[];

  /* 新增 */
  /** 当前活跃请求 ID（用于 UI 关联） */
  activeCorrelationId: string | null;
  /** 调试面板开关 */
  debugOpen: boolean;
  /** 持久化 schema 版本 */
  schemaVersion: number;
}

function parseNextRunCommandFromContent(content?: string): string {
  if (!content) return '';
  const m = content.match(/action=run\s+command=(\S+)/);
  return m?.[1] ?? '';
}

function isSkillExecuteFailure(result: string): boolean {
  const text = result.trim();
  if (!text) return true;
  if (text.startsWith('执行失败')) return true;
  if (text.includes('【预检失败】')) return true;
  if (text.includes('【skill.run】拒绝')) return true;
  if (/"status"\s*:\s*"error"/.test(text)) return true;
  if (/Unknown command:/i.test(text)) return true;
  if (/script not found/i.test(text)) return true;
  if (/PPTX dependencies are missing/i.test(text)) return true;
  return false;
}

function skillTurnHasFailedStep(skillTurn?: { steps?: Array<{ status?: string }> }): boolean {
  return (skillTurn?.steps ?? []).some((s) => s.status === 'failed' || s.status === 'needs_instruction');
}

function skillTurnRunCommandFromMessage(message: ChatMessageEx): string {
  const steps = message.approvalRequest?.skillTurn?.steps;
  if (!steps?.length) return '';
  for (const step of steps) {
    if (step.action === 'run') {
      const cmd = step.args?.command;
      if (typeof cmd === 'string' && cmd.trim()) return cmd.trim();
    }
  }
  return '';
}

type Action =
  /* 兼容 */
  | { type: 'set_draft'; value: string }
  | { type: 'push_history'; value: string }
  | { type: 'new_session'; session: ChatSession }
  | { type: 'merge_sessions'; sessions: ChatSession[] }
  | { type: 'reconcile_sessions'; workspaceId: string; serverIds: string[] }
  | { type: 'sync_session'; session: ChatSession; preserveGovernance?: boolean }
  | { type: 'del_session'; id: string }
  | { type: 'clear_active' }
  | { type: 'switch'; id: string }
  | { type: 'pin'; id: string; pinned: boolean }
  | { type: 'star'; id: string; starred: boolean }
  | { type: 'append_msg'; sid: string; msg: ChatMessageEx }
  | { type: 'replace_msg'; sid: string; mid: string; msg: ChatMessageEx }
  | { type: 'order_segment_messages'; sid: string; correlationId: string }
  | { type: 'del_msg'; sid: string; mid: string }
  | { type: 'regenerate'; sid: string; mid: string; msg: ChatMessageEx }
  | { type: 'replace_from_message'; sid: string; mid: string; msg: ChatMessageEx }
  | { type: 'update_session'; sid: string; patch: Partial<ChatSession> }
  | { type: 'set_typing'; typing: boolean }
  | { type: 'stop_typing' }
  | { type: 'set_abort'; ctrl: AbortController | null }
  | { type: 'clear_unread'; id: string }
  | { type: 'log_request'; log: RequestLog }
  | { type: 'update_request'; id: string; patch: Partial<RequestLog> }
  | { type: 'clear_requests' }
  /* 新增 */
  | { type: 'set_msg_status'; sid: string; mid: string; status: MessageStatus; error?: ChatMessageEx['error'] }
  | { type: 'set_feedback'; sid: string; mid: string; feedback: ChatMessageEx['feedback'] }
  | { type: 'set_metrics'; sid: string; mid: string; metrics: Partial<MessageMetrics> }
  | { type: 'append_reasoning_step'; sid: string; mid: string; step: ReasoningStep }
  | { type: 'set_safety'; sid: string; mid: string; safety: SafetyInfo }
  | { type: 'approve'; sid: string; mid: string; signerIndex: number; signedAt: string; signatureHash: string }
  | { type: 'reject'; sid: string; mid: string; signerIndex: number; reason?: string }
  | { type: 'archive_session'; id: string; archived: boolean }
  | { type: 'set_share_token'; id: string; token: string | null }
  | { type: 'set_active_correlation'; id: string | null }
  | { type: 'set_debug'; open: boolean }
  | { type: 'hydrate'; state: State };

/* ============ 常量 ============ */

const STORAGE_KEY = 'de-chat-state';
/** 已删除会话 tombstone，刷新/重启后仍阻止服务端列表回灌 */
const DELETED_TOMBSTONES_KEY = 'de-chat-deleted-tombstones';
/** v8：专家协助按工作区隔离 active；升级时丢弃全局 activeId */
const STORAGE_VERSION = 9;
const MAX_SESSIONS = 200; // 总会话上限
const MAX_MESSAGES_PER_SESSION = 500; // 单会话消息上限
const MAX_REQUESTS = 200; // 请求日志上限
const MAX_INPUT_HISTORY = 20;
const MAX_CHARS_DEFAULT = 4000;
const STREAM_CHUNK_MS = 24;
const STREAM_TICK_MS = 120;
const DEFAULT_TIMEOUT_MS = 150_000;
const MAX_RETRY = 1;

/* ============ 工具函数 ============ */

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function previewOf(m: ChatMessageEx): string {
  const c = m.content ?? '';
  return c.length > 50 ? c.slice(0, 50) : c;
}

export function uid(prefix = ''): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

function correlationId(): string {
  return `corr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function newSigner(userId: string, name: string, role: Signer['role'] = 'approver'): Signer {
  return { userId, name, role, signed: false };
}

/* ============ 初始 state ============ */

const initial: State = {
  sessions: {},
  activeId: '',
  draftInput: '',
  inputHistory: [],
  typing: false,
  abortRef: { current: null },
  requests: [],
  activeCorrelationId: null,
  debugOpen: false,
  schemaVersion: STORAGE_VERSION,
};

/* ============ Reducer ============ */

function reducer(s: State, a: Action): State {
  switch (a.type) {
    /* ---- 兼容 ---- */
    case 'set_draft':
      return { ...s, draftInput: a.value };
    case 'push_history': {
      const prev = s.inputHistory ?? [];
      return { ...s, inputHistory: [a.value, ...prev.filter((x) => x !== a.value)].slice(0, MAX_INPUT_HISTORY) };
    }
    case 'new_session': {
      const next = { ...s.sessions, [a.session.id]: a.session };
      // 总数上限保护
      const ids = Object.keys(next);
      let trimmed = next;
      if (ids.length > MAX_SESSIONS) {
        const overflow = ids.slice(0, ids.length - MAX_SESSIONS);
        trimmed = { ...next };
        overflow.forEach((k) => delete trimmed[k]);
      }
      return { ...s, sessions: trimmed, activeId: a.session.id };
    }
    case 'merge_sessions': {
      // 服务端历史：补齐缺失会话，并刷新已有会话的元数据；本地已有消息优先保留，等 conversation sync 再对齐。
      let changed = false;
      const merged = { ...s.sessions };
      a.sessions.forEach((session) => {
        if (!session.id) return;
        const existing = merged[session.id];
        if (!existing) {
          merged[session.id] = session;
          changed = true;
          return;
        }
        const keepMessages = (existing.messages?.length ?? 0) > 0
          ? existing.messages
          : (session.messages ?? []);
        const next: ChatSession = {
          ...existing,
          ...session,
          messages: keepMessages,
          pendingServerSync: false,
          // 列表投影常缺 runMode / reasoningEffort，勿用 undefined 冲掉本地已选
          runMode: session.runMode ?? existing.runMode,
          reasoningEffort: session.reasoningEffort ?? existing.reasoningEffort,
          sessionMode: session.sessionMode ?? existing.sessionMode,
          riskLevel: session.riskLevel ?? existing.riskLevel,
          replyMode: session.replyMode ?? existing.replyMode,
        };
        if (
          next.title !== existing.title
          || next.preview !== existing.preview
          || next.status !== existing.status
          || next.lifecycle !== existing.lifecycle
          || next.conversationId !== existing.conversationId
          || next.workspaceId !== existing.workspaceId
          || next.sessionMode !== existing.sessionMode
          || next.runMode !== existing.runMode
          || next.reasoningEffort !== existing.reasoningEffort
          || next.riskLevel !== existing.riskLevel
          || next.digitalPartnerId !== existing.digitalPartnerId
          || next.pinned !== existing.pinned
          || next.lastActiveAt !== existing.lastActiveAt
          || next.messages !== existing.messages
        ) {
          merged[session.id] = next;
          changed = true;
        }
      });
      return changed ? { ...s, sessions: merged } : s;
    }
    case 'reconcile_sessions': {
      // 服务端列表为当前工作区权威源：去掉本地仍挂着、服务端已不存在的会话，避免侧栏空、主区仍显示残留。
      // 空 serverIds 表示「无权威清单」（权限过滤 / 空响应），不得整表清空。
      if (a.serverIds.length === 0) return s;
      const server = new Set(a.serverIds);
      const now = Date.now();
      let changed = false;
      const next = { ...s.sessions };
      for (const id of Object.keys(next)) {
        const session = next[id];
        const ws = session.workspaceId ?? 'w1';
        if (ws !== a.workspaceId) continue;
        // 尚未落库的本地草稿（s_*）保留
        if (/^s_/.test(id)) continue;
        if (server.has(id)) continue;
        // 保护：当前活跃、待列表同步、已有本地消息、刚创建的会话
        if (s.activeId === id) continue;
        if (session.pendingServerSync) continue;
        if ((session.messages?.length ?? 0) > 0) continue;
        if (typeof session.createdAt === 'number' && now - session.createdAt < 5 * 60_000) continue;
        delete next[id];
        changed = true;
      }
      if (!changed) return s;
      const activeStill = Boolean(s.activeId && next[s.activeId]);
      return { ...s, sessions: next, activeId: activeStill ? s.activeId : '' };
    }
    case 'sync_session': {
      const existing = s.sessions[a.session.id];
      if (!a.session.id) return s;
      // 服务端详情覆盖会话事实字段；正在输入的草稿不属于会话详情，仍保留在全局 state。
      // 勿用空消息覆盖本地已有记录（刷新后 conversation 尚未灌入或暂空时的常见误伤）。
      const incomingMessages = a.session.messages ?? [];
      const keepLocalMessages = Boolean(existing && (existing.messages?.length ?? 0) > 0 && incomingMessages.length === 0);
      const merged = existing
        ? {
            ...existing,
            ...a.session,
            messages: dedupeConversationMessages(
              keepLocalMessages ? existing.messages : incomingMessages,
            ),
          }
        : { ...a.session, messages: dedupeConversationMessages(incomingMessages) };
      // 消息 hydrate 不得冲掉本地已切换的研判/受控执行等治理字段
      const next = existing && a.preserveGovernance
        ? {
            ...merged,
            sessionMode: existing.sessionMode,
            runMode: existing.runMode,
            reasoningEffort: existing.reasoningEffort,
            riskLevel: existing.riskLevel,
            handoff: existing.handoff,
            closeSummary: existing.closeSummary,
            status: existing.status,
            lifecycle: existing.lifecycle,
          }
        : merged;
      if (
        existing
        && existing.messages === next.messages
        && existing.preview === next.preview
        && existing.title === next.title
        && existing.status === next.status
        && existing.lifecycle === next.lifecycle
        && existing.digitalPartnerId === next.digitalPartnerId
        && existing.sessionMode === next.sessionMode
        && existing.riskLevel === next.riskLevel
        && (existing.unread ?? 0) === (next.unread ?? 0)
      ) {
        return s;
      }
      return { ...s, sessions: { ...s.sessions, [a.session.id]: next } };
    }
    case 'del_session': {
      const next = { ...s.sessions };
      const removed = next[a.id];
      delete next[a.id];
      if (s.activeId !== a.id) return { ...s, sessions: next };
      const ws = removed?.workspaceId ?? 'w1';
      const firstSame = Object.values(next).find((sess) => (sess.workspaceId ?? 'w1') === ws);
      return { ...s, sessions: next, activeId: firstSame?.id ?? '' };
    }
    case 'clear_active':
      return s.activeId ? { ...s, activeId: '' } : s;
    case 'switch': {
      if (!a.id || s.activeId === a.id) return s;
      const target = s.sessions[a.id];
      if (!target) return s;
      const needsClear = (target.unread ?? 0) > 0;
      return {
        ...s,
        activeId: a.id,
        sessions: needsClear
          ? { ...s.sessions, [a.id]: { ...target, unread: 0 } }
          : s.sessions,
      };
    }
    case 'pin':
      return { ...s, sessions: { ...s.sessions, [a.id]: { ...s.sessions[a.id], pinned: a.pinned } } };
    case 'star':
      return { ...s, sessions: { ...s.sessions, [a.id]: { ...s.sessions[a.id], starred: a.starred } } };
    case 'append_msg': {
      const sess = s.sessions[a.sid];
      if (!sess) return s;
      const idx = sess.messages.findIndex((m) =>
        m.id === a.msg.id
        || (a.msg.clientMsgId && m.clientMsgId === a.msg.clientMsgId)
        || (a.msg.serverMsgId && (m.serverMsgId === a.msg.serverMsgId || m.id === a.msg.serverMsgId)),
      );
      const messages = idx >= 0
        ? sess.messages.map((m, i) => (i === idx ? { ...m, ...a.msg } : m))
        : capMessages([...sess.messages, a.msg]);
      const updated: ChatSession = {
        ...sess,
        messages,
        preview: previewOf(a.msg),
        status: 'active',
        time: nowHHMM(),
        lastActiveAt: Date.now(),
      };
      return { ...s, sessions: { ...s.sessions, [a.sid]: updated } };
    }
    case 'replace_msg': {
      const sess = s.sessions[a.sid];
      if (!sess) return s;
      const idx = sess.messages.findIndex((m) => m.id === a.mid);
      const messages = idx >= 0
        ? sess.messages.map((m) => (m.id === a.mid ? a.msg : m))
        : capMessages([...sess.messages, a.msg]);
      return { ...s, sessions: { ...s.sessions, [a.sid]: { ...sess, messages, lastActiveAt: Date.now() } } };
    }
    case 'order_segment_messages': {
      const sess = s.sessions[a.sid];
      if (!sess) return s;
      const ordered = orderAssistantSegments(sess.messages);
      if (ordered === sess.messages) return s;
      return { ...s, sessions: { ...s.sessions, [a.sid]: { ...sess, messages: ordered, lastActiveAt: Date.now() } } };
    }
    case 'del_msg': {
      const sess = s.sessions[a.sid];
      if (!sess) return s;
      return { ...s, sessions: { ...s.sessions, [a.sid]: { ...sess, messages: sess.messages.filter((m) => m.id !== a.mid) } } };
    }
    case 'regenerate': {
      const sess = s.sessions[a.sid];
      if (!sess) return s;
      const idx = sess.messages.findIndex((m) => m.id === a.mid);
      if (idx < 0) return s;
      const messages = [...sess.messages.slice(0, idx), a.msg, ...sess.messages.slice(idx + 1)];
      return { ...s, sessions: { ...s.sessions, [a.sid]: { ...sess, messages, lastActiveAt: Date.now() } } };
    }
    case 'replace_from_message': {
      const sess = s.sessions[a.sid];
      if (!sess) return s;
      const idx = sess.messages.findIndex((m) => m.id === a.mid);
      if (idx < 0) return s;
      return { ...s, sessions: { ...s.sessions, [a.sid]: { ...sess, messages: [...sess.messages.slice(0, idx), a.msg], lastActiveAt: Date.now() } } };
    }
    case 'update_session':
      return { ...s, sessions: { ...s.sessions, [a.sid]: { ...s.sessions[a.sid], ...a.patch } } };
    case 'set_typing':
      return { ...s, typing: a.typing };
    case 'stop_typing':
      if (s.abortRef.current) s.abortRef.current.abort();
      return { ...s, typing: false, abortRef: { current: null } };
    case 'set_abort':
      return { ...s, abortRef: { current: a.ctrl } };
    case 'clear_unread': {
      const sess = s.sessions[a.id];
      // 缺失会话不得写入幽灵对象；已清零则保持引用，避免触发更新环
      if (!sess || (sess.unread ?? 0) === 0) return s;
      return { ...s, sessions: { ...s.sessions, [a.id]: { ...sess, unread: 0 } } };
    }
    case 'log_request':
      return { ...s, requests: [a.log, ...s.requests].slice(0, MAX_REQUESTS) };
    case 'update_request': {
      const reqs = s.requests.map((r) => (r.id === a.id ? { ...r, ...a.patch } : r));
      return { ...s, requests: reqs };
    }
    case 'clear_requests':
      return { ...s, requests: [] };

    /* ---- 新增 ---- */
    case 'set_msg_status': {
      const sess = s.sessions[a.sid];
      if (!sess) return s;
      const messages = sess.messages.map((m) =>
        m.id === a.mid ? { ...m, status: a.status, error: a.error ?? m.error } : m,
      );
      return { ...s, sessions: { ...s.sessions, [a.sid]: { ...sess, messages } } };
    }
    case 'set_feedback': {
      const sess = s.sessions[a.sid];
      if (!sess) return s;
      const messages = sess.messages.map((m) =>
        m.id === a.mid ? { ...m, feedback: { ...(m.feedback ?? { kind: null }), ...(a.feedback ?? { kind: null }) } } : m,
      );
      return { ...s, sessions: { ...s.sessions, [a.sid]: { ...sess, messages } } };
    }
    case 'set_metrics': {
      const sess = s.sessions[a.sid];
      if (!sess) return s;
      const messages = sess.messages.map((m) =>
        m.id === a.mid ? { ...m, metrics: { ...(m.metrics ?? {}), ...a.metrics } } : m,
      );
      return { ...s, sessions: { ...s.sessions, [a.sid]: { ...sess, messages } } };
    }
    case 'append_reasoning_step': {
      const sess = s.sessions[a.sid];
      if (!sess) return s;
      const messages = sess.messages.map((m) =>
        m.id === a.mid
          ? { ...m, reasoningSteps: [...(m.reasoningSteps ?? []), a.step] }
          : m,
      );
      return { ...s, sessions: { ...s.sessions, [a.sid]: { ...sess, messages } } };
    }
    case 'set_safety': {
      const sess = s.sessions[a.sid];
      if (!sess) return s;
      const messages = sess.messages.map((m) => (m.id === a.mid ? { ...m, safety: a.safety } : m));
      return { ...s, sessions: { ...s.sessions, [a.sid]: { ...sess, messages } } };
    }
    case 'approve': {
      const sess = s.sessions[a.sid];
      if (!sess) return s;
      const messages = sess.messages.map((m) => {
        if (m.id !== a.mid || !m.approvalRequest) return m;
        const ar = m.approvalRequest;
        if (ar.signed >= ar.required) return m;
        const signers = ar.signers.map((sg, i) =>
          i === a.signerIndex && !sg.signed
            ? { ...sg, signed: true, signedAt: a.signedAt, signatureHash: a.signatureHash }
            : sg,
        );
        const signed = signers.filter((sg) => sg.signed).length;
        const decision: ApprovalDecision = signed >= ar.required ? 'approved' : 'pending';
        const nextApproval = {
          ...ar,
          signers,
          signed,
          decision,
          decidedAt: signed >= ar.required ? new Date().toISOString() : ar.decidedAt,
        } as typeof m.approvalRequest;
        return { ...m, approvalRequest: nextApproval };
      });
      return { ...s, sessions: { ...s.sessions, [a.sid]: { ...sess, messages } } };
    }
    case 'reject': {
      const sess = s.sessions[a.sid];
      if (!sess) return s;
      const messages = sess.messages.map((m) => {
        if (m.id !== a.mid || !m.approvalRequest) return m;
        const ar = m.approvalRequest;
        const signers = ar.signers.map((sg, i) =>
          i === a.signerIndex ? { ...sg, signed: true, signedAt: new Date().toISOString(), signatureHash: uid('sig_') } : sg,
        );
        return {
          ...m,
          approvalRequest: {
            ...ar,
            signers,
            signed: ar.signed + 1,
            decision: 'rejected' as const,
            decidedAt: new Date().toISOString(),
          } as typeof m.approvalRequest,
        };
      });
      return { ...s, sessions: { ...s.sessions, [a.sid]: { ...sess, messages } } };
    }
    case 'archive_session': {
      const sess = s.sessions[a.id];
      if (!sess) return s;
      return {
        ...s,
        sessions: {
          ...s.sessions,
          [a.id]: {
            ...sess,
            lifecycle: a.archived ? 'archived' : 'active',
            archivedAt: a.archived ? Date.now() : undefined,
            group: a.archived ? 'archived' : sess.group,
          },
        },
      };
    }
    case 'set_share_token': {
      const sess = s.sessions[a.id];
      if (!sess) return s;
      return { ...s, sessions: { ...s.sessions, [a.id]: { ...sess, shareToken: a.token ?? undefined } } };
    }
    case 'set_active_correlation':
      return { ...s, activeCorrelationId: a.id };
    case 'set_debug':
      return { ...s, debugOpen: a.open };
    case 'hydrate':
      return a.state;
  }
}

/* 限制单会话消息数量（保留首条 + 尾部若干，加一条系统摘要占位） */
function capMessages(msgs: ChatMessageEx[]): ChatMessageEx[] {
  return capSessionMessages(msgs, MAX_MESSAGES_PER_SESSION);
}

/* ============ mock agent 回复生成器（兼容旧版 + 扩展企业级字段） ============ */

interface ReplyMock {
  id?: string;
  role: 'assistant';
  agentName: string;
  content: string;
  thinkingSummary?: string;
  reasoningSteps?: ReasoningStep[];
  citations?: Citation[];
  toolCalls?: ToolCall[];
  approvalRequest?: ChatMessageEx['approvalRequest'];
  safety?: SafetyInfo;
  metrics?: MessageMetrics;
}

const REPLY_TEMPLATES: { match: RegExp; reply: (q: string) => ReplyMock }[] = [
  {
    match: /(redis|缓存|cache)/i,
    reply: (q) => ({
      role: 'assistant',
      agentName: 'SRE 故障处置专员',
      content: '已检测到 Redis 相关问题。正在按 Runbook §3.1 执行：\n1. 检查 maxmemory-policy（当前 noeviction）\n2. 临时扩容到 16GB（需双重审批）\n3. 切换 volatile-lru 策略\n4. 监控 OOM 频率',
      thinkingSummary: '用户提到 Redis，先查 maxmemory-policy + 最近写入速率。',
      reasoningSteps: [
        { id: uid('r_'), kind: 'plan', title: '识别问题域', detail: '关键词命中 Redis，定位缓存层', startedAt: now(), endedAt: now() },
        { id: uid('r_'), kind: 'search', title: '检索 Runbook', detail: '召回 2 篇：Redis OOM 处置 v3.2、CMDB 资产表' },
        { id: uid('r_'), kind: 'tool_call', title: '执行 redis-cli INFO memory', toolCallIds: ['t1'] },
        { id: uid('r_'), kind: 'tool_call', title: '执行 redis-cli CONFIG GET maxmemory*', toolCallIds: ['t2'] },
        { id: uid('r_'), kind: 'finalize', title: '生成修复方案' },
      ],
      citations: [
        { id: 'c1', docId: 'rb-redis-oom', chunkId: 'rb-12-3', source: 'Runbook', page: 12, score: 0.92, rerankScore: 0.94, evalLabel: 'useful', text: '当触发 OOM 时，优先检查 maxmemory-policy 与最近写入速率...' },
        { id: 'c2', docId: 'cmdb-cache', chunkId: 'cmdb-prd-019', source: 'CMDB', page: null, score: 0.78, rerankScore: 0.81, evalLabel: 'useful', text: 'prod-redis-01 资产编号 PRD-CACHE-019...' },
      ],
      toolCalls: [
        { id: 't1', name: 'redis-cli INFO memory', args: { host: 'prod-redis-01' }, result: 'used_memory_human: 7.2G · maxmemory_human: 8G', status: 'success', durationMs: 120, permission: 'auto', sandboxId: 'sandbox-r-1024', traceId: 'tr-1' },
        { id: 't2', name: 'redis-cli CONFIG GET maxmemory*', args: {}, result: 'maxmemory 8589934592 · maxmemory-policy noeviction', status: 'success', durationMs: 80, permission: 'auto', sandboxId: 'sandbox-r-1024', traceId: 'tr-1' },
      ],
      approvalRequest: {
        action: 'CONFIG SET maxmemory 16GB + volatile-lru',
        resource: 'prod-redis-01',
        reason: '等保 3 · 高危配置变更',
        ticketId: 'CHG-2026-0156',
        required: 2,
        signed: 1,
        decision: 'pending',
        signers: [newSigner('u2', '王昊', 'operator'), newSigner('u1', '平台管理员', 'approver')].map((sg, i) => i === 0 ? { ...sg, signed: true, signedAt: new Date().toISOString(), signatureHash: uid('sig_') } : sg),
      },
      metrics: { ttftMs: 320, durationMs: 1200, promptTokens: 480, completionTokens: 220, cacheHits: 2, model: 'Sonnet-4', provider: 'anthropic' },
    }),
  },
  {
    match: /(k8s|kubernetes|节点扩容)/i,
    reply: () => ({
      role: 'assistant',
      agentName: '变更辅助',
      content: '已识别 K8s 节点扩容请求。分析：\n- 当前集群节点使用率 78%\n- 预计 5 个服务受影响（网关/订单/支付/认证/库存）\n- 建议维护窗口执行（建议 7/15 02:00-04:00）\n- 已生成变更单 #CHG-2026-0156',
      thinkingSummary: 'K8s 扩容需要评估影响范围 + 维护窗口。',
      reasoningSteps: [
        { id: uid('r_'), kind: 'plan', title: '解析诉求', detail: 'K8s 节点扩容' },
        { id: uid('r_'), kind: 'tool_call', title: 'kubectl get nodes', toolCallIds: ['t1'] },
        { id: uid('r_'), kind: 'finalize', title: '输出变更方案' },
      ],
      toolCalls: [
        { id: 't1', name: 'kubectl get nodes', args: { selector: 'role=worker' }, result: '5 nodes · 78% utilization', status: 'success', durationMs: 180, permission: 'auto', sandboxId: 'sandbox-k-2048', traceId: 'tr-2' },
      ],
      metrics: { ttftMs: 280, durationMs: 980, promptTokens: 320, completionTokens: 180, cacheHits: 1, model: 'Sonnet-4', provider: 'anthropic' },
    }),
  },
  {
    match: /(cve|漏洞|安全|漏洞修复)/i,
    reply: () => ({
      role: 'assistant',
      agentName: '漏洞修复',
      content: 'CVE 周报已生成。本周发现 12 个新漏洞，其中 3 个高危：\n- CVE-2026-3321（CVSS 9.8）· Log4j 远程代码执行\n- CVE-2026-3318（CVSS 8.6）· Spring Framework 权限绕过\n- CVE-2026-3315（CVSS 7.5）· OpenSSL 拒绝服务\n\n影响资产：\n- 12 台 K8s 节点（cluster-prd-01）\n- 8 个 API 网关实例\n- 4 个 CMDB 资产',
      thinkingSummary: 'CVE 报告需要按 CVSS 排序 + 关联资产。',
      citations: [
        { id: 'c1', docId: 'nvd-cve-2026-3321', source: 'CVE', page: null, score: 0.95, rerankScore: 0.97, evalLabel: 'gold', text: 'CVE-2026-3321 影响 Log4j 2.x < 2.17.0...' },
      ],
      metrics: { ttftMs: 410, durationMs: 1320, promptTokens: 540, completionTokens: 260, cacheHits: 0, model: 'Sonnet-4', provider: 'anthropic' },
    }),
  },
  {
    match: /(合规|审计|iso|等保)/i,
    reply: () => ({
      role: 'assistant',
      agentName: '合规审计',
      content: '本月合规自评报告已生成。94 项自评结果：\n- 通过 91 项（97%）\n- 需改善 3 项（导出审计日志/字段脱敏增强/灰度发布）\n- 等保 3 复测通过\n- ISO 27001 认证有效至 2027-03\n\n下次审计：2026-09-12',
      metrics: { ttftMs: 260, durationMs: 880, promptTokens: 280, completionTokens: 160, cacheHits: 1, model: 'Haiku-4.5', provider: 'anthropic' },
    }),
  },
  {
    match: /(alert|alertnoise|告警|降噪|siem|edr)/i,
    reply: () => ({
      role: 'assistant',
      agentName: '告警降噪',
      content: '已分析过去 24h 告警数据：\n\n**告警去重**：1,247 → 89（合并 92.8% 重复）\n\n- **重复 SIEM 规则**：R-019 触发 478 次（同一 IP）\n- **升级风暴**：kubernetes_pod_restart 触发 312 次（同一 deployment）\n- **低危噪音**：disk_usage_warning 156 次（>80% 但 <90%）\n\n建议处理：\n1. 静默 R-019（该 IP 已确认）\n2. 合并 k8s deployment 重启告警（1 条聚合）\n3. 调高 disk_usage 阈值到 90%\n\n效果：预计每日告警量从 1,247 降至 ~150（-88%）',
      thinkingSummary: '告警降噪核心是模式识别 + 历史数据关联。',
      citations: [
        { id: 'c1', docId: 'siem-rule-r019', source: 'SIEM', page: 12, score: 0.94, rerankScore: 0.95, evalLabel: 'useful', text: '告警去重 R-019 历史触发 478 次...' },
        { id: 'c2', docId: 'cmdb-frontend', source: 'CMDB', page: null, score: 0.82, rerankScore: 0.85, evalLabel: 'useful', text: 'kubernetes deployment prod-frontend-7d8...' },
      ],
      toolCalls: [
        { id: 't1', name: 'siem query', args: { rule: 'R-019', range: '24h' }, result: '478 hits · 1 unique IP', status: 'success', durationMs: 240, permission: 'auto', sandboxId: 'sandbox-s-4096', traceId: 'tr-3' },
      ],
      metrics: { ttftMs: 360, durationMs: 1180, promptTokens: 420, completionTokens: 240, cacheHits: 1, model: 'Sonnet-4', provider: 'anthropic' },
    }),
  },
  {
    match: /(siem|调查|威胁|入侵|incident)/i,
    reply: () => ({
      role: 'assistant',
      agentName: '威胁狩猎',
      content: '**SIEM 调查时间线**（基于 ATT&CK 框架）：\n\n1. **07:23** 初始入侵 — 钓鱼邮件 → 用户工作站执行恶意附件\n2. **07:45** 持久化 — 注册表 Run 键写入 svchost.exe\n3. **08:12** 凭证窃取 — Mimikatz 抓取 23 个凭据\n4. **08:30** 横向移动 — 扫描内网 SMB 共享\n5. **09:15** 数据外传 — DNS 隧道 1.2GB 至 C2 服务器\n\n**已自动隔离**：3 个工作站 + 2 个服务账号\n**建议**：立即重置 23 个泄露凭据 + 阻断 C2 域名',
      thinkingSummary: 'SIEM 调查需要按时间线 + ATT&CK 战术分类。',
      citations: [
        { id: 'c1', docId: 'mitre-t1003', source: 'SIEM', page: 5, score: 0.96, rerankScore: 0.98, evalLabel: 'gold', text: 'Mimikatz 凭证窃取 T1003...' },
        { id: 'c2', docId: 'cmdb-ws-042', source: 'CMDB', page: null, score: 0.88, rerankScore: 0.9, evalLabel: 'useful', text: 'workstation-042 · user-svc-018 ...' },
      ],
      toolCalls: [
        { id: 't1', name: 'siem timeline', args: { case: 'INC-2026-0723' }, result: '5 events · 23 creds · 1.2GB exfil', status: 'success', durationMs: 380, permission: 'auto', sandboxId: 'sandbox-s-4096', traceId: 'tr-4' },
      ],
      approvalRequest: {
        action: '重置 23 个泄露凭据 + 阻断 3 个 C2 域名',
        resource: 'workstation-042 / 23 凭据',
        reason: '等保 3 · 应急响应',
        ticketId: 'INC-2026-0723',
        required: 2,
        signed: 1,
        decision: 'pending',
        signers: [newSigner('u2', '王昊', 'operator'), newSigner('u1', '张睿', 'approver')].map((sg, i) => i === 0 ? { ...sg, signed: true, signedAt: new Date().toISOString(), signatureHash: uid('sig_') } : sg),
      },
      metrics: { ttftMs: 420, durationMs: 1480, promptTokens: 620, completionTokens: 320, cacheHits: 0, model: 'Sonnet-4', provider: 'anthropic' },
    }),
  },
  {
    match: /(灰度|发布|deploy|release|蓝绿)/i,
    reply: () => ({
      role: 'assistant',
      agentName: '变更辅助',
      content: '**灰度发布方案**（蓝绿 → 5% → 25% → 100%）：\n\n**阶段 1**（5% · 30min）\n- 仅 cn-east-1 区域\n- 监控指标：5xx < 0.1% / P95 < 800ms\n- 自动回滚阈值：5xx > 0.5%\n\n**阶段 2**（25% · 1h）\n- cn-east-1 + cn-south-1\n- 监控指标：CPU < 70% / 内存 < 80%\n\n**阶段 3**（100% · 24h）\n- 全量 + 流量切换\n- 监控所有业务指标 + 用户反馈\n\n**预计风险**：\n- 影响服务：5 个（gateway / order / pay / auth / inventory）\n- 回滚时间：< 30s（自动）\n- 影响用户：渐进式',
      thinkingSummary: '蓝绿发布 3 阶段，每阶段 30min 观察 + 自动回滚。',
      citations: [
        { id: 'c1', docId: 'rb-blue-green', source: 'Runbook', page: 8, score: 0.91, rerankScore: 0.93, evalLabel: 'useful', text: '蓝绿发布 3 阶段流程...' },
      ],
      toolCalls: [
        { id: 't1', name: 'argocd rollout', args: { stage: '5%', region: 'cn-east-1' }, result: '5/100 pods updated · 0 errors', status: 'success', durationMs: 1200, permission: 'approval-required', sandboxId: 'sandbox-a-8192', traceId: 'tr-5' },
      ],
      approvalRequest: {
        action: 'argocd rollout (5% → 25% → 100%)',
        resource: 'gateway-prod / order-prod',
        reason: 'P1 灰度发布 · 影响 5 个核心服务',
        ticketId: 'REL-2026-0715',
        required: 2,
        signed: 0,
        decision: 'pending',
        signers: [newSigner('u2', '王昊', 'operator'), newSigner('u1', '孙博', 'approver')],
      },
      metrics: { ttftMs: 380, durationMs: 1620, promptTokens: 580, completionTokens: 300, cacheHits: 2, model: 'Sonnet-4', provider: 'anthropic' },
    }),
  },
  {
    match: /(知识|文档|wiki|怎么用|介绍|使用)/i,
    reply: () => ({
      role: 'assistant',
      agentName: '知识答疑',
      content: '**企智搭 · 数字伙伴平台使用指南**（v3.0）：\n\n**核心模块**：\n- **首页** — 业务总览（KPI / 健康度 / 告警）\n- **会话**（Copilot）— 与数字伙伴协同处理工作\n- **任务** — 任务管理与双签审批\n- **工作区** — 多租户隔离与成员协作\n- **智能体** — 智能体能力管理\n- **工作流** — DAG 可视化编排\n- **知识** — RAG 检索与知识资产管理\n- **技能** — Skill / MCP / Tool（gVisor 沙箱）\n- **模型** — 多 Provider 与分级路由\n- **渠道** — 飞书 / 企微 / 钉钉 / Webhook\n- **设置** — 租户 / 成员 / 合规 / 计费\n\n**快速上手**：\n1. 按 `⌘K` 全局搜索\n2. 输入 `/` 唤起命令面板\n3. 输入 `@` 提及智能体、技能或文档\n4. 主题切换在顶栏右侧\n5. 在左侧栏进入所需模块',
      citations: [
        { id: 'c1', docId: 'rb-platform-v3', source: 'Runbook', page: 1, score: 0.95, rerankScore: 0.97, evalLabel: 'gold', text: '企智搭 · 数字伙伴平台使用指南 v3.0 ...' },
      ],
      metrics: { ttftMs: 220, durationMs: 720, promptTokens: 240, completionTokens: 180, cacheHits: 3, model: 'Haiku-4.5', provider: 'anthropic' },
    }),
  },
  {
    match: /(工单|创建任务|建工单|ticket|incident)/i,
    reply: (q) => ({
      role: 'assistant',
      agentName: '故障自愈',
      content: '**工单已创建** — TSK-20260714-001\n\n**基本信息**：\n- **标题**：' + (q.replace(/^.*?(工单|创建|建|ticket|incident)/i, '') || '用户问题') + '\n- **优先级**：P1（基于关键词分析）\n- **状态**：待分配\n- **创建人**：王昊\n- **来源**：Copilot 对话\n\n**自动关联**：\n- CMDB 资产：prod-redis-01, k8s-prod-cluster\n- Runbook：cache-oom 处置 v3.2\n- 知识库引用：3 篇\n\n**SLA**：4 小时内响应 / 24 小时内解决\n**负责人**：待分配（建议分配给 王昊 或 李婷）\n\n是否要立即分配给某人？',
      thinkingSummary: '创建工单需要从用户消息提取关键信息 + 关联资产 + 设置 SLA。',
      toolCalls: [
        { id: 't1', name: 'jira create', args: { project: 'OPS', priority: 'P1' }, result: 'TSK-20260714-001 created', status: 'success', durationMs: 320, permission: 'auto', sandboxId: 'sandbox-j-512', traceId: 'tr-6' },
        { id: 't2', name: 'cmdb lookup', args: { query: 'cache' }, result: '3 assets matched', status: 'success', durationMs: 180, permission: 'auto', sandboxId: 'sandbox-c-256', traceId: 'tr-6' },
      ],
      metrics: { ttftMs: 340, durationMs: 1040, promptTokens: 360, completionTokens: 220, cacheHits: 0, model: 'Sonnet-4', provider: 'anthropic' },
    }),
  },
  {
    match: /^($|help|帮助|\?)/i,
    reply: () => ({
      role: 'assistant',
      agentName: '故障自愈',
      content: '我是 **故障自愈** Agent v1.4.2。可以帮你：\n\n**我能处理**：\n- 🔴 Redis/K8s 等基础设施故障\n- 📊 容量预测与扩容建议\n- 🔍 CVE 漏洞扫描与修复\n- 🛡️ 合规审计报告\n- 📋 任务创建与追踪\n\n**试试问我**：\n- "prod-redis-01 OOM 了怎么办？"\n- "K8s 节点扩容建议"\n- "本周 CVE 周报"\n- "本月合规审计"\n\n**快捷键**：\n- `/` — 命令面板\n- `@` — 提及\n- `Enter` 发送 / `Shift+Enter` 换行\n- `Esc` 停止生成',
      metrics: { ttftMs: 120, durationMs: 280, promptTokens: 80, completionTokens: 120, cacheHits: 5, model: 'Haiku-4.5', provider: 'anthropic' },
    }),
  },
  {
    match: /^(hi|hello|你好|嗨)/i,
    reply: () => ({
      role: 'assistant',
      agentName: '故障自愈',
      content: '你好！我是故障自愈 Agent v1.4.2。可以帮你：\n- 处理 Redis/K8s 等基础设施故障\n- 执行 Runbook 自动化修复\n- 监控告警 + 智能诊断\n\n试试问我："Redis OOM 怎么解决" 或 "K8s 节点扩容建议"',
      metrics: { ttftMs: 80, durationMs: 220, promptTokens: 60, completionTokens: 100, cacheHits: 6, model: 'Haiku-4.5', provider: 'anthropic' },
    }),
  },
];

function generateMockReply(userMsg: string): ReplyMock {
  for (const t of REPLY_TEMPLATES) {
    if (t.match.test(userMsg)) return t.reply(userMsg);
  }
  return {
    role: 'assistant',
    agentName: '故障自愈',
    content: `已收到你的问题：「${userMsg}」\n\n正在分析中，可按 / 唤起命令面板切换 Agent 或使用 @ 提及特定资源。`,
    thinkingSummary: '通用回复：识别不到具体场景，给出引导。',
    metrics: { ttftMs: 180, durationMs: 420, promptTokens: 100, completionTokens: 80, cacheHits: 1, model: 'Haiku-4.5', provider: 'anthropic' },
  };
}

function now(): string {
  return new Date().toISOString();
}

function sessionHasActiveTurn(sess?: ChatSession): boolean {
  if (!sess) return false;
  if (sess.pendingTurn) return true;
  return sess.messages.some((m) => m.status === 'streaming' || m.status === 'in_flight' || m.status === 'queued');
}

/* ============ 持久化 ============ */

function loadState(): State | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed || !parsed.sessions) return null;
    // 版本升级：丢弃本地会话缓存（保留输入草稿），由 /api/sessions 重新灌入，
    // 避免 mock 时代的 s1/s_* 与 qzda-core 会话 id 错位引发深链振荡与 404。
    if ((parsed.schemaVersion ?? 1) < STORAGE_VERSION) {
      if ((parsed.schemaVersion ?? 1) === 8 && parsed.sessions) {
        return {
          ...parsed,
          inputHistory: Array.isArray(parsed.inputHistory) ? parsed.inputHistory.filter((x: unknown) => typeof x === 'string') : [],
          schemaVersion: STORAGE_VERSION,
          activeCorrelationId: null,
          typing: false,
          abortRef: { current: null },
          sessions: Object.fromEntries(
            Object.entries(parsed.sessions as Record<string, ChatSession>).map(([id, sess]) => [
              id,
              {
                ...sess,
                messages: (sess.messages ?? []).map((m) => (
                  m.status === 'streaming'
                    ? { ...m, status: 'in_flight' as const }
                    : m
                )),
              },
            ]),
          ),
        } as State;
      }
      return {
        ...initial,
        draftInput: typeof parsed.draftInput === 'string' ? parsed.draftInput : '',
        inputHistory: Array.isArray(parsed.inputHistory) ? parsed.inputHistory.filter((x: unknown) => typeof x === 'string') : [],
        schemaVersion: STORAGE_VERSION,
        activeId: '',
      };
    }
    return {
      ...parsed,
      inputHistory: parsed.inputHistory ?? [],
      requests: parsed.requests ?? [],
      debugOpen: parsed.debugOpen ?? false,
      activeCorrelationId: null,
      typing: false,
      abortRef: { current: null },
      sessions: Object.fromEntries(
        Object.entries(parsed.sessions as Record<string, ChatSession>).map(([id, sess]) => [
          id,
          {
            ...sess,
            messages: (sess.messages ?? []).map((m) => (
              m.status === 'streaming'
                ? { ...m, status: 'in_flight' as const }
                : m
            )),
          },
        ]),
      ),
    } as State;
  } catch {
    return null;
  }
}

function saveState(s: State) {
  try {
    const { typing, abortRef, ...rest } = s;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch {}
}

type DeletedTombstones = { sessionIds: string[]; conversationIds: string[] };

function loadDeletedTombstones(): { sessions: Set<string>; conversations: Set<string> } {
  try {
    const raw = localStorage.getItem(DELETED_TOMBSTONES_KEY);
    if (!raw) return { sessions: new Set(), conversations: new Set() };
    const parsed = JSON.parse(raw) as Partial<DeletedTombstones>;
    return {
      sessions: new Set(Array.isArray(parsed.sessionIds) ? parsed.sessionIds.filter((id) => typeof id === 'string' && id) : []),
      conversations: new Set(Array.isArray(parsed.conversationIds) ? parsed.conversationIds.filter((id) => typeof id === 'string' && id) : []),
    };
  } catch {
    return { sessions: new Set(), conversations: new Set() };
  }
}

function saveDeletedTombstones(sessions: Set<string>, conversations: Set<string>) {
  try {
    const payload: DeletedTombstones = {
      sessionIds: [...sessions],
      conversationIds: [...conversations],
    };
    localStorage.setItem(DELETED_TOMBSTONES_KEY, JSON.stringify(payload));
  } catch {}
}

/* ============ 序列化（导出） ============ */

export function exportSession(session: ChatSession, opts: { includeCitations?: boolean; includeToolCalls?: boolean; includeReasoning?: boolean; includeAuditTrail?: boolean } = {}): string {
  const { includeCitations = true, includeToolCalls = true, includeReasoning = true, includeAuditTrail = false } = opts;
  if (!includeAuditTrail) {
    const out: string[] = [`# ${session.title}`, `> ${session.preview || '(空)'}`, '', `Agent: ${session.agent}`, `Created: ${new Date(session.createdAt).toISOString()}`, ''];
    for (const m of session.messages) {
      out.push(`## [${m.role}] ${m.agentName ?? m.role} — ${m.createdAt}`);
      if (m.content) out.push(m.content);
      if (includeReasoning && m.reasoningSteps?.length) {
        out.push('', '**Reasoning:**');
        for (const s of m.reasoningSteps) out.push(`- (${s.kind}) ${s.title}${s.detail ? ` — ${s.detail}` : ''}`);
      }
      if (includeReasoning && m.cognitive && !m.cognitive.bypass) {
        out.push('', '**Cognitive:**');
        out.push(`- primary: ${m.cognitive.primaryLabel || m.cognitive.primary || '—'}${m.cognitive.mode ? ` · ${m.cognitive.mode}` : ''}`);
        if (m.cognitive.secondaryLabel || m.cognitive.secondary) {
          out.push(`- secondary: ${m.cognitive.secondaryLabel || m.cognitive.secondary}`);
        }
        if (m.cognitive.phases?.length) out.push(`- phases: ${m.cognitive.phases.join(' → ')}`);
      } else if (includeReasoning && m.cognitive?.bypass) {
        out.push('', `**Cognitive:** bypass (${m.cognitive.bypassReason || 'skipped'})`);
      }
      if (includeReasoning && m.turnMeta?.summary) {
        out.push('', `**Turn narrative:** ${m.turnMeta.summary}`);
      }
      if (includeReasoning && m.turnMeta?.phases?.length) {
        out.push('', '**Turn phases:**');
        for (const p of m.turnMeta.phases) {
          out.push(`- ${p.label} (${p.status})${p.stepCount != null ? ` · ${p.stepCount} steps` : ''}`);
        }
      }
      if (includeToolCalls && m.toolCalls?.length) {
        out.push('', '**Tool calls:**');
        for (const t of m.toolCalls) out.push(`- \`${t.name}\` (${t.status}, ${t.durationMs ?? 0}ms) ${t.sandboxId ? `[sandbox:${t.sandboxId}]` : ''}`);
      }
      if (includeCitations && m.citations?.length) {
        out.push('', '**Citations:**');
        for (const c of m.citations) out.push(`- [${c.source}${c.page ? ` p.${c.page}` : ''}] (score=${c.score.toFixed(2)}) ${c.text}`);
      }
      out.push('');
    }
    return out.join('\n');
  }
  // 审计模式：JSON + 摘要哈希
  const auditPayload = {
    sessionId: session.id,
    title: session.title,
    owner: session.ownerName,
    workspaceId: session.workspaceId,
    createdAt: new Date(session.createdAt).toISOString(),
    messages: session.messages.map((m) => ({
      id: m.id,
      role: m.role,
      agent: m.agentName,
      content: m.content,
      status: m.status,
      correlationId: m.correlationId,
      feedback: m.feedback,
      safety: m.safety,
      metrics: m.metrics,
      cognitive: m.cognitive,
      turnMeta: m.turnMeta,
      approval: m.approvalRequest,
    })),
    hash: uid('audit_'),
  };
  return JSON.stringify(auditPayload, null, 2);
}

/* ============ hook ============ */

export function useChat(agentMeta?: { name: string }) {
  const [state, dispatch] = useReducer(reducer, initial, () => {
    const loaded = loadState();
    if (loaded) return loaded;

    return initial;
  });

  // 持久化
  useEffect(() => {
    saveState(state);
  }, [state]);

  // 超时监控：超时自动 abort + 写错误
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnRecoveryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialTombstones = loadDeletedTombstones();
  const deletedSessionIdsRef = useRef<Set<string>>(initialTombstones.sessions);
  const deletedConversationIdsRef = useRef<Set<string>>(initialTombstones.conversations);

  /* ==================== 内部：启动流式 ==================== */

  const startStream = useCallback(
    (
      sid: string,
      replyId: string,
      reply: ReplyMock,
      ctrl: AbortController,
      correlationIdStr: string,
      opts?: { skipAppend?: boolean },
    ) => {
      // 1) 占位
      const placeholder: ChatMessageEx = {
        id: replyId,
        role: 'assistant',
        agentName: reply.agentName,
        content: '',
        reasoningSteps: [],
        toolCalls: [],
        citations: [],
        clientMsgId: uid('c_'),
        correlationId: correlationIdStr,
        status: 'streaming',
        metrics: { model: reply.metrics?.model ?? 'Sonnet-4', provider: reply.metrics?.provider ?? 'anthropic' },
        createdAt: new Date().toISOString(),
      };
      if (!opts?.skipAppend) {
        dispatch({ type: 'append_msg', sid, msg: placeholder });
      }

      // 2) 写请求日志
      const reqId = uid('req_');
      const startedAt = Date.now();
      dispatch({
        type: 'log_request',
        log: {
          id: reqId,
          correlationId: correlationIdStr,
          ts: startedAt,
          op: 'send',
          mid: replyId,
          sid,
          model: reply.metrics?.model ?? 'Sonnet-4',
          promptTokens: 0,
          completionTokens: 0,
          durationMs: 0,
          ttftMs: 0,
          status: 'streaming',
        },
      });

      // 3) Reasoning steps 注入（先全部）
      const steps = reply.reasoningSteps ?? [];
      let stepIdx = 0;
      const injectStep = () => {
        if (stepIdx >= steps.length) {
          streamText();
          return;
        }
        const s = steps[stepIdx++];
        dispatch({ type: 'append_reasoning_step', sid, mid: replyId, step: s });
        setTimeout(injectStep, 60);
      };

      // 4) 流式文本
      const text = reply.content;
      let i = 0;
      let firstChunkAt = 0;
      const tick = () => {
        if (ctrl.signal.aborted) {
          dispatch({ type: 'update_request', id: reqId, patch: { status: 'aborted', durationMs: Date.now() - startedAt } });
          dispatch({ type: 'set_typing', typing: false });
          dispatch({ type: 'set_abort', ctrl: null });
          dispatch({ type: 'set_msg_status', sid, mid: replyId, status: 'cancelled' });
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          return;
        }
        if (i === 0) firstChunkAt = Date.now();
        i += 2;
        dispatch({
          type: 'replace_msg',
          sid,
          mid: replyId,
          msg: {
            ...placeholder,
            content: text.slice(0, i),
            status: 'streaming',
          },
        });
        if (i < text.length) {
          setTimeout(tick, STREAM_CHUNK_MS);
        } else {
          // 5) 完整消息：恢复 reasoning / tool / citations / approval / metrics
          const finalMsg: ChatMessageEx = {
            ...placeholder,
            content: text,
            reasoningSteps: steps,
            thinkingSummary: reply.thinkingSummary,
            citations: reply.citations,
            toolCalls: reply.toolCalls,
            approvalRequest: reply.approvalRequest,
            safety: reply.safety,
            metrics: {
              ...placeholder.metrics,
              ...(reply.metrics ?? {}),
              ttftMs: reply.metrics?.ttftMs ?? firstChunkAt - startedAt,
              durationMs: Date.now() - startedAt,
            },
            status: 'succeeded',
            serverMsgId: uid('srv_'),
          };
          dispatch({ type: 'replace_msg', sid, mid: replyId, msg: finalMsg });
          dispatch({ type: 'update_request', id: reqId, patch: { status: 'success', durationMs: Date.now() - startedAt, ttftMs: firstChunkAt - startedAt, completionTokens: reply.metrics?.completionTokens ?? Math.round(text.length * 0.4) } });
          dispatch({ type: 'set_typing', typing: false });
          dispatch({ type: 'set_abort', ctrl: null });
          dispatch({ type: 'set_active_correlation', id: null });
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
        }
      };

      const streamText = () => setTimeout(tick, STREAM_TICK_MS);

      // 启动
      setTimeout(injectStep, 80);
    },
    [],
  );

  /** 对接 qzda-core SSE（VITE_USE_MOCK=false） */
  const startBackendStream = useCallback(
    (
      sid: string,
      replyId: string,
      text: string,
      ctrl: AbortController,
      correlationIdStr: string,
      digitalPartnerId?: string,
      opts?: { skipAppend?: boolean; agentName?: string; modelId?: string; enabledTools?: string[]; conversationId?: string; modeHint?: string; reflectHint?: string; sessionMode?: 'investigate' | 'execute'; runMode?: 'ask' | 'plan' | 'agent'; reasoningEffort?: 'off' | 'standard' | 'deep'; riskLevel?: 'low' | 'medium' | 'high'; attachmentIds?: string[]; clientMsgId?: string; replyMode?: 'single' | 'segmented' | 'stepwise' },
    ) => {
      const agentName = opts?.agentName ?? '岗位专家';
      const modelId = opts?.modelId ?? '';
      const replyMode = opts?.replyMode ?? DEFAULT_REPLY_MODE;
      const placeholder: ChatMessageEx = {
        id: replyId,
        role: 'assistant',
        agentName,
        content: '',
        reasoningSteps: [],
        toolCalls: [],
        citations: [],
        clientMsgId: uid('c_'),
        correlationId: correlationIdStr,
        segmentIndex: replyMode === 'single' ? undefined : 0,
        status: 'streaming',
        metrics: { model: modelId, provider: 'qzda-core' },
        createdAt: new Date().toISOString(),
      };
      if (!opts?.skipAppend) {
        dispatch({ type: 'append_msg', sid, msg: placeholder });
      }

      const pendingTurn: PendingTurn = {
        correlationId: correlationIdStr,
        clientMsgId: opts?.clientMsgId ?? placeholder.clientMsgId!,
        replyId,
        content: text,
        startedAt: new Date().toISOString(),
      };
      dispatch({ type: 'update_session', sid, patch: { pendingTurn } });

      const reqId = uid('req_');
      const startedAt = Date.now();
      let firstChunkAt = 0;
      let content = '';
      const segmentRouter = createSegmentRouter(replyId);
      const segmentPlaceholders = new Map<string, ChatMessageEx>();
      segmentPlaceholders.set(replyId, placeholder);
      const ensureSegment = (messageId?: string, segmentIndex?: number, segmentKind?: ChatMessageEx['segmentKind']) => {
        const mid = messageId?.trim() || replyId;
        if (!segmentPlaceholders.has(mid)) {
          const segPlaceholder: ChatMessageEx = {
            id: mid,
            role: 'assistant',
            agentName,
            content: '',
            reasoningSteps: [],
            toolCalls: [],
            citations: [],
            clientMsgId: placeholder.clientMsgId,
            correlationId: correlationIdStr,
            segmentIndex,
            segmentKind,
            status: 'streaming',
            metrics: { model: modelId, provider: 'qzda-core' },
            createdAt: new Date().toISOString(),
          };
          segmentPlaceholders.set(mid, segPlaceholder);
          if (mid !== replyId) {
            dispatch({ type: 'append_msg', sid, msg: segPlaceholder });
          } else if (segmentIndex != null) {
            dispatch({
              type: 'replace_msg',
              sid,
              mid,
              msg: { ...segPlaceholder, ...placeholder, segmentIndex },
            });
          }
        } else if (segmentIndex != null) {
          const existing = segmentPlaceholders.get(mid)!;
          const next = { ...existing, segmentIndex };
          segmentPlaceholders.set(mid, next);
          dispatch({ type: 'replace_msg', sid, mid, msg: next });
        }
        return mid;
      };
      const thoughtHost = replyId;
      const artifactSegmentIds = new Set<string>();
      let streamCompleted = false;
      const mergeArtifactIntoHost = (artifactBlock: string) => {
        if (!artifactBlock.trim()) return;
        const base = segmentPlaceholders.get(thoughtHost) ?? placeholder;
        const mergedContent = mergeArtifactBlockIntoContent(base.content ?? '', artifactBlock);
        const next: ChatMessageEx = {
          ...base,
          content: mergedContent,
          reasoningSteps: [...reasoningSteps],
          toolCalls: [...toolCalls],
          citations: [...citations],
          progressHint: liveProgress || base.progressHint,
        };
        segmentPlaceholders.set(thoughtHost, next);
        dispatch({ type: 'replace_msg', sid, mid: thoughtHost, msg: next });
      };
      const patchSegment = (mid: string, status: ChatMessageEx['status'] = 'streaming') => {
        const body = segmentRouter.segments.get(mid)?.content ?? '';
        const base = segmentPlaceholders.get(mid) ?? placeholder;
        const isHost = mid === thoughtHost;
        const next: ChatMessageEx = {
          ...base,
          content: body,
          ...(isHost ? {
            reasoningSteps: [...reasoningSteps],
            toolCalls: [...toolCalls],
            citations: [...citations],
            progressHint: liveProgress || base.progressHint,
          } : {}),
          status,
        };
        segmentPlaceholders.set(mid, next);
        dispatch({
          type: 'replace_msg',
          sid,
          mid,
          msg: next,
        });
      };
      const failAllSegments = (message: string, category: ErrorCategory) => {
        for (const mid of segmentRouter.segments.keys()) {
          const body = segmentRouter.segments.get(mid)?.content ?? '';
          const base = segmentPlaceholders.get(mid) ?? placeholder;
          const isHost = mid === thoughtHost;
          dispatch({
            type: 'replace_msg',
            sid,
            mid,
            msg: {
              ...base,
              content: body || (isHost ? `请求失败：${message}` : body),
              ...(isHost ? {
                reasoningSteps: [...reasoningSteps],
                toolCalls: [...toolCalls],
                citations: [...citations],
              } : {}),
              status: 'failed',
              error: isHost ? { category, message, retryable: category === 'network' || category === 'timeout' } : base.error,
            },
          });
        }
      };
      const reasoningSteps: ReasoningStep[] = [];
      const turnTasks: NonNullable<ChatMessageEx['turnTasks']> = [];
      const toolCalls: ToolCall[] = [];
      const citations: Citation[] = [];
      let resolvedModel = modelId;
      let resolvedProvider = 'qzda-core';
      let resolvedSource = '';
      let toolStartedAt = startedAt;
      let liveProgress = '';

      const pushThought = (typ: string, data: CopilotSSEEvent) => {
        const prevLen = reasoningSteps.length;
        const next = toHumanThoughtStep(typ, data);
        if (next) {
          const merged = appendHumanThought(reasoningSteps, next);
          reasoningSteps.length = 0;
          reasoningSteps.push(...merged);
          if (merged.length > prevLen) {
            dispatch({
              type: 'append_reasoning_step',
              sid,
              mid: thoughtHost,
              step: merged[merged.length - 1]!,
            });
          } else if (merged.length > 0) {
            const base = segmentPlaceholders.get(thoughtHost) ?? placeholder;
            const patched: ChatMessageEx = {
              ...base,
              reasoningSteps: [...merged],
            };
            segmentPlaceholders.set(thoughtHost, patched);
            dispatch({ type: 'replace_msg', sid, mid: thoughtHost, msg: patched });
          }
        }
        const progress = progressLabelFromEvent(typ, data);
        if (progress && reasoningSteps.length === 0) {
          liveProgress = progress;
          const base = segmentPlaceholders.get(thoughtHost) ?? placeholder;
          const patched: ChatMessageEx = {
            ...base,
            progressHint: liveProgress,
          };
          segmentPlaceholders.set(thoughtHost, patched);
          dispatch({ type: 'replace_msg', sid, mid: thoughtHost, msg: patched });
        }
      };

      const patchTurnState = () => {
        const base = segmentPlaceholders.get(thoughtHost) ?? placeholder;
        const patched: ChatMessageEx = {
          ...base,
          reasoningSteps: [...reasoningSteps],
          turnTasks: [...turnTasks],
          progressHint: reasoningSteps.length > 0 ? undefined : (liveProgress || base.progressHint),
        };
        segmentPlaceholders.set(thoughtHost, patched);
        dispatch({ type: 'replace_msg', sid, mid: thoughtHost, msg: patched });
      };

      dispatch({
        type: 'log_request',
        log: {
          id: reqId,
          correlationId: correlationIdStr,
          ts: startedAt,
          op: 'send',
          mid: replyId,
          sid,
          model: modelId,
          promptTokens: 0,
          completionTokens: 0,
          durationMs: 0,
          ttftMs: 0,
          status: 'streaming',
        },
      });

      const finishError = (message: string, category: ErrorCategory = 'internal') => {
        failAllSegments(message, category);
        dispatch({
          type: 'update_request',
          id: reqId,
          patch: {
            status: 'error',
            durationMs: Date.now() - startedAt,
            error: message,
            errorCategory: category,
          },
        });
        dispatch({ type: 'set_typing', typing: false });
        dispatch({ type: 'set_abort', ctrl: null });
        dispatch({ type: 'set_active_correlation', id: null });
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };

      const onEvent = (event: string, data: CopilotSSEEvent) => {
        if (ctrl.signal.aborted) return;
        const typ = data.type || event;
        if (typeof data.modelId === 'string' && data.modelId) resolvedModel = data.modelId;
        if (typeof data.modelName === 'string' && data.modelName) resolvedModel = data.modelName;
        if (typeof data.providerId === 'string' && data.providerId) resolvedProvider = data.providerId;
        if (typeof data.source === 'string' && data.source) resolvedSource = data.source;
        if (typ === 'stage') {
          if (data.stage === 'rag' || data.stage === 'runtime') {
            if (data.status === 'running') toolStartedAt = Date.now();
          }
          pushThought(typ, data);
          return;
        }
        if (typ === 'thought' || typ === 'evolve' || typ === 'route' || typ === 'agent' || typ === 'plan' || typ === 'reflect') {
          pushThought(typ, data);
          return;
        }
        if (typ === 'task') {
          const merged = mergeTurnTasks(turnTasks, {
            taskId: typeof data.taskId === 'string' ? data.taskId : undefined,
            title: typeof data.title === 'string' ? data.title : undefined,
            status: typeof data.status === 'string' ? data.status : undefined,
            action: typeof data.action === 'string' ? data.action : undefined,
            detail: typeof data.detail === 'string' ? data.detail : undefined,
          });
          turnTasks.length = 0;
          turnTasks.push(...merged);
          pushThought(typ, data);
          patchTurnState();
          return;
        }
        if (typ === 'authorization') {
          const approvalRaw = (data.approvalRequest ?? data.authorizationRequest) as (ChatMessageEx['approvalRequest'] & {
            approverRoleHint?: string;
            approverCandidateIds?: string[];
            approverCandidateNames?: string[];
          }) | undefined;
          const mid = (data.messageId || data.actionId || uid('act_')) as string;
          const authMsg: ChatMessageEx = {
            id: mid,
            role: 'assistant',
            content: `已创建待人工审核授权：${data.name || (data as { tool?: string }).tool || '写操作'}`,
            approvalRequest: approvalRaw ? {
              action: String(approvalRaw.action || (data as { tool?: string }).tool || 'controlled.execute'),
              resource: approvalRaw.resource ?? sid,
              reason: approvalRaw.reason,
              required: Number(approvalRaw.required ?? 1) || 1,
              signed: Number(approvalRaw.signed ?? 0) || 0,
              decision: approvalRaw.decision ?? 'pending',
              signers: approvalRaw.signers ?? [{ userId: '', name: '授权人', role: 'approver', signed: false }],
              skillTurn: approvalRaw.skillTurn,
              planSummary: approvalRaw.planSummary,
              approverRoleHint: approvalRaw.approverRoleHint,
              approverCandidateIds: approvalRaw.approverCandidateIds,
              approverCandidateNames: approvalRaw.approverCandidateNames,
            } : {
              action: String((data as { tool?: string }).tool || 'controlled.execute'),
              resource: sid,
              reason: '受控执行需人工审核授权',
              required: 1,
              signed: 0,
              decision: 'pending',
              signers: [{ userId: '', name: '授权人', role: 'approver', signed: false }],
            },
            correlationId: correlationIdStr,
            status: 'succeeded',
            createdAt: new Date().toISOString(),
          };
          // upsert by actionId，避免与后端已落库消息重复
          dispatch({ type: 'replace_msg', sid, mid, msg: authMsg });
          pushThought(typ, data);
          return;
        }
        if (typ === 'tool') {
          const hits = data.hits as {
            backend?: string;
            query?: string;
            results?: Array<{ title?: string; snippet?: string; score?: number; docId?: string; source?: string }>;
          } | undefined;
          const results = hits?.results
            ?? (Array.isArray(data.hits) ? (data.hits as Array<{ title?: string; snippet?: string; score?: number; docId?: string; source?: string }>) : []);
          const statusRaw = data.status ?? 'success';
          const status: ToolCall['status'] =
            statusRaw === 'denied' || statusRaw === 'failed' || statusRaw === 'running' || statusRaw === 'success' || statusRaw === 'needs_instruction'
              ? statusRaw
              : statusRaw === 'ok' ? 'success'
                : statusRaw === 'pending_authorization' ? 'denied'
                  : 'failed';
          const args = {
            ...(typeof data.args === 'object' && data.args ? data.args : {}),
            ...(hits?.backend ? { backend: hits.backend } : {}),
            ...(hits?.query ? { query: hits.query } : {}),
            ...(results.length ? { hitCount: results.length } : {}),
          };
          const tcId = typeof data.id === 'string' && data.id ? data.id : uid('tc_');
          const existing = toolCalls.findIndex((t) => t.id === tcId);
          const tc: ToolCall = {
            id: tcId,
            name: data.name ?? 'tool',
            args,
            status,
            durationMs: typeof data.durationMs === 'number' ? data.durationMs : Math.max(0, Date.now() - toolStartedAt),
            permission: data.permission,
            sandboxId: data.sandboxId,
            error: data.error,
          };
          if (existing >= 0) toolCalls[existing] = tc;
          else toolCalls.push(tc);
          for (const h of results.slice(0, 8)) {
            citations.push({
              id: uid('cite_'),
              docId: h.docId ?? 'doc',
              source: h.source ?? h.title ?? h.docId ?? 'knowledge',
              text: h.snippet ?? '',
              score: typeof h.score === 'number' ? h.score : 0.5,
            });
          }
          pushThought(typ, data);
          patchSegment(thoughtHost);
          return;
        }
        if (typ === 'message_start' && data.messageId) {
          if (isArtifactSegmentEvent(data)) {
            artifactSegmentIds.add(data.messageId);
            applySegmentSSEEvent(segmentRouter, data);
            return;
          }
          const applied = applySegmentSSEEvent(segmentRouter, data);
          if (applied.kind === 'start' && applied.isNew) {
            ensureSegment(applied.messageId, data.segmentIndex, data.segmentKind as ChatMessageEx['segmentKind']);
            dispatch({ type: 'order_segment_messages', sid, correlationId: correlationIdStr });
          } else if (data.segmentIndex != null) {
            ensureSegment(data.messageId, data.segmentIndex, data.segmentKind as ChatMessageEx['segmentKind']);
          }
          return;
        }
        if (typ === 'message_delta' && data.text) {
          if (data.messageId && artifactSegmentIds.has(data.messageId)) {
            applySegmentSSEEvent(segmentRouter, data);
            return;
          }
          const applied = applySegmentSSEEvent(segmentRouter, data);
          if (applied.kind !== 'delta') return;
          if (!firstChunkAt) firstChunkAt = Date.now();
          content = applied.content;
          patchSegment(applied.messageId);
          return;
        }
        if (typ === 'message_done' && data.messageId) {
          if (isArtifactSegmentEvent(data) || artifactSegmentIds.has(data.messageId)) {
            applySegmentSSEEvent(segmentRouter, data);
            const artBody = typeof data.content === 'string'
              ? data.content
              : segmentRouter.segments.get(data.messageId)?.content ?? '';
            mergeArtifactIntoHost(artBody);
            if (segmentPlaceholders.has(data.messageId)) {
              dispatch({ type: 'del_msg', sid, mid: data.messageId });
              segmentPlaceholders.delete(data.messageId);
            }
            return;
          }
          applySegmentSSEEvent(segmentRouter, data);
          patchSegment(data.messageId, 'succeeded');
          return;
        }
        if (typ === 'delta' && data.text) {
          const applied = applySegmentSSEEvent(segmentRouter, data);
          if (applied.kind !== 'delta') return;
          if (!firstChunkAt) firstChunkAt = Date.now();
          content = applied.content;
          patchSegment(applied.messageId);
          return;
        }
        if (typ === 'error') {
          finishError(data.message || '策略或运行时拒绝', 'tool_denied');
          ctrl.abort();
          return;
        }
        if (typ === 'done') {
          completeStream(data);
          return;
        }
      };

      const completeStream = (data: Partial<CopilotSSEEvent> = {}) => {
        if (streamCompleted) return;
        streamCompleted = true;
        applySegmentSSEEvent(segmentRouter, data);
        const provenance = Array.isArray(data.memoryProvenance) ? data.memoryProvenance : undefined;
        const cognitive = (data.cognitive && typeof data.cognitive === 'object')
          ? data.cognitive as ChatMessageEx['cognitive']
          : undefined;
        const turnMeta = parseTurnMeta(data.turnMeta);
        const metrics: MessageMetrics = {
          model: resolvedModel,
          provider: resolvedSource ? `${resolvedProvider}/${resolvedSource}` : resolvedProvider,
          ttftMs: firstChunkAt ? firstChunkAt - startedAt : Date.now() - startedAt,
          durationMs: Date.now() - startedAt,
          completionTokens: Math.round(content.length * 0.4),
          memoryHits: typeof data.memoryHits === 'number' ? data.memoryHits : provenance?.length,
          ragHits: typeof data.ragHits === 'number' ? data.ragHits : undefined,
          snapshotId: typeof data.snapshotId === 'string' ? data.snapshotId : undefined,
          memoryProvenance: provenance,
        };
        const segmentIds = segmentRouter.segments.size > 0
          ? [...segmentRouter.segments.keys()]
          : [replyId];
        for (const mid of segmentIds) {
          if (artifactSegmentIds.has(mid)) continue;
          const body = segmentRouter.segments.get(mid)?.content ?? '';
          const base = segmentPlaceholders.get(mid) ?? placeholder;
          const isHost = mid === thoughtHost;
          const finalMsg: ChatMessageEx = {
            ...base,
            content: body,
            reasoningSteps: isHost ? [...reasoningSteps] : base.reasoningSteps ?? [],
            toolCalls: isHost ? [...toolCalls] : base.toolCalls ?? [],
            citations: isHost ? [...citations] : base.citations ?? [],
            memoryProvenance: isHost ? provenance : base.memoryProvenance,
            cognitive: isHost ? cognitive : base.cognitive,
            turnMeta: isHost ? turnMeta : base.turnMeta,
            turnTasks: isHost
              ? dedupeTurnTasks([
                  ...turnTasks,
                  ...(((turnMeta?.tasks as ChatMessageEx['turnTasks']) ?? [])),
                ])
              : base.turnTasks,
            progressHint: undefined,
            metrics: isHost ? metrics : base.metrics,
            status: 'succeeded',
            serverMsgId: (mid === replyId && typeof data.messageId === 'string' && data.messageId)
              ? data.messageId
              : base.serverMsgId ?? uid('srv_'),
          };
          dispatch({ type: 'replace_msg', sid, mid, msg: finalMsg });
        }
        for (const artId of artifactSegmentIds) {
          if (artId !== thoughtHost) {
            dispatch({ type: 'del_msg', sid, mid: artId });
          }
        }
        dispatch({ type: 'order_segment_messages', sid, correlationId: correlationIdStr });
        dispatch({
          type: 'update_request',
          id: reqId,
          patch: {
            status: 'success',
            durationMs: Date.now() - startedAt,
            ttftMs: firstChunkAt ? firstChunkAt - startedAt : 0,
            completionTokens: Math.round(content.length * 0.4),
            model: resolvedModel,
          },
        });
        dispatch({ type: 'set_typing', typing: false });
        dispatch({ type: 'set_abort', ctrl: null });
        dispatch({ type: 'set_active_correlation', id: null });
        dispatch({ type: 'update_session', sid, patch: { pendingTurn: undefined } });
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };

      void streamCopilotTurn({
        conversationId: opts?.conversationId ?? sid,
        content: text,
        correlationId: correlationIdStr,
        digitalPartnerId,
        modelId,
        enabledTools: opts?.enabledTools,
        modeHint: opts?.modeHint,
        reflectHint: opts?.reflectHint,
        sessionMode: opts?.sessionMode,
        runMode: opts?.runMode,
        reasoningEffort: opts?.reasoningEffort,
        riskLevel: opts?.riskLevel,
        attachmentIds: opts?.attachmentIds,
        clientMsgId: opts?.clientMsgId,
        firstMessageId: replyId,
        replyMode: opts?.replyMode ?? DEFAULT_REPLY_MODE,
        signal: ctrl.signal,
        onEvent,
      }).then(() => {
        if (!streamCompleted) {
          completeStream({});
        }
      }).catch((err: unknown) => {
        if (ctrl.signal.aborted) {
          dispatch({ type: 'update_request', id: reqId, patch: { status: 'aborted', durationMs: Date.now() - startedAt } });
          for (const mid of segmentRouter.segments.keys()) {
            dispatch({ type: 'set_msg_status', sid, mid, status: 'cancelled' });
          }
          dispatch({ type: 'set_typing', typing: false });
          dispatch({ type: 'set_abort', ctrl: null });
          return;
        }
        const message = err instanceof Error ? err.message : '网络错误';
        const category: ErrorCategory = /timeout|abort/i.test(message) ? 'timeout' : /401|认证|令牌/i.test(message) ? 'auth' : 'network';
        finishError(message, category);
      });
    },
    [],
  );

  const launchReply = useCallback(
    (
      sid: string,
      text: string,
      ctrl: AbortController,
      corr: string,
      digitalPartnerId?: string,
      opts?: { replyId?: string; skipAppend?: boolean; agentName?: string; modelId?: string; enabledTools?: string[]; conversationId?: string; modeHint?: string; reflectHint?: string; sessionMode?: 'investigate' | 'execute'; runMode?: 'ask' | 'plan' | 'agent'; reasoningEffort?: 'off' | 'standard' | 'deep'; riskLevel?: 'low' | 'medium' | 'high'; attachmentIds?: string[]; clientMsgId?: string; replyMode?: 'single' | 'segmented' | 'stepwise' },
    ) => {
      const replyId = opts?.replyId ?? uid('m_');
      if (isMockChatMode()) {
        const reply = generateMockReply(text);
        startStream(sid, replyId, { ...reply, id: replyId }, ctrl, corr, { skipAppend: opts?.skipAppend });
      } else {
        startBackendStream(sid, replyId, text, ctrl, corr, digitalPartnerId, {
          skipAppend: opts?.skipAppend,
          agentName: opts?.agentName,
          modelId: opts?.modelId,
          enabledTools: opts?.enabledTools,
          conversationId: opts?.conversationId,
          modeHint: opts?.modeHint,
          reflectHint: opts?.reflectHint,
          sessionMode: opts?.sessionMode,
          runMode: opts?.runMode,
          reasoningEffort: opts?.reasoningEffort,
          riskLevel: opts?.riskLevel,
          attachmentIds: opts?.attachmentIds,
          clientMsgId: opts?.clientMsgId,
          replyMode: opts?.replyMode ?? DEFAULT_REPLY_MODE,
        });
      }
    },
    [startStream, startBackendStream],
  );

  /* ==================== 公共 API ==================== */

  const setDraft = useCallback((v: string) => dispatch({ type: 'set_draft', value: v }), []);

  const newSession = useCallback(async (opts?: { digitalPartnerId?: string; digitalPartnerName?: string; agentKey?: string; modelId?: string; enabledTools?: string[] }) => {
    const expertName = opts?.digitalPartnerName
      ?? (opts?.digitalPartnerId ? (agentMeta?.name ?? '岗位专家') : '助手');
    const workspaceId = useWorkspaceStore.getState().currentWorkspaceId ?? 'w1';
    const owner = useAuthStore.getState().user;
    const modelId = opts?.modelId ?? '';

    const buildLocal = (id: string, conversationId: string): ChatSession => ({
      id,
      title: '新会话',
      preview: '',
      agent: expertName,
      agentKey: opts?.agentKey,
      digitalPartnerId: opts?.digitalPartnerId,
      digitalPartnerName: opts?.digitalPartnerId ? expertName : undefined,
      status: 'active',
      lifecycle: 'active',
      group: 'today',
      time: nowHHMM(),
      messages: [],
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      ownerId: owner?.id ?? 'u1',
      ownerName: owner?.name ?? '王昊',
      workspaceId,
      conversationId,
      modelId,
      enabledTools: opts?.enabledTools,
      sessionMode: 'investigate',
      runMode: 'plan',
      reasoningEffort: 'standard',
      riskLevel: 'medium',
      replyMode: 'segmented',
    });

    if (!isMockChatMode()) {
      try {
        const created = await getApiClient().post<{
          id: string;
          conversationId?: string;
          title?: string;
          digitalPartnerId?: string;
          digitalPartnerName?: string;
          modelId?: string;
        }>('/api/sessions', {
          title: '新会话',
          digitalPartnerId: opts?.digitalPartnerId,
          digitalPartnerName: opts?.digitalPartnerId ? expertName : undefined,
          modelId,
        });
        const sess = buildLocal(created.id, created.conversationId || created.id);
        if (created.modelId) sess.modelId = created.modelId;
        sess.pendingServerSync = true;
        dispatch({ type: 'new_session', session: sess });
        rememberCopilotSession(sess.workspaceId ?? 'w1', sess.id);
        return created.id;
      } catch (err) {
        // Do not fall back to local-only s_* sessions — they create orphan memory without /api/sessions rows.
        throw err instanceof Error ? err : new Error('创建会话失败，请重试');
      }
    }

    const id = uid('s_');
    const session = buildLocal(id, id);
    dispatch({ type: 'new_session', session });
    rememberCopilotSession(session.workspaceId ?? 'w1', session.id);
    return id;
  }, [agentMeta?.name]);

  const patchSessionRemote = useCallback(async (id: string, body: Record<string, unknown>) => {
    if (!id || /^s_/.test(id) || isMockChatMode()) return;
    try {
      await getApiClient().request(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body,
      });
    } catch {
      /* 本地状态已更新；服务端失败下次刷新再对齐 */
    }
  }, []);

  /** 将当前工作区的只读历史记录并入本地会话，并剔除服务端已不存在的残留。 */
  const importSessions = useCallback((sessions: ChatSession[], opts?: { workspaceId?: string; reconcile?: boolean }) => {
    const filtered = sessions.filter((session) => {
      if (!session.id || deletedSessionIdsRef.current.has(session.id)) return false;
      const convId = session.conversationId;
      if (convId && deletedConversationIdsRef.current.has(convId)) return false;
      return true;
    });
    if (filtered.length) dispatch({ type: 'merge_sessions', sessions: filtered });
    // 仅在拿到非空权威清单时 reconcile；空数组可能是 owner 过滤 / 瞬态空响应，切勿误删本地会话记录。
    if (opts?.reconcile && opts.workspaceId && filtered.length > 0) {
      dispatch({
        type: 'reconcile_sessions',
        workspaceId: opts.workspaceId,
        serverIds: filtered.map((session) => session.id),
      });
    }
  }, []);

  const syncSession = useCallback((session: ChatSession, opts?: { preserveGovernance?: boolean }) => {
    if (!session.id || deletedSessionIdsRef.current.has(session.id)) return;
    dispatch({ type: 'sync_session', session, preserveGovernance: opts?.preserveGovernance });
  }, []);

  /** 仅更新会话元数据，绝不带 messages，避免乐观用户气泡被陈旧快照冲掉。 */
  const patchSessionLocal = useCallback((sid: string, patch: Partial<ChatSession>) => {
    if (!sid || deletedSessionIdsRef.current.has(sid)) return;
    const { messages: _omit, ...safe } = patch as Partial<ChatSession> & { messages?: ChatMessageEx[] };
    void _omit;
    dispatch({ type: 'update_session', sid, patch: safe });
  }, []);

  /** 将本地会话变更同步到服务端（改绑专家、运行配置等）。默认吞掉网络错误；需要回滚时用 throwOnError。 */
  const persistSession = useCallback(async (session: ChatSession, opts?: { throwOnError?: boolean }) => {
    if (!session.id || deletedSessionIdsRef.current.has(session.id)) return;
    // 关键：用 update_session 打补丁，禁止 sync 整表 messages
    patchSessionLocal(session.id, {
      title: session.title,
      digitalPartnerId: session.digitalPartnerId,
      digitalPartnerName: session.digitalPartnerName,
      agent: session.agent,
      modelId: session.modelId,
      enabledTools: session.enabledTools,
      status: session.status,
      lifecycle: session.lifecycle,
      pinned: session.pinned,
      starred: session.starred,
      sessionMode: session.sessionMode,
      runMode: session.runMode,
      reasoningEffort: session.reasoningEffort,
      riskLevel: session.riskLevel,
      handoff: session.handoff,
      closeSummary: session.closeSummary,
      preview: session.preview,
      workspaceId: session.workspaceId,
    });
    if (/^s_/.test(session.id) || isMockChatMode()) return;
    try {
      await getApiClient().request(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: 'PATCH',
        body: {
          title: session.title,
          digitalPartnerId: session.digitalPartnerId ?? '',
          modelId: session.modelId,
          enabledTools: session.enabledTools,
          status: session.status === 'archived' || session.lifecycle === 'archived'
            ? 'archived'
            : (session.status === 'closed' || session.status === 'done' ? 'closed' : (session.status || 'active')),
          pinned: Boolean(session.pinned),
          starred: Boolean(session.starred),
          sessionMode: session.sessionMode,
          runMode: session.runMode,
          reasoningEffort: session.reasoningEffort,
          riskLevel: session.riskLevel,
          handoff: session.handoff,
          closeSummary: session.closeSummary,
        },
      });
    } catch (err) {
      if (opts?.throwOnError) throw err;
    }
  }, [patchSessionLocal]);

  /** 研判 / 受控执行：乐观更新 + PATCH；失败回滚。 */
  const setCollaborationMode = useCallback(async (
    mode: 'investigate' | 'execute',
    opts?: { riskLevel?: 'low' | 'medium' | 'high'; enableApprovalTools?: string[]; runMode?: 'ask' | 'plan' | 'agent'; reasoningEffort?: 'off' | 'standard' | 'deep' },
  ) => {
    const sid = state.activeId;
    if (!sid) return;
    const session = state.sessions[sid];
    if (!session) return;
    if (session.status === 'closed' || session.status === 'done' || session.status === 'archived') {
      throw new Error('会话已结案，无法切换模式');
    }
    if (session.handoff?.active) {
      throw new Error('人工交接中，无法切换模式');
    }
    const prevMode = session.sessionMode === 'execute' ? 'execute' : 'investigate';
    const prevRisk = session.riskLevel;
    const prevTools = session.enabledTools;
    const prevRun = session.runMode;
    const prevEffort = session.reasoningEffort;
    const riskLevel = opts?.riskLevel ?? session.riskLevel ?? 'medium';
    const enabledTools = mode === 'execute' && opts?.enableApprovalTools?.length
      ? Array.from(new Set([...(session.enabledTools ?? []), ...opts.enableApprovalTools]))
      : session.enabledTools;
    const patch: Partial<ChatSession> = { sessionMode: mode, riskLevel, enabledTools };
    if (opts?.runMode) patch.runMode = opts.runMode;
    if (opts?.reasoningEffort) patch.reasoningEffort = opts.reasoningEffort;
    patchSessionLocal(sid, patch);
    try {
      if (/^s_/.test(sid) || isMockChatMode()) return;
      await getApiClient().request(`/api/sessions/${encodeURIComponent(sid)}`, {
        method: 'PATCH',
        body: {
          sessionMode: mode,
          riskLevel,
          enabledTools,
          ...(opts?.runMode ? { runMode: opts.runMode } : {}),
          ...(opts?.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
        },
      });
    } catch (err) {
      patchSessionLocal(sid, {
        sessionMode: prevMode,
        riskLevel: prevRisk,
        enabledTools: prevTools,
        runMode: prevRun,
        reasoningEffort: prevEffort,
      });
      throw err instanceof Error ? err : new Error('模式切换失败，请重试');
    }
  }, [state.activeId, state.sessions, patchSessionLocal]);

  const clearActive = useCallback(() => {
    dispatch({ type: 'clear_active' });
  }, []);

  const delSession = useCallback(async (id: string) => {
    if (!id) return;
    const removed = state.sessions[id];
    deletedSessionIdsRef.current.add(id);
    const convId = removed?.conversationId;
    if (convId) deletedConversationIdsRef.current.add(convId);
    if (removed) clearCopilotLastSession(removed.workspaceId ?? 'w1', id);
    saveDeletedTombstones(deletedSessionIdsRef.current, deletedConversationIdsRef.current);
    dispatch({ type: 'del_session', id });
    if (isMockChatMode()) return;
	// 本地已删；tombstone 保留到 DELETE 成功且服务端已持久删除。
    try {
      await getApiClient().request(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      // 删除成功后再清 tombstone：失败时仍阻止 importSessions 回灌
      deletedSessionIdsRef.current.delete(id);
      if (convId) deletedConversationIdsRef.current.delete(convId);
      saveDeletedTombstones(deletedSessionIdsRef.current, deletedConversationIdsRef.current);
    } catch {
      // 保留 tombstone，避免服务端仍有记录时回灌
    }
  }, [state.sessions]);
  const switchSession = useCallback((id: string) => {
    const target = state.sessions[id];
    if (target) {
      rememberCopilotSession(target.workspaceId ?? 'w1', id);
    }
    dispatch({ type: 'switch', id });
  }, [state.sessions]);
  const togglePin = useCallback((id: string) => {
    const sess = state.sessions[id];
    if (!sess) return;
    const pinned = !sess.pinned;
    dispatch({ type: 'pin', id, pinned });
    void patchSessionRemote(id, { pinned });
  }, [state.sessions, patchSessionRemote]);
  const toggleStar = useCallback((id: string) => {
    const sess = state.sessions[id];
    if (!sess) return;
    const starred = !sess.starred;
    dispatch({ type: 'star', id, starred });
    void patchSessionRemote(id, { starred });
  }, [state.sessions, patchSessionRemote]);

  const stop = useCallback(() => {
    dispatch({ type: 'stop_typing' });
    const corr = state.activeCorrelationId;
    if (corr) {
      const sid = state.activeId;
      const sess = state.sessions[sid];
      if (sess) {
        const streaming = sess.messages.filter((x) => x.correlationId === corr && (x.status === 'streaming' || x.status === 'in_flight'));
        for (const m of streaming) {
          dispatch({ type: 'set_msg_status', sid, mid: m.id, status: 'cancelled' });
        }
        if (!streaming.length) {
          const m = sess.messages.find((x) => x.correlationId === corr);
          if (m) dispatch({ type: 'set_msg_status', sid, mid: m.id, status: 'cancelled' });
        }
        dispatch({ type: 'update_session', sid, patch: { pendingTurn: undefined } });
      }
      dispatch({ type: 'set_active_correlation', id: null });
      if (!isMockChatMode()) {
        const conversationId = sess?.conversationId ?? sid;
        void getApiClient().request(`/api/copilot/conversations/${encodeURIComponent(conversationId)}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ correlationId: corr }),
        }).catch(() => undefined);
      }
    }
  }, [state.activeCorrelationId, state.activeId, state.sessions]);

  const send = useCallback((content: string, opts?: Partial<SendMessageInput>) => {
    const sid = state.activeId;
    const text = (opts?.text ?? content).trim();
    const sess = state.sessions[sid];
    if (!text || !sid || state.typing) return;
    if (sessionHasActiveTurn(sess)) return;

    dispatch({ type: 'push_history', value: text });

    const corr = correlationId();
    dispatch({ type: 'set_active_correlation', id: corr });

    const userMsg: ChatMessageEx = {
      id: uid('m_'),
      role: 'user',
      content: text,
      clientMsgId: uid('c_'),
      correlationId: corr,
      status: 'succeeded',
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: 'append_msg', sid, msg: userMsg });
    dispatch({ type: 'set_draft', value: '' });

    // 流式
    const ctrl = new AbortController();
    dispatch({ type: 'set_abort', ctrl });
    dispatch({ type: 'set_typing', typing: true });

    // 超时
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      ctrl.abort();
    }, DEFAULT_TIMEOUT_MS);

    const deId = opts?.digitalPartnerId ?? sess?.digitalPartnerId;
    const replyName = sess?.digitalPartnerId
      ? (sess.digitalPartnerName ?? sess.agent ?? '岗位专家')
      : '助手';
    const modelId = opts?.modelId ?? opts?.model ?? sess?.modelId;
    const enabledTools = opts?.enabledTools ?? sess?.enabledTools;
    const replyMode = opts?.replyMode ?? sess?.replyMode ?? DEFAULT_REPLY_MODE;
    // 仅打元数据补丁，禁止 sync 整表（否则会用 append 前的 stale messages 冲掉刚插入的用户气泡）
    if (sess) {
      const patch: Partial<ChatSession> = { replyMode };
      if (opts?.modelId || opts?.model) patch.modelId = modelId ?? sess.modelId;
      if (opts?.enabledTools) patch.enabledTools = enabledTools ?? sess.enabledTools;
      if (opts?.sessionMode) patch.sessionMode = opts.sessionMode;
      if (opts?.runMode) patch.runMode = opts.runMode;
      if (opts?.reasoningEffort) patch.reasoningEffort = opts.reasoningEffort;
      if (opts?.riskLevel) patch.riskLevel = opts.riskLevel;
      dispatch({ type: 'update_session', sid, patch });
    }
    setTimeout(() => {
      launchReply(sid, text, ctrl, corr, deId, {
        modelId,
        enabledTools,
        conversationId: sess?.conversationId ?? sid,
        agentName: replyName,
        modeHint: opts?.modeHint,
        reflectHint: opts?.reflectHint,
        sessionMode: opts?.sessionMode ?? sess?.sessionMode,
        runMode: opts?.runMode ?? sess?.runMode,
        reasoningEffort: opts?.reasoningEffort ?? sess?.reasoningEffort,
        riskLevel: opts?.riskLevel ?? sess?.riskLevel,
        replyMode,
        attachmentIds: opts?.attachmentIds,
        clientMsgId: userMsg.clientMsgId,
      });
    }, isMockChatMode() ? 300 : 0);
  }, [state.activeId, state.sessions, state.typing, launchReply]);

  const sendMessage = send; // 兼容别名

  const replaceAndSend = useCallback((mid: string, content: string, opts?: Partial<SendMessageInput> & { modelId?: string; enabledTools?: string[] }) => {
    const sess = state.sessions[state.activeId];
    const original = sess?.messages.find((message) => message.id === mid);
    const text = content.trim();
    if (!sess || !original || original.role !== 'user' || !text || state.typing) return;
    const corr = correlationId();
    const userMsg = { ...original, content: text, editedAt: new Date().toISOString(), correlationId: corr, status: 'succeeded' as const };
    dispatch({ type: 'replace_from_message', sid: state.activeId, mid, msg: userMsg });
    dispatch({ type: 'set_draft', value: '' }); dispatch({ type: 'set_active_correlation', id: corr }); dispatch({ type: 'set_typing', typing: true });
    const ctrl = new AbortController(); dispatch({ type: 'set_abort', ctrl });
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
    const modelId = opts?.modelId ?? sess.modelId;
    const enabledTools = opts?.enabledTools ?? sess.enabledTools;
    setTimeout(() => {
      launchReply(state.activeId, text, ctrl, corr, sess.digitalPartnerId, {
        modelId,
        enabledTools,
        conversationId: sess.conversationId ?? state.activeId,
        agentName: sess.digitalPartnerId
          ? (sess.digitalPartnerName ?? sess.agent ?? '岗位专家')
          : '助手',
        sessionMode: opts?.sessionMode ?? sess.sessionMode,
        runMode: opts?.runMode ?? sess.runMode,
        reasoningEffort: opts?.reasoningEffort ?? sess.reasoningEffort,
        riskLevel: opts?.riskLevel ?? sess.riskLevel,
        attachmentIds: opts?.attachmentIds,
        clientMsgId: userMsg.clientMsgId,
      });
    }, isMockChatMode() ? 200 : 0);
  }, [state.activeId, state.sessions, state.typing, launchReply]);

  const regenerate = useCallback((mid: string, opts?: { modelId?: string; enabledTools?: string[]; modeHint?: string; reflectHint?: string; sessionMode?: 'investigate' | 'execute'; runMode?: 'ask' | 'plan' | 'agent'; reasoningEffort?: 'off' | 'standard' | 'deep' }) => {
    const sess = state.sessions[state.activeId];
    if (!sess) return;
    const idx = sess.messages.findIndex((m) => m.id === mid);
    if (idx <= 0) return;
    const userMsg = sess.messages[idx - 1];
    if (userMsg.role !== 'user') return;

    const corr = correlationId();
    dispatch({ type: 'set_active_correlation', id: corr });

    const replyId = uid('m_');
    const agentName = sess.digitalPartnerId
      ? (sess.digitalPartnerName ?? sess.agent ?? '岗位专家')
      : '助手';
    const placeholder: ChatMessageEx = {
      id: replyId,
      role: 'assistant',
      agentName,
      content: '',
      reasoningSteps: [],
      toolCalls: [],
      citations: [],
      clientMsgId: uid('c_'),
      correlationId: corr,
      parentId: mid,
      branchIndex: (sess.messages.filter((m) => m.parentId === mid).length || 0) + 1,
      status: 'streaming',
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: 'regenerate', sid: state.activeId, mid, msg: placeholder });

    const ctrl = new AbortController();
    dispatch({ type: 'set_abort', ctrl });
    dispatch({ type: 'set_typing', typing: true });

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);

    setTimeout(() => {
      launchReply(state.activeId, userMsg.content, ctrl, corr, sess.digitalPartnerId, {
        replyId,
        skipAppend: true,
        agentName,
        modelId: opts?.modelId ?? sess.modelId,
        enabledTools: opts?.enabledTools ?? sess.enabledTools,
        conversationId: sess.conversationId ?? state.activeId,
        modeHint: opts?.modeHint,
        reflectHint: opts?.reflectHint,
        sessionMode: opts?.sessionMode ?? sess.sessionMode,
        runMode: opts?.runMode ?? sess.runMode,
        reasoningEffort: opts?.reasoningEffort ?? sess.reasoningEffort,
        clientMsgId: userMsg.clientMsgId,
      });
    }, isMockChatMode() ? 200 : 0);
  }, [state.activeId, state.sessions, launchReply]);

  const clearTurnRecovery = useCallback(() => {
    if (turnRecoveryRef.current) {
      clearInterval(turnRecoveryRef.current);
      turnRecoveryRef.current = null;
    }
  }, []);

  const recoverPendingTurn = useCallback(async (sid: string): Promise<'running' | 'done' | 'cancelled' | 'idle'> => {
    if (isMockChatMode()) return 'idle';
    const sess = state.sessions[sid];
    if (!sess) return 'idle';
    const pending = sess.pendingTurn;
    const inflightCorr = sess.messages.find((m) => m.status === 'in_flight')?.correlationId;
    const corr = pending?.correlationId ?? inflightCorr;
    if (!corr) return 'idle';
    const convId = sess.conversationId ?? sid;
    if (/^s_/.test(convId)) return 'idle';

    const applyStatus = (status: Awaited<ReturnType<typeof fetchCopilotTurnStatus>>) => {
      if (!status) return 'running' as const;
      if (status.status === 'running' && !status.hasAssistantReply) {
        dispatch({ type: 'set_typing', typing: true });
        return 'running' as const;
      }
      if (status.status === 'done' || status.hasAssistantReply) {
        dispatch({ type: 'update_session', sid, patch: { pendingTurn: undefined } });
        dispatch({ type: 'set_typing', typing: false });
        clearTurnRecovery();
        return 'done' as const;
      }
      if (status.status === 'cancelled' || status.status === 'failed') {
        dispatch({ type: 'update_session', sid, patch: { pendingTurn: undefined } });
        dispatch({ type: 'set_typing', typing: false });
        clearTurnRecovery();
        return 'cancelled' as const;
      }
      return 'running' as const;
    };

    const outcome = applyStatus(await fetchCopilotTurnStatus(convId, corr));
    if (outcome !== 'running') return outcome;
    if (!turnRecoveryRef.current) {
      turnRecoveryRef.current = setInterval(() => {
        void fetchCopilotTurnStatus(convId, corr).then((status) => {
          const next = applyStatus(status);
          if (next !== 'running') clearTurnRecovery();
        });
      }, TURN_RECOVERY_POLL_MS);
    }
    return 'running';
  }, [clearTurnRecovery, state.sessions]);

  const delMessage = useCallback((mid: string) => {
    if (state.activeId) dispatch({ type: 'del_msg', sid: state.activeId, mid });
  }, [state.activeId]);

  /** 本地助手消息（Slash /help 等，不走后端流）。 */
  const appendLocalAssistant = useCallback((content: string, opts?: { agentName?: string }) => {
    if (!state.activeId) return;
    const msg: ChatMessageEx = {
      id: uid('m_'),
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
      status: 'succeeded',
      agentName: opts?.agentName ?? '系统',
    };
    dispatch({ type: 'append_msg', sid: state.activeId, msg });
  }, [state.activeId]);

  /** 清空当前会话消息（保留会话绑定与运行配置）。 */
  const clearActiveMessages = useCallback(() => {
    if (!state.activeId) return;
    const sess = state.sessions[state.activeId];
    if (!sess) return;
    dispatch({
      type: 'sync_session',
      session: {
        ...sess,
        messages: [],
        preview: '',
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      },
    });
  }, [state.activeId, state.sessions]);

  /** 指定签名位批准：单人审核优先；遗留双签仍走 signerIndex。仅授权，不自动执行。 */
  const approve = useCallback(async (mid: string, signerIndex: number, decisionNote?: string) => {
    if (!state.activeId) return;
    const session = state.sessions[state.activeId];
    const message = session?.messages.find((item) => item.id === mid);
    if (!message?.approvalRequest) return;
    const actor = useAuthStore.getState().user;
    if (!actor) throw new Error('请先登录后再授权。');

    const api = getApiClient();
    const conversationId = session.conversationId ?? state.activeId;
    const isSingle = (message.approvalRequest.required ?? 2) <= 1
      || Boolean((message as ChatMessageEx & { authorizationRequest?: unknown }).authorizationRequest);

    if (session.sessionMode !== 'execute') {
      await patchSessionRemote(session.id, { sessionMode: 'execute', riskLevel: session.riskLevel ?? 'medium' });
      dispatch({ type: 'update_session', sid: state.activeId, patch: { sessionMode: 'execute' } });
    }

    const result = await api.post<{ signedAt: string; signatureHash: string; completed: boolean }>(`/api/actions/${mid}/approve`, {
      signerIndex: isSingle ? 0 : signerIndex,
      conversationId,
      decisionNote: decisionNote ?? '',
    });
    dispatch({ type: 'approve', sid: state.activeId, mid, signerIndex: isSingle ? 0 : signerIndex, signedAt: result.signedAt, signatureHash: result.signatureHash });
    if (!result.completed) return;

    const request = message.approvalRequest!;
    const signers = (request.signers ?? []).map((signer, index) =>
      index === (isSingle ? 0 : signerIndex) || signer.signed
        ? {
            ...signer,
            signed: true,
            signedAt: index === (isSingle ? 0 : signerIndex) ? result.signedAt : signer.signedAt,
            signatureHash: index === (isSingle ? 0 : signerIndex) ? result.signatureHash : signer.signatureHash,
          }
        : signer,
    );
    dispatch({
      type: 'replace_msg',
      sid: state.activeId,
      mid,
      msg: {
        ...message,
        approvalRequest: {
          ...request,
          signers: signers.length ? signers : [{
            userId: actor.id, name: actor.name, role: 'approver' as const,
            signed: true, signedAt: result.signedAt, signatureHash: result.signatureHash,
          }],
          signed: request.required ?? 1,
          decision: 'approved',
          decidedAt: result.signedAt,
        },
      },
    });
  }, [state.activeId, state.sessions, patchSessionRemote]);

  const AUTHORIZED_EXECUTE_MARKER = '—— 授权后执行结果 ——';

  const appendExecuteResultOnce = (content: string, executeResult: string, nextRunCommand?: string) => {
    if (!executeResult.trim()) return content;
    if (content.includes(AUTHORIZED_EXECUTE_MARKER)) return content;
    let next = `${content}\n\n${AUTHORIZED_EXECUTE_MARKER}\n${executeResult}`;
    if (nextRunCommand) {
      next += `\n\n待续跑：action=run command=${nextRunCommand}`;
    }
    return next;
  };

  /** 授权完成后手动执行受控动作；返回是否执行成功 */
  const executeAuthorized = useCallback(async (mid: string): Promise<boolean> => {
    if (!state.activeId) return false;
    const session = state.sessions[state.activeId];
    const message = session?.messages.find((item) => item.id === mid);
    if (!message?.approvalRequest || message.approvalRequest.decision !== 'approved') {
      throw new Error('该操作尚未授权，无法执行');
    }
    const actor = useAuthStore.getState().user;
    if (!actor) throw new Error('请先登录后再执行。');

    const api = getApiClient();
    const conversationId = session.conversationId ?? state.activeId;
    const request = message.approvalRequest;

    const task = await api.post<{ id: string; code: string }>(`/api/conversations/${conversationId}/tasks`, {
      title: `${session?.title ?? '专家协同会话'} · 待办事项`,
      priority: 'P1',
      assignee: actor.name,
      digitalPartnerId: session?.digitalPartnerId,
      correlationId: message.correlationId,
      conversationId,
      links: { conversationId },
      source: 'conversation',
    });

    let executeResult = '';
    let nextRunCommand = '';
    let canContinueRun = false;
    let skillTurn = request.skillTurn;
    try {
      const executed = await api.post<{
        executeResult?: string;
        status?: string;
        nextRunCommand?: string;
        canContinueRun?: boolean;
        skillTurn?: NonNullable<ChatMessageEx['approvalRequest']>['skillTurn'];
      }>(`/api/actions/${mid}/execute`, { taskId: task.id, conversationId });
      executeResult = typeof executed?.executeResult === 'string' ? executed.executeResult : '';
      nextRunCommand = typeof executed?.nextRunCommand === 'string' ? executed.nextRunCommand : '';
      canContinueRun = Boolean(executed?.canContinueRun || nextRunCommand);
      if (executed?.skillTurn) skillTurn = executed.skillTurn;
    } catch (err) {
      executeResult = err instanceof Error ? `执行失败：${err.message}` : '执行失败';
    }

    const execOk = executeResult.length > 0
      && !isSkillExecuteFailure(executeResult)
      && !skillTurnHasFailedStep(skillTurn);
    dispatch({
      type: 'replace_msg',
      sid: state.activeId,
      mid,
      msg: {
        ...message,
        content: appendExecuteResultOnce(message.content, executeResult, canContinueRun ? nextRunCommand : undefined),
        approvalRequest: {
          ...request,
          skillTurn: skillTurn ?? request.skillTurn,
          planSummary: skillTurn?.summary ?? request.planSummary,
        },
        linkedTaskId: task.id,
        nextRunCommand: canContinueRun ? nextRunCommand : undefined,
        canContinueRun: canContinueRun || undefined,
        toolCalls: [
          ...(message.toolCalls ?? []),
          {
            id: uid('t_'),
            name: request.action,
            args: { resource: request.resource, ticketId: request.ticketId },
            result: executeResult || `已授权执行 · 任务 ${task.code ?? task.id} 已回链`,
            status: execOk ? 'success' : 'failed',
            durationMs: 48,
            permission: 'approval-required',
          },
        ],
      },
    });
    return execOk;
  }, [state.activeId, state.sessions]);

  /** P2：批准后若仍有待续跑 run，手动继续 Skill Turn；返回是否成功 */
  const continueSkillTurn = useCallback(async (mid: string): Promise<boolean> => {
    if (!state.activeId) return false;
    const session = state.sessions[state.activeId];
    const message = session?.messages.find((item) => item.id === mid);
    if (!message) return false;
    const conversationId = session.conversationId ?? state.activeId;
    const cmd = skillTurnRunCommandFromMessage(message)
      || message.nextRunCommand
      || parseNextRunCommandFromContent(message.content);
    if (!cmd && !message.canContinueRun) {
      throw new Error('没有可续跑的 run 步骤');
    }
    let executeResult = '';
    let nextRunCommand = '';
    let canContinueRun = false;
    let skillTurn = message.approvalRequest?.skillTurn;
    try {
      const executed = await getApiClient().post<{
        executeResult?: string;
        nextRunCommand?: string;
        canContinueRun?: boolean;
        skillTurn?: NonNullable<ChatMessageEx['approvalRequest']>['skillTurn'];
      }>(`/api/actions/${mid}/execute`, {
        conversationId,
        continueRun: true,
        command: cmd || undefined,
      });
      executeResult = typeof executed?.executeResult === 'string' ? executed.executeResult : '';
      nextRunCommand = typeof executed?.nextRunCommand === 'string' ? executed.nextRunCommand : '';
      canContinueRun = Boolean(executed?.canContinueRun || nextRunCommand);
      if (executed?.skillTurn) skillTurn = executed.skillTurn;
    } catch (err) {
      executeResult = err instanceof Error ? `执行失败：${err.message}` : '执行失败';
    }
    const execOk = executeResult.length > 0
      && !isSkillExecuteFailure(executeResult)
      && !skillTurnHasFailedStep(skillTurn);
    dispatch({
      type: 'replace_msg',
      sid: state.activeId,
      mid,
      msg: {
        ...message,
        content: executeResult
          ? `${message.content}\n\n—— 继续执行 run ——\n${executeResult}`
          : message.content,
        approvalRequest: message.approvalRequest
          ? {
              ...message.approvalRequest,
              skillTurn: skillTurn ?? message.approvalRequest.skillTurn,
              planSummary: skillTurn?.summary ?? message.approvalRequest.planSummary,
            }
          : message.approvalRequest,
        nextRunCommand: canContinueRun ? nextRunCommand : undefined,
        canContinueRun: canContinueRun || undefined,
        toolCalls: [
          ...(message.toolCalls ?? []),
          {
            id: uid('t_'),
            name: 'skill.run',
            args: { command: cmd },
            result: executeResult || '续跑完成',
            status: execOk ? 'success' : 'failed',
            durationMs: 48,
          },
        ],
      },
    });
    return execOk;
  }, [state.activeId, state.sessions]);

  /** 兼容旧 API：不再绕过服务端校验，仍只尝试首个未签席位。 */
  const approveSign = useCallback((mid: string) => {
    const session = state.activeId ? state.sessions[state.activeId] : undefined;
    const request = session?.messages.find((item) => item.id === mid)?.approvalRequest;
    const signerIndex = request?.signers.findIndex((signer) => !signer.signed) ?? -1;
    if (signerIndex >= 0) return approve(mid, signerIndex);
    return Promise.resolve();
  }, [approve, state.activeId, state.sessions]);

  /** 拒绝：本地更新 + 服务端 reject */
  const reject = useCallback((mid: string, signerIndex: number, reason?: string) => {
    if (!state.activeId) return;
    const session = state.sessions[state.activeId];
    dispatch({ type: 'reject', sid: state.activeId, mid, signerIndex, reason });
    if (!isMockChatMode() && session) {
      void getApiClient().post(`/api/actions/${mid}/reject`, {
        conversationId: session.conversationId ?? state.activeId,
        reason: reason ?? '已拒绝',
      }).catch(() => undefined);
    }
  }, [state.activeId, state.sessions]);

  /** 分享（服务端只读 token） */
  const shareSession = useCallback(async (id: string): Promise<string | null> => {
    const sess = state.sessions[id];
    if (!sess) return null;
    if (sess.shareToken) return sess.shareToken;
    if (isMockChatMode()) {
      const token = uid('sh_');
      dispatch({ type: 'set_share_token', id, token });
      return token;
    }
    try {
      const res = await getApiClient().post<{ token: string }>(`/api/sessions/${encodeURIComponent(id)}/share`, {});
      dispatch({ type: 'set_share_token', id, token: res.token });
      return res.token;
    } catch {
      return null;
    }
  }, [state.sessions]);

  const revokeShare = useCallback((id: string) => {
    dispatch({ type: 'set_share_token', id, token: null });
    if (!isMockChatMode()) {
      void getApiClient().request(`/api/sessions/${encodeURIComponent(id)}/share`, { method: 'DELETE' }).catch(() => undefined);
    }
  }, []);

  /** 反馈（点赞 / 点踩 + 标签 + 备注）；同步后端自进化候选 */
  const setFeedback = useCallback((mid: string, payload: { kind: FeedbackKind; tags?: FeedbackTag[]; comment?: string; ratedBy?: string }) => {
    if (!state.activeId) return;
    const sid = state.activeId;
    const sess = state.sessions[sid];
    const msg = sess?.messages.find((m) => m.id === mid);
    dispatch({
      type: 'set_feedback',
      sid,
      mid,
      feedback: {
        kind: payload.kind,
        tags: payload.tags,
        comment: payload.comment,
        ratedBy: payload.ratedBy ?? 'u1',
        ratedAt: new Date().toISOString(),
      },
    });
    if (isMockChatMode()) return;
    const conversationId = sess?.conversationId || msg?.correlationId || sid;
    const serverMid = msg?.serverMsgId || mid;
    if (!conversationId || payload.kind == null) return;
    const token = localStorage.getItem('token');
    const workspaceId = useWorkspaceStore.getState().currentWorkspaceId ?? 'w1';
    void fetch(`/api/copilot/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(serverMid)}/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'x-workspace-id': workspaceId,
      },
      body: JSON.stringify({
        kind: payload.kind,
        comment: payload.comment,
        tags: payload.tags,
      }),
    }).catch(() => {
      /* 反馈失败不阻断本地 UI */
    });
  }, [state.activeId, state.sessions]);

  /** 重试某条失败消息（消费相同 clientMsgId 幂等） */
  const retryMessage = useCallback((mid: string) => {
    const sess = state.sessions[state.activeId];
    if (!sess) return;
    const m = sess.messages.find((x) => x.id === mid);
    if (!m || m.role !== 'assistant' || m.status !== 'failed') return;
    // 找到对应的 user 消息
    const idx = sess.messages.findIndex((x) => x.id === mid);
    if (idx <= 0) return;
    const userMsg = sess.messages[idx - 1];
    if (userMsg.role !== 'user') return;
    regenerate(mid);
  }, [state.activeId, state.sessions, regenerate]);

  /** 归档 / 取消归档 */
  const archiveSession = useCallback((id: string, archived: boolean) => {
    dispatch({ type: 'archive_session', id, archived });
    void patchSessionRemote(id, { status: archived ? 'archived' : 'active' });
  }, [patchSessionRemote]);

  /** 导出 */
  const exportSessionAs = useCallback((id: string, format: 'markdown' | 'json' | 'audit', options?: { includeCitations?: boolean; includeToolCalls?: boolean; includeReasoning?: boolean; includeAuditTrail?: boolean }): string | null => {
    const sess = state.sessions[id];
    if (!sess) return null;
    const opts = { includeAuditTrail: format === 'audit', ...(options ?? {}) };
    if (format === 'json') {
      return JSON.stringify({ session: sess }, null, 2);
    }
    return exportSession(sess, opts);
  }, [state.sessions]);

  /** 会话指标汇总 */
  const getSessionMetrics = useCallback((id: string) => {
    const sess = state.sessions[id];
    if (!sess) return null;
    const msgs = sess.messages.filter((m) => m.role === 'assistant');
    const succeeded = msgs.filter((m) => m.status === 'succeeded').length;
    const cancelled = msgs.filter((m) => m.status === 'cancelled').length;
    const failed = msgs.filter((m) => m.status === 'failed').length;
    const total = msgs.length || 1;
    const ttfts = msgs.map((m) => m.metrics?.ttftMs ?? 0).filter((v) => v > 0);
    const tokens = msgs.reduce((acc, m) => acc + (m.metrics?.completionTokens ?? 0), 0);
    const likes = msgs.filter((m) => m.feedback?.kind === 'like').length;
    const dislikes = msgs.filter((m) => m.feedback?.kind === 'dislike').length;
    return {
      totalMessages: sess.messages.length,
      totalTokens: tokens,
      avgTtftMs: ttfts.length ? Math.round(ttfts.reduce((a, b) => a + b, 0) / ttfts.length) : 0,
      successRate: succeeded / total,
      cancelledCount: cancelled,
      failedCount: failed,
      feedbackLike: likes,
      feedbackDislike: dislikes,
    };
  }, [state.sessions]);

  /** 调试面板 */
  const setDebugOpen = useCallback((open: boolean) => dispatch({ type: 'set_debug', open }), []);
  const clearRequests = useCallback(() => dispatch({ type: 'clear_requests' }), []);

  const isConversationDeleted = useCallback((conversationId?: string | null) => {
    if (!conversationId) return false;
    return deletedConversationIdsRef.current.has(conversationId)
      || deletedSessionIdsRef.current.has(conversationId);
  }, []);

  return {
    state,
    activeSession: state.sessions[state.activeId],

    /* 兼容 */
    setDraft,
    newSession,
    importSessions,
    syncSession,
    persistSession,
    patchSessionLocal,
    setCollaborationMode,
    clearActive,
    delSession,
    isConversationDeleted,
    switchSession,
    togglePin,
    toggleStar,
    send,
    sendMessage,
    replaceAndSend,
    stop,
    regenerate,
    recoverPendingTurn,
    delMessage,
    appendLocalAssistant,
    clearActiveMessages,
    approveSign,

    /* 企业级 */
    approve,
    executeAuthorized,
    continueSkillTurn,
    reject,
    setFeedback,
    retryMessage,
    archiveSession,
    shareSession,
    revokeShare,
    exportSessionAs,
    getSessionMetrics,
    setDebugOpen,
    clearRequests,
  };
}
