/**
 * 新建知识包向导：创建 → 上传/接入 → 加工 → 评测 → 版本。
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Boxes, Database, Globe, Lock, Plus, ShieldAlert, Upload } from 'lucide-react';
import { Badge, Button, Input } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { KnowledgePackage } from '@qzda/web-types';
import { Field } from './KnowledgeShared';
import { useKnowledgeController } from './useKnowledgeController';
import { KnowledgeStudioRail } from './KnowledgeStudioRail';
import { ConnectSourceFormView } from './ConnectSourceForm';
import { KnowledgeUploadForm } from './KnowledgeUploadForm';
import { AttachDocsModal } from './AttachDocsModal';
import { PackageEvalStep, PackageProcessingStep, PackageVersionsStep } from './KnowledgePackageSteps';
import { roleCanMutate } from '@/features/role-nav/role-nav';
import { useAuthStore } from '@/stores/authStore';
import { packageStatusLabel, packageStatusTone } from '@/features/knowledge/knowledge-ui';

const DOMAINS = ['SRE', '安全', '财务', '客服', '办公', '研发'];
const CLASS_OPTIONS: Array<{
  value: KnowledgePackage['classification'];
  label: string;
  hint: string;
  icon: typeof Globe;
}> = [
  { value: 'internal', label: '内部', hint: '工作区内可检索、可装配', icon: Globe },
  { value: 'confidential', label: '机密', hint: '仅授权岗位与流程可引用', icon: Lock },
  { value: 'restricted', label: '受限', hint: '高敏感，发布与引用需复核', icon: ShieldAlert },
];

type CreateStep = 'create' | 'members' | 'processing' | 'eval' | 'versions';
const STEPS: Array<{ key: CreateStep; index: string; label: string; hint: string }> = [
  { key: 'create', index: '01', label: '创建知识包', hint: '命名、域与分级' },
  { key: 'members', index: '02', label: '成员文档', hint: '上传文件' },
  { key: 'processing', index: '03', label: '加工', hint: '接入数据源与切片' },
  { key: 'eval', index: '04', label: '检索评测', hint: '门禁验证' },
  { key: 'versions', index: '05', label: '版本与引用', hint: '发布交付' },
];

function parseStep(raw: string | null): CreateStep {
  if (raw === 'members' || raw === 'processing' || raw === 'eval' || raw === 'versions') return raw;
  return 'create';
}

export default function KnowledgePackageCreatePage() {
  const c = useKnowledgeController();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canWrite = roleCanMutate(useAuthStore((s) => s.user?.role)) && c.canWrite;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [domain, setDomain] = useState('SRE');
  const [classification, setClassification] = useState<KnowledgePackage['classification']>('internal');
  const [created, setCreated] = useState<KnowledgePackage | null>(null);
  const [ingest, setIngest] = useState<'upload' | 'source'>('upload');
  const [attachOpen, setAttachOpen] = useState(false);
  const step = parseStep(params.get('step'));
  const pkgId = params.get('id') ?? '';
  const listed = c.knowledgePackages.find((item) => item.id === pkgId) ?? null;
  const pkg = listed ?? (created?.id === pkgId ? created : null);
  const valid = Boolean((pkg || name.trim()) && canWrite);
  const busy = c.createPackageMutation.isPending;
  const classValue = pkg?.classification ?? classification;
  const classMeta = CLASS_OPTIONS.find((item) => item.value === classValue) ?? CLASS_OPTIONS[0];
  const stepIndex = STEPS.findIndex((item) => item.key === step);
  const currentDomain = pkg?.domain ?? domain;

  const memberDocs = useMemo(() => {
    if (!pkg) return [];
    const ids = new Set(pkg.documentIds ?? []);
    return c.docs.filter((doc) => ids.has(doc.id) || doc.packageId === pkg.id);
  }, [c.docs, pkg]);
  const jobs = useMemo(
    () => (pkg ? c.processingJobs.filter((job) => job.packageId === pkg.id) : []),
    [c.processingJobs, pkg],
  );
  const connecting = c.sourceMutation.isPending || c.sourceSyncMutation.isPending;

  const go = (next: CreateStep) => {
    if (next !== 'create' && !pkgId) return;
    const nextParams = new URLSearchParams();
    if (pkgId) nextParams.set('id', pkgId);
    if (next !== 'create') nextParams.set('step', next);
    setParams(nextParams, { replace: true });
  };

  const persist = async () => {
    if (pkg) {
      go('members');
      return;
    }
    if (!name.trim() || !canWrite) return;
    try {
      const item = await c.createPackageMutation.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        domain: domain.trim() || '通用',
        classification,
      });
      setCreated(item);
      setParams({ id: item.id, step: 'members' }, { replace: true });
    } catch {
      /* onError 已提示 */
    }
  };

  const railStatus = (key: CreateStep) => {
    if (!pkg) return key === 'create' ? '进行中' : '创建后继续';
    if (key === 'create') return '已创建';
    if (key === 'members') return `${memberDocs.length} 篇`;
    if (key === 'processing') return jobs.length ? `${jobs.length} 条作业` : `${c.sourceConnections.length} 个数据源`;
    if (key === 'eval') return '试检索';
    return pkg.currentVersion.version;
  };

  return (
    <div className="de-partner-wizard wf-studio" data-testid="page-knowledge-package-create">
      <header className="de-partner-wizard__top">
        <div className="min-w-0">
          <Link to="/knowledge" className="de-partner-wizard__back"><ArrowLeft className="h-3.5 w-3.5" />返回知识中心</Link>
          <div className="mt-2 flex flex-wrap items-end gap-x-3">
            <h1>{pkg ? pkg.name : '新建知识包'}</h1>
            <p>在本页完成创建、上传文件、接入数据源，再加工评测并发布。</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pkg && <Badge tone={packageStatusTone(pkg.status)}>{packageStatusLabel(pkg.status)}</Badge>}
          {!canWrite && <Badge tone="neutral">只读</Badge>}
        </div>
      </header>
      <div className="de-partner-wizard__body">
        <KnowledgeStudioRail
          sequential
          label="知识包交付路径"
          current={step}
          onSelect={go}
          steps={STEPS.map((item) => ({
            ...item,
            status: railStatus(item.key),
          }))}
        />
        <section className="de-partner-wizard__main wf-studio__main knowledge-pkg-create-shell">
          <div className="h-full min-h-0 overflow-y-auto p-3 md:p-4">
            {step === 'create' && (
              <div className="knowledge-pkg-create">
                <div className="knowledge-pkg-create__main">
                  <section className="knowledge-pkg-create__block">
                    <header className="knowledge-pkg-create__block-head">
                      <span>01</span>
                      <div>
                        <h2>基本信息</h2>
                        <p>名称用于目录与引用；业务域帮助伙伴按场景装配。</p>
                      </div>
                    </header>
                    <div className="knowledge-pkg-create__fields">
                      <Field label="知识包名称" required>
                        <Input
                          value={pkg?.name ?? name}
                          disabled={Boolean(pkg)}
                          onChange={(event) => setName(event.target.value)}
                          placeholder="例如：生产故障处置知识包"
                        />
                      </Field>
                      <Field label="业务域">
                        <div className="knowledge-pkg-domain">
                          {DOMAINS.map((item) => (
                            <button
                              key={item}
                              type="button"
                              disabled={Boolean(pkg)}
                              className={cn('knowledge-pkg-domain__chip', currentDomain === item && 'is-active')}
                              onClick={() => setDomain(item)}
                            >
                              {item}
                            </button>
                          ))}
                          <input
                            value={DOMAINS.includes(currentDomain) ? '' : currentDomain}
                            disabled={Boolean(pkg)}
                            onChange={(event) => setDomain(event.target.value)}
                            placeholder="自定义"
                            aria-label="自定义业务域"
                            className="knowledge-pkg-domain__custom"
                          />
                        </div>
                      </Field>
                      <div className="knowledge-pkg-create__wide">
                        <Field label="说明">
                          <textarea
                            value={pkg?.description ?? description}
                            disabled={Boolean(pkg)}
                            onChange={(event) => setDescription(event.target.value)}
                            rows={3}
                            placeholder="适用范围、主要来源、谁可以引用、使用边界。"
                            className="de-employee-input w-full rounded-lg bg-[var(--bg)] px-3 py-2 text-xs leading-5"
                          />
                        </Field>
                      </div>
                    </div>
                  </section>
                  <section className="knowledge-pkg-create__block">
                    <header className="knowledge-pkg-create__block-head">
                      <span>02</span>
                      <div>
                        <h2>数据分级</h2>
                        <p>决定检索范围与发布复核强度。</p>
                      </div>
                    </header>
                    <div className="knowledge-pkg-class-grid" role="radiogroup" aria-label="数据分级">
                      {CLASS_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const active = classValue === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            disabled={Boolean(pkg)}
                            className={cn('knowledge-pkg-class', active && 'is-active')}
                            onClick={() => setClassification(option.value)}
                          >
                            <span className="knowledge-pkg-class__icon"><Icon className="h-4 w-4" /></span>
                            <strong>{option.label}</strong>
                            <small>{option.hint}</small>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </div>
                <aside className="knowledge-pkg-create__aside">
                  <div className="knowledge-pkg-create__preview">
                    <div className="knowledge-pkg-create__preview-kicker">{pkg ? '已创建' : '实时预览'}</div>
                    <h3>{(pkg?.name ?? name).trim() || '未命名知识包'}</h3>
                    <div className="knowledge-pkg-create__preview-tags">
                      <Badge tone="neutral">{currentDomain.trim() || '业务域'}</Badge>
                      <Badge tone={classValue === 'internal' ? 'info' : 'warn'}>{classMeta.label}</Badge>
                    </div>
                    <p>{(pkg?.description ?? description).trim() || '补充说明后，伙伴能更快判断能否装配。'}</p>
                  </div>
                  <ol className="knowledge-pkg-create__path">
                    {STEPS.map((item, index) => (
                      <li key={item.key} className={cn(item.key === 'create' && 'is-current')}>
                        <em>{item.index}</em>
                        <span>
                          <strong>{item.label}</strong>
                          <small>{index === 1 ? '上传文件或接入数据源' : item.hint}</small>
                        </span>
                      </li>
                    ))}
                  </ol>
                  <p className="knowledge-pkg-create__aside-note">
                    <Boxes className="h-3.5 w-3.5" />
                    创建后留在本向导纳入内容，不必回到目录。
                  </p>
                </aside>
              </div>
            )}

            {step === 'members' && pkg && (
              <div className="knowledge-pkg-create">
                <div className="knowledge-pkg-create__main">
                  <section className="knowledge-pkg-create__block">
                    <header className="knowledge-pkg-create__block-head">
                      <span>02</span>
                      <div>
                        <h2>纳入内容</h2>
                        <p>上传文件或接入数据源，两条路径都会进入本包。</p>
                      </div>
                      {c.canWrite && (
                        <Button size="sm" variant="outline" onClick={() => setAttachOpen(true)}>
                          <Plus className="h-3.5 w-3.5" />纳管已有文档
                        </Button>
                      )}
                    </header>
                    <div className="knowledge-pkg-ingest">
                      <button type="button" className={cn('knowledge-pkg-ingest__card', ingest === 'upload' && 'is-active')} onClick={() => setIngest('upload')}>
                        <span className="knowledge-pkg-ingest__icon"><Upload className="h-4 w-4" /></span>
                        <strong>上传文件</strong>
                        <small>PDF / Word / Markdown 直接纳入</small>
                      </button>
                      <button type="button" className={cn('knowledge-pkg-ingest__card', ingest === 'source' && 'is-active')} onClick={() => setIngest('source')}>
                        <span className="knowledge-pkg-ingest__icon"><Database className="h-4 w-4" /></span>
                        <strong>接入数据源</strong>
                        <small>Git / API / Webhook 同步后再加工</small>
                      </button>
                    </div>
                    {ingest === 'upload' ? (
                      <KnowledgeUploadForm
                        canWrite={canWrite}
                        submitting={c.uploadMutation.isPending}
                        submitLabel="上传到本包"
                        onSubmit={(payload) => c.handleUploadDoc({ ...payload, packageId: pkg.id }, { stay: true })}
                      />
                    ) : (
                      <ConnectSourceFormView
                        compact
                        connecting={connecting}
                        onSubmit={(form) => { void c.connectSource(form); }}
                        footer={({ valid: sourceValid, submit }) => (
                          <div className="flex justify-end">
                            <Button disabled={!sourceValid || connecting || !canWrite} onClick={submit}>
                              {connecting ? '接入中…' : '接入到本包'}
                            </Button>
                          </div>
                        )}
                      />
                    )}
                  </section>
                </div>
                <aside className="knowledge-pkg-create__aside">
                  <div className="knowledge-pkg-create__preview">
                    <div className="knowledge-pkg-create__preview-kicker">本包成员</div>
                    <h3>{memberDocs.length} 篇已纳入</h3>
                    <p>{pkg.name}</p>
                  </div>
                  {memberDocs.length === 0 ? (
                    <p className="knowledge-pkg-create__aside-note">还没有文档。上传或接入后会出现在这里。</p>
                  ) : (
                    <div className="knowledge-pkg-docs">
                      {memberDocs.map((doc) => (
                        <div key={doc.id} className="knowledge-package-member">
                          <span className="min-w-0">
                            <strong className="block truncate">{doc.title}</strong>
                            <small>{doc.source}</small>
                          </span>
                          <Badge tone={doc.status === 'ready' || doc.status === 'published' ? 'success' : 'warn'}>
                            {doc.status === 'ready' || doc.status === 'published' ? '已就绪' : '索引中'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </aside>
              </div>
            )}

            {step === 'processing' && pkg && (
              <PackageProcessingStep
                c={c}
                pkg={pkg}
                jobs={jobs}
                onGoEval={() => go('eval')}
                emptySourceHint="可返回「成员文档」切换到接入数据源。"
              />
            )}
            {step === 'eval' && pkg && (
              <PackageEvalStep c={c} pkg={pkg} sourceDocIds={memberDocs.map((doc) => doc.id)} />
            )}
            {step === 'versions' && pkg && <PackageVersionsStep c={c} pkg={pkg} />}
            {step !== 'create' && !pkg && (
              <div className="grid h-40 place-items-center text-xs text-[var(--text-muted)]">
                请先完成创建知识包。
              </div>
            )}
          </div>
        </section>
      </div>
      <footer className="wf-studio__foot">
        <Button variant="ghost" onClick={() => (step === 'create' ? navigate('/knowledge') : go(STEPS[Math.max(0, stepIndex - 1)].key))}>
          {step === 'create' ? '取消' : `上一步：${STEPS[Math.max(0, stepIndex - 1)].label}`}
        </Button>
        {step === 'create' ? (
          <Button disabled={!valid || busy} onClick={() => void persist()}>
            {busy ? '创建中…' : pkg ? '下一步：成员文档' : '创建并纳入内容'}
          </Button>
        ) : step === 'versions' ? (
          <Button onClick={() => pkg && navigate(`/knowledge/packages/${encodeURIComponent(pkg.id)}`)}>完成并打开知识包</Button>
        ) : (
          <Button disabled={!pkg} onClick={() => go(STEPS[stepIndex + 1].key)}>下一步：{STEPS[stepIndex + 1].label}</Button>
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
    </div>
  );
}
