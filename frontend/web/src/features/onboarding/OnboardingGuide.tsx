import { useEffect, useState } from 'react';
import {
  Activity, ArrowRight, BookOpen, Bot, Brain, BrainCircuit, BriefcaseBusiness,
  CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, ListChecks,
  Send, ShieldCheck, Sparkles, Wrench, X,
} from 'lucide-react';
import { Button } from '@de/web-ui';
import { cn } from '@de/web-utils';
import type { Role } from '@de/web-types';
import { resolveAppRole, type AppRole } from '@/features/role-nav/role-nav';

type OnboardingGuideProps = {
  open: boolean;
  onClose: () => void;
  role?: Role;
};

/** 管理员侧栏预览（默认向导） */
export const PREVIEW_NAV_GROUPS = [
  { label: null, items: ['运营总览'] },
  { label: '协作', items: ['专家协作', '任务中心'] },
  { label: '编排', items: ['工作伙伴', '工作流程'] },
  { label: '能力', items: ['模型服务', '知识中心', '技能中心', '记忆中心', '消息渠道'] },
] as const;

export const PREVIEW_NAV_BY_ROLE: Record<AppRole, ReadonlyArray<{ label: string | null; items: readonly string[] }>> = {
  admin: PREVIEW_NAV_GROUPS,
  user: [
    { label: null, items: ['运营总览'] },
    { label: '协作', items: ['专家协作', '我的待办'] },
    { label: '编排', items: ['工作伙伴', '工作流程'] },
    { label: '能力', items: ['知识检索', '技能清单'] },
  ],
  auditor: [
    { label: null, items: ['运营总览'] },
    { label: '审计', items: ['审计中心', '持续验证'] },
    { label: '核查', items: ['任务核查', '协作记录', '伙伴档案', '流程版本', '知识引用', '技能权限', '记忆策略', '模型审计'] },
  ],
};

export const VALUE_CARDS = [
  {
    icon: ShieldCheck,
    title: '安全受控执行',
    description: '持续验证、访问控制与审批贯穿关键操作，守住身份、数据与执行边界。',
  },
  {
    icon: Bot,
    title: '能力资产统一',
    description: '模型、知识、技能、记忆与消息渠道统一接入，供数字伙伴复用编排。',
  },
  {
    icon: ClipboardCheck,
    title: '全过程可追溯',
    description: '协作、任务、上岗与审计证据关联，支持复核、运营与合规导出。',
  },
];

export const JOURNEY_CARDS = [
  {
    number: '01',
    title: '能力接入',
    description: '配置模型服务、知识、技能、记忆与消息渠道，建立可调用的能力基础。',
  },
  {
    number: '02',
    title: '编排上岗',
    description: '组合数字伙伴与工作流程，完成试运行、评测与双重审批后上岗。',
  },
  {
    number: '03',
    title: '受控运营',
    description: '在任务协作、持续验证与审计中心保护下开展日常执行与治理。',
  },
];

const ROLE_WELCOME: Record<AppRole, { title: string; body: string; journeyTitle: string; journeyBody: string }> = {
  user: {
    title: '从专家协作与待办开始',
    body: '日常以专家协作为主入口，用「我的待办」处理审批，用知识检索与技能清单辅助调用。',
    journeyTitle: '完成一次受控协作',
    journeyBody: '发起协作 → 处理待办 → 引用知识与技能，全程可追溯。',
  },
  admin: {
    title: '让数字伙伴在受控边界内协同工作',
    body: '从能力接入、编排上岗到受控运营，统一身份权限、记忆渠道与审计证据。',
    journeyTitle: '建立数字伙伴执行闭环',
    journeyBody: '沿「能力 → 编排 → 运营」完成企业级数字伙伴启用。',
  },
  auditor: {
    title: '以审计与核查为中心',
    body: '侧栏直达审计中心与持续验证，并对任务、协作与能力进行只读核查。',
    journeyTitle: '完成一次合规核查',
    journeyBody: '审计中心检索证据 → 持续验证看裁决 → 任务/能力核查复核。',
  },
};

const BRAND = 'var(--brand)';

