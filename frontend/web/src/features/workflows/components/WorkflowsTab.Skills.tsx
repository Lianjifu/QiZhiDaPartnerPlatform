/**
 * WorkflowsTab.Skills — 发布为流程技能视图。
 * 此处要求画布已保存、来源版本已对齐、运行前校验已通过、模板依赖就绪，
 * 全部条件满足才允许调用 publish-as-skill。
 */
import { useEffect } from 'react';
import { Badge, Button } from '@qzda/web-ui';
import { Check, X, Sparkles, ShieldCheck } from 'lucide-react';
import { useT } from '@/i18n';
import type { WorkflowsController } from './useWorkflowsController';

export function WorkflowsTabSkills({ c }: { c: WorkflowsController }) {
  const { t } = useT();
  useEffect(() => {
    if (!c.skillSourceVersion && c.activeVersion) c.setSkillSourceVersion(c.activeVersion);
  }, [c]);
  return (
    <div className="wf-publish-tab flex h-full min-h-0 flex-col gap-3" data-testid="wf-publish">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t('module.workflows.publishSkill.title')}</h2>
        <Badge tone="info">已发布 {c.publishedSkillCount} · 草稿 {c.draftSkillCount}</Badge>
      </div>
      <div className="wf-publish-tab__grid flex-1 grid grid-cols-2 gap-3 min-h-0">
        <section className="wf-publish-tab__form h-full overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-3 space-y-2">
          <FormRow label="技能名称">
            <input className="wf-input w-full" value={c.skillName} onChange={(e) => c.setSkillName(e.target.value)} disabled={!c.canWrite} />
          </FormRow>
          <FormRow label="技能说明">
            <textarea className="wf-textarea w-full" rows={3} value={c.skillDesc} onChange={(e) => c.setSkillDesc(e.target.value)} disabled={!c.canWrite} />
          </FormRow>
          <FormRow label="风险等级">
            <select className="wf-input w-full" value={c.skillRiskLevel} onChange={(e) => c.setSkillRiskLevel(e.target.value as any)} disabled={!c.canWrite}>
              <option value="low">低风险</option>
              <option value="mid">中等风险</option>
              <option value="high">高风险（需治理发布）</option>
            </select>
          </FormRow>
          <FormRow label="来源版本">
            <select className="wf-input w-full" value={c.skillSourceVersion} onChange={(e) => c.setSkillSourceVersion(e.target.value)} disabled={!c.canWrite}>
              {c.versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </FormRow>
          <div className="flex items-center gap-2 pt-2">
            <Button onClick={() => c.publishSkill()} disabled={!c.canPublishSkill}><Sparkles className="h-4 w-4" />发布为流程技能</Button>
            {c.skillGateHint && <span className="text-xs text-amber-500">{c.skillGateHint}</span>}
          </div>
        </section>
        <section className="wf-publish-tab__gates h-full overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-3 space-y-2">
          <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /><strong>技能发布门禁</strong></div>
          <ol className="space-y-2">
            {c.skillGateSteps.map((step) => (
              <li key={step.key} className="flex items-start gap-2 rounded border border-[var(--border)] p-2 text-xs">
                {step.ok ? <Check className="h-4 w-4 text-emerald-500 mt-0.5" /> : <X className="h-4 w-4 text-rose-500 mt-0.5" />}
                <div>
                  <div className="font-medium">{step.title}</div>
                  <div className="text-[var(--text-muted)]">{step.detail}</div>
                </div>
              </li>
            ))}
          </ol>
          <p className="text-xs text-[var(--text-muted)]">调用需审批：高风险技能提交为草稿后，将由管理员在 /skills?tab=workflowSkills 治理发布。</p>
        </section>
      </div>
      <ExistingSkills c={c} />
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      {children}
    </div>
  );
}

function ExistingSkills({ c }: { c: WorkflowsController }) {
  if (c.workflowSkills.length === 0) return null;
  return (
    <section className="space-y-1">
      <div className="text-sm font-semibold">已发布技能</div>
      <div className="grid grid-cols-2 gap-2">
        {c.workflowSkills.map((skill) => (
          <div key={skill.id} className="rounded border border-[var(--border)] bg-[var(--surface-1)] p-2 text-xs">
            <div className="flex items-center gap-2">
              <strong>{skill.name}</strong>
              <Badge tone={skill.status === 'published' ? 'success' : 'warn'}>{skill.status}</Badge>
              <Badge tone="info">{skill.riskLevel}</Badge>
            </div>
            <p className="text-[var(--text-muted)] mt-0.5">{skill.description}</p>
            <p className="text-[10px] text-[var(--text-muted)]">workflowId: {skill.sourceWorkflowId} · vars.workflowId 必传</p>
          </div>
        ))}
      </div>
    </section>
  );
}