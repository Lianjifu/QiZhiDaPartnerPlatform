import { useLayoutEffect, type ReactNode } from 'react';
import { setApiClient, ApiClient, getDemoHandler } from '@qzda/web-api';
import { useAuthStore } from '@/stores/authStore';
import { apiBaseURL, isDemoApiMode } from '@/lib/api-mode';
import { resolveWorkspaceHeader } from '@/lib/workspace-header';
import { queryClient } from '@/lib/queryClient';

interface AuthBootstrapProps {
  children: ReactNode;
}

/**
 * 装配 ApiClient 与 401 自动登出,放在 <RouterProvider> 上层。
 * 注意时序:useLayoutEffect 同步执行,早于首次 render,
 * 保证首屏第一次 fetch 就能命中正确的 baseURL / mock handler / 401 行为。
 */
export function AuthBootstrap({ children }: AuthBootstrapProps) {
  useLayoutEffect(() => {
    setApiClient(
      new ApiClient(
        apiBaseURL(),
        () => localStorage.getItem('token'),
        getDemoHandler(),
        () => {
          const user = useAuthStore.getState().user;
          return {
            'x-workspace-id': resolveWorkspaceHeader(),
            ...(user ? {
              'x-tenant-id': user.tenantId,
              ...(isDemoApiMode() ? {
                'x-mock-role': user.role,
                'x-mock-actor': user.name,
                'x-mock-user-id': user.id,
                'x-mock-permissions': user.permissions.join(','),
              } : {}),
            } : {}),
          };
        },
        () => {
          // 401 — 自动登出 + 清缓存 + 跳登录(L3)
          useAuthStore.getState().logout();
          queryClient.clear();
          if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
            window.location.assign('/login');
          }
        },
      ),
    );
  }, []);
  return <>{children}</>;
}