export function OnboardingGuide({ open, onClose, role }: OnboardingGuideProps) {
  const [page, setPage] = useState<1 | 2>(1);
  const appRole = resolveAppRole(role);
  const welcome = ROLE_WELCOME[appRole];
  const previewNav = PREVIEW_NAV_BY_ROLE[appRole];

  useEffect(() => {
    if (open) setPage(1);
  }, [open]);

  if (!open) return null;

  const isJourney = page === 2;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-3 backdrop-blur-md sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <section className="grid w-full max-w-6xl grid-cols-1 overflow-hidden rounded-[24px] border border-white/80 bg-white/70 shadow-[0_24px_72px_rgba(15,23,42,0.28)] backdrop-blur-2xl sm:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:grid-cols-[minmax(0,1.1fr)_minmax(400px,0.9fr)]">
        <PlatformPreview page={page} navGroups={previewNav} />

        <div className="relative flex flex-col border-l border-white/70 bg-[color-mix(in_srgb,var(--brand)_6%,white)] p-4 sm:p-5 lg:p-7">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-white/70 hover:text-[var(--text)] sm:right-4 sm:top-4 sm:h-8 sm:w-8"
            aria-label="关闭引导"
          >
            <X className="h-4 w-4" />
          </button>

          {!isJourney ? (
            <div className="pr-7 sm:pr-9">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--brand)] sm:gap-2 sm:text-xs">
                <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                企智搭 · 数字伙伴平台
              </div>
              <p className="mt-3 text-xs font-medium text-[var(--text-secondary)] sm:mt-4 sm:text-sm">欢迎进入企智搭 · 数字伙伴平台</p>
              <h1 id="onboarding-title" className="mt-1.5 max-w-md text-base font-semibold leading-snug text-[var(--brand)] sm:text-[26px] sm:leading-tight">
                {welcome.title}
              </h1>
              <p className="mt-2 max-w-md text-[11px] leading-5 text-[var(--text-secondary)] sm:mt-3 sm:text-[13px] sm:leading-5">
                {welcome.body}
              </p>
            </div>
          ) : (
            <div className="pr-7 sm:pr-9">
              <div className="text-[10px] font-semibold text-[var(--brand)] sm:text-xs">核心路径</div>
              <h1 id="onboarding-title" className="mt-3 text-base font-semibold leading-snug text-[var(--brand)] sm:mt-4 sm:text-[26px] sm:leading-tight">
                {welcome.journeyTitle}
              </h1>
              <p className="mt-2 max-w-md text-[11px] leading-5 text-[var(--text-secondary)] sm:mt-3 sm:text-[13px] sm:leading-5">
                {welcome.journeyBody}
              </p>
            </div>
          )}

          <div className="mt-4 space-y-2 sm:mt-5 sm:space-y-2.5">
            {isJourney
              ? JOURNEY_CARDS.map((item) => (
                  <div
                    key={item.number}
                    className="flex gap-2.5 rounded-xl border border-white/90 bg-white/75 px-3 py-2.5 shadow-[0_8px_20px_rgba(79,70,229,0.08)] sm:gap-3 sm:px-3.5 sm:py-3"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--brand-light)] text-[9px] font-semibold text-[var(--brand)] sm:h-7 sm:w-7 sm:text-[10px]">
                      {item.number}
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-xs font-semibold text-[var(--text)] sm:text-[13px]">{item.title}</h2>
                      <p className="mt-0.5 text-[10px] leading-4 text-[var(--text-secondary)] sm:text-[11px] sm:leading-5">{item.description}</p>
                    </div>
                  </div>
                ))
              : VALUE_CARDS.map(({ icon: Icon, title, description }) => (
                  <div
                    key={title}
                    className="flex gap-2.5 rounded-xl border border-white/90 bg-white/75 px-3 py-2.5 shadow-[0_8px_20px_rgba(79,70,229,0.08)] sm:gap-3 sm:px-3.5 sm:py-3"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--brand-light)] text-[var(--brand)] sm:h-7 sm:w-7">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-xs font-semibold text-[var(--text)] sm:text-[13px]">{title}</h2>
                      <p className="mt-0.5 text-[10px] leading-4 text-[var(--text-secondary)] sm:text-[11px] sm:leading-5">{description}</p>
                    </div>
                  </div>
                ))}
          </div>

          <div className="mt-5 flex items-center gap-1.5 sm:mt-6 sm:gap-3">
            <div className="mr-auto flex items-center gap-1 text-[10px] font-medium text-[var(--text-muted)] sm:text-xs">
              <button
                type="button"
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-white/70 hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="上一页"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-7 text-center">{page}/2</span>
              <button
                type="button"
                onClick={() => setPage(2)}
                disabled={page === 2}
                className="grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-white/70 hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="下一页"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            {!isJourney && <Button variant="ghost" onClick={onClose}>跳过</Button>}
            {isJourney ? (
              <Button onClick={onClose}>开始使用<CheckCircle2 className="h-3.5 w-3.5" /></Button>
            ) : (
              <Button onClick={() => setPage(2)}>下一步<ArrowRight className="h-3.5 w-3.5" /></Button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function PlatformPreview({
  page,
  navGroups,
}: {
  page: 1 | 2;
  navGroups: ReadonlyArray<{ label: string | null; items: readonly string[] }>;
}) {
  const flat = navGroups.flatMap((g) => [...g.items]);
  const active = page === 1 ? (flat.find((i) => /知识|技能|模型|审计/.test(i)) ?? flat[0]) : (flat.find((i) => /工作伙伴|任务|伙伴/.test(i)) ?? flat[1] ?? flat[0]);
  return (
    <div className="relative hidden self-stretch overflow-hidden bg-[color-mix(in_srgb,var(--brand)_8%,#f8fafc)] p-3 sm:block sm:p-5 lg:p-7">
      <div className="flex h-full min-h-0 overflow-hidden rounded-2xl border border-white/90 bg-white/85 shadow-[0_16px_36px_rgba(79,70,229,0.10)]">
        <PreviewNavigation active={active} navGroups={navGroups} />
        <div className="min-w-0 flex-1 overflow-hidden p-2.5 sm:p-4">
          {page === 1 ? (
            <>
              <PreviewHeader title="能力与核查" detail="按角色展示消费、供给或审计入口" />
              <CapabilitiesThumbnail />
            </>
          ) : (
            <>
              <PreviewHeader title="协同闭环" detail="协作 · 待办 · 编排 · 受控运营" />
              <OrchestrationThumbnail />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewNavigation({
  active,
  navGroups,
}: {
  active: string;
  navGroups: ReadonlyArray<{ label: string | null; items: readonly string[] }>;
}) {
  return (
    <aside className="hidden w-[112px] shrink-0 flex-col border-r border-[color-mix(in_srgb,var(--brand)_12%,transparent)] bg-white/80 p-2.5 lg:flex lg:w-[132px]">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--brand)]">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--brand)] text-[9px] font-bold text-white">DE</span>
        <span className="hidden lg:inline">Digital</span>
      </div>
      <div className="mt-4 space-y-2">
        {navGroups.map((group) => (
          <div key={group.label ?? 'root'}>
            {group.label && (
              <div className="mb-1 px-1.5 text-[8px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <div
                  key={item}
                  className={cn(
                    'rounded-md px-1.5 py-1 text-[9px] leading-tight',
                    item === active
                      ? 'bg-[var(--brand-light)] font-semibold text-[var(--brand)]'
                      : 'text-[var(--text-muted)]',
                  )}
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-auto rounded-md bg-[color-mix(in_srgb,var(--brand)_6%,white)] px-2 py-1.5 text-[9px] text-[var(--text-muted)]">
        平台设置 · 治理
      </div>
    </aside>
  );
}

function PreviewHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[color-mix(in_srgb,var(--brand)_12%,transparent)] pb-2.5 sm:pb-3">
      <div>
        <div className="text-[11px] font-semibold text-[var(--text)] sm:text-sm">{title}</div>
        <div className="mt-0.5 text-[9px] text-[var(--text-muted)]">{detail}</div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="rounded-md border border-[color-mix(in_srgb,var(--brand)_22%,transparent)] bg-[var(--brand-light)] px-2 py-1 text-[9px] text-[var(--brand)]">
          生产
        </span>
        <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
      </div>
    </div>
  );
}

function CapabilitiesThumbnail() {
  const capabilities = [
    { icon: Brain, label: '模型', value: '06' },
    { icon: BookOpen, label: '知识', value: '24' },
    { icon: BrainCircuit, label: '记忆', value: '18' },
    { icon: Send, label: '渠道', value: '05' },
  ];
  return (
    <div className="pt-3 sm:pt-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {capabilities.map(({ icon: Icon, label, value }) => (
          <div
            key={label}
            className="rounded-xl border border-[color-mix(in_srgb,var(--brand)_14%,transparent)] bg-white p-2.5 shadow-[0_4px_12px_rgba(79,70,229,0.05)] sm:p-3"
          >
            <Icon className="h-3.5 w-3.5 text-[var(--brand)]" />
            <div className="mt-3 text-lg font-semibold text-[var(--text)] sm:text-xl">{value}</div>
            <div className="mt-0.5 text-[9px] text-[var(--text-muted)] sm:text-[10px]">{label}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--brand)_14%,transparent)] bg-white p-2.5 sm:p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--text)] sm:text-xs">
            <Wrench className="h-3 w-3 text-[var(--brand)]" />
            技能与渠道就绪
          </div>
          <span className="text-[9px] text-[var(--brand)]">12 项已准入</span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <div className="h-1.5 rounded-full bg-[var(--brand)]" />
          <div className="h-1.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--brand) 70%, white)' }} />
          <div className="h-1.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--brand) 40%, white)' }} />
          <div className="h-1.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--brand) 18%, white)' }} />
        </div>
      </div>
    </div>
  );
}

function OrchestrationThumbnail() {
  const employees = [
    { name: '客服协同助理', state: '已上岗', icon: BriefcaseBusiness },
    { name: '合同审核员', state: '待审批', icon: ListChecks },
    { name: '知识运营员', state: '试运行', icon: Bot },
  ];
  return (
    <div className="pt-3 sm:pt-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <PreviewMetric label="在岗" value="08" />
        <PreviewMetric label="待上岗" value="03" />
        <PreviewMetric label="任务中" value="12" />
      </div>
      <div className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--brand)_14%,transparent)] bg-white p-2.5 sm:p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-medium text-[var(--text)] sm:text-xs">上岗队列</span>
          <Activity className="h-3.5 w-3.5 text-[var(--brand)]" />
        </div>
        <div className="space-y-2">
          {employees.map((item, index) => (
            <div key={item.name} className="flex items-center gap-2 rounded-md bg-[color-mix(in_srgb,var(--brand)_5%,white)] px-2 py-2">
              <span className="grid h-5 w-5 place-items-center rounded bg-[var(--brand-light)] text-[9px] font-semibold text-[var(--brand)]">
                {index + 1}
              </span>
              <item.icon className="hidden h-3 w-3 text-[var(--brand)] sm:block" />
              <span className="min-w-0 flex-1 truncate text-[9px] text-[var(--text)] sm:text-[10px]">{item.name}</span>
              <span className="text-[9px] text-[var(--brand)]">{item.state}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl border border-[color-mix(in_srgb,var(--brand)_22%,transparent)] bg-[var(--brand-light)] px-2.5 py-2 text-[9px] text-[var(--brand)] sm:px-3 sm:py-2.5 sm:text-[10px]">
        <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" />持续验证</span>
        <span className="inline-flex items-center gap-1"><ClipboardCheck className="h-3 w-3" />审计已关联</span>
      </div>
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[color-mix(in_srgb,var(--brand)_14%,transparent)] bg-white p-2 sm:p-3">
      <div className="text-[9px] text-[var(--text-muted)] sm:text-[10px]">{label}</div>
      <div className="mt-1 text-base font-semibold sm:mt-2 sm:text-lg" style={{ color: BRAND }}>{value}</div>
    </div>
  );
}
