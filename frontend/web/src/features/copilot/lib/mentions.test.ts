import { describe, expect, it } from 'vitest';
import {
  filterByQuery,
  mentionTriggerMatch,
  mergeMentionedTools,
  parseCapabilityMentions,
  replaceMentionTrigger,
  shouldShowMentionMenu,
} from './mentions';

describe('mentionTriggerMatch', () => {
  it('matches bare @ and trailing @query', () => {
    expect(mentionTriggerMatch('@')).toEqual({ start: 0, query: '' });
    expect(mentionTriggerMatch('请用 @')).toEqual({ start: 3, query: '' });
    expect(mentionTriggerMatch('请用 @sk')).toEqual({ start: 3, query: 'sk' });
  });

  it('does not match completed tokens mid-sentence without new trigger', () => {
    expect(mentionTriggerMatch('已用 @skill:政策问答 继续')).toBeNull();
    expect(shouldShowMentionMenu('普通文本')).toBe(false);
  });
});

describe('replaceMentionTrigger', () => {
  it('replaces leading @ with a skill token', () => {
    expect(replaceMentionTrigger('@', '@skill:政策问答')).toBe('@skill:政策问答 ');
  });

  it('replaces trailing trigger after text', () => {
    expect(replaceMentionTrigger('帮我查 @sk', '@skill:政策问答')).toBe('帮我查 @skill:政策问答 ');
  });
});

describe('parseCapabilityMentions / mergeMentionedTools', () => {
  it('extracts capability keys and merges into enabled tools', () => {
    const text = '请调用 @skill:政策问答 并用 @tool:hris 核对';
    expect(parseCapabilityMentions(text)).toEqual(['skill:政策问答', 'tool:hris']);
    expect(mergeMentionedTools(
      ['builtin:knowledge.retrieve'],
      text,
      ['skill:政策问答', 'tool:hris', 'skill:清单生成'],
    )).toEqual(['builtin:knowledge.retrieve', 'skill:政策问答', 'tool:hris']);
  });
});

describe('filterByQuery', () => {
  it('filters by name', () => {
    const items = [{ name: '政策问答', key: 'skill:政策问答' }, { name: '清单生成', key: 'skill:清单生成' }];
    expect(filterByQuery(items, '政策').map((i) => i.name)).toEqual(['政策问答']);
  });
});
