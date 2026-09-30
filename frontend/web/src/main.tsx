import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { I18nProvider } from './i18n';
import './styles/global.css';
import 'reactflow/dist/style.css';
import { setApiClient, ApiClient, mockHandler } from '@qzda/web-api';
import { useWorkspaceStore } from './stores/workspaceStore';
import { useAuthStore } from './stores/authStore';
import { apiBaseURL, isDemoApiMode } from './lib/api-mode';
import { resolveWorkspaceHeader } from './lib/workspace-header';

function installApiClient() {
  // 默认真实 API；仅演示模式注入本地 Handler。
  setApiClient(
    new ApiClient(
      apiBaseURL(),
      () => localStorage.getItem('token'),
      isDemoApiMode() ? mockHandler : undefined,
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
        useAuthStore.getState().logout();
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.assign('/login');
        }
      },
    ),
  );
}

installApiClient();

if (import.meta.hot) {
  import.meta.hot.accept('./lib/api-mode', () => {
    installApiClient();
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </I18nProvider>
  </React.StrictMode>,
);
