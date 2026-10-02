/**
 * 数字伙伴详情面板：广场/详情 modal 中的 5 个 Tab 内容。
 *
 *  - `ProfileContent` / `StructuredBoundaryContent` / `CapabilityContent`
 *  - `MemoryContent` / `RuntimeContent` — 详情 Tab
 *
 * 边界策略编辑器（`BoundaryPolicyEditor`）与 `resolveBoundaryPolicy` 在 `PartnersDetail.Content`。
 */
import type { DigitalPartner } from '@qzda/web-types';
import { Badge } from '@qzda/web-ui';
import { Database, HeartPulse, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { Metric, executionModeOptions } from './PartnersShared';
import { resolveBoundaryPolicy } from './PartnersDetail.Content';

/** 详情面板：档案。 */
export function ProfileContent({ employee }: { employee: DigitalPartner }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">岗位档案</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">数字伙伴以岗位责任服务业务对象，不以底层模型或技术组件作为业务身份。</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Metric label="花名" value={employee.name} />
        <Metric label="岗位名称" value={employee.role} />
        <Metric label="所属部门" value={employee.department} />
        <Metric label="岗位负责人" value={employee.owner} />
        <Metric label="服务对象" value={employee.serviceObject} />
        <Metric label="人工接管负责人" value={employee.escalationOwner} />
        <Metric label="运行环境" value={employee.environment === 'production' ? '生产' : employee.environment === 'staging' ? '预发' : '沙箱'} />
        <Metric label="风险等级" value={employee.risk === 'low' ? '低风险' : employee.risk === 'medium' ? '中风险' : '高风险'} />
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4 text-xs leading-6 text-[var(--text-secondary)]">
        {employee.description}
      </div>
    </div>
  );
}

