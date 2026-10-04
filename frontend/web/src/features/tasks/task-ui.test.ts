import { describe, expect, it } from 'vitest';
import { cadenceLabel, scheduleWhen } from './schedule-ui';
import { conversationHref, employeeLabel, getPrimaryAction, getStageMeta, nextStepLabel, sourceLabel } from './task-ui';

describe('controlled task primary actions', () => {
  it('requires expert takeover before a failed risk task can proceed', () => {
    expect(getPrimaryAction('risk', 'failed')).toEqual({ key: 'takeover', label: '专家接管' });
  });

  it('retries non-failed risk tasks', () => {
    expect(getPrimaryAction('risk', 'blocked')).toEqual({ key: 'retry', label: '重试协同' });
  });

  it('maps normal lifecycle stages to direct transitions', () => {
    expect(getPrimaryAction('pending', 'none').key).toBe('start');
    expect(getPrimaryAction('running', 'none').key).toBe('pause');
    expect(getPrimaryAction('completed', 'none').key).toBe('archive');
  });
});

describe('task center copy', () => {
  it('uses colleague-facing stage labels', () => {
    expect(getStageMeta('running').label).toBe('协同中');
    expect(getStageMeta('human_action').label).toBe('待专家确认');
  });

  it('never shows waiting-next-step for completed tasks', () => {
    expect(nextStepLabel({ lifecycleStage: 'completed', execution: { retryCount: 0, paused: false } })).toBe('可归档');
    expect(nextStepLabel({ lifecycleStage: 'completed', execution: { retryCount: 0, paused: false, currentStep: '已回链会话' } })).toBe('已回链会话');
  });

  it('prefers digital employee name over agent id', () => {
    expect(employeeLabel({ digitalPartnerName: 'SRE 故障处置专员', digitalPartnerId: 'de-sre', agentId: 'a1' })).toBe('SRE 故障处置专员');
    expect(sourceLabel('workflow')).toBe('能力触发');
  });

  it('builds conversation deep link from employee id', () => {
    expect(conversationHref({ links: { conversationId: 's1' }, digitalPartnerId: 'de-sre' })).toBe('/copilot?session=s1&employeeId=de-sre');
    expect(conversationHref({ links: {}, digitalPartnerId: 'de-sre' })).toBeNull();
    expect(conversationHref({ links: {}, digitalPartnerId: undefined })).toBeNull();
    expect(conversationHref({ digitalPartnerId: 'de-sre' })).toBeNull();
  });
});

describe('scheduled task copy', () => {
  it('labels cadence in operator language', () => {
    expect(cadenceLabel('daily')).toBe('每天');
    expect(cadenceLabel('weekly')).toBe('每周');
    expect(scheduleWhen({ cadence: 'daily', hour: 9, minute: 0 } as never)).toContain('每天');
  });
});
