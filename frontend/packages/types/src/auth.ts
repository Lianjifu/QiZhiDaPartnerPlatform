import type { User } from './index';

/**
 * POST /api/auth/login request body.
 * Password is not validated against any store today — server derives role from email only.
 * Keep in sync with backend/internal/auth/http.go LoginRequest.
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * POST /api/auth/login response body.
 * Token may be a mock-* dev token or a real HS256 JWT depending on env flags.
 */
export interface LoginResponse {
  token: string;
  user: User;
}
