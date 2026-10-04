import { QueryClient } from '@tanstack/react-query';

/**
 * Shared TanStack Query client. Lives here so both `main.tsx` (provider setup)
 * and `auth/hooks/useLogout.ts` (`queryClient.clear()` on logout) can reach it
 * without circular imports.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});
