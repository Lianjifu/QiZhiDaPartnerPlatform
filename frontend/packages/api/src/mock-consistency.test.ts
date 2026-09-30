/**
 * Mock 跨实体一致性：任务 / 伙伴 / 知识 / 工作流 / 渠道 / 模型 / 记忆 / 运营 KPI。
 */
import { describe, expect, it } from 'vitest';
import { mockHandler } from './mock';

const admin = {
  Authorization: 'Bearer mock-admin-token',
  'x-workspace-id': 'w1',
  'x-mock-permissions': 'model.read,model.write,channel.read,channel.write,workspace.read,workspace.write',
};

describe('mock data-flow consistency', () => {
  it('tasks reference existing digital employees and agent kernels', async () => {
    const [tasks, employees, agents] = await Promise.all([
      mockHandler('/api/tasks', { method: 'GET', headers: admin }) as Promise<any[]>,
      mockHandler('/api/partners', { method: 'GET', headers: admin }) as Promise<any[]>,
      mockHandler('/api/agents', { method: 'GET', headers: admin }) as Promise<any[]>,
    ]);
    const employeeIds = new Set(employees.map((e) => e.id));
    const agentIds = new Set(agents.map((a) => a.id));
    for (const task of tasks) {
      expect(employeeIds.has(task.digitalPartnerId), `task ${task.id} → ${task.digitalPartnerId}`).toBe(true);
      if (task.agentId) expect(agentIds.has(task.agentId), `task ${task.id} agent ${task.agentId}`).toBe(true);
      const employee = employees.find((e) => e.id === task.digitalPartnerId);
      if (employee?.capabilities?.agentId && task.agentId) {
        expect(task.agentId).toBe(employee.capabilities.agentId);
      }
    }
  });

  it('employee capability names resolve into capability catalog', async () => {
    const [employees, catalog, agents] = await Promise.all([
      mockHandler('/api/partners', { method: 'GET', headers: admin }) as Promise<any[]>,
      mockHandler('/api/partner-capability-catalog', { method: 'GET', headers: admin }) as Promise<any>,
      mockHandler('/api/agents', { method: 'GET', headers: admin }) as Promise<any[]>,
    ]);
    const names = (items: Array<{ name: string }>) => new Set(items.map((item) => item.name));
    const models = names(catalog.models);
    const knowledge = names(catalog.knowledge);
    const workflows = names(catalog.workflows);
    const channels = names(catalog.channels);
    const agentIds = new Set(agents.map((a) => a.id));
    // 技能/工具目录会被其他用例隔离或卸载；此处只校验稳定的路由 / 知识包 / 流程 / 渠道 / 内核引用。
    const core = employees.filter((item) => ['de-sre', 'de-it', 'de-alert-ops', 'de-capacity', 'de-change'].includes(item.id));
    expect(core.length).toBe(5);

    for (const employee of employees) {
      const caps = employee.capabilities;
      if (caps.model) expect(models.has(caps.model), `${employee.id} model ${caps.model}`).toBe(true);
      if (caps.agentId) expect(agentIds.has(caps.agentId), `${employee.id} agent ${caps.agentId}`).toBe(true);
      for (const item of caps.channels ?? []) {
        expect(channels.has(item), `${employee.id} channel ${item}`).toBe(true);
      }
    }

    for (const employee of core) {
      const caps = employee.capabilities;
      for (const item of caps.knowledge ?? []) {
        if (item.includes('知识包')) expect(knowledge.has(item), `${employee.id} knowledge ${item}`).toBe(true);
      }
      for (const item of caps.workflows ?? []) {
        if (item.includes('流程技能') || item.includes('cache-oom') || item.includes('入职办理') || item === '生产变更协同') {
          expect(workflows.has(item), `${employee.id} workflow ${item}`).toBe(true);
        }
      }
    }
  });

  it('knowledge docs / packages / graph / chunks have no orphan refs', async () => {
    const [docs, packages, chunks, citations, entities, relations, bindings] = await Promise.all([
      mockHandler('/api/knowledge/docs', { method: 'GET', headers: admin }) as Promise<any[]>,
      mockHandler('/api/knowledge/packages', { method: 'GET', headers: admin }) as Promise<any[]>,
      mockHandler('/api/knowledge/chunks/top', { method: 'GET', headers: admin }) as Promise<any[]>,
      mockHandler('/api/knowledge/citation-trace', { method: 'GET', headers: admin }) as Promise<any[]>,
      mockHandler('/api/knowledge/graph/entities', { method: 'GET', headers: admin }) as Promise<any[]>,
      mockHandler('/api/knowledge/graph/relations', { method: 'GET', headers: admin }) as Promise<any[]>,
      mockHandler('/api/knowledge/bindings', { method: 'GET', headers: admin }) as Promise<any[]>,
    ]);
    const docIds = new Set(docs.map((d) => d.id));
    const packageIds = new Set(packages.map((p) => p.id));
    for (const pkg of packages) {
      for (const docId of pkg.documentIds ?? []) {
        expect(docIds.has(docId), `package ${pkg.id} → ${docId}`).toBe(true);
      }
    }
    for (const chunk of chunks) expect(docIds.has(chunk.docId), `chunk → ${chunk.docId}`).toBe(true);
    for (const cite of citations) expect(docIds.has(cite.docId), `citation → ${cite.docId}`).toBe(true);
    for (const entity of entities) expect(docIds.has(entity.sourceDocId), `entity → ${entity.sourceDocId}`).toBe(true);
    for (const relation of relations) expect(docIds.has(relation.sourceDocId), `relation → ${relation.sourceDocId}`).toBe(true);
    for (const binding of bindings) {
      expect(packageIds.has(binding.packageId), `binding package ${binding.packageId}`).toBe(true);
      if (binding.consumerType === 'digital_employee') {
        const employees = await mockHandler('/api/partners', { method: 'GET', headers: admin }) as any[];
        expect(employees.some((e) => e.id === binding.consumerId)).toBe(true);
      }
      if (binding.consumerType === 'workflow') {
        const workflows = await mockHandler('/api/workflows', { method: 'GET', headers: admin }) as any[];
        expect(workflows.some((w) => w.id === binding.consumerId)).toBe(true);
      }
    }
  });

  it('workflow skills point at existing workflows', async () => {
    const [workflows, skills] = await Promise.all([
      mockHandler('/api/workflows', { method: 'GET', headers: admin }) as Promise<any[]>,
      mockHandler('/api/workflow-skills', { method: 'GET', headers: admin }) as Promise<any[]>,
    ]);
    const ids = new Set(workflows.map((w) => w.id));
    expect(ids.has('wf1')).toBe(true);
    expect(ids.has('wf-change')).toBe(true);
    for (const skill of skills) {
      expect(ids.has(skill.sourceWorkflowId), `skill ${skill.id} → ${skill.sourceWorkflowId}`).toBe(true);
    }
  });

  it('memory records reference existing employees and task/workflow sources', async () => {
    const [records, employees, tasks, workflows] = await Promise.all([
      mockHandler('/api/memory/records', { method: 'GET', headers: admin }) as Promise<any[]>,
      mockHandler('/api/partners', { method: 'GET', headers: admin }) as Promise<any[]>,
      mockHandler('/api/tasks', { method: 'GET', headers: admin }) as Promise<any[]>,
      mockHandler('/api/workflows', { method: 'GET', headers: admin }) as Promise<any[]>,
    ]);
    const employeeIds = new Set(employees.map((e) => e.id));
    const taskIds = new Set(tasks.map((t) => t.id));
    const workflowIds = new Set(workflows.map((w) => w.id));
    for (const record of records) {
      if (record.digitalPartnerId) expect(employeeIds.has(record.digitalPartnerId)).toBe(true);
      if (record.sourceType === 'task') expect(taskIds.has(record.sourceId), `memory ${record.id} task ${record.sourceId}`).toBe(true);
      if (record.sourceType === 'workflow') expect(workflowIds.has(record.sourceId), `memory ${record.id} workflow ${record.sourceId}`).toBe(true);
    }
  });

  it('workspace partners returns digital employees not legacy nicknames', async () => {
    const partners = await mockHandler('/api/workspaces/w1/partners', { method: 'GET', headers: admin }) as any[];
    expect(partners.length).toBeGreaterThan(0);
    expect(partners.every((item) => item.id?.startsWith('de-') && item.name && item.role)).toBe(true);
  });

  it('home/ops pendingApprovals matches release approvals', async () => {
    const [kpis, overview, approvals] = await Promise.all([
      mockHandler('/api/home/kpis', { method: 'GET', headers: admin }) as Promise<any>,
      mockHandler('/api/operations/overview', { method: 'GET', headers: admin }) as Promise<any>,
      mockHandler('/api/release-approvals', { method: 'GET', headers: admin }) as Promise<any[]>,
    ]);
    const pending = approvals.filter((item) => item.status === 'pending').length;
    expect(kpis.pendingApprovals).toBe(pending);
    expect(overview.governance.pendingApprovals).toBe(pending);
    expect(kpis.source).toBe('live-aggregate');
    expect(overview.source).toBe('live-aggregate');
  });

  it('fills previously missing control-plane routes', async () => {
    const health = await mockHandler('/api/channel-control/health', { method: 'GET', headers: admin }) as any[];
    expect(Array.isArray(health)).toBe(true);
    expect(health.some((item) => item.deploymentId === 'delivery-feishu')).toBe(true);

    const deadLetters = await mockHandler('/api/channel-control/dead-letters', { method: 'GET', headers: admin }) as any[];
    expect(deadLetters.length).toBeGreaterThan(0);
    const replayed = await mockHandler(`/api/channel-control/dead-letters/${deadLetters[0].id}/replay`, {
      method: 'POST',
      headers: admin,
    }) as any;
    expect(replayed.status).toBe('delivered');

    const probe = await mockHandler('/api/model-providers/test-connection', {
      method: 'POST',
      headers: admin,
      body: { workspaceId: 'w1', protocol: 'openai_compatible', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-demo' },
    }) as any;
    expect(probe.status).toBe('healthy');
    expect(typeof probe.latencyMs).toBe('number');
  });
});
