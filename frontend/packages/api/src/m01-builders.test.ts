import { describe, expect, it } from 'vitest';
import {
  buildHomeExtraLive,
  buildOpsOverviewLive,
  normalizeCapabilityName,
  normalizeEmployeeCapabilities,
} from './m01-builders';

describe('buildHomeExtraLive', () => {
  it('aggregates alerts and suggestions from tasks/employees without demo cost', () => {
    const extra = buildHomeExtraLive({
      workspaceId: 'w1',
      tasks: [
        {
          id: 't1', code: 'TSK-1', title: 'P0 处置', status: 'in_progress', priority: 'P0',
          digitalPartnerName: '夜航', updatedAt: new Date().toISOString(),
          sla: { risk: 'overdue', remainingMin: -5 },
        },
        {
          id: 't2', code: 'TSK-2', title: '待复核', status: 'review', priority: 'P1',
          digitalPartnerName: '青禾', updatedAt: new Date().toISOString(),
        },
        {
          id: 't3', code: 'TSK-3', title: '已完成', status: 'completed', priority: 'P3',
          updatedAt: new Date().toISOString(),
        },
      ],
      employees: [
        { id: 'de-1', workspaceId: 'w1', lifecycle: 'active', runtime: { calls24h: 10 } },
        { id: 'de-2', workspaceId: 'w1', lifecycle: 'pending_approval' },
      ],
      sessions: [{ id: 's1', workspaceId: 'w1', updatedAt: new Date().toISOString() }],
      usageMeters: [],
    });

    expect(extra.source).toBe('live-aggregate');
    expect(extra.costMonth.source).toBe('none');
    expect(extra.taskCompletion).toEqual({ done: 1, doing: 1, review: 1, todo: 0 });
    expect(extra.slaAlerts.length).toBeGreaterThanOrEqual(2);
    expect(extra.slaAlerts.every((a) => a.source === 'task' && a.id.startsWith('task-alert-'))).toBe(true);
    expect(extra.operationalMetrics.activeAgents).toBe(1);
    expect(extra.operationalMetrics.collabToday).toBe(1);
    expect(extra.suggestion.some((s) => s.id === 'sg-review')).toBe(true);
    expect(extra.suggestion.some((s) => s.to === '/partners' || s.to === '/copilot' || s.to.startsWith('/tasks'))).toBe(true);
    expect(extra.quickLinks.every((l) => !/Agent/i.test(l.label + (l.desc ?? '')))).toBe(true);
  });

  it('returns empty trend when no time-bucket signals', () => {
    const extra = buildHomeExtraLive({
      workspaceId: 'w2',
      tasks: [],
      employees: [],
      sessions: [],
      now: new Date('2026-08-18T04:00:00Z'),
    });
    expect(extra.operationalMetrics.trend24h).toEqual([]);
    expect(extra.suggestion.some((s) => s.id === 'sg-onboard')).toBe(true);
  });

  it('exposes usage-meters cost only when meters exist', () => {
    const extra = buildHomeExtraLive({
      workspaceId: 'w1',
      tasks: [],
      employees: [{ id: 'de-1', workspaceId: 'w1', lifecycle: 'active' }],
      sessions: [],
      usageMeters: [{ workspaceId: 'w1', usd: 12.5, budgetUsd: 100, units: 3 }],
    });
    expect(extra.costMonth).toMatchObject({ used: 12.5, budget: 100, source: 'usage-meters' });
  });
});

describe('normalizeCapabilityName / normalizeEmployeeCapabilities', () => {
  it('normalizes capability aliases to catalog names', () => {
    expect(normalizeCapabilityName('日志检索')).toBe('loki-query');
    expect(normalizeEmployeeCapabilities({
      skills: ['日志检索', '告警分析'],
      tools: ['Prometheus', 'CMDB'],
      workflows: ['生产故障处置流'],
      channels: ['企业微信', '事件中心'],
      knowledge: ['运行手册库'],
      model: '企业通用路由 v2',
    })).toMatchObject({
      skills: ['loki-query', 'prometheus'],
      tools: ['prometheus', 'cmdb-tool'],
      workflows: ['生产故障处置流程技能'],
      channels: ['企业微信', '飞书'],
      knowledge: ['生产故障处置知识包'],
      model: 'P0 路由',
    });
  });
});

describe('buildOpsOverviewLive', () => {
  it('counts active and pending partners', () => {
    const overview = buildOpsOverviewLive({
      workspaceId: 'w1',
      tasks: [{ id: '1', code: 'T1', title: 'x', status: 'review', priority: 'P1' }],
      employees: [
        { id: 'a', workspaceId: 'w1', lifecycle: 'active' },
        { id: 'b', workspaceId: 'w1', lifecycle: 'pending_approval' },
      ],
    });
    expect(overview.digitalPartners).toEqual({ active: 1, pending: 1 });
    expect(overview.pending[0].to).toContain('/tasks');
  });
});
