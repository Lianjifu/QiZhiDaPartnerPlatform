import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * M06 P1：原 pages/Workflows.tsx 与 pages/WorkflowOrchestrationSession.tsx 拆分
 * 为 features/workflows/components/*.tsx 多文件，原始断言改读所有新文件并拼接。
 */
const workflowFiles = [
  'WorkflowsPage.tsx',
  'useWorkflowsController.ts',
  'workflow-template-helpers.ts',
  'WorkflowsModals.tsx',
  'WorkflowsTab.Editor.tsx',
  'WorkflowsTab.Generation.tsx',
  'WorkflowsTab.List.tsx',
  'WorkflowsTab.Runs.tsx',
  'WorkflowsTab.Settings.tsx',
  'WorkflowsTab.Skills.tsx',
  'WorkflowsShared.tsx',
];
const orchestrationFiles = [
  'WorkflowOrchestrationSessionPage.tsx',
  'WorkflowOrchestratorCanvas.tsx',
  'WorkflowOrchestratorRunPanel.tsx',
];

const workflowsSource = workflowFiles
  .map((f) => readFileSync(join(root, f), 'utf8'))
  .join('\n');
const orchestrationSource = orchestrationFiles
  .map((f) => readFileSync(join(root, f), 'utf8'))
  .join('\n');
const mockSource = readFileSync(join(root, '../../../../../packages/api/src/mock.ts'), 'utf8');
const appSource = readFileSync(join(root, '../../../App.tsx'), 'utf8');

const forbidden = [
  /双签/,
  /Agent\s*决策/,
  /SignedLog/,
  /故障自愈/,
  /Workforce/i,
  /EXECUTING_NODE_ID/,
  /本地演示草稿/,
  /capacity-agent/,
  /report-agent/,
  /redis-recovery-agent/,
];

describe('workflows orchestration copy', () => {
  it('keeps Workflows page free of deprecated brand terms and fake LIVE marker', () => {
    for (const pattern of forbidden) {
      expect(workflowsSource, `workflows files must not match ${pattern}`).not.toMatch(pattern);
    }
  });

  it('uses draft-oriented status chrome instead of fake run observation', () => {
    expect(workflowsSource).toContain('编排草稿');
    expect(workflowsSource).toContain('draftToFlow');
    expect(workflowsSource).not.toContain('运行观察');
  });

  it('paginates and shows a flat unified template grid', () => {
    expect(workflowsSource).toContain('TPL_PAGE_SIZE');
    expect(workflowsSource).toContain('wf-tpl-pager');
    expect(workflowsSource).toContain('pagedFlat');
    expect(workflowsSource).toContain('全部部门统一列表');
    expect(workflowsSource).not.toContain('pagedGroups');
  });

  it('splits workflow templates into platform builtin and personal origins', () => {
    expect(workflowsSource).toContain('平台内置');
    expect(workflowsSource).toContain('个人创建');
    expect(workflowsSource).toContain('templateOriginFilter');
    expect(workflowsSource).toContain('saveAsPersonalTemplate');
    expect(workflowsSource).toContain('isPersonalTemplate');
    expect(workflowsSource).toContain('办公通用');
    expect(workflowsSource).toContain('knowledgePackageIds');
  });

  it('aligns workflow mock draft terminology with platform lexicon', () => {
    const workflowSlice = mockSource.slice(
      mockSource.indexOf('export const mockWorkflow'),
      mockSource.indexOf('// 工作流控制台运行态'),
    );
    expect(workflowSlice).toContain('员工入职开通');
    expect(workflowSlice).toContain('cache-oom 受控恢复');  // IT 高级库仍保留
    expect(workflowSlice).toContain('数字伙伴研判');
    expect(workflowSlice).toContain('双重审批');
    expect(workflowSlice).toContain('审计留痕');
    expect(workflowSlice).not.toMatch(/双签|故障自愈|Agent\s*决策|SignedLog/);
  });
});

describe('workflow template library gates', () => {
  it('states digital-employee consumption positioning on the template page', () => {
    expect(workflowsSource).toContain('发布为流程技能');
    expect(workflowsSource).toContain('创建隔离草稿');
    expect(workflowsSource).toContain('平台认证模板');
    expect(workflowsSource).toContain('IT 高级库');
  });

  it('blocks trial run and publish when template dependencies are unauthorized', () => {
    expect(workflowsSource).toContain('draftGate');
    expect(workflowsSource).toContain('模板依赖未授权，禁止试运行');
    expect(workflowsSource).toContain('模板依赖未就绪，无法发布');
    expect(workflowsSource).toContain('isTemplateReusable');
    expect(workflowsSource).toContain('needsTemplateReview');
  });

  it('persists template provenance on isolated drafts', () => {
    expect(workflowsSource).toContain('sourceTemplateId=${asset.id}@${asset.version}');
    expect(workflowsSource).toContain('normalizeTemplateAsset');
    expect(mockSource).toContain('dependencyStatus');
    expect(mockSource).toContain('infra.execute：当前工作区未授权生产写权限');
    expect(mockSource).toMatch(/payment\.initiate|付款/);
  });
});

