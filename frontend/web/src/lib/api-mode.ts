/**
 * API 运行模式（VITE_API_MODE）：
 *  - api（默认）：走真实控制面（qzda-gateway）；
 *  - demo：浏览器内 mock handler，不请求后端。
 */
const rawApiMode: string = import.meta.env.VITE_API_MODE || 'api';
if (rawApiMode !== 'api' && rawApiMode !== 'demo') {
  throw new Error(`VITE_API_MODE 只能是 api 或 demo，当前为 "${rawApiMode}"`);
}

export function isDemoApiMode(): boolean {
  return rawApiMode === 'demo';
}

function isLoopbackBase(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

/**
 * 开发态默认走同源 `/api`（Vite proxy → qzda-gateway :8089），避免浏览器/Cursor 沙箱
 * 无法直连环回地址导致控制面读取失败。
 * 需要直连时设置 `VITE_API_DIRECT=true` 并填写非空 `VITE_API_BASE`。
 */
export function apiBaseURL(): string {
  const raw = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
  const forceDirect = import.meta.env.VITE_API_DIRECT === 'true';

  if (import.meta.env.DEV && !forceDirect) {
    if (!raw || isLoopbackBase(raw)) return '';
  }
  if (!raw) return '';
  return raw.replace(/\/$/, '');
}
