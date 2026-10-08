import { describe, expect, it } from 'vitest';
import { apiBaseURL, isDemoApiMode } from './api-mode';

describe('api-mode', () => {
  it('defaults to api mode when VITE_API_MODE is unset', () => {
    expect(isDemoApiMode()).toBe(false);
  });

  it('apiBaseURL uses same-origin proxy in DEV for loopback bases', () => {
    // vitest 默认 DEV=true；loopback 直连会被折叠为空字符串（走 Vite proxy）
    expect(typeof apiBaseURL()).toBe('string');
    expect(apiBaseURL()).toBe('');
  });
});
