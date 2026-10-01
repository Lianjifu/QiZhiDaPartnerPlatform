import { describe, expect, it } from 'vitest';
import { extractPageOutline, stripPageOutlineSection } from './page-outline';

describe('extractPageOutline', () => {
  it('returns null when no 页面结构 heading present', () => {
    expect(extractPageOutline('# 别的标题\n- 项目A\n- 项目B')).toBeNull();
  });

  it('extracts bullets under 页面结构 heading (H2)', () => {
    const md = [
      '## 页面结构',
      '- 封面（主题/部门/汇报人/日期占位）',
      '- 目录',
      '- 一句话总结 + 目标达成概览',
      '- 重点项目与里程碑时间线',
      '- 研效质量 + 资源人力',
      '- 风险问题 + Q4 计划',
      '',
      '## 使用说明',
      '其他段落',
    ].join('\n');
    const outline = extractPageOutline(md);
    expect(outline).not.toBeNull();
    expect(outline?.pages).toEqual([
      '封面（主题/部门/汇报人/日期占位）',
      '目录',
      '一句话总结 + 目标达成概览',
      '重点项目与里程碑时间线',
      '研效质量 + 资源人力',
      '风险问题 + Q4 计划',
    ]);
  });

  it('stops at the next H1-H3 heading', () => {
    const md = [
      '### 页面结构',
      '- 章节一',
      '- 章节二',
      '## 后续段落',
      '- 不应被收录',
    ].join('\n');
    expect(extractPageOutline(md)?.pages).toEqual(['章节一', '章节二']);
  });

  it('returns null when heading exists but has no bullets', () => {
    expect(extractPageOutline('## 页面结构\n\n无内容')).toBeNull();
  });
});

describe('stripPageOutlineSection', () => {
  it('removes the 页面结构 section while preserving surrounding content', () => {
    const md = [
      '生成完成',
      '',
      '已按方案 A 生成。',
      '',
      '## 页面结构',
      '- 封面',
      '- 目录',
      '- 总结',
      '',
      '## 使用说明',
      '替换示例内容',
    ].join('\n');
    const stripped = stripPageOutlineSection(md);
    expect(stripped).toContain('生成完成');
    expect(stripped).toContain('已按方案 A 生成。');
    expect(stripped).not.toContain('## 页面结构');
    expect(stripped).not.toContain('- 封面');
    expect(stripped).toContain('## 使用说明');
    expect(stripped).toContain('替换示例内容');
  });

  it('returns input unchanged when no heading present', () => {
    const md = '只是普通文本\n- 列表项';
    expect(stripPageOutlineSection(md)).toBe(md);
  });

  it('trims surrounding blank lines after removal', () => {
    const md = '前文\n\n## 页面结构\n- A\n\n后文';
    const stripped = stripPageOutlineSection(md);
    expect(stripped).toBe('前文\n\n后文');
  });
});
