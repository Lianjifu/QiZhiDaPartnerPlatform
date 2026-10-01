/** 与后端 copilotHistoryMaxMessages 对齐：模型实际使用的会话消息窗口 */
export const COPILOT_LLM_HISTORY_MESSAGES = 24;

export const COPILOT_LLM_HISTORY_TURNS = COPILOT_LLM_HISTORY_MESSAGES / 2;

/** 单会话本地展示上限（useChat capMessages） */
export const COPILOT_LOCAL_MESSAGE_CAP = 500;

export type CapMessage = { id: string; role: string; content?: string; createdAt?: string };

/** 限制单会话消息数量（保留首条 + 尾部若干 + 省略占位） */
export function capSessionMessages<T extends CapMessage>(msgs: T[], max = COPILOT_LOCAL_MESSAGE_CAP): T[] {
  if (msgs.length <= max) return msgs;
  const head = msgs[0]!;
  const tail = msgs.slice(-max + 2);
  const notice = {
    id: `m_omit_${Date.now()}`,
    role: 'system',
    content: `—— 此处省略 ${msgs.length - tail.length - 1} 条历史消息 ——`,
    createdAt: new Date().toISOString(),
  } as T;
  return [head, notice, ...tail];
}

export function shouldShowContextWindowHint(messageCount: number): boolean {
  return messageCount > COPILOT_LLM_HISTORY_MESSAGES;
}
