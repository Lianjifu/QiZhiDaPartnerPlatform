import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@qzda/web-ui';
import { Modal } from '@/components/shared';
import { DigitalPartnerAvatar } from '@/components/DigitalPartnerAvatar';
import { useApiMutation, useApiQuery } from '@/services/query';
import { compareDigitalPartners, employeePrimaryLabel, employeeSecondaryLabel, isDepartmentHead } from '@/lib/digital-employees';
import type { DigitalPartner, Task } from '@qzda/web-types';
import { MessageSquare, Network, SendHorizontal, UsersRound } from 'lucide-react';
import { cn } from '@qzda/web-utils';

type DispatchKind = 'assign' | 'assist';

function lifecycleTone(lifecycle: DigitalPartner['lifecycle']): 'success' | 'warn' | 'neutral' | 'error' | 'info' {
  if (lifecycle === 'active') return 'success';
  if (lifecycle === 'pending_approval' || lifecycle === 'testing') return 'warn';
  if (lifecycle === 'quarantined') return 'error';
  if (lifecycle === 'paused') return 'info';
  return 'neutral';
}

function lifecycleLabel(lifecycle: DigitalPartner['lifecycle']) {
  return ({
    draft: '草稿',
    testing: '试运行',
    pending_approval: '待确认上岗',
    active: '已上岗',
    paused: '已暂停',
    quarantined: '已隔离',
  } as const)[lifecycle];
}

