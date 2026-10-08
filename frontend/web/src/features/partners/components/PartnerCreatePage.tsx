/**
 * 新建 / 完善数字伙伴：分步完成基本信息 → 岗位配置 → 能力装配 → 上岗发布。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import type { DigitalPartner } from '@qzda/web-types';
import { Badge, Button } from '@qzda/web-ui';
import { ArrowLeft, CheckCircle2, Circle, Save } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { roleCanMutate } from '@/features/role-nav/role-nav';
import {
  capabilityAssemblyCompleteness,
  releaseOnboardingCompleteness,
  roleSetupCompleteness,
} from '@/features/partners/lib/partners';
import { EmployeeConfigurationWorkbench, type EmbeddedSaveHandle } from './PartnersTab.Onboarding';
import { ContextualEmployeeDetail } from './PartnersTab.Detail';
import { DeleteUnreleasedPartnerButton } from './PartnersDelete';
import { EmployeeAvatar, lifecycleMeta } from './PartnersShared';
import { usePartnerBuiltinToolNames } from '../hooks/usePartnerBuiltinToolNames';

type WizardStep = 'identity' | 'role' | 'capability' | 'release';

const STEPS: Array<{ key: WizardStep; index: string; label: string; hint: string; goal: string }> = [
  { key: 'identity', index: '01', label: '基本信息', hint: '花名、岗位与部门', goal: '建立数字伙伴档案' },
  { key: 'role', index: '02', label: '岗位配置', hint: '档案、职责与接管', goal: '写清可做与不可做' },
  { key: 'capability', index: '03', label: '能力装配', hint: '模型、资产与授权', goal: '绑定可执行能力' },
  { key: 'release', index: '04', label: '上岗发布', hint: '评测、申请与确认', goal: '通过门禁后上岗' },
];

export default function PartnerCreatePage() {
  const builtinToolNames = usePartnerBuiltinToolNames();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canMutate = roleCanMutate(useAuthStore((s) => s.user?.role));
  const partnerId = params.get('id') || '';
  const stepParam = (params.get('step') as WizardStep | null) || (partnerId ? 'role' : 'identity');

  const { data: employees = [], refetch } = useApiQuery<DigitalPartner[]>(['digital-employees'], '/api/partners');
  const employee = employees.find((item) => item.id === partnerId) ?? null;

  const [step, setStep] = useState<WizardStep>(STEPS.some((item) => item.key === stepParam) ? stepParam : 'identity');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [department, setDepartment] = useState('');
  const [description, setDescription] = useState('');
  const [gateHint, setGateHint] = useState<string | null>(null);
  const [stepSave, setStepSave] = useState<EmbeddedSaveHandle | null>(null);
  const bindSave = useCallback((handle: EmbeddedSaveHandle | null) => setStepSave(handle), []);

  const createEmployee = useApiMutation<DigitalPartner, Partial<DigitalPartner>>('/api/partners', {
    invalidateKeys: [['digital-employees'], ['digital-employees', 'overview']],
    onSuccess: (created) => {
      setParams({ id: created.id, step: 'role' }, { replace: true });
      setStep('role');
      setGateHint(null);
      void refetch();
    },
  });

  const patchIdentity = useApiMutation<DigitalPartner, Partial<DigitalPartner>>(
    () => `/api/partners/${partnerId}`,
    {
      invalidateKeys: [['digital-employees'], ['digital-employees', 'overview']],
      onSuccess: () => {
        setGateHint(null);
        void refetch();
      },
    },
    'PATCH',
  );

  useEffect(() => {
    const next = STEPS.some((item) => item.key === stepParam) ? stepParam : 'identity';
    if (!partnerId && next !== 'identity') {
      setStep('identity');
      return;
    }
    setStep(next);
  }, [partnerId, stepParam]);

  useEffect(() => {
    if (!employee) return;
    setName(employee.name);
    setRole(employee.role);
    setDepartment(employee.department);
    setDescription(employee.description ?? '');
  }, [employee?.id]);

  if (!canMutate) return <Navigate to="/partners" replace />;

  const roleMeta = employee ? roleSetupCompleteness(employee) : null;
  const capMeta = employee ? capabilityAssemblyCompleteness(employee, builtinToolNames) : null;
  const releaseMeta = employee ? releaseOnboardingCompleteness(employee, builtinToolNames) : null;
  const roleReady = Boolean(roleMeta?.ready);
  const capReady = Boolean(capMeta?.ready);
  const released = releaseMeta?.stage === 'released';
  const currentIndex = STEPS.findIndex((item) => item.key === step);
  const currentDef = STEPS[currentIndex] ?? STEPS[0];

  const stepState = (key: WizardStep): 'done' | 'current' | 'todo' | 'blocked' => {
    if (key === step) return 'current';
    if (key === 'identity') return partnerId ? 'done' : 'todo';
    if (!partnerId) return 'blocked';
    if (key === 'role') return roleReady ? 'done' : 'todo';
    if (key === 'capability') return capReady ? 'done' : roleReady ? 'todo' : 'blocked';
    return released ? 'done' : capReady ? 'todo' : 'blocked';
  };

  const go = (next: WizardStep) => {
    if (next !== 'identity' && !partnerId) return;
    if (next === 'capability' && !roleReady) {
      setGateHint('请先保存并补齐岗位配置，再进入能力装配。');
      return;
    }
    if (next === 'release' && !capReady) {
      setGateHint('请先保存并补齐能力装配，再进入上岗发布。');
      return;
    }
    setGateHint(null);
    setStep(next);
    const nextParams: Record<string, string> = { step: next };
    if (partnerId) nextParams.id = partnerId;
    setParams(nextParams, { replace: true });
  };

  const identityFields = () => ({
    name: name.trim(),
    role: role.trim(),
    department: department.trim(),
    description: description.trim(),
  });

  const identityValid = Boolean(name.trim() && role.trim() && department.trim());

  const saveIdentity = (thenGoRole = false) => {
    if (!identityValid || !partnerId || patchIdentity.isPending) return;
    patchIdentity.mutate(identityFields(), {
      onSuccess: () => {
        setGateHint(null);
        void refetch();
        if (thenGoRole) go('role');
      },
    });
  };

  const advance = () => {
    if (step === 'identity') {
      if (!identityValid || createEmployee.isPending) return;
      if (partnerId) {
        saveIdentity(true);
        return;
      }
      createEmployee.mutate({
        ...identityFields(),
        risk: 'low',
        responsibilities: ['待配置岗位职责'],
        prohibitedActions: ['待配置禁止行为'],
      });
      return;
    }
    if (step === 'role') {
      if (!roleReady) {
        setGateHint(roleMeta?.missing.length ? `请先保存本步，并补齐：${roleMeta.missing.join('、')}` : '请先保存并补齐岗位配置。');
        return;
      }
      go('capability');
      return;
    }
    if (step === 'capability') {
      if (!capReady) {
        setGateHint(capMeta?.missing.length ? `请先保存本步，并补齐：${capMeta.missing.join('、')}` : '请先保存并补齐能力装配。');
        return;
      }
      go('release');
    }
  };

  const back = () => {
    if (step === 'identity') {
      navigate('/partners');
      return;
    }
    const order: WizardStep[] = ['identity', 'role', 'capability', 'release'];
    go(order[Math.max(0, order.indexOf(step) - 1)]);
  };

  const primaryLabel = step === 'identity'
    ? (partnerId ? '进入岗位配置' : '创建并进入岗位配置')
    : step === 'role'
      ? '下一步：能力装配'
      : step === 'capability'
        ? '下一步：上岗发布'
        : released
          ? '完成并返回目录'
          : '稍后继续';

  const primaryDisabled = step === 'identity'
    ? (!identityValid || createEmployee.isPending)
    : step === 'release'
      ? false
      : !employee;

  return (
    <div className="de-partner-wizard">
      <header className="de-partner-wizard__top">
        <div className="min-w-0">
          <Link to="/partners" className="de-partner-wizard__back">
            <ArrowLeft className="h-3.5 w-3.5" />返回数字伙伴
          </Link>
          <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
            <h1>{partnerId ? '完善数字伙伴' : '新建数字伙伴'}</h1>
            <p>第 {currentIndex + 1} / {STEPS.length} 步 · {currentDef.label}</p>
          </div>
        </div>
        {employee && (
          <div className="de-partner-wizard__who">
            <EmployeeAvatar employee={employee} size={36} />
            <div className="min-w-0">
              <strong>{employee.name}</strong>
              <span>{employee.role} · {employee.department}</span>
            </div>
            <Badge tone={lifecycleMeta[employee.lifecycle].tone}>{lifecycleMeta[employee.lifecycle].label}</Badge>
          </div>
        )}
      </header>

      <div className="de-partner-wizard__body">
        <ol className="de-partner-wizard__rail" aria-label="新建步骤">
          {STEPS.map((item, index) => {
            const state = stepState(item.key);
            const locked = state === 'blocked';
            const statusText = state === 'done'
              ? (item.key === 'identity' ? '可继续编辑' : item.key === 'role' ? roleMeta?.label : item.key === 'capability' ? capMeta?.label : releaseMeta?.label)
              : state === 'current'
                ? '进行中'
                : locked
                  ? '待上一步完成'
                  : '未开始';
            return (
              <li key={item.key} className={cn(index < STEPS.length - 1 && 'has-line')}>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => !locked && go(item.key)}
                  className={cn('de-partner-wizard__step', `is-${state}`)}
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

        <section className="de-partner-wizard__main">
          {step === 'identity' && (
            <IdentityStep
              editing={Boolean(partnerId)}
              name={name}
              role={role}
              department={department}
              description={description}
              setName={setName}
              setRole={setRole}
              setDepartment={setDepartment}
              setDescription={setDescription}
            />
          )}
          {step === 'role' && employee && (
            <EmployeeConfigurationWorkbench employee={employee} open layout="inline" embedded mode="role" onClose={() => navigate('/partners')} onSaved={() => { setGateHint(null); void refetch(); }} onBindSave={bindSave} />
          )}
          {step === 'capability' && employee && (
            <EmployeeConfigurationWorkbench employee={employee} open layout="inline" embedded mode="capability" onClose={() => navigate('/partners')} onSaved={() => { setGateHint(null); void refetch(); }} onBindSave={bindSave} />
          )}
          {step === 'release' && employee && (
            <ContextualEmployeeDetail
              employee={employee}
              context="release"
              layout="inline"
              onClose={() => navigate('/partners')}
              onGoToModule={(tab) => go(tab === 'roleSetup' ? 'role' : 'capability')}
            />
          )}
          {step !== 'identity' && !employee && (
            <p className="px-1 text-sm text-[var(--text-muted)]">正在载入数字伙伴…</p>
          )}
        </section>
      </div>

      <footer className="de-partner-wizard__foot">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={back}>{step === 'identity' && !partnerId ? '取消' : '上一步'}</Button>
          {employee && <DeleteUnreleasedPartnerButton employee={employee} onDeleted={() => navigate('/partners')} />}
        </div>
        <div className="de-partner-wizard__foot-actions">
          {gateHint && <p className="de-partner-wizard__gate">{gateHint}</p>}
          {partnerId && step !== 'release' && (
            <Button variant="outline" onClick={() => navigate('/partners')}>稍后继续</Button>
          )}
          {step === 'identity' && partnerId && (
            <Button
              variant={identityValid ? 'secondary' : 'outline'}
              disabled={!identityValid || patchIdentity.isPending}
              loading={patchIdentity.isPending}
              onClick={() => saveIdentity(false)}
            >
              <Save className="h-3.5 w-3.5" />保存基本信息
            </Button>
          )}
          {(step === 'role' || step === 'capability') && (
            <Button
              variant={stepSave?.canSave && ((step === 'role' && !roleReady) || (step === 'capability' && !capReady)) ? undefined : 'secondary'}
              disabled={!stepSave || stepSave.pending}
              loading={Boolean(stepSave?.pending)}
              onClick={() => stepSave?.save()}
            >
              <Save className="h-3.5 w-3.5" />保存本步配置
            </Button>
          )}
          {step === 'release' ? (
            <Button onClick={() => navigate('/partners')}>{primaryLabel}</Button>
          ) : (
            <Button
              disabled={primaryDisabled || (step === 'identity' && patchIdentity.isPending)}
              loading={step === 'identity' && (createEmployee.isPending || patchIdentity.isPending)}
              onClick={advance}
            >
              {primaryLabel}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

function IdentityStep({ editing, name, role, department, description, setName, setRole, setDepartment, setDescription }: {
  editing?: boolean;
  name: string; role: string; department: string; description: string;
  setName: (v: string) => void; setRole: (v: string) => void; setDepartment: (v: string) => void; setDescription: (v: string) => void;
}) {
  const fields = useMemo(() => [
    { key: 'name', ok: Boolean(name.trim()) },
    { key: 'role', ok: Boolean(role.trim()) },
    { key: 'department', ok: Boolean(department.trim()) },
  ], [name, role, department]);
  const filled = fields.filter((item) => item.ok).length;

  return (
    <div className="de-partner-wizard__identity">
      <div className="de-partner-wizard__card">
        <div className="de-partner-wizard__card-head">
          <h2>{editing ? '编辑基本信息' : '建立数字伙伴档案'}</h2>
          <p>{editing ? '返回本步可继续修改花名、岗位与部门，保存后立即写入档案。' : '先确认花名与岗位归属。创建后即可在同页完成职责、能力与上岗，不必再回到目录切换 Tab。'}</p>
        </div>
        <div className="de-partner-wizard__fields">
          <Field label="员工名称（花名）" required value={name} onChange={setName} placeholder="例如：听潮" hint="协作会话与目录卡片上展示的名称" />
          <Field label="岗位名称" required value={role} onChange={setRole} placeholder="例如：安全事件分析专员" hint="对应真实业务岗位，而不是技术角色名" />
          <Field label="所属部门" required value={department} onChange={setDepartment} placeholder="例如：信息技术部" hint="用于目录分组与部门负责人协同" />
          <label className="de-partner-wizard__field de-partner-wizard__field--wide">
            <span>岗位说明</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="说明服务对象、业务目标与人工升级条件。" />
            <em>可在下一步岗位档案中继续补充负责人与接管人。</em>
          </label>
        </div>
      </div>
      <aside className="de-partner-wizard__aside">
        <h3>本步完成后</h3>
        <ol>
          <li className={filled >= 3 ? 'is-on' : undefined}><b>01</b><span>档案入库，进入岗位配置</span></li>
          <li><b>02</b><span>写清职责、边界与人工接管</span></li>
          <li><b>03</b><span>装配模型与可执行能力</span></li>
          <li><b>04</b><span>评测通过后申请上岗</span></li>
        </ol>
        <p>必填项已填写 {filled} / 3。创建后可随时返回本页继续。</p>
      </aside>
    </div>
  );
}

function Field({ label, required, value, onChange, placeholder, hint }: {
  label: string; required?: boolean; value: string; onChange: (v: string) => void; placeholder: string; hint?: string;
}) {
  return (
    <label className="de-partner-wizard__field">
      <span>{label}{required ? <i>*</i> : null}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {hint ? <em>{hint}</em> : null}
    </label>
  );
}
