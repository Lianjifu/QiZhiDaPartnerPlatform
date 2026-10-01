import { describe, expect, it } from 'vitest';
import { dedupeMemoryAudits, memoryAuditReactKey } from './audit-list';

describe('dedupeMemoryAudits', () => {
  it('removes duplicate ids', () => {
    const items = dedupeMemoryAudits([
      { id: 'ma-224', workspaceId: 'ws-1', correlationId: 'corr-1', time: '2026-01-01T00:00:00Z', actor: 'a', action: 'x', target: 't', result: 'success' },
      { id: 'ma-224', workspaceId: 'ws-1', correlationId: 'corr-1', time: '2026-01-01T00:00:01Z', actor: 'b', action: 'y', target: 't2', result: 'success' },
      { id: 'ma-225', workspaceId: 'ws-1', correlationId: 'corr-1', time: '2026-01-01T00:00:02Z', actor: 'c', action: 'z', target: 't3', result: 'success' },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('ma-224');
  });
});

describe('memoryAuditReactKey', () => {
  it('includes index for uniqueness', () => {
    const event = { id: 'ma-224', workspaceId: 'ws-1', correlationId: 'corr-1', time: 't', actor: 'a', action: 'x', target: 't', result: 'success' as const };
    expect(memoryAuditReactKey(event, 0)).not.toBe(memoryAuditReactKey(event, 1));
  });
});
