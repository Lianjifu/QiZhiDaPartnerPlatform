import { type ReactNode, useMemo, useState } from 'react';
import {
  Activity, ArrowRight, Database, FileText, GitBranch, Layers, PlayCircle, Plus, Search, ShieldCheck,
} from 'lucide-react';
import { Badge, Button, KpiCard } from '@qzda/web-ui';
import type { KnowledgeDoc, KnowledgePackage, KnowledgeProcessingJob, KnowledgeSourceConnection } from '@qzda/web-types';
import { cn } from '@qzda/web-utils';
import { EmptyState } from '@/components/shared';
import {
  normalizeSourceStatus, packageReadyToPublish, packageStatusLabel, packageStatusTone,
} from '@/features/knowledge/knowledge-ui';
import type { KnowledgeController } from './useKnowledgeController';
import { KnowledgeTabEval } from './KnowledgeTab.Eval';

function jobLabel(status: KnowledgeProcessingJob['status']) {
  if (status === 'succeeded') return { text: '已完成', tone: 'success' as const };
  if (status === 'failed') return { text: '失败', tone: 'error' as const };
  if (status === 'running') return { text: '加工中', tone: 'warn' as const };
  return { text: '排队中', tone: 'info' as const };
}

function StepHead({ title, desc, actions }: { title: string; desc: string; actions?: ReactNode }) {
  return (
    <header className="knowledge-pkg-step__head">
      <div className="min-w-0">
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function PackageMembersStep({
  c, pkg, docs, onAttach,
}: {
  c: KnowledgeController;
  pkg: KnowledgePackage;
  docs: KnowledgeDoc[];
  onAttach: () => void;
}) {
  const [q, setQ] = useState('');
  const ready = docs.filter((doc) => doc.status === 'ready' || doc.status === 'published');
  const pending = docs.length - ready.length;
  const chunks = docs.reduce((sum, doc) => sum + (doc.chunks ?? 0), 0);
  const visible = docs.filter((doc) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return doc.title.toLowerCase().includes(needle) || doc.source.toLowerCase().includes(needle);
  });

  return (
    <div className="knowledge-pkg-step">
      <StepHead
        title="成员文档"
        desc="查看与编辑本包已纳入的内容。新增文件或数据源请从知识中心入口进入。"
        actions={c.canWrite ? (
          <Button size="sm" variant="outline" onClick={onAttach}><Plus className="h-3.5 w-3.5" />调整纳管</Button>
        ) : undefined}
      />
      <div className="knowledge-pkg-kpis">
        <KpiCard label="文档" value={docs.length} sub="篇" icon={FileText} tone="brand" size="comfortable" />
        <KpiCard label="已就绪" value={ready.length} sub="篇" icon={ShieldCheck} tone="success" size="comfortable" />
        <KpiCard label="待加工" value={pending} sub="篇" icon={Layers} tone={pending ? 'warn' : 'neutral'} size="comfortable" />
        <KpiCard label="切片" value={chunks} sub="块" icon={GitBranch} tone="info" size="comfortable" />
      </div>
      <div className="knowledge-pkg-toolbar">
        <div className="wf-tpl-search">
          <Search className="h-3.5 w-3.5" />
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="筛选标题或来源" aria-label="筛选文档" />
        </div>
        <span className="text-[11px] text-[var(--text-muted)]">{visible.length} / {docs.length}</span>
      </div>
      {visible.length === 0 ? (
        <EmptyState icon={FileText} title={docs.length === 0 ? '尚未纳入文档' : '没有匹配文档'} description={docs.length === 0 ? '请从知识中心使用「上传内容」或「接入数据源」。也可在此调整已有文档的纳管。' : '换一个关键词再试。'} />
      ) : (
        <div className="knowledge-pkg-docs">
          {visible.map((doc) => {
            const ok = doc.status === 'ready' || doc.status === 'published';
            return (
              <button key={doc.id} type="button" className="knowledge-package-member" onClick={() => c.openDocument(doc.id)}>
                <span className="min-w-0">
                  <strong className="block truncate">{doc.title}</strong>
                  <small>{doc.source} · {doc.updatedAt ? String(doc.updatedAt).slice(0, 10) : '—'}</small>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge tone={ok ? 'success' : 'warn'}>{ok ? '已就绪' : '索引中'}</Badge>
                  <Badge tone="neutral">{doc.chunks} 切片</Badge>
                  <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PackageProcessingStep({
  c, pkg, jobs, onGoEval, emptySourceHint,
}: {
  c: KnowledgeController;
  pkg: KnowledgePackage;
  jobs: KnowledgeProcessingJob[];
  onGoEval: () => void;
  emptySourceHint?: string;
}) {
  const sources = c.sourceConnections;
  const failed = jobs.filter((job) => job.status === 'failed').length;
  const active = jobs.filter((job) => job.status === 'running' || job.status === 'queued').length;

  return (
    <div className="knowledge-pkg-step">
      <StepHead
        title="加工"
        desc="查看本包切片与索引作业，并可启动加工或同步已接入的数据源。"
        actions={c.canWrite ? (
          <Button size="sm" disabled={c.processPackageMutation.isPending} onClick={() => c.processPackageMutation.mutate({ id: pkg.id, strategy: 'semantic' })}>
            <Layers className="h-3.5 w-3.5" />启动加工
          </Button>
        ) : undefined}
      />
      <div className="knowledge-pkg-kpis">
        <KpiCard label="作业" value={jobs.length} sub="条" icon={Layers} tone="brand" size="comfortable" />
        <KpiCard label="进行中" value={active} sub="条" icon={Activity} tone={active ? 'warn' : 'neutral'} size="comfortable" />
        <KpiCard label="失败" value={failed} sub="条" icon={PlayCircle} tone={failed ? 'error' : 'success'} size="comfortable" />
        <KpiCard label="数据源" value={sources.length} sub="个" icon={Database} tone="info" size="comfortable" />
      </div>
      <div className="knowledge-pkg-split">
        <section>
          <h3>加工作业</h3>
          {jobs.length === 0 ? (
            <EmptyState icon={Layers} title="还没有加工作业" description="纳管文档后点击「启动加工」。" />
          ) : (
            <div className="knowledge-job-list">
              {jobs.map((job) => {
                const meta = jobLabel(job.status);
                return (
                  <article key={job.id} className={cn('knowledge-job-card', job.status === 'failed' && 'is-failed')}>
                    <div className="knowledge-job-card__main">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="truncate text-[13px]">{job.source}</strong>
                          <Badge tone={meta.tone}>{meta.text}</Badge>
                        </div>
                        <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                          {job.strategy} · {job.chunkCount || '—'} 切片 / {job.documentCount} 文档 · {job.indexVersion}
                        </p>
                        {job.error && <p className="knowledge-job-card__error">{job.error}</p>}
                      </div>
                      {job.status === 'failed' && c.canWrite && (
                        <Button size="sm" variant="secondary" onClick={() => c.retryJobMutation.mutate({ id: job.id })}>重试</Button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        <section>
          <h3>已接入数据源</h3>
          {sources.length === 0 ? (
            <EmptyState icon={Database} title="没有已接入的数据源" description={emptySourceHint ?? '新增连接请从知识中心「接入数据源」入口进入。'} />
          ) : (
            <div className="space-y-2">
              {sources.map((source: KnowledgeSourceConnection) => {
                const st = normalizeSourceStatus(source.status);
                return (
                  <article key={source.id} className="knowledge-source-card">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="truncate text-sm">{source.name}</strong>
                        <Badge tone={st === 'healthy' ? 'success' : st === 'syncing' ? 'brand' : 'warn'}>{st === 'healthy' ? '健康' : st === 'syncing' ? '同步中' : '需关注'}</Badge>
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">{source.kind} · {source.schedule} · {source.documents} 资产</p>
                    </div>
                    {c.canWrite && (
                      <Button size="sm" variant="secondary" onClick={() => c.syncSource(source.id)}>立即同步</Button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <button type="button" className="knowledge-pkg-next" onClick={onGoEval}>
        加工完成后进入检索评测 <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function PackageEvalStep({ c, pkg, sourceDocIds }: { c: KnowledgeController; pkg: KnowledgePackage; sourceDocIds: string[] }) {
  return (
    <div className="knowledge-pkg-step">
      <StepHead title="检索评测" desc="用真实问题验证本包证据覆盖与延迟，通过门禁后再发布版本。" />
      <KnowledgeTabEval c={c} mode="retrieval" sourceDocIds={sourceDocIds} packageId={pkg.id} embedded />
    </div>
  );
}

export function PackageGraphStep({ c, pkg, sourceDocIds }: { c: KnowledgeController; pkg: KnowledgePackage; sourceDocIds: string[] }) {
  return (
    <div className="knowledge-pkg-step knowledge-pkg-step--fill">
      <StepHead title="知识图谱" desc={`从「${pkg.name}」成员文档抽取实体与关系，供影响分析与混合召回。`} />
      <KnowledgeTabEval c={c} mode="graph" sourceDocIds={sourceDocIds} packageId={pkg.id} embedded />
    </div>
  );
}

export function PackageVersionsStep({ c, pkg }: { c: KnowledgeController; pkg: KnowledgePackage }) {
  const gate = packageReadyToPublish(pkg);
  const bindings = useMemo(() => c.consumerBindings.filter((item) => item.packageId === pkg.id), [c.consumerBindings, pkg.id]);
  return (
    <div className="knowledge-pkg-step">
      <StepHead
        title="版本与引用"
        desc="发布稳定版本后，数字伙伴与工作流才能装配本包。"
        actions={c.canWrite && pkg.status !== 'published' ? (
          <Button size="sm" disabled={!gate.ok || c.publishPackageMutation.isPending} title={gate.reason} onClick={() => c.publishPackageMutation.mutate({ id: pkg.id })}>
            <PlayCircle className="h-3.5 w-3.5" />发布版本
          </Button>
        ) : undefined}
      />
      <div className="knowledge-pkg-gate">
        <div>
          <strong>{gate.ok ? '已满足发布门禁' : '暂不可发布'}</strong>
          <p>{gate.ok ? `当前 ${pkg.currentVersion.version} 可通过评测后发布。` : gate.reason}</p>
        </div>
        <Badge tone={packageStatusTone(pkg.status)}>{packageStatusLabel(pkg.status)}</Badge>
      </div>
      <div className="knowledge-pkg-split">
        <section>
          <h3>版本历史</h3>
          <div className="space-y-2">
            {pkg.versions.map((version) => (
              <div key={version.id} className="knowledge-package-version">
                <span>
                  <strong className="font-mono">{version.version}</strong>
                  <small className="block">{version.changeSummary || '—'}</small>
                </span>
                <span className="text-right">
                  <Badge tone={packageStatusTone(version.status)}>{packageStatusLabel(version.status)}</Badge>
                  <small className="mt-1.5 block text-[11px] text-[var(--text-muted)]">{version.publishedAt ? version.publishedAt.slice(0, 10) : version.indexVersion}</small>
                </span>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h3>运行时引用 {bindings.length ? `· ${bindings.length}` : ''}</h3>
          {bindings.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="尚无引用方" description="发布后，数字伙伴与工作流装配本包会出现在这里。" />
          ) : (
            <div className="space-y-2">
              {bindings.map((binding) => (
                <div key={binding.id} className="knowledge-package-version">
                  <span>
                    <strong>{binding.consumerName}</strong>
                    <small className="block">{binding.consumerType === 'workflow' ? '工作流' : binding.consumerType === 'digital_employee' ? '数字伙伴' : '执行内核'} · {binding.environment}</small>
                  </span>
                  <Badge tone="neutral">{binding.packageVersion}</Badge>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
