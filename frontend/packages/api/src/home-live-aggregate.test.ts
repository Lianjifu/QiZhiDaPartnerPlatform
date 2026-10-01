import { describe, expect, it } from 'vitest';
import { mockHandler } from './mock';

const admin = { Authorization: 'Bearer mock-admin-token', 'x-workspace-id': 'w1' };

/**
 * 这些测试验证 mockHandler 在拿到 M01 路由时委托给 m01-mock-handlers.ts dispatcher。
 * 纯函数行为（buildHomeExtraLive / buildOpsOverviewLive / normalize*）请见 m01-builders.test.ts。
 */
describe('mockHandler M01 live-aggregate routes', () => {
  it('GET /api/home/extra is live-aggregate from workspace entities', async () => {
    const extra = await mockHandler('/api/home/extra', { method: 'GET', headers: admin }) as any;
    expect(extra.source).toBe('live-aggregate');
    expect(extra.costMonth.source).toBe('none');
    expect(Array.isArray(extra.slaAlerts)).toBe(true);
    expect(extra.slaAlerts.every((a: any) => String(a.id).startsWith('task-alert-'))).toBe(true);
    expect(extra.operationalMetrics).toHaveProperty('collabToday');
    if (extra.operationalMetrics.trend24h.length) {
      expect(extra.operationalMetrics.trend24h[0]).toHaveProperty('tasks');
      expect(extra.operationalMetrics.trend24h[0]).toHaveProperty('collab');
      expect(extra.operationalMetrics.trend24h[0]).toHaveProperty('alerts');
    }
  });

  it('GET /api/operations/overview uses digital employees not agent market', async () => {
    const overview = await mockHandler('/api/operations/overview', { method: 'GET', headers: admin }) as any;
    expect(overview.source).toBe('live-aggregate');
    expect(overview.digitalPartners).toBeTruthy();
    expect(overview.health.activeAgents).toBe(overview.digitalPartners.active);
    expect(overview.governance?.unpublishedAgents).toBeUndefined();
  });

  it('GET /api/home/kpis reports live-aggregate source', async () => {
    const kpis = await mockHandler('/api/home/kpis', { method: 'GET', headers: admin }) as any;
    expect(kpis.source).toBe('live-aggregate');
    expect(typeof kpis.activeDigitalPartners).toBe('number');
  });
});
