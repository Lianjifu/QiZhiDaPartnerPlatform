/**
 * Copilot SSE client — 对接 qzda-core /api/copilot/conversations/:id/stream
 */
import { useAuthStore } from '@/stores/authStore';
import { resolveWorkspaceHeader } from '@/lib/workspace-header';

export type ReplyMode = 'single' | 'segmented' | 'stepwise';

export type CopilotSSEEvent = {
  type: string;
  stage?: string;
  status?: string;
  correlationId?: string;
  text?: string;
  message?: string;
  name?: string;
  hits?: unknown;
  decision?: string;
  units?: number;
  employee?: unknown;
  ok?: boolean;
  modelId?: string;
  modelName?: string;
  providerId?: string;
  source?: string;
  warning?: string;
  mode?: string;
  maxSteps?: number;
  enabledTools?: string[];
  args?: Record<string, unknown>;
  id?: string;
  durationMs?: number;
  permission?: string;
  error?: string;
  sandboxId?: string;
  step?: number;
  action?: string;
  toolCount?: number;
  reactSteps?: number;
  reason?: string;
  goal?: string;
  steps?: unknown;
  stepId?: string;
  title?: string;
  index?: number;
  total?: number;
  critique?: string;
  round?: number;
  maxRounds?: number;
  reflectRounds?: number;
  policyLevel?: string;
  policyId?: string;
  requestedLevel?: string;
  specialists?: unknown;
  employeeId?: string;
  role?: string;
  department?: string;
  task?: string;
  preview?: string;
  resultStatus?: string;
  supervisorId?: string;
  provenance?: Array<{ id?: string; title?: string; layer?: string; score?: number }>;
  memoryProvenance?: Array<{ id?: string; title?: string; layer?: string; score?: number }>;
  kind?: string;
  summary?: string;
  evolveCandidates?: number;
  hitCount?: number;
  memoryHits?: number;
  ragHits?: number;
  snapshotId?: string;
  actionId?: string;
  messageId?: string;
  riskLevel?: string;
  authorizationRequest?: unknown;
  approvalRequest?: unknown;
  moderated?: boolean;
  reasons?: string[];
  segmentIndex?: number;
  segmentTotal?: number;
  segmentKind?: 'ack' | 'body' | 'summary' | 'step' | 'artifact';
  segmentCount?: number;
  messageIds?: string[];
  replyMode?: ReplyMode;
  segmentPolicy?: 'document' | 'conversational';
  messages?: unknown[];
  content?: string;
  cognitive?: {
    bypass?: boolean;
    bypassReason?: string;
    enabled?: boolean;
    primary?: string;
    primaryLabel?: string;
    secondary?: string;
    secondaryLabel?: string;
    mode?: string;
    phases?: string[];
    confidence?: number;
    reasons?: string[];
  };
  /** 任务事件 id — useChat pushThought 路径使用 */
  taskId?: string;
  /** 任务详情描述 */
  detail?: string;
  /** 回合叙事元数据 — 由 parseTurnMeta 解析 */
  turnMeta?: unknown;
};

export function isMockChatMode(): boolean {
  return import.meta.env.VITE_USE_DEMO === 'true' || import.meta.env.VITE_USE_MOCK === 'true';
}

export function mockIdentityHeaders(user: {
  role: string;
  tenantId: string;
  name: string;
  id: string;
  permissions: string[];
} | null | undefined): Record<string, string> {
  if (!isMockChatMode() || !user) {
    return {};
  }
  return {
    'x-mock-role': user.role,
    'x-mock-actor': encodeURIComponent(user.name),
    'x-mock-user-id': user.id,
    'x-mock-permissions': user.permissions.join(','),
  };
}

/** 解析 SSE 文本缓冲，返回已完成事件与剩余缓冲。 */
export function parseSSEChunk(
  buffer: string,
  onEvent: (event: string, data: CopilotSSEEvent) => void,
): string {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  let eventName = 'message';
  for (const raw of parts) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim() || 'message';
      continue;
    }
    if (line.startsWith('data:')) {
      const payload = line.slice(5).trim();
      if (payload) {
        try {
          onEvent(eventName, JSON.parse(payload) as CopilotSSEEvent);
        } catch {
          /* ignore malformed */
        }
      }
      eventName = 'message';
    }
  }
  return rest;
}

export type StreamTurnInput = {
  conversationId: string;
  content: string;
  correlationId: string;
  digitalPartnerId?: string;
  modelId?: string;
  enabledTools?: string[];
  modeHint?: string;
  reflectHint?: string;
  sessionMode?: 'investigate' | 'execute';
  runMode?: 'ask' | 'plan' | 'agent';
  reasoningEffort?: 'off' | 'standard' | 'deep';
  riskLevel?: 'low' | 'medium' | 'high';
  attachmentIds?: string[];
  clientMsgId?: string;
  firstMessageId?: string;
  replyMode?: ReplyMode;
  branchFromMessageId?: string;
  signal?: AbortSignal;
  onEvent: (event: string, data: CopilotSSEEvent) => void;
};

export async function streamCopilotTurn(input: StreamTurnInput): Promise<void> {
  const token = localStorage.getItem('token');
  const user = useAuthStore.getState().user;
  const workspaceId = resolveWorkspaceHeader();

  const res = await fetch(
    `/api/copilot/conversations/${encodeURIComponent(input.conversationId)}/stream`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'x-workspace-id': workspaceId,
        'x-correlation-id': input.correlationId,
        ...(user ? { 'x-tenant-id': user.tenantId } : {}),
        ...mockIdentityHeaders(user),
      },
      body: JSON.stringify({
        content: input.content,
        correlationId: input.correlationId,
        digitalPartnerId: input.digitalPartnerId,
        modelId: input.modelId,
        enabledTools: input.enabledTools,
        modeHint: input.modeHint,
        reflectHint: input.reflectHint,
        sessionMode: input.sessionMode,
        runMode: input.runMode,
        reasoningEffort: input.reasoningEffort,
        riskLevel: input.riskLevel,
        attachmentIds: input.attachmentIds,
        clientMsgId: input.clientMsgId,
        branchFromMessageId: input.branchFromMessageId,
        firstMessageId: input.firstMessageId,
        replyMode: input.replyMode,
      }),
      signal: input.signal,
    },
  );

  if (!res.ok) {
    let message = `流式请求失败 (${res.status})`;
    try {
      const json = (await res.json()) as { error?: { message?: string; code?: string } };
      if (json.error?.message) message = json.error.message;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }

  if (!res.body) {
    throw new Error('浏览器不支持流式响应');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = parseSSEChunk(buffer, input.onEvent);
  }
  if (buffer.trim()) {
    parseSSEChunk(`${buffer}\n`, input.onEvent);
  }
}
