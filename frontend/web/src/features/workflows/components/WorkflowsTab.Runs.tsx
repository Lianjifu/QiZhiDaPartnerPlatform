/**
 * M06 P1 运行记录 tab（HistoryView）。
 *
 * 拆分原因：原 pages/Workflows.tsx 4479L（M06 P1 整合），按 D1 决策把运行历史
 * 面板抽离到本文件。状态完全自包含（仅依赖 useApiQuery + 父级 onGoCanvas），
 * controller 仅透传 workflowRuns、showToast、focusRunId、canExecute 等。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  History as HistoryLucide, Search, ChevronLeft, ChevronRight, Eye,
  SkipBack, SkipForward, StepBack, StepForward, Play, Pause, RotateCcw,
  AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { useApiMutation, useApiQuery } from '@/services/query';
import { Drawer } from '@/components/shared';
import type { WorkflowRunRecord } from './WorkflowsShared';
import type { WorkflowsController } from './useWorkflowsController';

interface Props {
  c: WorkflowsController;
}

const STATUS_LABEL: Record<string, string> = { success: '已完成', failed: '执行失败', running: '运行中' };

export function WorkflowsTabRuns({ c }: Props) {
  const showToast = c.showToast;
  const { data: runs = [], refetch, isLoading } = useApiQuery<WorkflowRunRecord[]>(['workflow-runs'], '/api/workflow-runs');
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mobileReplayOpen, setMobileReplayOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed' | 'running'>('all');
  const [page, setPage] = useState(1);
  const retryRunApi = useApiMutation<WorkflowRunRecord, { id: string; workflowId: string }>(
    (vars) => `/api/workflows/${vars.workflowId}/runs/${vars.id}/retry`,
    {
      onSuccess: (run) => { showToast(`已创建重试尝试 ${run.id}`, 'success'); setSelectedRunId(run.id); refetch(); },
      onError: (err) => showToast(err instanceof Error ? err.message : '重试请求失败，请检查权限或运行状态', 'error'),
    },
  );

  useEffect(() => {
    if (c.focusRunId) { setSelectedRunId(c.focusRunId); c.setFocusRunId(null); return; }
    if (!selectedRunId && runs[0]) setSelectedRunId(runs[0].id);
  }, [c.focusRunId, runs, selectedRunId, c]);

  const replaySteps = useMemo(() => {
    const sel = runs.find((r) => r.id === selectedRunId) ?? runs[0];
    return sel?.nodeSteps?.length
      ? sel.nodeSteps
      : Array.from({ length: sel?.steps ?? 0 }, (_, index) => ({ id: `synthetic-${index + 1}`, label: `步骤 ${index + 1}`, status: 'pending' as const }));
  }, [runs, selectedRunId]);

  const hasRecordedEvidence = useMemo(() => {
    const sel = runs.find((r) => r.id === selectedRunId) ?? runs[0];
    return sel?.evidenceMode === 'recorded' && Boolean(sel?.nodeSteps?.length);
  }, [runs, selectedRunId]);

  const selectedRun = useMemo(() => runs.find((r) => r.id === selectedRunId) ?? runs[0], [runs, selectedRunId]);
  const totalSteps = replaySteps.length;
  const successCount = runs.filter((r) => r.status === 'success').length;
  const failedCount = runs.filter((r) => r.status === 'failed').length;
  const runningCount = runs.filter((r) => r.status === 'running').length;
  const recordedCount = runs.filter((r) => r.evidenceMode === 'recorded' && Boolean(r.nodeSteps?.length)).length;
  const visibleRuns = runs.filter((r) => (
    (statusFilter === 'all' || r.status === statusFilter)
    && (!query.trim() || `${r.id} ${r.trigger} ${r.who} ${r.revisionId ?? ''} ${r.correlationId ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  ));
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(visibleRuns.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedRuns = visibleRuns.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstItem = visibleRuns.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, visibleRuns.length);

  useEffect(() => { if (!playing) return; const timer = setInterval(() => setStep((s) => { if (s >= totalSteps) { setPlaying(false); return s; } return s + 1; }), 800); return () => clearInterval(timer); }, [playing, totalSteps]);
  useEffect(() => { setStep(0); setPlaying(false); }, [selectedRunId]);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  const openRun = (id: string, mobile = false) => { setSelectedRunId(id); if (mobile || (typeof window !== 'undefined' && window.matchMedia('(max-width: 1079px)').matches)) setMobileReplayOpen(true); };
  const renderReplayBody = (embedded = false) => {
    if (!selectedRun) return <div className="wf-history__replay-empty">请选择左侧一条运行记录查看回放</div>;
    return (
      <>
        <div className="wf-history__replay-head">
          {!embedded && <div className="wf-history__replay-kicker">运行回放</div>}
          <h3 className="wf-history__replay-title">{selectedRun.trigger}</h3>
          <div className="wf-history__replay-sub">{selectedRun.time} · {selectedRun.who}{selectedRun.revisionId ? ` · ${selectedRun.revisionId}` : ''}{selectedRun.attempt && selectedRun.attempt > 1 ? ` · 第 ${selectedRun.attempt} 次尝试` : ''}{selectedRun.parentRunId ? ` · 源自 ${selectedRun.parentRunId}` : ''}</div>
          <div className="wf-history__replay-tags">
            <Badge tone={selectedRun.status === 'success' ? 'success' : selectedRun.status === 'failed' ? 'error' : 'info'}>{STATUS_LABEL[selectedRun.status] ?? selectedRun.status}</Badge>
            {selectedRun.environment && <Badge tone="neutral">{selectedRun.environment}</Badge>}
            <Badge tone={hasRecordedEvidence ? 'success' : 'warn'}>{hasRecordedEvidence ? '节点快照证据' : '仅有汇总'}</Badge>
          </div>
        </div>
        {!hasRecordedEvidence && <div className="wf-history__replay-warn">该记录未保存节点快照。下方回放按步骤数占位，不能作为审计逐步证据。</div>}
        <div className="wf-history__replay-progress">
          <div className="wf-history__progress-bar">{replaySteps.map((item, i) => { const isCompleted = i < step; const isCurrent = i === step; const failedIndex = selectedRun.nodeSteps?.findIndex((s) => s.status === 'failed') ?? -1; const isFailed = item.status === 'failed' || (selectedRun.status === 'failed' && i === (failedIndex >= 0 ? failedIndex : totalSteps - 1)); return <span key={item.id} style={{ background: isFailed && i <= step ? 'var(--danger)' : isCurrent ? 'var(--brand)' : isCompleted ? 'var(--success)' : undefined }} />; })}</div>
          <div className="wf-history__progress-meta"><span>当前步骤</span><strong>{Math.min(step, totalSteps)} / {totalSteps}</strong></div>
          {selectedRun.correlationId && <div className="wf-history__corr">correlation: {selectedRun.correlationId}</div>}
        </div>
        <div className="wf-history__steps">
          {replaySteps.map((item, i) => { const isDone = i < step; const isCurrent = i === step; const isFailedStep = item.status === 'failed' || (selectedRun.status === 'failed' && !hasRecordedEvidence && i === totalSteps - 1); return (
            <div key={item.id} className={cn('wf-history__step', isCurrent && 'is-current', isDone && !isFailedStep && 'is-done', isFailedStep && 'is-failed')}>
              <div className="wf-history__step-left"><span className="wf-history__step-index">{isDone && !isFailedStep ? <CheckCircle2 className="h-3 w-3" /> : i + 1}</span><span className="wf-history__step-label">{item.label}</span></div>
              {'kind' in item && item.kind && <span className="wf-history__step-kind">{item.kind}</span>}
              {isFailedStep && <Badge tone="error" className="text-[9px]">失败</Badge>}
            </div>
          ); })}
          {selectedRun.error && <div className="wf-history__error"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span><span className="font-semibold">异常：</span>{selectedRun.error}</span></div>}
        </div>
        <div className="wf-history__replay-controls">
          <div className="wf-history__transport">
            <button type="button" aria-label="回到开始" onClick={() => { setStep(0); setPlaying(false); }}><SkipBack className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="上一步" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}><StepBack className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label={playing ? '暂停' : '播放'} className="is-primary" onClick={() => setPlaying(!playing)} disabled={step >= totalSteps || totalSteps === 0}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
            <button type="button" aria-label="下一步" onClick={() => setStep((s) => Math.min(totalSteps, s + 1))} disabled={step >= totalSteps}><StepForward className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="跳到结束" onClick={() => { setStep(totalSteps); setPlaying(false); }}><SkipForward className="h-3.5 w-3.5" /></button>
          </div>
          <div className="wf-history__transport-note">单步 / 自动 800ms · {hasRecordedEvidence ? '基于节点快照' : '占位回放'}</div>
        </div>
      </>
    );
  };

  return (
    <div className="wf-history">
      <header className="wf-history__hero">
        <div className="wf-history__hero-main"><div className="wf-history__eyebrow"><HistoryLucide className="h-3.5 w-3.5" />执行证据与回放</div><h2 className="wf-history__title">运行记录</h2><p className="wf-history__lead">查看每次试运行与正式触发的结果。仅标注「节点快照证据」的记录可逐步回放核对；沙箱试运行成功后会自动聚焦到本页。</p></div>
        <div className="wf-history__hero-meta">
          <div className="wf-history__stat"><strong>{isLoading ? '—' : runs.length}</strong><span>全部</span></div>
          <div className="wf-history__stat is-ok"><strong>{successCount}</strong><span>成功</span></div>
          <div className="wf-history__stat is-bad"><strong>{failedCount}</strong><span>失败</span></div>
          <div className="wf-history__stat is-run"><strong>{runningCount}</strong><span>运行中</span></div>
          <div className="wf-history__stat"><strong>{recordedCount}</strong><span>有快照</span></div>
          <Button size="sm" variant="ghost" onClick={() => c.setTab('canvas')}>返回编排</Button>
        </div>
      </header>
      <div className="wf-history__layout">
        <section className="wf-history__panel" aria-labelledby="wf-history-list-title">
          <div className="wf-history__panel-head"><div><h3 id="wf-history-list-title">运行列表</h3><p>流程 <code className="font-mono text-[10px] text-[var(--text-secondary)]">{c.workflowId}</code> · 当前筛选 {visibleRuns.length} 条</p></div></div>
          <div className="wf-history__toolbar">
            <div className="wf-history__search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索运行 ID、触发源、执行人或 correlation" /></div>
            <div className="wf-history__filters" role="group" aria-label="运行状态">{(['all', 'success', 'failed', 'running'] as const).map((key) => (<button key={key} type="button" onClick={() => setStatusFilter(key)} className={statusFilter === key ? 'is-active' : undefined}>{key === 'all' ? '全部' : key === 'success' ? '成功' : key === 'failed' ? '失败' : '运行中'}</button>))}</div>
          </div>
          {visibleRuns.length > 0 ? (
            <>
              <div className="wf-history__list">
                {pagedRuns.map((r) => { const recorded = r.evidenceMode === 'recorded' && Boolean(r.nodeSteps?.length); return (
                  <div key={r.id} role="button" tabIndex={0} onClick={() => openRun(r.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openRun(r.id); } }} className={cn('wf-history__row', selectedRunId === r.id && 'is-selected')}>
                    <div className="wf-history__row-main">
                      <span className={cn('wf-history__dot', r.status === 'success' ? 'is-success' : r.status === 'failed' ? 'is-failed' : 'is-running')} />
                      <div className="min-w-0">
                        <div className="wf-history__row-title"><strong className="truncate">{r.trigger}</strong><Badge tone={r.status === 'success' ? 'success' : r.status === 'failed' ? 'error' : 'info'} className="text-[9px]">{STATUS_LABEL[r.status] ?? r.status}</Badge><Badge tone={recorded ? 'success' : 'warn'} className="text-[9px]">{recorded ? '有快照' : '仅汇总'}</Badge></div>
                        <div className="wf-history__row-meta"><code>{r.id}</code>{r.revisionId && <><span className="wf-history__sep" /><code>{r.revisionId}</code></>}<span className="wf-history__sep" /><span>{r.time}</span><span className="wf-history__sep" /><span>{r.who}</span>{r.environment && <><span className="wf-history__sep" /><span>{r.environment}</span></>}{r.attempt && r.attempt > 1 && <><span className="wf-history__sep" /><span>第 {r.attempt} 次</span></>}</div>
                        {recorded && r.nodeSteps?.length ? (<div className="wf-history__rail">{r.nodeSteps.map((nodeStep) => (<span key={nodeStep.id} className={nodeStep.status === 'failed' ? 'is-bad' : nodeStep.status === 'success' ? 'is-ok' : nodeStep.status === 'skipped' ? 'is-skip' : 'is-pending'} />))}</div>) : (<div className="mt-2 text-[10px] text-[var(--text-muted)]">{r.steps} 步 · 无节点快照</div>)}
                      </div>
                    </div>
                    <div className="wf-history__metrics"><div><div>耗时</div><strong>{r.status === 'running' ? '处理中' : `${r.duration}s`}</strong></div><div><div>步骤</div><strong>{r.steps}</strong></div></div>
                    <div className="wf-history__actions">
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openRun(r.id, true); }}><Eye className="h-3 w-3" />回放</Button>
                      {r.status === 'failed' && (<Button size="sm" variant="secondary" disabled={!c.canExecute} title={c.canExecute ? undefined : '缺少 workflow.execute 权限'} onClick={(e) => { e.stopPropagation(); retryRunApi.mutate({ id: r.id, workflowId: r.workflowId ?? c.workflowId }); }} loading={retryRunApi.isPending}><RotateCcw className="h-3 w-3" />重跑</Button>)}
                    </div>
                    {r.error && <div className="wf-history__error"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span><span className="font-semibold">异常：</span>{r.error}</span></div>}
                  </div>
                ); })}
              </div>
              <div className="wf-history__footer">
                <span>显示第 {firstItem}–{lastItem} 条，共 {visibleRuns.length} 条</span>
                <nav className="wf-history__pager" aria-label="运行记录分页"><button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="上一页"><ChevronLeft className="h-3.5 w-3.5" /></button>{Array.from({ length: pageCount }, (_, index) => index + 1).map((item) => (<button key={item} type="button" onClick={() => setPage(item)} className={item === currentPage ? 'is-current' : undefined} aria-current={item === currentPage ? 'page' : undefined}>{item}</button>))}<button type="button" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} aria-label="下一页"><ChevronRight className="h-3.5 w-3.5" /></button></nav>
              </div>
            </>
          ) : (
            <div className="wf-history__empty"><strong>{isLoading ? '正在加载运行记录…' : '没有符合条件的运行记录'}</strong>{!isLoading && (<><span>可调整筛选，或回到画布发起一次沙箱试运行。</span><Button size="sm" variant="secondary" onClick={() => c.setTab('canvas')}>返回编排</Button></>)}</div>
          )}
        </section>
        <aside className="wf-history__panel wf-history__replay" aria-label="运行回放">{renderReplayBody()}</aside>
      </div>
      <Drawer open={mobileReplayOpen} onClose={() => setMobileReplayOpen(false)} title="运行回放" description={selectedRun ? `${selectedRun.trigger} · ${selectedRun.time} · ${selectedRun.who}` : '未选择运行'} width={520}><div className="flex min-h-[60vh] flex-col">{renderReplayBody(true)}</div></Drawer>
    </div>
  );
}

export default WorkflowsTabRuns;