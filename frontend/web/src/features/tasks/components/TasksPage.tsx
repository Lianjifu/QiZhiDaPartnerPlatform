import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, LoaderCircle, Plus } from 'lucide-react';
import type { ControlledTask, Priority, TaskLifecycleStage } from '@qzda/web-types';
import { Input } from '@qzda/web-ui';
import { Drawer, RoleReadonlyBanner } from '@/components/shared';
import { useApiMutation, useApiQuery } from '@/services/query';
import { TaskActionSummary, type TaskPreset } from '@/features/tasks/TaskActionSummary';
import { TaskLifecycleBoard } from '@/features/tasks/TaskLifecycleBoard';
import { TaskToolbar, defaultTaskFilters, type TaskFilters } from '@/features/tasks/TaskToolbar';
import { getStageMeta, isRiskTask, normalizeControlledTask } from '@/features/tasks/task-ui';
import { TaskLifecycleDrawer } from '@/features/tasks/TaskLifecycleDrawer';
import { roleCanMutate, rolePageCopy, resolveAppRole, workspaceErrorMessage } from '@/features/role-nav/role-nav';
import { useAuthStore } from '@/stores/authStore';

const STORAGE_KEY = 'de-controlled-task-console-v1';
type View = 'board' | 'list';

function readPreferences(): { filters: TaskFilters; view: View } {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return { filters: { ...defaultTaskFilters, ...value.filters }, view: value.view === 'list' ? 'list' : 'board' };
  } catch { return { filters: defaultTaskFilters, view: 'board' }; }
}

function roleDefaultFilters(role: ReturnType<typeof resolveAppRole>, actor: string, base: TaskFilters): TaskFilters {
  if (role === 'user') {
    return { ...base, assignee: actor || base.assignee };
  }
  if (role === 'auditor') {
    return { ...base, approval: 'pending', risk: 'attention' };
  }
  return base;
}

function buildTaskListQuery(filters: TaskFilters) {
  const query: Record<string, string> = {};
  if (filters.stage !== 'all') query.stage = filters.stage;
  if (filters.assignee !== 'all') query.assignee = filters.assignee;
  if (filters.risk !== 'all') query.risk = filters.risk;
  if (filters.priority !== 'all') query.priority = filters.priority;
  if (filters.agent !== 'all') query.agent = filters.agent;
  if (filters.source !== 'all') query.source = filters.source;
  if (filters.approval !== 'all') query.approval = filters.approval;
  if (filters.search.trim()) query.q = filters.search.trim();
  if (filters.blocked) query.blocked = '1';
  if (filters.archived) query.archived = '1';
  return query;
}

