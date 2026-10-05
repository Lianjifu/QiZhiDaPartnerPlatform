/**
 * 发布为流程技能：门禁核对 + 技能档案 + 已发布清单。
 * 画布已保存、来源版本对齐、运行前校验通过、模板依赖就绪后才可发布。
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, GitBranch, Save, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { useT } from '@/i18n';
import type { WorkflowsController } from './useWorkflowsController';
import { formatWorkflowVersionLabel } from './WorkflowsShared';

const RISK_LABEL: Record<string, string> = {
  low: '低风险',
  mid: '中等风险',
  high: '高风险 · 需治理发布',
};

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  deprecated: '已停用',
};

export function WorkflowsTabSkills({ c }: { c: WorkflowsController }) {
  const { t } = useT();
  useEffect(() => {
    if (!c.skillSourceVersion && c.activeVersion) c.setSkillSourceVersion(c.activeVersion);
  }, [c]);

  const passed = c.skillGateSteps.filter((step) => step.ok).length;
  const source = c.versions.find((item) => item.id === c.skillSourceVersion);
  const nameOk = Boolean(c.skillName.trim());

  return (
    <div className="wf-publish" data-testid="wf-publish">
      <section className="wf-publish__hero">
        <div className="wf-publish__hero-main">
          <div className="wf-publish__eyebrow"><Sparkles className="h-3.5 w-3.5" />流程技能</div>
          <h2 className="wf-publish__title">{t('module.workflows.publishSkill.title')}</h2>
          <p className="wf-publish__lead">
            把当前编排草稿发布为可装配的流程技能。发布后由数字伙伴在能力装配中引用，本页不直接发起专家协作上岗。
            高风险技能会先落为草稿，由管理员在技能治理中确认。
          </p>
        </div>
        <div className="wf-publish__hero-meta">
          <div className="wf-publish__stat"><strong>{passed}/{c.skillGateSteps.length}</strong><span>门禁通过</span></div>
          <div className="wf-publish__stat is-pub"><strong>{c.publishedSkillCount}</strong><span>已发布</span></div>
          <div className="wf-publish__stat"><strong>{c.draftSkillCount}</strong><span>待治理</span></div>
        </div>
      </section>

      <div className="wf-publish__grid">
        <section className="wf-publish__panel">
          <header className="wf-publish__panel-head">
            <div>
              <h3>技能档案</h3>
              <p>名称与说明会展示给数字伙伴装配页；来源版本决定调用哪一份编排。</p>
            </div>
            {c.workflowId ? <span className="wf-publish__meta-chip">流程 <code>{c.workflowId}</code></span> : <span className="wf-publish__meta-chip">尚未绑定流程 ID</span>}
          </header>
          <div className="wf-publish__panel-body">
            <div className="wf-publish__fields">
              <label className="wf-publish__field wf-publish__field--full">
                <span>技能名称</span>
                <input value={c.skillName} onChange={(event) => c.setSkillName(event.target.value)} disabled={!c.canWrite} placeholder="例如：生产故障处置流程技能" />
              </label>
              <label className="wf-publish__field wf-publish__field--full">
                <span>技能说明</span>
                <textarea rows={3} value={c.skillDesc} onChange={(event) => c.setSkillDesc(event.target.value)} disabled={!c.canWrite} placeholder="说明适用场景、边界与数字伙伴如何调用" />
              </label>
              <label className="wf-publish__field">
                <span>风险等级</span>
                <select value={c.skillRiskLevel} onChange={(event) => c.setSkillRiskLevel(event.target.value as typeof c.skillRiskLevel)} disabled={!c.canWrite}>
                  <option value="low">低风险 · 可直接发布</option>
                  <option value="mid">中等风险 · 调用需审批</option>
                  <option value="high">高风险 · 需治理发布</option>
                </select>
              </label>
              <label className="wf-publish__field">
                <span>来源版本</span>
                <select value={c.skillSourceVersion} onChange={(event) => c.setSkillSourceVersion(event.target.value)} disabled={!c.canWrite || c.versions.length === 0}>
                  {c.versions.length === 0 && <option value="">暂无版本，请先保存草稿</option>}
                  {c.versions.map((version) => (
                    <option key={version.id} value={version.id}>{formatWorkflowVersionLabel(version)}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="wf-publish__preview">
              <div className="wf-publish__preview-label">装配预览</div>
              <div className="wf-publish__preview-name">{c.skillName.trim() || '未命名流程技能'}</div>
              <p className="wf-publish__preview-desc">{c.skillDesc.trim() || '补充说明后，数字伙伴装配时可以看到这段描述。'}</p>
              <div className="wf-publish__preview-tags">
                <Badge tone={c.skillRiskLevel === 'high' ? 'warn' : 'info'}>{RISK_LABEL[c.skillRiskLevel] ?? c.skillRiskLevel}</Badge>
                <Badge tone="neutral">{source ? formatWorkflowVersionLabel(source) : (c.skillSourceVersion || '未选版本')}</Badge>
                <Badge tone="neutral">{c.nodes.length} 节点 · {c.edges.length} 连线</Badge>
                {c.skillRiskLevel !== 'low' && <Badge tone="warn">调用需审批</Badge>}
              </div>
            </div>

            <div className="wf-publish__actions">
              <Button onClick={() => c.publishSkill()} disabled={!c.canPublishSkill || !nameOk} loading={c.publishAsSkillApi.isPending}>
                <Sparkles className="h-3.5 w-3.5" />发布为流程技能
              </Button>
              <Button variant="outline" onClick={c.runWorkflow} disabled={!c.canExecute || c.isDirty}>运行前校验</Button>
              <Link to="/skills?tab=governance" className="wf-publish__ghost">
                技能治理 <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              {c.skillGateHint && <p className="wf-publish__actions-note">{c.skillGateHint}</p>}
              {!nameOk && <p className="wf-publish__actions-note">请填写技能名称后再发布。</p>}
            </div>
          </div>
        </section>

        <section className="wf-publish__panel">
          <header className="wf-publish__panel-head">
            <div>
              <h3>技能发布门禁</h3>
              <p>四项全部通过后才允许发布。未通过项可从本页直接回到对应步骤。</p>
            </div>
            <ShieldCheck className="h-4 w-4 text-[var(--brand)]" />
          </header>
          <div className="wf-publish__panel-body">
            <ol className="wf-publish__gate-list">
              {c.skillGateSteps.map((step, index) => (
                <li key={step.key} className={cn('wf-publish__gate', step.ok ? 'is-ok' : 'is-bad')}>
                  <span className="wf-publish__gate-index" aria-hidden>{step.ok ? <Check className="h-3.5 w-3.5" /> : String(index + 1).padStart(2, '0')}</span>
                  <div className="wf-publish__gate-copy">
                    <strong>{step.title}</strong>
                    <span>{step.detail}</span>
                  </div>
                  {!step.ok && (
                    <GateAction stepKey={step.key} c={c} />
                  )}
                </li>
              ))}
            </ol>
            <p className="wf-publish__footnote">
              调用时须传 <code>vars.workflowId</code>。高风险技能提交为草稿后，由管理员在技能中心治理发布。
            </p>
          </div>
        </section>
      </div>

      <section className="wf-publish__panel">
        <header className="wf-publish__list-head">
          <div>
            <h3>本流程已生成的技能</h3>
            <p>同一编排可以发布多个技能版本，停用与上架请到技能治理。</p>
          </div>
          <Badge tone="info">{c.workflowSkills.length} 条</Badge>
        </header>
        {c.workflowSkills.length === 0 ? (
          <div className="wf-publish__empty">
            <Workflow className="h-6 w-6" />
            <strong>还没有流程技能</strong>
            <span>通过门禁后发布，数字伙伴即可在能力装配中引用。</span>
          </div>
        ) : (
          <div>
            {c.workflowSkills.map((skill) => (
              <article key={skill.id} className="wf-publish__skill-row">
                <div>
                  <div className="wf-publish__skill-title">
                    {skill.name}
                    <Badge tone={skill.status === 'published' ? 'success' : skill.status === 'deprecated' ? 'neutral' : 'warn'}>{STATUS_LABEL[skill.status] ?? skill.status}</Badge>
                  </div>
                  <p className="wf-publish__skill-meta">
                    {skill.description || '未填写说明'}
                    <br />
                    来源 <code>{skill.sourceWorkflowId}</code> · 版本 <code>{skill.sourceVersionId}</code> · 调用须传 <code>vars.workflowId</code>
                  </p>
                </div>
                <div className="wf-publish__skill-tags">
                  <Badge tone={skill.riskLevel === 'high' ? 'warn' : 'info'}>{RISK_LABEL[skill.riskLevel] ?? skill.riskLevel}</Badge>
                  {skill.approvalRequired && <Badge tone="warn">调用需审批</Badge>}
                  {skill.rollbackSupported && <Badge tone="neutral">支持回滚</Badge>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function GateAction({ stepKey, c }: { stepKey: string; c: WorkflowsController }) {
  if (stepKey === 'draft') {
    return (
      <Button size="sm" variant="outline" onClick={c.saveCanvas} disabled={!c.canWrite || !c.isDirty}>
        <Save className="h-3.5 w-3.5" />保存
      </Button>
    );
  }
  if (stepKey === 'version') {
    return (
      <Button size="sm" variant="outline" onClick={() => c.goStudio('versions')}>
        <GitBranch className="h-3.5 w-3.5" />版本
      </Button>
    );
  }
  if (stepKey === 'validate') {
    return (
      <Button size="sm" variant="outline" onClick={c.runWorkflow} disabled={!c.canExecute || c.isDirty}>
        校验
      </Button>
    );
  }
  return null;
}