/** 详情面板：岗位授权契约（结构化展示）。 */
export function StructuredBoundaryContent({ employee }: { employee: DigitalPartner }) {
  const policy = resolveBoundaryPolicy(employee);
  const modeLabel = Object.fromEntries(executionModeOptions);
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">岗位授权契约</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">职责、执行授权、人工接管和数据范围作为同一份可审计策略展示。</p>
      </div>
      <div className="space-y-2">
        {policy.responsibilities.map((item) => (
          <article key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{item.title}</span>
              {item.evidenceRequired && <Badge tone="success">留存证据</Badge>}
            </div>
            <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
              <div><dt className="text-[11px] text-[var(--text-muted)]">目标</dt><dd className="mt-0.5 text-[var(--text-secondary)]">{item.objective}</dd></div>
              <div><dt className="text-[11px] text-[var(--text-muted)]">触发</dt><dd className="mt-0.5 text-[var(--text-secondary)]">{item.trigger}</dd></div>
              <div><dt className="text-[11px] text-[var(--text-muted)]">交付</dt><dd className="mt-0.5 text-[var(--text-secondary)]">{item.deliverables.join('、') || '—'}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
        <h3 className="text-xs font-semibold">执行边界</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {policy.capabilityModes.map((item) => (
            <Badge key={`${item.capabilityType}-${item.capabilityName}`} tone={item.mode === 'execute' ? 'success' : item.mode === 'prohibited' ? 'error' : item.mode === 'approval_required' ? 'warn' : 'info'}>
              {item.capabilityName} · {modeLabel[item.mode]}
            </Badge>
          ))}
        </div>
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        <BoundaryList
          icon={UserRoundCheck}
          tone="text-[var(--brand)]"
          title={`人工接管 · SLA ${policy.handoff.slaMinutes} 分钟`}
          values={[...policy.handoff.triggers, `接管人：${policy.handoff.approvers.join('、')}`]}
        />
        <BoundaryList
          icon={ShieldCheck}
          tone="text-[var(--warning)]"
          title="数据与范围"
          values={[
            `数据分类：${policy.dataClassification === 'internal' ? '内部' : policy.dataClassification === 'confidential' ? '敏感' : '受限'}`,
            `运行环境：${policy.allowedEnvironments.map((item) => item === 'production' ? '生产' : item === 'staging' ? '预发' : '沙箱').join('、')}`,
          ]}
        />
      </div>
    </div>
  );
}

/** 详情面板：能力装配摘要。 */
export function CapabilityContent({ employee }: { employee: DigitalPartner }) {
  const rows = [
    { label: '模型', values: [employee.capabilities.model] },
    { label: '知识', values: employee.capabilities.knowledge },
    { label: '技能', values: employee.capabilities.skills },
    { label: '工具', values: employee.capabilities.tools },
    { label: '工作流', values: employee.capabilities.workflows },
    { label: '渠道', values: employee.capabilities.channels },
  ];
  const cog = employee.capabilities.cognitive;
  const cogLabel = cog?.enabled === false
    ? '已关闭'
    : `已启用 · 偏好 ${cog?.preferredFramework === 'problem' ? '问题解决' : cog?.preferredFramework === 'creative' ? '创意决策' : cog?.preferredFramework === 'logic' ? '逻辑思考' : '自动'} · 最多 ${cog?.maxFrameworksPerTurn ?? 2} 框架`;
  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-[var(--text-muted)]">仅绑定工作区内已发布、经治理批准的能力版本。能力本体仍由模型、知识、技能、工作流和渠道中心独立治理。</p>
      {employee.capabilities.agentId && <p className="rounded-lg px-3 py-2 text-[11px] text-[var(--text-muted)]" style={{ boxShadow: 'var(--saas-ring)' }}>执行运行时已绑定（内部），不作为对外岗位身份。</p>}
      <div className="rounded-lg bg-[var(--bg)] p-3" style={{ boxShadow: 'var(--saas-ring)' }}>
        <div className="text-xs font-semibold">认知思路模型</div>
        <div className="mt-2 text-xs text-[var(--text-secondary)]">{cogLabel}</div>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="rounded-lg bg-[var(--bg)] p-3" style={{ boxShadow: 'var(--saas-ring)' }}>
          <div className="text-xs font-semibold">{row.label}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {row.values.length
              ? row.values.map((value) => <Badge key={value} tone="neutral">{value}</Badge>)
              : <span className="text-xs text-[var(--text-muted)]">未绑定</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 详情面板：三层记忆策略。 */
export function MemoryContent({ employee }: { employee: DigitalPartner }) {
  const policy = employee.memoryPolicy;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">三层记忆策略</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">会话短期记忆、岗位工作记忆和经审核的长期记忆彼此分层，长期记忆不会自动成为企业知识。</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Metric label="短期记忆" value={policy.shortTermHours} sub="小时" />
        <Metric label="工作记忆" value={policy.workingDays} sub="天" />
        <Metric label="长期提炼" value={policy.longTermCadence === 'daily' ? '每日' : '每周'} />
        <Metric label="转知识" value={policy.knowledgePromotion === 'approval_required' ? '需审核' : '已关闭'} />
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs leading-5 text-[var(--text-secondary)]">
        <Database className="mr-1 inline h-3.5 w-3.5 text-[var(--brand)]" />
        长期记忆按策略提炼为知识候选，审核通过后才进入知识中心的权威资产目录。
      </div>
    </div>
  );
}

/** 详情面板：运行观测。 */
export function RuntimeContent({ employee }: { employee: DigitalPartner }) {
  const runtime = employee.runtime;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Metric label="24 小时调用" value={runtime.calls24h} />
        <Metric label="成功率" value={runtime.calls24h > 0 ? `${(runtime.successRate * 100).toFixed(1)}%` : '—'} />
        <Metric label="P95 延迟" value={runtime.p95Ms || '—'} sub={runtime.p95Ms ? 'ms' : undefined} />
        <Metric label="今日成本" value={`¥${Number(runtime.costToday || 0).toFixed(2)}`} />
        <Metric label="人工交接" value={runtime.handoffs24h} sub="次" />
        <Metric label="异常信号" value={runtime.anomalies} sub="项" />
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs leading-5 text-[var(--text-secondary)]">
        <HeartPulse className="mr-1 inline h-3.5 w-3.5 text-[var(--success)]" />
        运行运营聚焦业务服务质量；模型、工具与渠道的深度技术指标分别在其所属控制面查看。
      </div>
    </div>
  );
}

/** 通用 key-value 列表。 */
export function BoundaryList({ icon: Icon, tone, title, values }: { icon: typeof ShieldCheck; tone: string; title: string; values: string[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="space-y-2">
        {values.map((value) => (
          <div key={value} className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-xs text-[var(--text-secondary)]">
            <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} />
            {value}
          </div>
        ))}
      </div>
    </div>
  );
}
