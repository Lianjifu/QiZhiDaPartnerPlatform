/**
 * Shared header builder for authenticated fetch calls.
 *
 * `/api/skill-artifacts/*` requires `Authorization: Bearer <token>` because
 * the backend's artifact gateway has `RequireAuth = true` by default.
 * `useChat` and `copilot-stream` already attach this manually; the artifact
 * preview / download / HEAD call sites use this helper to stay consistent.
 *
 * Memory-only on purpose — token is held in `localStorage` by `authStore`
 * (see `src/stores/authStore.ts`). If the store ever moves to httpOnly
 * cookies, swap the implementation here.
 */
export function authHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
