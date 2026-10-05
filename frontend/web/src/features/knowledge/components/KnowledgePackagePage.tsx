/**
 * 知识包详情：基本信息、添加内容、加工、验证、图谱、发布。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, PlayCircle } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { KnowledgePackage } from '@qzda/web-types';
import { useKnowledgeController } from './useKnowledgeController';
import { KnowledgeModals } from './KnowledgeModals';
import { KnowledgeStudioRail } from './KnowledgeStudioRail';
import { PackageIdentityForm } from './KnowledgePackageIdentity';
import {
  PackageEvalStep, PackageGraphStep, PackageMembersStep, PackageProcessingStep, PackageVersionsStep,
} from './KnowledgePackageSteps';
import { packageReadyToPublish, packageStatusLabel, packageStatusTone, PACKAGE_LIFECYCLE_STEPS, type KnowledgePackageStep } from '@/features/knowledge/knowledge-ui';

type PkgStep = KnowledgePackageStep;
const STEPS = PACKAGE_LIFECYCLE_STEPS;

function parseStep(raw: string | null): PkgStep {
  if (raw === 'info' || raw === 'processing' || raw === 'eval' || raw === 'graph' || raw === 'versions') return raw;
  return 'members';
}

export default function KnowledgePackagePage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const c = useKnowledgeController();
  const step = parseStep(params.get('step'));
  const ingest = params.get('ingest') === 'source' ? 'source' : 'upload';
  const pkg = c.knowledgePackages.find((item) => item.id === id) ?? null;
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [domain, setDomain] = useState('SRE');
  const [classification, setClassification] = useState<KnowledgePackage['classification']>('internal');

  const go = (next: PkgStep, nextIngest?: 'upload' | 'source') => {
    const nextParams = new URLSearchParams();
    if (next !== 'members') nextParams.set('step', next);
    const kind = nextIngest ?? (next === 'members' ? ingest : undefined);
    if (next === 'members' && kind === 'source') nextParams.set('ingest', 'source');
    setParams(nextParams, { replace: true });
  };
  const stepIndex = STEPS.findIndex((item) => item.key === step);

  useEffect(() => {
    if (id) c.setHighlightedPackageId(id);
  }, [c.setHighlightedPackageId, id]);

  useEffect(() => {
    if (!pkg) return;
    setName(pkg.name);
    setDescription(pkg.description ?? '');
    setDomain(pkg.domain);
    setClassification(pkg.classification);
  }, [pkg?.id, pkg?.name, pkg?.description, pkg?.domain, pkg?.classification]);

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
  const memberIds = useMemo(() => new Set(memberDocs.map((doc) => doc.id)), [memberDocs]);
  const graphCount = c.graphEntities.filter((item) => memberIds.has(item.sourceDocId)).length;
  const identityDirty = pkg
    ? name.trim() !== pkg.name
      || (description.trim() !== (pkg.description ?? ''))
      || domain !== pkg.domain
      || classification !== pkg.classification
    : false;

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
          {c.canWrite && pkg && (
            <Button size="sm" disabled={!gate.ok || c.publishPackageMutation.isPending} title={gate.reason} onClick={() => { c.publishPackageMutation.mutate({ id: pkg.id }); go('versions'); }}>
              <PlayCircle className="h-3.5 w-3.5" />{pkg.status === 'published' ? '发布新版本' : '发布版本'}
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
            status: item.key === 'info'
              ? packageStatusLabel(pkg?.status)
              : item.key === 'members'
                ? `${memberDocs.length} 篇已纳入${readyCount ? ` · ${readyCount} 可用` : ''}`
                : item.key === 'processing'
                  ? (jobs.length ? `${jobs.length} 项任务` : '尚未开始')
                  : item.key === 'eval'
                    ? (lastEval ? (lastEval.status === 'passed' ? '已通过' : '需再验证') : '尚未验证')
                    : item.key === 'graph'
                      ? (graphCount ? `${graphCount} 个实体` : '加工后生成')
                      : pkg ? `当前 ${pkg.currentVersion.version}` : '未发布',
          }))}
        />
        <section className={cn('de-partner-wizard__main', 'wf-studio__main')}>
          <div className="h-full min-h-0 overflow-y-auto p-4 md:p-5">
            {!pkg ? (
              <div className="grid h-40 place-items-center text-xs text-[var(--text-muted)]">知识包不存在或无权访问。</div>
            ) : step === 'info' ? (
              <PackageIdentityForm
                name={name}
                description={description}
                domain={domain}
                classification={classification}
                disabled={!c.canWrite}
                onName={setName}
                onDescription={setDescription}
                onDomain={setDomain}
                onClassification={setClassification}
              />
            ) : step === 'members' ? (
              <PackageMembersStep
                c={c}
                pkg={pkg}
                docs={memberDocs}
                ingest={ingest}
                onIngest={(next) => go('members', next)}
              />
            ) : step === 'processing' ? (
              <PackageProcessingStep
                c={c}
                pkg={pkg}
                jobs={jobs}
                onGoEval={() => go('eval')}
                emptySourceHint="请到「添加内容」接入数据源。"
              />
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
        <Button variant="ghost" onClick={() => (step === 'info' ? navigate('/knowledge') : go(STEPS[Math.max(0, stepIndex - 1)].key))}>
          {step === 'info' ? '返回目录' : `上一步：${STEPS[Math.max(0, stepIndex - 1)].label}`}
        </Button>
        {step === 'info' && c.canWrite && pkg ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!identityDirty || !name.trim() || c.updatePackageMutation.isPending}
              onClick={() => c.updatePackageMutation.mutate({
                id: pkg.id,
                name: name.trim(),
                description: description.trim(),
                domain: domain.trim() || '通用',
                classification,
              })}
            >
              {c.updatePackageMutation.isPending ? '保存中…' : '保存基本信息'}
            </Button>
            <Button onClick={() => go('members')}>下一步：添加内容</Button>
          </div>
        ) : step !== 'versions' ? (
          <Button onClick={() => go(STEPS[stepIndex + 1].key)}>下一步：{STEPS[stepIndex + 1].label}</Button>
        ) : (
          <Button onClick={() => navigate('/knowledge')}>完成并返回目录</Button>
        )}
      </footer>
      <KnowledgeModals c={c} />
    </div>
  );
}