export default function Tasks() {
  const user = useAuthStore((state) => state.user);
  const actor = user?.name ?? '当前用户';
  const role = resolveAppRole(user?.role);
  const canMutate = roleCanMutate(user?.role);
  const copy = rolePageCopy('tasks', user?.role);
  const [preferences] = useState(readPreferences);
  const [searchParams, setSearchParams] = useSearchParams();
  const taskCodeFromHome = searchParams.get('task');
  const [filters, setFilters] = useState<TaskFilters>(() => {
    const seeded = {
      ...preferences.filters,
      search: taskCodeFromHome ?? preferences.filters.search,
      risk: searchParams.get('risk') === 'attention' ? 'attention' as const : preferences.filters.risk,
    };
    return roleDefaultFilters(role, actor, seeded);
  });
  const [view, setView] = useState<View>(preferences.view);
  const [selected, setSelected] = useState<ControlledTask | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [drawerPending, setDrawerPending] = useState(false);

  const listQuery = useMemo(() => buildTaskListQuery(filters), [filters]);
  const { data: facetRaw = [], isLoading: facetLoading } = useApiQuery<ControlledTask[]>(
    ['controlled-tasks', 'facets'],
    '/api/tasks',
    undefined,
    { refetchInterval: 5_000 },
  );
  const { data: apiTasksRaw = [], isLoading, error, refetch } = useApiQuery<ControlledTask[]>(
    ['controlled-tasks', 'list', listQuery],
    '/api/tasks',
    { query: listQuery },
    { refetchInterval: 5_000 },
  );
  const facetTasks = useMemo(() => (facetRaw ?? []).map((task) => normalizeControlledTask(task)), [facetRaw]);
  const tasks = useMemo(() => (apiTasksRaw ?? []).map((task) => normalizeControlledTask(task)), [apiTasksRaw]);

  const transition = useApiMutation<ControlledTask, { id: string; stage: TaskLifecycleStage; actor: string; version?: number }>(({ id }) => `/api/tasks/${id}/transition`, { onSuccess: () => setMessage('任务状态已更新。'), onError: (err) => setMessage(err instanceof Error ? err.message : '状态流转失败，请重试。') });
  const create = useApiMutation<ControlledTask, { title: string; priority: Priority; actor: string }>('/api/tasks', { onSuccess: (task) => { setNewTaskOpen(false); setNewTitle(''); setSelected(normalizeControlledTask(task)); setMessage('已创建任务。'); }, onError: (err) => setMessage(err instanceof Error ? err.message : '创建任务失败，请重试。') });

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify({ filters, view })); }, [filters, view]);

  const counts = useMemo(() => ({
    pending: facetTasks.filter((task) => task.lifecycleStage === 'pending').length,
    human_action: facetTasks.filter((task) => task.lifecycleStage === 'human_action' || task.governance.approvalStatus === 'pending').length,
    risk: facetTasks.filter((task) => task.lifecycleStage === 'risk' || isRiskTask(task.sla)).length,
    conversation: facetTasks.filter((task) => task.source === 'conversation' || Boolean(task.links.conversationId)).length,
  }), [facetTasks]);
  const applyPreset = (preset: TaskPreset) => setFilters({
    ...defaultTaskFilters,
    stage: preset === 'pending' ? 'pending' : preset === 'human_action' ? 'human_action' : 'all',
    risk: preset === 'risk' ? 'attention' : 'all',
    source: preset === 'conversation' ? 'conversation' : 'all',
    assignee: role === 'user' ? actor : 'all',
  });
  const openTask = (task: ControlledTask) => { setSelected(task); setMessage(null); };
  const closeDrawer = useCallback(() => {
    setSelected(null);
    if (!searchParams.has('task') && searchParams.get('risk') !== 'attention') return;
    const next = new URLSearchParams(searchParams);
    next.delete('task');
    if (next.get('risk') === 'attention') next.delete('risk');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const moveTask = (task: ControlledTask, stage: TaskLifecycleStage) => {
    if (!canMutate) {
      setMessage('审计只读模式，无法变更任务状态。');
      return;
    }
    transition.mutate({ id: task.id, stage, actor, version: task.version });
  };
  const selectedCurrent = selected
    ? tasks.find((task) => task.id === selected.id) ?? facetTasks.find((task) => task.id === selected.id) ?? selected
    : null;
  const mutationPending = transition.isPending || drawerPending;
  const loading = isLoading || facetLoading;

  useEffect(() => {
    if (!taskCodeFromHome || selected) return;
    const task = facetTasks.find((item) => item.code === taskCodeFromHome) ?? tasks.find((item) => item.code === taskCodeFromHome);
    if (task) setSelected(task);
  }, [facetTasks, tasks, selected, taskCodeFromHome]);

  const errorText = error instanceof Error ? workspaceErrorMessage(error.message) : '请求失败';

  return <main className="task-console px-3 py-3 md:px-4 md:py-4 lg:p-5">
    <div className="task-console-header-panel"><header className="task-console-header"><div><h1>{copy.title}</h1><p>{copy.subtitle}</p></div></header></div>
    <div className="task-console-content-panel">
    <RoleReadonlyBanner />
    <TaskActionSummary counts={counts} onPreset={applyPreset} />
    <TaskToolbar filters={filters} onChange={setFilters} view={view} onViewChange={setView} tasks={facetTasks} onCreate={canMutate ? () => setNewTaskOpen(true) : undefined} />
    {message && <div className="task-feedback" role="status">{message}<button type="button" onClick={() => setMessage(null)}>关闭</button></div>}
    {loading ? <div className="task-loading"><LoaderCircle className="animate-spin" />正在加载协同任务…</div> : error ? <div className="task-loading error" role="alert"><AlertCircle />无法加载任务：{errorText}<button type="button" onClick={() => refetch()}>重试</button></div> : <TaskLifecycleBoard tasks={tasks} view={view} disabled={mutationPending || !canMutate} onOpen={openTask} onTransition={moveTask} />}
    </div>
    <Drawer open={!!selectedCurrent} onClose={closeDrawer} title={selectedCurrent?.title} description={selectedCurrent ? `${selectedCurrent.code} · ${getStageMeta(selectedCurrent.lifecycleStage).label}` : undefined} width={520} className="task-detail-drawer" flush>
      {selectedCurrent && <div className="task-detail-drawer-body"><TaskLifecycleDrawer task={selectedCurrent} onPendingChange={setDrawerPending} /></div>}
    </Drawer>
    {canMutate && (
      <Drawer open={newTaskOpen} onClose={() => setNewTaskOpen(false)} title="新建任务" description="创建后由任务台统一记录状态与审计。" width={440} footer={<button type="button" className="task-create-btn" disabled={!newTitle.trim() || create.isPending} onClick={() => create.mutate({ title: newTitle.trim(), priority: 'P1', actor })}><Plus size={16} />{create.isPending ? '创建中…' : '创建任务'}</button>}><label className="task-new-label">任务标题<Input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="描述需要与数字伙伴协同处置的事项" /></label></Drawer>
    )}
  </main>;
}