describe('workflow AI assisted drafting', () => {
  it('opens a dedicated full-screen orchestration session page', () => {
    expect(appSource).toContain('/workflows/orchestration');
    expect(appSource).toContain('/workflows/orchestration/:sessionId');
    expect(workflowsSource).toContain("navigate('/workflows/orchestration')");
    expect(orchestrationSource).toContain('AI 辅助编排会话');
    expect(orchestrationSource).toContain('createInflightRef');
    expect(orchestrationSource).toContain('重新打开');
    expect(orchestrationSource).toContain('澄清完全可选');
    expect(orchestrationSource).toContain('一键生成示例');
    expect(orchestrationSource).toContain('沉淀知识中心');
    expect(orchestrationSource).toContain('引用知识文档');
    expect(orchestrationSource).toContain('Runbook 检索');
    expect(orchestrationSource).toContain('沉淀模版候选');
    expect(orchestrationSource).toContain('previewNodeTypes');
    expect(orchestrationSource).toContain('画布预览');
    expect(orchestrationSource).toContain('ReactFlow');
    expect(orchestrationSource).toContain('onSplitPointerDown');
    expect(orchestrationSource).toContain('拖动调整左右区域宽度');
    expect(orchestrationSource).not.toContain('节点序列（可微调）');
    expect(mockSource).toContain('enterprise-model-router');
    expect(mockSource).toContain('knowledge.retrieve_runbook');
    expect(mockSource).toContain('mockOrchestrationTemplateCandidates');
    expect(orchestrationSource).toContain('画布预览仅用于示例编排');
    expect(orchestrationSource).toContain('供数字伙伴装配');
    expect(orchestrationSource).toContain('由数字伙伴研判处置路径，经双重审批后执行受控恢复');
    expect(orchestrationSource).not.toContain('当 Redis 触发 OOM 告警时自动处理');
  });

  it('keeps generation mock free of autonomous-healing default prompt', () => {
    const generationSlice = mockSource.slice(
      mockSource.indexOf('export const mockWorkflowGenerations'),
      mockSource.indexOf('// ============ P7 知识扩展数据'),
    );
    expect(generationSlice).toContain('数字伙伴研判处置路径');
    expect(generationSlice).toContain('执行受控恢复');
    expect(generationSlice).toContain('受控恢复数字伙伴');
    expect(generationSlice).toContain('mockOrchestrationSessions');
    expect(generationSlice).toContain('invokeOrchestrationModel');
    expect(mockSource).toContain('编排会话沉淀');
    expect(generationSlice).not.toMatch(/自动处理|故障自愈/);
  });
});

describe('workflow canvas orchestration', () => {
  it('states digital-employee skill publish path on canvas', () => {
    expect(workflowsSource).toContain('供数字伙伴能力装配');
    expect(workflowsSource).toContain('本页不直接发起专家协作上岗');
    expect(workflowsSource).toContain('执行受控恢复');
    expect(workflowsSource).toContain('执行受控动作');
  });

  it('gates publish-as-skill on validation, dirty draft, and workflow id', () => {
    expect(workflowsSource).toContain('skillValidationReady');
    expect(workflowsSource).toContain('validationPassed');
    expect(workflowsSource).toContain('skillSourceVersion');
    expect(workflowsSource).toContain('调用需审批');
    expect(workflowsSource).toContain('/skills?tab=workflowSkills');
    expect(workflowsSource).toContain('vars.workflowId');
    expect(workflowsSource).toContain('publish-as-skill');
    expect(workflowsSource).toContain('wf-publish');
    expect(workflowsSource).toContain('skillGateSteps');
    expect(mockSource).toContain('E_VALIDATION_REQUIRED');
    expect(mockSource).toContain('治理发布工作流技能');
  });

  it('exposes version center for auditors while keepers reach it from canvas capsule', () => {
    expect(workflowsSource).toContain("t('module.workflows.tabs.history')");
    expect(workflowsSource).toContain("t('module.workflows.tabs.versions')");
    expect(workflowsSource).toContain('visibleWorkflowTabs');
    expect(workflowsSource).toContain('defaultWorkflowTab');
    expect(workflowsSource).toContain('打开版本中心');
    expect(workflowsSource).toContain('回滚并生成新草稿');
    expect(workflowsSource).toContain('WorkflowLifecycleStrip');
    expect(workflowsSource).toContain('wf-boundary');
    expect(workflowsSource).toContain('/api/workflows/${workflowId || \'__none__\'}');
    expect(workflowsSource).toContain('enabled: Boolean(workflowId)');
    expect(workflowsSource).not.toContain("?? 'wf1'");
    expect(workflowsSource).not.toContain("'/api/workflows/wf1'");
  });

  it('enforces structure gates for external write nodes', () => {
    expect(workflowsSource).toContain('evaluateWorkflowStructure');
    expect(workflowsSource).toContain('存在外部写入节点，但缺少双重审批节点');
    expect(workflowsSource).toContain('结构门禁');
  });

  it('marks debug replay as local simulation without fake success audit', () => {
    expect(workflowsSource).toContain('模拟重跑');
    expect(workflowsSource).toContain('不会创建执行记录或审计留痕');
    expect(workflowsSource).not.toContain('已重新执行节点');
    expect(workflowsSource).toContain('approvalTimeoutSec');
    expect(workflowsSource).toContain('已纳管 Skill 调用');
  });
});