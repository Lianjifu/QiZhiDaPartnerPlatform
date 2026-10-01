import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { queryClient } from '@/lib/queryClient';

export type LogoutSource = 'menu' | 'reauth' | 'expired';

/**
 * 退出登录 — 客户端纯操作,无后端调用。
 * 三件事:清 store、清 TanStack Query 缓存、跳登录页。
 *
 * 触发点:
 *   - L1 用户菜单 Sign out:    useLogout({ from: 'menu' })
 *   - L2 reauth 确认:          useLogout({ from: 'reauth' })
 *   - L3 任意请求 401:         useLogout({ from: 'expired' })
 *
 * 行为不变性:
 *   - localStorage.token 被移除
 *   - 跳 /login 用 replace: true
 *   - 已位于 /login 时不再 navigate
 *   - 不发任何 /api/auth/logout 请求(后端无该端点)
 *   - 新增: TanStack Query 缓存清空(避免切账号脏数据)
 */
export function useLogout() {
  const navigate = useNavigate();
  return useCallback(
    (_opts?: { from?: LogoutSource; notify?: string }) => {
      useAuthStore.getState().logout();
      queryClient.clear();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        navigate('/login', { replace: true });
      }
    },
    [navigate],
  );
}
