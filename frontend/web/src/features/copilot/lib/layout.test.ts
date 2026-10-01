import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT_CONFIG,
  columnWidthConstraints,
  effectiveColumnMode,
  gridTemplateForMode,
  resolveColumnMode,
  sessionHistoryPresentation,
} from './layout';

describe('copilot session history presentation', () => {
  it('keeps session history pinned from tablet widths upward', () => {
    expect(sessionHistoryPresentation(900)).toBe('pinned');
    expect(sessionHistoryPresentation(1440)).toBe('pinned');
  });

  it('uses a drawer only when the viewport cannot safely reserve a history column', () => {
    expect(sessionHistoryPresentation(899)).toBe('drawer');
  });
});

describe('copilot three-column layout', () => {
  const all = { sessions: true, main: true, details: true };

  it('upgrades to three-column on wide viewports', () => {
    expect(resolveColumnMode({ width: 1600, height: 900 }, all)).toBe('three-column');
  });

  it('falls back to two-column on medium viewports', () => {
    expect(resolveColumnMode({ width: 1100, height: 800 }, all)).toBe('two-column');
    // Hide one side: still two-column.
    expect(
      resolveColumnMode({ width: 1100, height: 800 }, { ...all, details: false }),
    ).toBe('two-column');
  });

  it('falls back to stacked on narrow viewports', () => {
    expect(resolveColumnMode({ width: 720, height: 800 }, all)).toBe('stacked');
  });

  it('upgrades even on narrower viewports when details are pinned', () => {
    // pinned means: respect at least two-column if width allows
    expect(
      effectiveColumnMode({ width: 1000, height: 800 }, all, true),
    ).toBe('three-column');
    expect(
      effectiveColumnMode({ width: 720, height: 800 }, all, true),
    ).toBe('stacked');
  });

  it('emits three distinct grid templates per mode', () => {
    const three = gridTemplateForMode('three-column');
    const two = gridTemplateForMode('two-column');
    const stacked = gridTemplateForMode('stacked');
    // Use startsWith / endsWith because minmax(0, 1fr) introduces spaces.
    expect(three.columns.startsWith(`${DEFAULT_LAYOUT_CONFIG.defaultSessionsWidth}px`)).toBe(true);
    expect(three.columns.endsWith(`${DEFAULT_LAYOUT_CONFIG.defaultDetailsWidth}px`)).toBe(true);
    expect(three.columns).toContain('minmax(0, 1fr)');
    expect(two.columns.startsWith('minmax(0, 1fr)')).toBe(true);
    expect(two.columns.endsWith(`${DEFAULT_LAYOUT_CONFIG.defaultDetailsWidth}px`)).toBe(true);
    expect(stacked.columns).toBe('minmax(0, 1fr)');
    expect(stacked.rows).toBe('auto auto auto');
  });

  it('honors custom widths and config', () => {
    const cfg = { ...DEFAULT_LAYOUT_CONFIG, defaultSessionsWidth: 200, defaultDetailsWidth: 240 };
    const tpl = gridTemplateForMode('three-column', cfg, { sessions: 240, details: 320 });
    expect(tpl.columns.startsWith('240px')).toBe(true);
    expect(tpl.columns.endsWith('320px')).toBe(true);
  });

  it('exposes column width constraints', () => {
    const c = columnWidthConstraints();
    expect(c.min).toBeLessThan(c.max);
    expect(c.min).toBeGreaterThan(0);
  });
});