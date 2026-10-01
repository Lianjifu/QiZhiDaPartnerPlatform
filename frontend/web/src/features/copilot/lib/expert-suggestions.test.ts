import { describe, expect, it } from 'vitest';
import { buildExpertSuggestions, detectExpertDomain } from './expert-suggestions';

describe('expert suggestions', () => {
  it('detects hr domain and returns hr presets', () => {
    expect(detectExpertDomain({
      role: '人事专员',
      department: '人事部',
      description: '负责人事招聘及行政',
      responsibilities: ['招聘进度跟踪', '入职材料核对'],
    })).toBe('hr');

    const suggestions = buildExpertSuggestions({
      role: '人事专员',
      department: '人事部',
      description: '负责人事招聘及行政',
    });
    expect(suggestions).toHaveLength(4);
    expect(suggestions.map((item) => item.title).join('')).toMatch(/入职|招聘|人事|试用/);
    expect(suggestions.some((item) => item.title.includes('Redis'))).toBe(false);
  });

  it('keeps sre presets for fault response roles', () => {
    const suggestions = buildExpertSuggestions({
      role: 'SRE 故障处置专员',
      department: '信息技术部',
      description: '关联告警、日志定位生产故障',
      responsibilities: ['告警关联与影响分析'],
    });
    expect(suggestions[0]?.title).toContain('Redis');
  });

  it('builds finance suggestions for expense roles', () => {
    const suggestions = buildExpertSuggestions({
      role: '费用核算专员',
      department: '财务部',
      responsibilities: ['单据完整性核验'],
    });
    expect(suggestions.some((item) => /报销|发票|费用/.test(item.title))).toBe(true);
  });

  it('falls back to responsibilities for unknown domains', () => {
    const suggestions = buildExpertSuggestions({
      role: '法务协作专员',
      department: '法务部',
      serviceObject: '合同审核',
      responsibilities: ['合同条款核对', '风险条款提示', '审批节点提醒'],
    });
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]?.title).toContain('合同条款核对');
    expect(suggestions[0]?.desc).toContain('合同审核');
  });
});
