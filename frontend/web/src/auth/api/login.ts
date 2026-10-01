import type { LoginRequest, LoginResponse } from '@qzda/web-types';

/**
 * Login is invoked via the shared `useApiMutation` hook in `LoginPage.tsx`,
 * not directly. This file only owns the request/response type contract
 * so other modules can reference the same shape without re-typing.
 *
 * Re-exports are intentionally here (not the page) because types belong to
 * the API contract, not the form.
 */
export type { LoginRequest, LoginResponse };
