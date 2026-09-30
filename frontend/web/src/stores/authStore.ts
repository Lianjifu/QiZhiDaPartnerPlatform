/**
 * 鉴权状态 — 三角色访问模型 + 当前用户 + Token
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, Permission, Role } from '@qzda/web-types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthed: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
  hasPermission: (p: Permission) => boolean;
  hasRole: (...roles: Role[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthed: false,
      login: (user, token) => {
        localStorage.setItem('token', token);
        set({ user, token, isAuthed: true });
      },
      logout: () => {
        localStorage.removeItem('token');
        set({ user: null, token: null, isAuthed: false });
      },
      hasPermission: (p) => {
        const u = get().user;
        return !!u?.permissions.includes(p);
      },
      hasRole: (...roles) => {
        const r = get().user?.role;
        return !!r && roles.includes(r);
      },
    }),
    { name: 'de-auth' },
  ),
);
