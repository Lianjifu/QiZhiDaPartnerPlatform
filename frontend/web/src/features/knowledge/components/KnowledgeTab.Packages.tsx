/**
 * 知识中心目录：知识包发现。加工 / 发布 / 纳管在包详情页。
 */
import { PackageWorkbench } from './PackageWorkbench';
import type { KnowledgeController } from './useKnowledgeController';
import { useNavigate } from 'react-router-dom';

export function KnowledgeTabPackages({ c }: { c: KnowledgeController }) {
  const navigate = useNavigate();
  const busy = c.deletePackageMutation.isPending;

  return (
    <PackageWorkbench
      packages={c.knowledgePackages}
      canWrite={c.canWrite}
      highlightedPackageId={c.highlightedPackageId}
      busy={busy}
      onCreate={() => navigate('/knowledge/packages/new')}
      onOpenPackage={(pkg) => navigate(`/knowledge/packages/${encodeURIComponent(pkg.id)}`)}
      onDelete={(pkg) => c.deletePackageMutation.mutate({ id: pkg.id })}
    />
  );
}
