/**
 * 通用 TanStack Query 封装 — 统一错误处理 / 鉴权注入
 */
import { useQuery, useMutation, useQueryClient, type UseQueryOptions, type UseMutationOptions } from '@tanstack/react-query';
import { getApiClient } from '@qzda/web-api';
import { useWorkspaceStore } from '@/stores/workspaceStore';

export function useApiQuery<T>(
  key: readonly unknown[],
  path: string,
  params?: { query?: Record<string, any>; body?: unknown; method?: 'GET' | 'POST' },
  options?: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>,
) {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId ?? 'w1');
  const q = useQuery<T>({
    queryKey: [...key, workspaceId],
    queryFn: async () => {
      const c = getApiClient();
      return c.request<T>(path, {
        method: params?.method ?? 'GET',
        query: params?.query,
        body: params?.body,
      });
    },
    ...options,
  });
  return {
    data: q.data === null ? undefined : q.data,
    error: q.error,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    refetch: q.refetch,
  };
}

type MutationOpts<TData, TVar> = {
  onSuccess?: (data: TData, vars: TVar) => void;
  onError?: (err: unknown, vars: TVar) => void;
  /** 精确失效的 query key 前缀；未指定时仍全量 invalidate（兼容旧行为） */
  invalidateKeys?: readonly (readonly unknown[])[];
};

export function useApiMutation<TData, TVar>(
  path: string | ((vars: TVar) => string),
  options?: MutationOpts<TData, TVar>,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
) {
  const qc = useQueryClient();
  // 4 个泛型让 TanStack Query 类型完整
  return useMutation<TData, unknown, TVar>({
    mutationFn: async (vars: TVar) => {
      const c = getApiClient();
      const p = typeof path === 'function' ? path(vars) : path;
      const payload = vars as unknown;
      const skipBody = method === 'DELETE' && (payload === undefined || payload === null
        || (typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload as object).length === 0));
      return c.request<TData>(p, skipBody ? { method } : { method, body: vars });
    },
    onSuccess: (data, vars) => {
      options?.onSuccess?.(data, vars);
      if (options?.invalidateKeys?.length) {
        for (const key of options.invalidateKeys) {
          qc.invalidateQueries({ queryKey: key });
        }
      } else {
        qc.invalidateQueries();
      }
    },
    onError: (err, vars) => {
      options?.onError?.(err, vars);
    },
  } as UseMutationOptions<TData, unknown, TVar>);
}

/** multipart 文件上传（FormData） */
export function useApiUploadMutation<TData>(
  path: string,
  options?: MutationOpts<TData, FormData>,
) {
  const qc = useQueryClient();
  return useMutation<TData, unknown, FormData>({
    mutationFn: async (form: FormData) => getApiClient().upload<TData>(path, form),
    onSuccess: (data, vars) => {
      options?.onSuccess?.(data, vars);
      qc.invalidateQueries();
    },
    onError: (err, vars) => {
      options?.onError?.(err, vars);
    },
  } as UseMutationOptions<TData, unknown, FormData>);
}
