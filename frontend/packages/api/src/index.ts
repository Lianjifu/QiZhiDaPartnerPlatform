/**
 * API 客户端层 — 默认请求真实后端（粗粒度网关 / Vite 代理）。
 * Mock 适配器仅在应用入口显式注入时启用（VITE_USE_MOCK=true）。
 */
import type { ApiResponse } from '@qzda/web-types';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 500) {
    super(message);
  }
}

const DEFAULT_TIMEOUT = 15_000;

/** fetch Header values must be ByteString (ISO-8859-1); encode anything outside. */
function sanitizeHeaderValue(value: string): string {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 255) return encodeURIComponent(value);
  }
  return value;
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v == null) continue;
    out[k] = sanitizeHeaderValue(String(v));
  }
  return out;
}

function resolveRequestURL(baseURL: string, path: string, query?: RequestOptions['query']): string {
  let href: string;
  if (!baseURL) {
    href = path.startsWith('/') ? path : `/${path}`;
  } else {
    href = new URL(path, baseURL.endsWith('/') ? baseURL : `${baseURL}/`).toString();
  }
  if (!query) return href;
  const u = href.startsWith('http') ? new URL(href) : new URL(href, 'http://local.invalid');
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) u.searchParams.set(k, String(v));
  }
  if (!href.startsWith('http')) {
    return `${u.pathname}${u.search}`;
  }
  return u.toString();
}

export class ApiClient {
  constructor(
    private baseURL: string,
    private getAuthToken: () => string | null = () => null,
    private mockHandler?: (path: string, opts: RequestOptions) => Promise<unknown>,
    private getContextHeaders: () => Record<string, string> = () => ({}),
    private onUnauthorized?: () => void,
  ) {}

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const token = this.getAuthToken();
    const requestHeaders: Record<string, string> = {
      ...opts.headers,
      ...this.getContextHeaders(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    if (this.mockHandler) {
      const data = await this.mockHandler(path, { ...opts, headers: requestHeaders });
      return data as T;
    }
    const controller = new AbortController();
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      controller.abort('timeout');
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT);
    try {
      const url = resolveRequestURL(this.baseURL, path, opts.query);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...sanitizeHeaders(requestHeaders),
      };

      let res: Response;
      try {
        res = await fetch(url, {
          method: opts.method ?? 'GET',
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: opts.signal ?? controller.signal,
        });
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        if (aborted) {
          // Caller-cancel (TanStack Query unmount / key churn) — not a failure;
          // let TanStack Query handle it as a silent cancel. Only flag as
          // E_TIMEOUT when our own timeout fired.
          if (timedOut) {
            throw new ApiError('E_TIMEOUT', '请求超时，请确认控制面网关是否可达', 408);
          }
          throw err;
        }
        const hint = this.baseURL
          ? `无法连接控制面 ${this.baseURL}，请先启动：cd backend && make run`
          : '无法连接控制面（同源 /api → Vite 代理 → :8089 网关）。请确认已启动后端栈（cd backend && make compose-up-monolith 或 make run），并重启前端 dev（环境变量变更需重启 Vite）';
        throw new ApiError('E_NETWORK', hint, 0);
      }
      let json: ApiResponse<T>;
      try {
        json = (await res.json()) as ApiResponse<T>;
      } catch {
        throw new ApiError('E_BAD_RESPONSE', `控制面返回非 JSON（HTTP ${res.status}）`, res.status);
      }
      if (!res.ok || !json.ok) {
        const code = json.error?.code ?? 'E_UNKNOWN';
        if (res.status === 401 || code === 'E_IDENTITY_MOCK_FORBIDDEN') {
          this.onUnauthorized?.();
        }
        throw new ApiError(code, json.error?.message ?? '请求失败', res.status);
      }
      // 后端偶发返回 data: null（Go nil slice）；对数组消费方统一兜底为 []，避免 .filter 崩溃
      return (json.data ?? null) as T;
    } finally {
      clearTimeout(t);
    }
  }

  get<T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) {
    return this.request<T>(path, { ...opts, method: 'GET' });
  }
  post<T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) {
    return this.request<T>(path, { ...opts, method: 'POST', body });
  }
  put<T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) {
    return this.request<T>(path, { ...opts, method: 'PUT', body });
  }
  delete<T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) {
    return this.request<T>(path, { ...opts, method: 'DELETE' });
  }

  /** multipart 上传；Mock 模式下自动转为 contentBase64 JSON。 */
  async upload<T>(path: string, form: FormData, opts: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
    const token = this.getAuthToken();
    const requestHeaders: Record<string, string> = {
      ...opts.headers,
      ...this.getContextHeaders(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    if (this.mockHandler) {
      const file = form.get('file');
      if (file == null || typeof file === 'string') {
        throw new ApiError('E_BAD_REQUEST', '缺少 file 字段', 400);
      }
      const name = 'name' in file && typeof file.name === 'string' ? file.name : 'upload.bin';
      const buf = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < buf.length; i += 1) binary += String.fromCharCode(buf[i]!);
      const contentBase64 = btoa(binary);
      return (await this.mockHandler(path, {
        ...opts,
        method: 'POST',
        headers: requestHeaders,
        body: { fileName: name, contentBase64 },
      })) as T;
    }
    const controller = new AbortController();
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      controller.abort('timeout');
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT);
    try {
      const url = resolveRequestURL(this.baseURL, path, opts.query);
      const headers = sanitizeHeaders(requestHeaders);
      // 不要手动设置 Content-Type，由浏览器带 multipart boundary
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: form,
          signal: opts.signal ?? controller.signal,
        });
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        if (aborted) {
          if (timedOut) {
            throw new ApiError('E_TIMEOUT', '上传超时，请确认控制面网关是否可达', 408);
          }
          throw err;
        }
        throw new ApiError('E_NETWORK', '无法连接控制面完成上传', 0);
      }
      let json: ApiResponse<T>;
      try {
        json = (await res.json()) as ApiResponse<T>;
      } catch {
        throw new ApiError('E_BAD_RESPONSE', `控制面返回非 JSON（HTTP ${res.status}）`, res.status);
      }
      if (!res.ok || !json.ok) {
        const code = json.error?.code ?? 'E_UNKNOWN';
        if (res.status === 401 || code === 'E_IDENTITY_MOCK_FORBIDDEN') {
          this.onUnauthorized?.();
        }
        throw new ApiError(code, json.error?.message ?? '上传失败', res.status);
      }
      return (json.data ?? null) as T;
    } finally {
      clearTimeout(t);
    }
  }
}

/** 全局单例 — 在 web 应用启动时注入 */
let _client: ApiClient | null = null;

export function setApiClient(c: ApiClient) {
  _client = c;
}

export function getApiClient(): ApiClient {
  if (!_client) throw new Error('ApiClient 未初始化 — 请在应用入口调用 setApiClient');
  return _client;
}

export * from './mock';
import * as mockModule from './mock';
export const mock = mockModule;
