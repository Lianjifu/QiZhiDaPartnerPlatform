/**
 * WorkflowsTab.Generation — AI 辅助编排会话入口 + 全屏抽屉。
 *
 * 拆分原因：原 pages/Workflows.tsx 单文件 4479L（M06 P1 整合），按 D1 决策
 * 将 WorkflowAIGeneratorDrawer + AI_PROMPT_EXAMPLES + dependencyTypeLabel
 * 抽出到独立 tab 文件。
 */
import { useState } from 'react';
import { Badge, Button } from '@qzda/web-ui';
import { Drawer } from '@/components/shared';
import { Sparkles, RotateCcw, Save } from 'lucide-react';
import { useT } from '@/i18n';
import type { WorkflowsController } from './useWorkflowsController';
import { NODE_LABELS } from './WorkflowsShared';

const AI_PROMPT_EXAMPLES = [
  '当生产 Redis 触发 OOM 告警时，由数字伙伴研判处置路径，经双重审批后执行受控恢复，写入审计并通知值班负责人',
  '处理工单分发：解析需求、调用知识检索、由数字伙伴研判是否升级、超时则转入人工审批',
  '每日合规扫描：拉取合规要求、扫描运行手册、生成整改建议清单并通知合规负责人',
];

export function dependencyTypeLabel(type: 'tool' | 'mcp' | 'agent') {
  if (type === 'tool') return 'Tool';
  if (type === 'mcp') return 'MCP';
  return '数字伙伴';
}

export function WorkflowsTabGeneration({ c }: { c: WorkflowsController }) {
  const { t } = useT();
  if (!c.aiGenerateOpen) return null;
  return (
    <Drawer open={c.aiGenerateOpen} onClose={() => c.setAiGenerateOpen(false)}>
      <div className="p-4 space-y-3 max-w-2xl" data-testid="wf-ai-drawer">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[var(--brand)]" />
            <h2 className="text-lg font-semibold">{t('module.workflows.aiDrawer.title')}</h2>
          </div>
          <Badge tone="info">{c.generationModel}</Badge>
        </header>
        {c.generationStep === 'input' && <GeneratorInputStep c={c} />}
        {c.generationStep === 'preview' && c.generationResult && <GeneratorPreviewStep c={c} />}
      </div>
    </Drawer>
  );
}

function GeneratorInputStep({ c }: { c: WorkflowsController }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">业务目标描述</div>
        <textarea
          className="wf-textarea w-full"
          rows={4}
          value={c.generationPrompt}
          onChange={(e) => c.setGenerationPrompt(e.target.value)}
        />
        <div className="mt-1 flex flex-wrap gap-1">
          {AI_PROMPT_EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="wf-chip" onClick={() => c.setGenerationPrompt(ex)}>
              一键生成示例
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <CheckboxRow label="要求双重审批" value={c.generationConstraints.requireApproval} onChange={(v) => c.setGenerationConstraints({ ...c.generationConstraints, requireApproval: v })} />
        <CheckboxRow label="要求审计留痕" value={c.generationConstraints.requireAudit} onChange={(v) => c.setGenerationConstraints({ ...c.generationConstraints, requireAudit: v })} />
        <CheckboxRow label="要求补偿回滚" value={c.generationConstraints.requireRollback} onChange={(v) => c.setGenerationConstraints({ ...c.generationConstraints, requireRollback: v })} />
        <RiskRow value={c.generationConstraints.riskLevel} onChange={(v) => c.setGenerationConstraints({ ...c.generationConstraints, riskLevel: v })} />
      </div>
      <ModelRow value={c.generationModel} onChange={c.setGenerationModel} />
      <div className="flex items-center gap-2 pt-2">
        <Button onClick={() => c.submitGeneration()} disabled={c.generateWorkflowApi.isPending}>
          {c.generateWorkflowApi.isPending ? '生成中…' : '生成草稿'}
        </Button>
        <span className="text-xs text-[var(--text-muted)]">此处不直接发起专家协作上岗，AI 生成结果将以隔离版本保存。</span>
      </div>
      <HistoryList history={c.generationHistory} />
    </div>
  );
}

function CheckboxRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function RiskRow({ value, onChange }: { value: 'L1' | 'L2' | 'L3'; onChange: (v: 'L1' | 'L2' | 'L3') => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">风险等级</span>
      <select className="wf-input" value={value} onChange={(e) => onChange(e.target.value as 'L1' | 'L2' | 'L3')}>
        <option value="L1">L1</option>
        <option value="L2">L2</option>
        <option value="L3">L3</option>
      </select>
    </label>
  );
}

function ModelRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">使用模型</span>
      <input className="wf-input" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function HistoryList({ history }: { history: import('./WorkflowsShared').GenerationResult[] }) {
  const [open, setOpen] = useState(false);
  if (!history.length) return null;
  return (
    <details className="rounded border border-[var(--border)] p-2" open={open} onClick={() => setOpen((o) => !o)}>
      <summary className="text-sm">历史生成 {history.length}</summary>
      <ul className="text-xs space-y-1 mt-1">
        {history.map((g) => (
          <li key={g.id}>
            <Badge tone={g.checks.structure === 'passed' ? 'success' : 'warn'}>{g.id}</Badge>
            <span className="ml-2 text-[var(--text-muted)]">{g.prompt.slice(0, 60)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function GeneratorPreviewStep({ c }: { c: WorkflowsController }) {
  const r = c.generationResult!;
  return (
    <div className="space-y-2">
      <Badge tone={r.checks.structure === 'passed' ? 'success' : 'warn'}>质量评分 {r.qualityScore}</Badge>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <CheckCard title="结构" status={r.checks.structure} />
        <CheckCard title="依赖" status={r.checks.dependencies} />
        <CheckCard title="风险" status={r.checks.risk} />
      </div>
      <Section title="节点">
        <ul className="text-xs space-y-0.5">
          {r.workflow.nodes.map((n) => (
            <li key={n.id}><Badge tone="info">{n.kind}</Badge> {NODE_LABELS[n.kind] ?? n.label}</li>
          ))}
        </ul>
      </Section>
      <Section title="依赖">
        <ul className="text-xs space-y-0.5">
          {r.dependencies.map((d, i) => (
            <li key={i}><Badge tone={d.status === 'available' ? 'success' : 'error'}>{dependencyTypeLabel(d.type)}</Badge> {d.name} {d.reason ? `· ${d.reason}` : ''}</li>
          ))}
        </ul>
      </Section>
      <Section title="风险">
        <ul className="text-xs space-y-0.5">
          {r.risks.map((risk, i) => (
            <li key={i}><Badge tone={risk.requiresApproval ? 'error' : 'warn'}>{risk.level}</Badge> {risk.text}</li>
          ))}
        </ul>
      </Section>
      {r.warnings.length > 0 && (
        <Section title="警告">
          <ul className="text-xs space-y-0.5">
            {r.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Section>
      )}
      <div className="flex items-center gap-2 pt-2">
        <Button onClick={() => c.applyGeneration()} disabled={c.applyGenerationApi.isPending}>
          <Save className="h-4 w-4" />应用为隔离草稿
        </Button>
        <Button variant="outline" onClick={() => c.discardGeneration()}><RotateCcw className="h-4 w-4" />放弃本次结果</Button>
      </div>
    </div>
  );
}

function CheckCard({ title, status }: { title: string; status: 'passed' | 'review' }) {
  return (
    <div className="rounded border border-[var(--border)] p-2 text-xs">
      <div className="text-[var(--text-muted)]">{title}</div>
      <Badge tone={status === 'passed' ? 'success' : 'warn'}>{status}</Badge>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-[var(--border)] p-2">
      <div className="text-xs text-[var(--text-muted)] mb-1">{title}</div>
      {children}
    </div>
  );
}