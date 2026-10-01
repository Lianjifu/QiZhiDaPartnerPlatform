import type { ChatMessageEx } from '@/hooks/types';

/** 同一 correlationId 的多段 assistant 消息按 segmentIndex 稳定排序。 */
export function orderAssistantSegments(messages: ChatMessageEx[]): ChatMessageEx[] {
  if (messages.length < 2) return messages;
  const out = [...messages];
  let i = 0;
  while (i < out.length) {
    const head = out[i];
    if (head.role !== 'assistant' || !head.correlationId) {
      i += 1;
      continue;
    }
    const corr = head.correlationId;
    let j = i;
    const block: ChatMessageEx[] = [];
    while (j < out.length && out[j].role === 'assistant' && out[j].correlationId === corr) {
      block.push(out[j]);
      j += 1;
    }
    if (block.some((message) => message.segmentIndex != null)) {
      block.sort((a, b) => (a.segmentIndex ?? 0) - (b.segmentIndex ?? 0));
      out.splice(i, block.length, ...block);
    }
    i = j;
  }
  return out;
}
