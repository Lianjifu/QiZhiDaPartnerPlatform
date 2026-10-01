import { describe, expect, it } from 'vitest';
import {
  buildExpertEvidencePack,
  deriveExpertContextOverview,
  deriveExpertJobContract,
  formatEvidencePackMarkdown,
} from './expert-context';
import type { ChatMessageEx } from '@/hooks/types';
import type { DigitalPartner } from '@qzda/web-types';

describe('deriveExpertContextOverview', () => {
  it('returns empty evidence when messages have no tools or citations', () => {
    const messages: ChatMessageEx[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: '你好',
        createdAt: '2026-08-04T12:00:00.000Z',
        status: 'succeeded',
        metrics: { model: 'deepseek-v4-flash', provider: 'mp-11', completionTokens: 40 },
      },
    ];
    const overview = deriveExpertContextOverview(messages);
    expect(overview.citations).toEqual([]);
    expect(overview.tools.total).toBe(0);
    expect(overview.toolItems).toEqual([]);
    expect(overview.memoryHits).toEqual([]);
    expect(overview.rag.attempted).toBe(false);
    expect(overview.rag.label).toBe('本回合未触发检索');
    expect(overview.modelLabel).toBe('deepseek-v4-flash');
    expect(overview.providerLabel).toBe('mp-11');
    expect(overview.tokenUsed).toBe(40);
  });

  it('aggregates real citations and knowledge.retrieve tool', () => {
    const messages: ChatMessageEx[] = [
      {
        id: 'm2',
        role: 'assistant',
        content: '材料清单…',
        createdAt: '2026-08-04T12:01:00.000Z',
        status: 'succeeded',
        toolCalls: [
          {
            id: 't1',
            name: 'knowledge.retrieve',
            args: { backend: 'published-memory' },
            status: 'success',
            durationMs: 12,
          },
        ],
        citations: [
          { id: 'c1', docId: 'kd-1', source: '入职手册', text: '需身份证', score: 0.9 },
        ],
        metrics: { model: 'mdl-12', provider: 'mp-11', completionTokens: 80 },
      },
    ];
    const overview = deriveExpertContextOverview(messages);
    expect(overview.rag.attempted).toBe(true);
    expect(overview.rag.backend).toBe('published-memory');
    expect(overview.rag.hitCount).toBe(1);
    expect(overview.rag.label).toBe('命中 1 条');
    expect(overview.tools).toEqual({ total: 1, success: 1, failed: 0, avgMs: 12 });
    expect(overview.toolItems[0]?.name).toBe('knowledge.retrieve');
    expect(overview.citations[0].source).toBe('入职手册');
    expect(overview.timeline.some((item) => item.text.includes('knowledge.retrieve'))).toBe(true);
  });

  it('surfaces tool failures, approval pending and memory hits', () => {
    const messages: ChatMessageEx[] = [
      {
        id: 'm3',
        role: 'assistant',
        content: '失败示例',
        createdAt: '2026-08-04T12:02:00.000Z',
        status: 'succeeded',
        approvalRequest: {
          action: '更新配额',
          decision: 'pending',
          required: 1,
          signed: 0,
          signers: [],
        },
        toolCalls: [
          {
            id: 't-fail',
            name: 'workflow.run',
            args: {},
            status: 'failed',
            durationMs: 40,
            error: '权限不足',
            permission: 'approval-required',
          },
        ],
        memoryProvenance: [{ id: 'mem-1', title: '上周配额变更', layer: 'working', score: 0.82 }],
        metrics: {
          snapshotId: 'snap-9',
          memoryProvenance: [{ id: 'mem-2', title: '部门政策', layer: 'long', score: 0.7 }],
        },
      },
    ];
    const overview = deriveExpertContextOverview(messages);
    expect(overview.tools.failed).toBe(1);
    expect(overview.toolItems[0]?.error).toContain('权限不足');
    expect(overview.toolItems[0]?.approvalPending).toBe(true);
    expect(overview.pendingApprovals).toBe(1);
    expect(overview.memoryHits).toHaveLength(2);
    expect(overview.snapshotIds).toEqual(['snap-9']);
    expect(overview.timeline.some((item) => item.tone === 'warn')).toBe(true);
  });

  it('never invents Redis demo citations', () => {
    const overview = deriveExpertContextOverview([]);
    expect(overview.citations).toEqual([]);
    expect(overview.tools.total).toBe(0);
    expect(JSON.stringify(overview)).not.toMatch(/Redis|INC-019|bge-reranker|320ms/);
  });
});

describe('deriveExpertJobContract', () => {
  it('prefers boundaryPolicy responsibilities and keeps prohibited actions', () => {
    const employee = {
      id: 'e1',
      name: '小青',
      role: 'HR 专家',
      department: '人力',
      description: '入职引导',
      version: '1.2',
      risk: 'medium',
      environment: 'prod',
      serviceObject: '新员工',
      owner: '张三',
      escalationOwner: '李四',
      responsibilities: ['旧职责'],
      prohibitedActions: ['直接改薪'],
      boundaryPolicy: {
        responsibilities: [{ id: 'r1', title: '入职材料核对', objective: '', trigger: '', deliverables: [], evidenceRequired: true }],
        capabilityModes: [],
        dataClassification: 'internal',
        allowedEnvironments: ['prod'],
        handoff: { triggers: [], approvers: [], notificationChannels: [], slaMinutes: 30 },
      },
      capabilities: { model: 'mdl-a', knowledge: ['手册'], skills: ['docx'], tools: [], workflows: [], channels: ['web'] },
      evaluation: { status: 'passed', score: 91 },
    } as unknown as DigitalPartner;

    const contract = deriveExpertJobContract(employee);
    expect(contract?.responsibilities).toEqual(['入职材料核对']);
    expect(contract?.prohibitedActions).toEqual(['直接改薪']);
    expect(contract?.model).toBe('mdl-a');
    expect(contract?.knowledge).toEqual(['手册']);
  });

  it('returns null without employee', () => {
    expect(deriveExpertJobContract(null)).toBeNull();
  });
});

describe('evidence pack', () => {
  it('builds markdown with session vs message compare', () => {
    const session = deriveExpertContextOverview([
      {
        id: 'a',
        role: 'assistant',
        content: 's',
        createdAt: '2026-08-04T12:00:00.000Z',
        citations: [{ id: 'c1', docId: 'd1', source: '知识库', text: 'a', score: 0.9 }],
        status: 'succeeded',
      },
    ]);
    const message = deriveExpertContextOverview([]);
    const pack = buildExpertEvidencePack({
      scope: 'message',
      employee: null,
      runMode: 'plan',
      riskLevel: 'medium',
      overview: message,
      sessionOverview: session,
      messageOverview: message,
    });
    const md = formatEvidencePackMarkdown(pack);
    expect(md).toContain('专家协作证据包');
    expect(md).toContain('会话 vs 消息对比');
    expect(md).toContain('| 引用 | 1 | 0 |');
  });
});