export function DepartmentTeamPanel({ head }: { head: DigitalPartner }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: employees = [] } = useApiQuery<DigitalPartner[]>(['digital-employees'], '/api/partners');
  const [mode, setMode] = useState<DispatchKind | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);

  const departmentMembers = useMemo(
    () => employees
      .filter((item) => item.department === head.department && item.id !== head.id && !isDepartmentHead(item))
      .sort(compareDigitalPartners),
    [employees, head.department, head.id],
  );
  const assistCandidates = useMemo(
    () => employees
      .filter((item) => item.department !== head.department && item.lifecycle === 'active' && !isDepartmentHead(item))
      .sort(compareDigitalPartners),
    [employees, head.department],
  );
  const onDuty = departmentMembers.filter((item) => item.lifecycle === 'active');
  const anomalies = onDuty.filter((item) => item.runtime.anomalies > 0).length;

  const openDispatch = (kind: DispatchKind, employeeId?: string) => {
    setMode(kind);
    setTargetId(employeeId ?? null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">部门班组</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
          对本部门专家可直接派工；跨部门仅能发起协办请求，经对方确认或任务域审批后进入协同。
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
          <div className="text-[11px] text-[var(--text-muted)]">班组成员</div>
          <div className="mt-1 text-sm font-semibold tabular-nums">{departmentMembers.length}</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
          <div className="text-[11px] text-[var(--text-muted)]">可派工（在岗）</div>
          <div className="mt-1 text-sm font-semibold tabular-nums">{onDuty.length}</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
          <div className="text-[11px] text-[var(--text-muted)]">运行异常</div>
          <div className="mt-1 text-sm font-semibold tabular-nums">{anomalies}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!onDuty.length} onClick={() => openDispatch('assign')}>
          <SendHorizontal className="h-3.5 w-3.5" />本部门派工
        </Button>
        <Button size="sm" variant="secondary" disabled={!assistCandidates.length} onClick={() => openDispatch('assist')}>
          <Network className="h-3.5 w-3.5" />请跨部门协办
        </Button>
        <Button size="sm" variant="ghost" onClick={() => navigate(`/tasks?task=${encodeURIComponent(employeePrimaryLabel(head))}`)}>
          查看调度任务
        </Button>
      </div>

      <div className="space-y-2">
        {departmentMembers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--text-muted)]">
            本部门暂无其他数字伙伴。
          </p>
        ) : departmentMembers.map((member) => (
          <article key={member.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <DigitalPartnerAvatar employee={member} size={36} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{employeePrimaryLabel(member)}</span>
                  <Badge tone={lifecycleTone(member.lifecycle)}>{lifecycleLabel(member.lifecycle)}</Badge>
                  {member.runtime.anomalies > 0 && <Badge tone="warn">异常 {member.runtime.anomalies}</Badge>}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{employeeSecondaryLabel(member)} · 交接 {member.runtime.handoffs24h}/24h</p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {member.lifecycle === 'active' && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => openDispatch('assign', member.id)}>
                    派工
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/copilot?employeeId=${member.id}`)}>
                    <MessageSquare className="h-3.5 w-3.5" />协作
                  </Button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>

      {mode && (
        <HeadDispatchModal
          head={head}
          kind={mode}
          employees={mode === 'assign' ? onDuty : assistCandidates}
          initialTargetId={targetId}
          onClose={() => { setMode(null); setTargetId(null); }}
          onCreated={(task) => {
            queryClient.invalidateQueries({ queryKey: ['controlled-tasks'] });
            queryClient.invalidateQueries({ queryKey: ['tasks'] });
            setMode(null);
            setTargetId(null);
            navigate(`/tasks?task=${encodeURIComponent(task.code)}`);
          }}
        />
      )}
    </div>
  );
}

function HeadDispatchModal({
  head,
  kind,
  employees,
  initialTargetId,
  onClose,
  onCreated,
}: {
  head: DigitalPartner;
  kind: DispatchKind;
  employees: DigitalPartner[];
  initialTargetId: string | null;
  onClose: () => void;
  onCreated: (task: Task) => void;
}) {
  const [targetId, setTargetId] = useState(initialTargetId ?? employees[0]?.id ?? '');
  const [title, setTitle] = useState(kind === 'assign' ? `${head.department}派工 · ` : `跨部门协办 · `);
  const [description, setDescription] = useState(
    kind === 'assign'
      ? `由${head.name}向本部门专家派工，请在岗位授权范围内完成并回报结果。`
      : `由${head.name}发起跨部门协办请求；对方确认后方可开始协同，不得绕过对方岗位边界与任务域审批。`,
  );
  const [message, setMessage] = useState<string | null>(null);
  const create = useApiMutation<Task, Partial<Task>>('/api/tasks', {
    onSuccess: onCreated,
    onError: () => setMessage('创建失败，请检查必填项后重试。'),
  });

  const target = employees.find((item) => item.id === targetId);
  const submit = () => {
    if (!target || !title.trim()) {
      setMessage('请选择专家并填写目标。');
      return;
    }
    const crossDept = kind === 'assist';
    create.mutate({
      title: title.trim(),
      description: description.trim(),
      priority: crossDept ? 'P2' : 'P1',
      status: crossDept ? 'review' : 'pending',
      assignee: target.owner,
      digitalPartnerId: target.id,
      digitalPartnerName: employeePrimaryLabel(target),
      agentId: target.capabilities.agentId,
      coordinatorId: head.id,
      coordinatorName: employeePrimaryLabel(head),
      dispatchKind: kind,
      collaboratorIds: crossDept ? [target.id] : undefined,
      collaboratorNames: crossDept ? [employeePrimaryLabel(target)] : undefined,
      assistStatus: crossDept ? 'pending' : 'not_required',
      tags: crossDept ? ['协办', target.department] : ['派工', head.department],
      progress: { done: 0, total: crossDept ? 2 : 3 },
      slaRemainingMin: crossDept ? 360 : 180,
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={kind === 'assign' ? '本部门派工' : '请跨部门协办'}
      description={kind === 'assign' ? '直接分派给本部门在岗专家，形成可追溯任务。' : '向其他部门在岗专家发起协办；需对方确认或任务域审批后执行。'}
      size="md"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button loading={create.isPending} disabled={!targetId || !title.trim()} onClick={submit}>
            {kind === 'assign' ? '确认派工' : '发起协办'}
          </Button>
        </>
      )}
    >
      <div className="grid gap-4">
        <label className="grid gap-1.5 text-xs font-medium">
          {kind === 'assign' ? '本部门专家' : '协办专家'}
          <select
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-xs outline-none focus:border-[var(--brand)]"
          >
            {employees.map((item) => (
              <option key={item.id} value={item.id}>
                {employeePrimaryLabel(item)} · {employeeSecondaryLabel(item)}
              </option>
            ))}
          </select>
        </label>
        {target && (
          <div className={cn('flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs text-[var(--text-secondary)]')} style={{ boxShadow: 'var(--saas-ring)' }}>
            <DigitalPartnerAvatar employee={target} size={32} />
            <div>
              <div className="font-medium text-[var(--text)]">{employeePrimaryLabel(target)}</div>
              <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{employeeSecondaryLabel(target)} · 风险 {target.risk === 'high' ? '高' : target.risk === 'medium' ? '中' : '低'}</div>
            </div>
          </div>
        )}
        <label className="grid gap-1.5 text-xs font-medium">
          目标标题
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-xs outline-none focus:border-[var(--brand)]"
            placeholder="说明要完成的业务目标"
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium">
          说明与边界
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-normal leading-5 outline-none focus:border-[var(--brand)]"
          />
        </label>
        {kind === 'assist' && (
          <p className="rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-light)] px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)]">
            跨部门协办不会直接授予对方写权限；对方确认后，仍按该专家岗位授权契约执行。
          </p>
        )}
        {message && <p role="alert" className="text-xs text-[var(--danger)]">{message}</p>}
      </div>
    </Modal>
  );
}

export function DepartmentTeamTabLabel() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <UsersRound className="h-3 w-3" />
      部门班组
    </span>
  );
}
