import { describe, expect, it } from 'vitest';
import {
  artifactHref,
  extractSkillArtifacts,
  inferTitle,
  sanitizeArtifactFilename,
  stripArtifactNoise,
  toDownloadName,
} from './artifact-links';

describe('sanitizeArtifactFilename', () => {
  it('strips markdown backticks and trailing junk', () => {
    expect(sanitizeArtifactFilename('abc123-招聘模板.docx`')).toBe('abc123-招聘模板.docx');
    expect(sanitizeArtifactFilename('`abc123-招聘模板.docx`')).toBe('abc123-招聘模板.docx');
  });
});

describe('toDownloadName / inferTitle', () => {
  it('normalizes polluted storage names', () => {
    expect(toDownloadName('lecc2aef2257-skill_docx__输出招聘模板_docx.docx')).toBe('输出招聘模板.docx');
    expect(inferTitle('lecc2aef2257-skill_docx__输出招聘模板_docx.docx')).toBe('输出招聘模板');
  });

  it('prefers explicit 文件名 line', () => {
    expect(toDownloadName('abc123-x.docx', '招聘岗位模板.docx')).toBe('招聘岗位模板.docx');
  });
});

describe('extractSkillArtifacts', () => {
  it('extracts relative artifact paths with clean download names', () => {
    const text = [
      '已生成文档',
      '文件名：招聘岗位模板.docx',
      '下载链接：/api/skill-artifacts/abc123-招聘岗位模板.docx',
      '内容如下',
    ].join('\n');
    expect(extractSkillArtifacts(text)).toEqual([
      {
        href: artifactHref('abc123-招聘岗位模板.docx'),
        filename: 'abc123-招聘岗位模板.docx',
        downloadName: '招聘岗位模板.docx',
        title: '招聘岗位模板',
        kind: 'docx',
      },
    ]);
  });

  it('marks pptx kind and prefers pptx before docx', () => {
    const text = [
      '下载链接：/api/skill-artifacts/aaa123-团队季度考评.docx',
      '下载链接：/api/skill-artifacts/bbb456-团队季度考评汇报.pptx',
    ].join('\n');
    const items = extractSkillArtifacts(text);
    expect(items[0]?.kind).toBe('pptx');
    expect(items[0]?.downloadName).toBe('团队季度考评汇报.pptx');
    expect(items[1]?.kind).toBe('docx');
  });

  it('recognizes xlsx, normalizes title, and labels it Excel 表格', () => {
    const text =
      '下载链接：/api/skill-artifacts/lecc2aef2257-skill_xlsx__预算明细_xlsx.xlsx';
    const items = extractSkillArtifacts(text);
    expect(items[0]?.kind).toBe('xlsx');
    expect(items[0]?.title).toBe('预算明细');
    expect(items[0]?.downloadName).toBe('预算明细.xlsx');
  });
});

describe('stripArtifactNoise', () => {
  it('removes download link and filename lines but keeps body', () => {
    const text = [
      '已为您生成《招聘岗位模板》Word 文档：',
      '文件名：招聘岗位模板.docx',
      '下载链接：/api/skill-artifacts/x.docx',
      '',
      '一、基本信息',
    ].join('\n');
    const cleaned = stripArtifactNoise(text);
    expect(cleaned).toContain('已为您生成');
    expect(cleaned).toContain('一、基本信息');
    expect(cleaned).not.toContain('/api/skill-artifacts');
    expect(cleaned).not.toContain('文件名：');
  });

  it('strips download link line even when payload is empty (Q3 PPT shape)', () => {
    // Real failure case: assistant emits "下载链接：" with no path, leaving a
    // literal ```\n..\n``` block that <Markdown> renders as empty/broken.
    const text = [
      '已按「方案 A」生成 Q3 研发季度汇报 PPT，共 6 页。',
      '下载链接：',
      '```',
      '..',
      '```',
      '',
      '## 页面结构',
      '- 封面',
    ].join('\n');
    const cleaned = stripArtifactNoise(text);
    expect(cleaned).toContain('已按「方案 A」');
    expect(cleaned).toContain('## 页面结构');
    expect(cleaned).not.toContain('下载链接');
    expect(cleaned).not.toMatch(/^\s*\.\.\s*$/m);
  });
});
