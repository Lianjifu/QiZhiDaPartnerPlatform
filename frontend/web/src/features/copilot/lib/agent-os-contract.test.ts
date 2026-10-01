import { describe, expect, it } from 'vitest';
import type { MemoryLayer, ZeroTrustDecision } from '@qzda/web-types';
import {
  AGENT_OS_ERROR_CODES,
  INBOUND_CHANNEL_KINDS,
  MEMORY_LAYERS,
  POLICY_DECISIONS,
  SESSION_MODES,
  STREAM_EVENT_TYPES,
  isInboundChannelKind,
  isPolicyDecision,
  isSessionMode,
  isStreamEventType,
  type PolicyDecision,
} from '@qzda/web-types';

describe('agent-os contract', () => {
  it('freezes sessionMode to investigate|execute', () => {
    expect(SESSION_MODES).toEqual(['investigate', 'execute']);
    expect(isSessionMode('investigate')).toBe(true);
    expect(isSessionMode('exec')).toBe(false);
  });

  it('aligns PolicyDecision with ZeroTrustDecision', () => {
    const asZeroTrust: readonly ZeroTrustDecision[] = POLICY_DECISIONS;
    const asPolicy: readonly PolicyDecision[] = ['allow', 'mask', 'approval_required', 'deny'];
    expect(asZeroTrust).toEqual(asPolicy);
    expect(isPolicyDecision('deny')).toBe(true);
    expect(isPolicyDecision('block')).toBe(false);
  });

  it('uses inbound caller kinds, not the delivery catalog', () => {
    expect(INBOUND_CHANNEL_KINDS).toEqual(['web', 'api', 'feishu', 'wecom', 'dingtalk']);
    expect(isInboundChannelKind('slack')).toBe(false);
    expect(isInboundChannelKind('email')).toBe(false);
    expect(isInboundChannelKind('feishu')).toBe(true);
  });

  it('shares SSE/Connect stream event names', () => {
    expect(STREAM_EVENT_TYPES).toEqual(['stage', 'delta', 'tool', 'route', 'thought', 'evidence', 'done', 'error']);
    expect(isStreamEventType('done')).toBe(true);
    expect(isStreamEventType('thought')).toBe(true);
    expect(isStreamEventType('finish')).toBe(false);
  });

  it('aligns memory layers with MemoryLayer', () => {
    const layers: readonly MemoryLayer[] = MEMORY_LAYERS;
    expect(layers).toEqual(['short_term', 'working', 'long_term']);
  });

  it('freezes Agent OS E_* codes', () => {
    expect(AGENT_OS_ERROR_CODES).toContain('E_SESSION_CLOSED');
    expect(AGENT_OS_ERROR_CODES).toContain('E_REPLAY_NOT_FOUND');
    expect(AGENT_OS_ERROR_CODES).toContain('E_IDENTITY_MOCK_FORBIDDEN');
    expect(AGENT_OS_ERROR_CODES.every((c) => c.startsWith('E_'))).toBe(true);
  });
});
