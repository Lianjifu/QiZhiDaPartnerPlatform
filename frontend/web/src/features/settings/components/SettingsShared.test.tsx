/**
 * M09 P3 frontend tests — settings-ui.test.tsx
 *
 * Lightweight component + logic tests for the M09 平台设置 feature
 * split (P1). Covers:
 *   - MENU / SETTINGS_TAB_KEYS structural assertions (5 settings tabs
 *     + 3 embedded pages, in expected order)
 *   - KeyStatusBadge tone branching (active/warning/default)
 *   - SettingsToggle click → onChange toggle (on/off/aria-checked)
 *   - Field / BillingFact render their label + value verbatim
 *   - panelClass constant shape
 *
 * Heavier rendering of SettingsPage (with 6 queries + 3 mutations +
 * 3 embedded pages) is left to the manual smoke pass — the page shell
 * is a stable URL ?tab= reader with no business logic of its own, and
 * the split-file boundary means the per-tab tests live next to each
 * SettingsTab.* file in follow-ups.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BillingFact,
  Field,
  KeyStatusBadge,
  MENU,
  SETTINGS_TAB_KEYS,
  SettingsToggle,
  panelClass,
} from './SettingsShared';

afterEach(cleanup);

describe('settings MENU / SETTINGS_TAB_KEYS', () => {
  it('lists 8 tabs in the expected order', () => {
    expect(MENU.map((m) => m.key)).toEqual([
      'tenant', 'security', 'backup', 'apikeys', 'billing',
      'access', 'zeroTrust', 'auditCenter',
    ]);
  });

  it('MENU entries all carry an i18n labelKey + icon', () => {
    for (const item of MENU) {
      expect(item.labelKey).toMatch(/^(module\.|nav\.)/);
      expect(item.icon).toBeDefined();
    }
  });

  it('SETTINGS_TAB_KEYS mirrors MENU keys', () => {
    expect(SETTINGS_TAB_KEYS.size).toBe(MENU.length);
    for (const item of MENU) {
      expect(SETTINGS_TAB_KEYS.has(item.key)).toBe(true);
    }
  });
});

describe('settings panelClass', () => {
  it('uses the surface-1 token + rounded shell', () => {
    expect(panelClass).toContain('rounded-xl');
    expect(panelClass).toContain('bg-[var(--surface-1)]');
  });
});

describe('KeyStatusBadge tone branching', () => {
  it('active → success tone', () => {
    render(<KeyStatusBadge status="active" />);
    const badge = screen.getByText('生效中');
    expect(badge).toBeTruthy();
    expect(badge.className).toMatch(/--success\)/);
  });

  it('warning → warn tone', () => {
    render(<KeyStatusBadge status="warning" />);
    const badge = screen.getByText('即将到期');
    expect(badge.className).toMatch(/--warning\)/);
  });

  it('unknown status → neutral echo', () => {
    render(<KeyStatusBadge status="custom-label" />);
    const badge = screen.getByText('custom-label');
    expect(badge.className).toMatch(/--bg-hover\)/);
  });
});

describe('SettingsToggle', () => {
  it('renders unchecked, clicking flips to checked via onChange', () => {
    let captured: boolean | undefined;
    render(
      <SettingsToggle
        checked={false}
        onChange={(v) => { captured = v; }}
        label="启用飞书值班"
      />,
    );
    const btn = screen.getByRole('switch', { name: '启用飞书值班' });
    expect(btn.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(btn);
    expect(captured).toBe(true);
  });

  it('renders checked state with is-on class', () => {
    render(
      <SettingsToggle
        checked={true}
        onChange={() => {}}
        label="启用钉钉"
      />,
    );
    const btn = screen.getByRole('switch', { name: '启用钉钉' });
    expect(btn.getAttribute('aria-checked')).toBe('true');
    expect(btn.className).toMatch(/is-on/);
  });

  it('clicking a checked toggle fires onChange(false)', () => {
    let captured: boolean | undefined;
    render(
      <SettingsToggle
        checked={true}
        onChange={(v) => { captured = v; }}
        label="关闭告警"
      />,
    );
    fireEvent.click(screen.getByRole('switch', { name: '关闭告警' }));
    expect(captured).toBe(false);
  });
});

describe('Field / BillingFact', () => {
  it('Field renders label and value', () => {
    render(<Field label="租户名称" value="ACME Corp" />);
    const field = screen.getByText('租户名称').parentElement;
    expect(field).not.toBeNull();
    expect(field!.textContent).toContain('ACME Corp');
  });

  it('BillingFact renders arbitrary ReactNode values', () => {
    render(
      <BillingFact
        label="方案"
        value={<span data-testid="plan">Enterprise Plus</span>}
      />,
    );
    expect(screen.getByText('方案')).toBeTruthy();
    expect(screen.getByTestId('plan').textContent).toBe('Enterprise Plus');
  });
});
