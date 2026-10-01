import { describe, expect, it } from 'vitest';
import { mockHandler } from './mock';

describe('workflow orchestration session', () => {
  it('creates a session, uploads markdown, generates via model router, deposits knowledge, and applies revision', async () => {
    const session = await mockHandler('/api/workflows/orchestration-sessions', {
      method: 'POST',
      body: {
        title: 'Redis 受控恢复编排',
        goal: '当生产 Redis 触发 OOM 告警时，由数字伙伴研判处置路径',
        workspaceId: 'w1',
        model: '企业默认模型',
        constraints: { riskLevel: 'L2', requireApproval: true, requireAudit: true, requireRollback: true },
      },
    }) as any;

    expect(session.status).toBe('drafting');
    expect(session.messages[0].role).toBe('system');

    const uploaded = await mockHandler(`/api/workflows/orchestration-sessions/${session.id}/documents`, {
      method: 'POST',
      body: {
        fileName: 'redis-oom.md',
        content: '# Redis OOM 处置\n\n## 触发\n内存告警\n\n## 审批\n双重审批后执行受控恢复\n',
      },
    }) as any;
    expect(uploaded.document.title).toContain('Redis');
    expect(uploaded.document.sections.length).toBeGreaterThan(0);

    const generated = await mockHandler(`/api/workflows/orchestration-sessions/${session.id}/generate`, {
      method: 'POST',
      body: { skipClarification: true },
    }) as any;
    expect(generated.session.clarificationSkipped).toBe(true);
    expect(generated.session.status).toBe('ready');
    expect(generated.candidate.workflow.nodes.length).toBeGreaterThan(3);
    expect(generated.candidate.workflow.nodes.some((node: any) => node.sourceRef?.heading)).toBe(true);
    expect(generated.stream.chunks.length).toBeGreaterThan(0);
    expect(generated.session.messages.some((item: any) => item.modelInvocation?.provider === 'enterprise-model-router')).toBe(true);

    const deposited = await mockHandler(
      `/api/workflows/orchestration-sessions/${session.id}/documents/${uploaded.document.id}/deposit-knowledge`,
      { method: 'POST', body: {} },
    ) as any;
    expect(deposited.knowledgeDoc.source).toBe('编排会话沉淀');
    expect(deposited.alreadyDeposited).toBe(false);

    const applied = await mockHandler(`/api/workflows/orchestration-sessions/${session.id}/apply`, {
      method: 'POST',
      body: { candidateId: generated.session.activeCandidateId },
    }) as any;
    expect(applied.revisionId).toBeTruthy();
    expect(applied.status).toBe('applied');
  });

  it('supports optional clarification streaming, candidate patch/version switch, knowledge attach, retrieve and template propose', async () => {
    const session = await mockHandler('/api/workflows/orchestration-sessions', {
      method: 'POST',
      body: { goal: '每周巡检证书到期并通知值班', workspaceId: 'w1', model: 'Qwen-Enterprise' },
    }) as any;

    const clarified = await mockHandler(`/api/workflows/orchestration-sessions/${session.id}/messages`, {
      method: 'POST',
      body: { content: '只通知安全值班，不自动变更', mode: 'clarify', stream: true },
    }) as any;
    expect(clarified.session.messages.at(-1).kind).toBe('clarify');
    expect(clarified.session.messages.at(-1).modelInvocation?.model).toBe('Qwen-Enterprise');
    expect(clarified.stream.chunks.length).toBeGreaterThan(0);

    const attached = await mockHandler(`/api/workflows/orchestration-sessions/${session.id}/documents`, {
      method: 'POST',
      body: { knowledgeDocId: 'k1' },
    }) as any;
    expect(attached.document.source).toBe('knowledge');
    expect(attached.document.knowledgeDocId).toBe('k1');

    const retrieved = await mockHandler(`/api/workflows/orchestration-sessions/${session.id}/retrieve-runbook`, {
      method: 'POST',
      body: { query: 'Redis OOM' },
    }) as any;
    expect(retrieved.session.lastRetrieve.hits.length).toBeGreaterThan(0);
    expect(retrieved.session.messages.at(-1).modelInvocation?.toolsUsed?.[0]?.name).toBe('knowledge.retrieve_runbook');

    const generated = await mockHandler(`/api/workflows/orchestration-sessions/${session.id}/generate`, {
      method: 'POST',
      body: { skipClarification: false },
    }) as any;
    expect(generated.session.candidates.length).toBe(1);
    const candidateId = generated.session.activeCandidateId;
    const nodeId = generated.candidate.workflow.nodes.find((node: any) => node.kind === 'notify')?.id
      ?? generated.candidate.workflow.nodes.at(-1).id;

    const patched = await mockHandler(`/api/workflows/orchestration-sessions/${session.id}/candidates/${candidateId}/patch`, {
      method: 'POST',
      body: { rename: { nodeId, label: '通知安全值班' } },
    }) as any;
    expect(patched.session.candidates.length).toBe(2);
    expect(patched.candidate.label).toBe('示例 v2');
    expect(patched.candidate.workflow.nodes.some((node: any) => node.label === '通知安全值班')).toBe(true);

    const activated = await mockHandler(`/api/workflows/orchestration-sessions/${session.id}/candidates/${candidateId}/activate`, {
      method: 'POST',
      body: {},
    }) as any;
    expect(activated.activeCandidateId).toBe(candidateId);

    const proposed = await mockHandler(`/api/workflows/orchestration-sessions/${session.id}/propose-template`, {
      method: 'POST',
      body: { name: '证书巡检模版候选' },
    }) as any;
    expect(proposed.templateCandidate.status).toBe('pending_approval');
    expect(proposed.session.templateCandidate.name).toContain('证书巡检');
  });
});
