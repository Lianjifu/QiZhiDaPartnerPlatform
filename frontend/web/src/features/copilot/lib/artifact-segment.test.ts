import { describe, expect, it } from 'vitest';
import {
  artifactContentFingerprint,
  collapseDuplicateArtifactSegments,
  isArtifactOnlyMessage,
  mergeArtifactBlockIntoContent,
} from './artifact-segment';
import type { ChatMessageEx } from '@/hooks/types';

function msg(partial: Partial<ChatMessageEx> & Pick<ChatMessageEx, 'id' | 'role' | 'content'>): ChatMessageEx {
  return {
    createdAt: new Date().toISOString(),
    status: 'succeeded',
    ...partial,
  };
}

describe('artifact-segment', () => {
  it('merges artifact block into host content', () => {
    const merged = mergeArtifactBlockIntoContent('已完成生成。', '下载链接：/api/skill-artifacts/x.docx');
    expect(merged).toContain('已完成生成');
    expect(merged).toContain('/api/skill-artifacts/x.docx');
  });

  it('detects artifact-only messages', () => {
    expect(isArtifactOnlyMessage({
      role: 'assistant',
      content: '下载链接：/api/skill-artifacts/x-模板.docx',
      segmentKind: 'artifact',
    })).toBe(true);
  });

  it('collapses duplicate artifact hrefs in same turn', () => {
    const href = '/api/skill-artifacts/x-模板.docx';
    const merged = collapseDuplicateArtifactSegments([
      msg({ id: 'a1', role: 'assistant', correlationId: 'c1', content: `下载链接：${href}` }),
      msg({ id: 'a2', role: 'assistant', correlationId: 'c1', content: `下载链接：${href}` }),
    ]);
    expect(merged).toHaveLength(1);
    expect(artifactContentFingerprint(merged[0]?.content)).toBe(artifactContentFingerprint(`下载链接：${href}`));
  });

  it('merges artifact-only segment into previous body on hydrate', () => {
    const href = '/api/skill-artifacts/x-模板.docx';
    const merged = collapseDuplicateArtifactSegments([
      msg({ id: 'body', role: 'assistant', correlationId: 'c1', content: '已完成 Word 生成。' }),
      msg({ id: 'art', role: 'assistant', correlationId: 'c1', segmentKind: 'artifact', content: `下载链接：${href}` }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.content).toContain('已完成 Word 生成');
    expect(merged[0]?.content).toContain(href);
  });
});
