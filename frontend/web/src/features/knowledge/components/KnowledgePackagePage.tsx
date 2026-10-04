/**
 * 知识包详情：成员、加工、评测、图谱、版本与引用。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, PlayCircle } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { useKnowledgeController } from './useKnowledgeController';
import { KnowledgeModals } from './KnowledgeModals';
import { AttachDocsModal } from './AttachDocsModal';
import { KnowledgeStudioRail } from './KnowledgeStudioRail';
import {
  PackageEvalStep, PackageGraphStep, PackageMembersStep, PackageProcessingStep, PackageVersionsStep,
} from './KnowledgePackageSteps';
import { packageReadyToPublish, packageStatusLabel, packageStatusTone } from '@/features/knowledge/knowledge-ui';

type PkgStep = 'members' | 'processing' | 'eval' | 'graph' | 'versions';
const STEPS: Array<{ key: PkgStep; index: string; label: string; hint: string }> = [
  { key: 'members', index: '01', label: '成员文档', hint: '查看与编辑' },
  { key: 'processing', index: '02', label: '加工', hint: '切片与作业' },
  { key: 'eval', index: '03', label: '检索评测', hint: '门禁与试检索' },
  { key: 'graph', index: '04', label: '知识图谱', hint: '实体与关系' },
  { key: 'versions', index: '05', label: '版本与引用', hint: '发布与装配' },
];

function parseStep(raw: string | null): PkgStep {
  if (raw === 'processing' || raw === 'eval' || raw === 'graph' || raw === 'versions') return raw;
  return 'members';
}

export default function KnowledgePackagePage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const c = useKnowledgeController();
  const step = parseStep(params.get('step'));
  const pkg = c.knowledgePackages.find((item) => item.id === id) ?? null;
  const [attachOpen, setAttachOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const go = (next: PkgStep) => setParams(next === 'members' ? {} : { step: next }, { replace: true });
  const stepIndex = STEPS.findIndex((item) => item.key === step);

  useEffect(() => {
    if (id) c.setHighlightedPackageId(id);
  }, [c.setHighlightedPackageId, id]);

  const memberDocs = useMemo(() => {
    if (!pkg) return [];
    const ids = new Set(pkg.documentIds ?? []);
    return c.docs.filter((doc) => ids.has(doc.id) || doc.packageId === pkg.id);
  }, [c.docs, pkg]);
  const jobs = useMemo(
    () => (pkg ? c.processingJobs.filter((job) => job.packageId === pkg.id) : []),
    [c.processingJobs, pkg],
  );
  const gate = pkg ? packageReadyToPublish(pkg) : { ok: false, reason: '知识包不存在' };
  const readyCount = memberDocs.filter((doc) => doc.status === 'ready' || doc.status === 'published').length;
  const evals = pkg ? c.evaluations.filter((item) => item.packageId === pkg.id) : [];
  const lastEval = evals[0];

  return (
    <div className={cn('de-partner-wizard wf-studio', railCollapsed && 'is-rail-collapsed')} data-testid="page-knowledge-package">
      <header className="de-partner-wizard__top">
        <div className="min-w-0">
          <Link to="/knowledge" className="de-partner-wizard__back"><ArrowLeft className="h-3.5 w-3.5" />返回知识中心</Link>
          <div className="mt-2 flex flex-wrap items-end gap-x-3">
            <h1>{pkg?.name ?? '知识包详情'}</h1>
            <p>{pkg ? `${pkg.domain} · ${packageStatusLabel(pkg.status)} · ${pkg.currentVersion.version}` : '正在载入…'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pkg && <Badge tone={packageStatusTone(pkg.status)}>{packageStatusLabel(pkg.status)}</Badge>}
          {c.canWrite && pkg && pkg.status !== 'published' && (
            <Button size="sm" disabled={!gate.ok || c.publishPackageMutation.isPending} title={gate.reason} onClick={() => { c.publishPackageMutation.mutate({ id: pkg.id }); go('versions'); }}>
              <PlayCircle className="h-3.5 w-3.5" />发布版本
            </Button>
          )}
        </div>
      </header>
      <div className="de-partner-wizard__body">
        <KnowledgeStudioRail
          label="知识包生命周期"
          current={step}
          collapsed={railCollapsed}
          onToggle={() => setRailCollapsed((value) => !value)}
          onSelect={go}
          steps={STEPS.map((item) => ({
            ...item,
            status: item.key === 'members'
              ? `${memberDocs.length} 篇 · ${readyCount} 就绪`
              : item.key === 'processing'
                ? (jobs.length ? `${jobs.length} 条作业` : '待启动')
                : item.key === 'eval'
                  ? (lastEval ? (lastEval.status === 'passed' ? '评测通过' : '需复核') : '待评测')
                  : item.key === 'graph'
                    ? `${c.graphEntities.length} 实体`
                    : pkg?.currentVersion.version ?? '版本',
          }))}
        />
        <section className={cn('de-partner-wizard__main', 'wf-studio__main')}>
          <div className="h-full min-h-0 overflow-y-auto p-4 md:p-5">
            {!pkg ? (
              <div className="grid h-40 place-items-center text-xs text-[var(--text-muted)]">知识包不存在或无权访问。</div>
            ) : step === 'members' ? (
              <PackageMembersStep c={c} pkg={pkg} docs={memberDocs} onAttach={() => setAttachOpen(true)} />
            ) : step === 'processing' ? (
              <PackageProcessingStep c={c} pkg={pkg} jobs={jobs} onGoEval={() => go('eval')} />
            ) : step === 'eval' ? (
              <PackageEvalStep c={c} pkg={pkg} sourceDocIds={memberDocs.map((doc) => doc.id)} />
            ) : step === 'graph' ? (
              <PackageGraphStep c={c} pkg={pkg} sourceDocIds={memberDocs.map((doc) => doc.id)} />
            ) : (
              <PackageVersionsStep c={c} pkg={pkg} />
            )}
          </div>
        </section>
      </div>
      <footer className="wf-studio__foot">
        <Button variant="ghost" onClick={() => (step === 'members' ? navigate('/knowledge') : go(STEPS[Math.max(0, stepIndex - 1)].key))}>
          {step === 'members' ? '返回目录' : `上一步：${STEPS[Math.max(0, stepIndex - 1)].label}`}
        </Button>
        {step !== 'versions' ? (
          <Button onClick={() => go(STEPS[stepIndex + 1].key)}>下一步：{STEPS[stepIndex + 1].label}</Button>
        ) : (
          <Button onClick={() => navigate('/knowledge')}>完成并返回目录</Button>
        )}
      </footer>
      {pkg && (
        <AttachDocsModal
          open={attachOpen}
          onClose={() => setAttachOpen(false)}
          candidates={c.docs.filter((doc) => !memberDocs.some((item) => item.id === doc.id))}
          busy={c.attachPackageMutation.isPending}
          onSubmit={(docIds) => {
            c.attachPackageMutation.mutate({ id: pkg.id, docIds });
            setAttachOpen(false);
          }}
        />
      )}
      <KnowledgeModals c={c} />
    </div>
  );
}
