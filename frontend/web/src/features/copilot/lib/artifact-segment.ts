/**
 * artifact 分段：合并正文、折叠重复下载段。
 */
import type { CopilotSSEEvent } from './copilot-stream';
import { extractSkillArtifacts } from './artifact-links';
import type { ChatMessageEx } from '@/hooks/types';

export function isArtifactSegmentEvent(data: Pick<CopilotSSEEvent, 'kind' | 'segmentKind'>): boolean {
  return (data.kind ?? data.segmentKind ?? '').toLowerCase() === 'artifact';
}

/** 将 artifact 段正文并入首段（供 extractSkillArtifacts 渲染下载卡片）。 */
export function mergeArtifactBlockIntoContent(body: string, artifactBlock: string): string {
  const a = artifactBlock.trim();
  if (!a) return body.trim();
  const b = body.trim();
  if (!b) return a;
  if (b.includes(a) || extractSkillArtifacts(b).some((x) => a.includes(x.href))) {
    return b;
  }
  return `${b}\n\n${a}`;
}

export function artifactContentFingerprint(content?: string): string {
  if (!content?.trim()) return '';
  const arts = extractSkillArtifacts(content);
  if (!arts.length) return '';
  return arts.map((a) => a.href).sort().join('|');
}

export function isArtifactOnlyMessage(message: Pick<ChatMessageEx, 'role' | 'content' | 'segmentKind'>): boolean {
  if (message.role !== 'assistant') return false;
  if ((message.segmentKind ?? '').toLowerCase() === 'artifact') return true;
  const fp = artifactContentFingerprint(message.content);
  if (!fp) return false;
  const stripped = (message.content ?? '')
    .replace(/(?:下载链接|文件名)\s*[:：].+$/gmu, '')
    .replace(/\/api\/skill-artifacts\/\S+/gi, '')
    .trim();
  return stripped.length < 8;
}

/** 折叠同 correlation 下重复 artifact 段，并将 artifact-only 段并入前一条正文。 */
export function collapseDuplicateArtifactSegments(messages: ChatMessageEx[]): ChatMessageEx[] {
  if (messages.length < 2) return messages;
  const out: ChatMessageEx[] = [];
  for (const message of messages) {
    const prev = out[out.length - 1];
    if (
      prev
      && message.role === 'assistant'
      && prev.role === 'assistant'
      && message.correlationId
      && message.correlationId === prev.correlationId
      && isArtifactOnlyMessage(message)
      && !isArtifactOnlyMessage(prev)
    ) {
      out[out.length - 1] = {
        ...prev,
        content: mergeArtifactBlockIntoContent(prev.content ?? '', message.content ?? ''),
        serverMsgId: prev.serverMsgId || message.serverMsgId,
      };
      continue;
    }
    const fp = artifactContentFingerprint(message.content);
    if (
      prev
      && fp
      && fp === artifactContentFingerprint(prev.content)
      && message.role === 'assistant'
      && prev.role === 'assistant'
      && message.correlationId
      && message.correlationId === prev.correlationId
      && (isArtifactOnlyMessage(message) || isArtifactOnlyMessage(prev))
    ) {
      const keep = (message.serverMsgId && !prev.serverMsgId)
        || (message.segmentIndex ?? 0) >= (prev.segmentIndex ?? 0)
        ? message
        : prev;
      out[out.length - 1] = {
        ...keep,
        serverMsgId: keep.serverMsgId || prev.serverMsgId || message.serverMsgId,
        toolCalls: keep.toolCalls?.length ? keep.toolCalls : prev.toolCalls ?? message.toolCalls,
        reasoningSteps: keep.reasoningSteps?.length ? keep.reasoningSteps : prev.reasoningSteps ?? message.reasoningSteps,
      };
      continue;
    }
    out.push(message);
  }
  return out;
}
