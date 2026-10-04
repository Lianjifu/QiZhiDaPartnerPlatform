/**
 * 新建 / 编辑工作流程：编排、运行记录、发布技能、版本管理同一独立页。
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Circle, PanelLeftClose, PanelLeftOpen, Sparkles } from 'lucide-react';
import { Badge, Button, Spinner } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { useT } from '@/i18n';
import { WorkflowsTabGeneration } from './WorkflowsTab.Generation';
import { WorkflowsModals } from './WorkflowsModals';
import { useWorkflowsController, type WorkflowsController } from './useWorkflowsController';
import type { TabKey } from './WorkflowsShared';

const WorkflowsTabEditor = lazy(() => import('./WorkflowsTab.Editor').then((m) => ({ default: m.WorkflowsTabEditor })));
const WorkflowsTabSkills = lazy(() => import('./WorkflowsTab.Skills').then((m) => ({ default: m.WorkflowsTabSkills })));
const WorkflowsTabSettings = lazy(() => import('./WorkflowsTab.Settings').then((m) => ({ default: m.WorkflowsTabSettings })));
const WorkflowsTabRuns = lazy(() => import('./WorkflowsTab.Runs').then((m) => ({ default: m.WorkflowsTabRuns })));

type StudioStep = 'canvas' | 'history' | 'publishSkill' | 'versions';

const STEPS: Array<{ key: StudioStep; index: string; label: string; hint: string }> = [
  { key: 'canvas', index: '01', label: '流程编排', hint: '节点、连线与草稿' },
  { key: 'history', index: '02', label: '运行记录', hint: '试运行与回放' },
  { key: 'publishSkill', index: '03', label: '发布技能', hint: '门禁与技能档案' },
  { key: 'versions', index: '04', label: '版本管理', hint: '对比、加载与回滚' },
];

function parseStep(raw: string | null): StudioStep {
  if (raw === 'publishSkill' || raw === 'versions' || raw === 'canvas' || raw === 'history') return raw;
  return 'canvas';
}

function stepDoneText(key: StudioStep, c: WorkflowsController) {
  if (key === 'canvas') return '草稿已保存';
  if (key === 'history') return `${c.workflowRuns.length} 条记录`;
  if (key === 'publishSkill') return '可发布 / 已发布';
  return `${c.versions.length} 个版本`;
}

export default function WorkflowStudioPage() {
  const { t } = useT();
  const c = useWorkflowsController();
  return <WorkflowStudioShell c={c} t={t} />;
}

function WorkflowStudioShell({ c, t }: { c: WorkflowsController; t: (key: string, fallback?: string) => string }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [railCollapsed, setRailCollapsed] = useState(false);
  const step = parseStep(params.get('step'));

  useEffect(() => {
    if (c.tab !== step) c.setTab(step);
  }, [c.setTab, c.tab, step]);

  const go = (next: StudioStep) => {
    c.setTab(next);
    setParams(next === 'canvas' ? {} : { step: next }, { replace: true });
  };

  const currentIndex = STEPS.findIndex((item) => item.key === step);
  const currentDef = STEPS[currentIndex] ?? STEPS[0];
  const canvasReady = c.nodes.length > 0 && !c.isDirty;
  const skillReady = c.canPublishSkill || c.publishedSkillCount > 0;
  const runsReady = c.workflowRuns.length > 0;

  const stepState = (key: StudioStep): 'done' | 'current' | 'todo' => {
    if (key === step) return 'current';
    if (key === 'canvas') return canvasReady ? 'done' : 'todo';
    if (key === 'history') return runsReady ? 'done' : 'todo';
    if (key === 'publishSkill') return skillReady ? 'done' : 'todo';
    return c.versions.length > 0 ? 'done' : 'todo';
  };

  return (
    <div className={cn('de-partner-wizard wf-studio', railCollapsed && 'is-rail-collapsed')} data-testid="page-workflow-studio">
      <header className="de-partner-wizard__top">
        <div className="min-w-0">
          <Link to="/workflows" className="de-partner-wizard__back">
            <ArrowLeft className="h-3.5 w-3.5" />返回流程模版
          </Link>
          <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
            <h1>{c.nodes.length ? '编辑工作流程' : '新建工作流程'}</h1>
            <p>第 {currentIndex + 1} / {STEPS.length} 步 · {currentDef.label} · {t('module.workflows.tabs.history')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {c.isDirty && <Badge tone="warn">未保存草稿</Badge>}
          {c.activeVersion && <Badge tone="neutral">{c.activeVersion}</Badge>}
          <Button size="sm" variant="outline" onClick={c.openAIGenerator} disabled={!c.canWrite} title={t('module.workflows.aiOrchestrationHint')}>
            <Sparkles className="h-3.5 w-3.5" />{t('module.workflows.aiOrchestration')}
          </Button>
          <Button size="sm" onClick={c.runWorkflow} disabled={!c.canExecute}>{t('module.workflows.runDraft')}</Button>
        </div>
      </header>

      <div className="de-partner-wizard__body">
        <div className="wf-studio__rail">
          <button
            type="button"
            className="wf-studio__rail-toggle"
            onClick={() => setRailCollapsed((open) => !open)}
            aria-expanded={!railCollapsed}
            aria-controls="wf-studio-steps"
            title={railCollapsed ? '展开步骤' : '收起步骤'}
          >
            {railCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
            <span>{railCollapsed ? '展开' : '收起'}</span>
          </button>
          <ol id="wf-studio-steps" className="de-partner-wizard__rail" aria-label="新建工作流程步骤">
            {STEPS.map((item, index) => {
              const state = stepState(item.key);
              const statusText = state === 'done' ? stepDoneText(item.key, c) : state === 'current' ? '进行中' : '未开始';
              return (
                <li key={item.key} className={cn(index < STEPS.length - 1 && 'has-line')}>
                  <button
                    type="button"
                    onClick={() => go(item.key)}
                    className={cn('de-partner-wizard__step', `is-${state}`)}
                    title={`${item.label} · ${statusText}`}
                  >
                    <span className="de-partner-wizard__index" aria-hidden>
                      {state === 'done' ? <CheckCircle2 className="h-4 w-4" /> : state === 'current' ? item.index : <Circle className="h-3.5 w-3.5" />}
                    </span>
                    <span className="de-partner-wizard__meta">
                      <strong>{item.label}</strong>
                      <em>{item.hint}</em>
                      <small>{statusText}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <section className={cn('de-partner-wizard__main', 'wf-studio__main')}>
          <Suspense fallback={<div className="grid h-full place-items-center"><Spinner size={24} className="text-[var(--brand)]" /></div>}>
            {step === 'canvas' && <WorkflowsTabEditor c={c} />}
            {step === 'history' && (
              <div className="h-full min-h-0 overflow-y-auto">
                <WorkflowsTabRuns c={c} />
              </div>
            )}
            {step === 'publishSkill' && (
              <div className="h-full min-h-0 overflow-y-auto">
                <WorkflowsTabSkills c={c} />
              </div>
            )}
            {step === 'versions' && (
              <div className="h-full min-h-0 overflow-hidden">
                <WorkflowsTabSettings c={c} />
              </div>
            )}
          </Suspense>
        </section>
      </div>

      <footer className="wf-studio__foot">
        <Button variant="ghost" onClick={() => (step === 'canvas' ? navigate('/workflows') : go(STEPS[Math.max(0, currentIndex - 1)].key))}>
          {step === 'canvas' ? '返回目录' : '上一步'}
        </Button>
        <div className="flex flex-wrap gap-2">
          {step === 'canvas' && (
            <Button variant="outline" onClick={c.saveCanvas} disabled={!c.canWrite || !c.isDirty}>保存草稿</Button>
          )}
          {step !== 'versions' ? (
            <Button onClick={() => go(STEPS[currentIndex + 1].key)}>下一步：{STEPS[currentIndex + 1].label}</Button>
          ) : (
            <Button onClick={() => navigate('/workflows')}>完成并返回目录</Button>
          )}
        </div>
      </footer>

      <WorkflowsTabGeneration c={c} />
      <WorkflowsModals c={c} />
      <span className="sr-only">{t('module.workflows.tabs.versions')}{t('module.workflows.tabs.canvas')}</span>
    </div>
  );
}

export type { TabKey };
