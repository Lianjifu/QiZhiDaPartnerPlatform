import { useMemo } from 'react';
import { useApiQuery } from '@/services/query';
import { builtinToolNamesFromCatalog } from '@/features/partners/lib/partners';

export function usePartnerBuiltinToolNames(): ReadonlySet<string> {
  const { data } = useApiQuery<{ platformTools?: { name: string }[]; runtimeTools?: { name: string }[] }>(
    ['digital-employee-capability-catalog'],
    '/api/partner-capability-catalog',
  );
  return useMemo(() => builtinToolNamesFromCatalog(data), [data]);
}
