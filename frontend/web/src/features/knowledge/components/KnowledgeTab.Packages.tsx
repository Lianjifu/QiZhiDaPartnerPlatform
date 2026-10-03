/**
 * 知识中心 · 知识包 tab（M07 P1 拆分）。
 *
 * 资产区的「知识包」视图，复用 PackageWorkbench；本文件只负责把 controller
 * 状态 + mutation 翻译成 PackageWorkbench 期望的 props。
 */
import { PackageWorkbench } from './PackageWorkbench';
import { packageReadyToPublish } from '@/features/knowledge/knowledge-ui';
import type { KnowledgeController } from './useKnowledgeController';

export function KnowledgeTabPackages({ c }: { c: KnowledgeController }) {
  const busy = c.publishPackageMutation.isPending
    || c.processPackageMutation.isPending
    || c.attachPackageMutation.isPending
    || c.deletePackageMutation.isPending;

  return (
    <PackageWorkbench
      packages={c.knowledgePackages}
      docs={c.docs}
      canWrite={c.canWrite}
      highlightedPackageId={c.highlightedPackageId}
      busy={busy}
      onCreate={() => c.setActiveModal('newPackage')}
      onOpenDoc={(docId) => {
        c.setAssetsView('docs');
        c.openDocument(docId);
      }}
      onProcess={(pkg) => c.processPackageMutation.mutate({ id: pkg.id, strategy: 'semantic' })}
      onPublish={(pkg) => {
        const gate = packageReadyToPublish(pkg);
        if (!gate.ok) {
          c.setGovernanceNotice(gate.reason ?? '暂不可发布');
          return;
        }
        c.publishPackageMutation.mutate({ id: pkg.id });
      }}
      onAttach={(pkg, docIds) => c.attachPackageMutation.mutate({ id: pkg.id, docIds })}
      onDelete={(pkg) => c.deletePackageMutation.mutate({ id: pkg.id })}
      onViewBindings={() => c.setWorkspace('governance')}
    />
  );
}