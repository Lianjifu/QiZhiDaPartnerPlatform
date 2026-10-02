/**
 * 工作流模板归一化与部门标签 helper。
 *
 * 拆分原因：原 pages/Workflows.tsx 文件 4479L（M06 P1 整合），按 D1 决策
 * 把模板归一化与 category→label 函数抽离，避免控制器 hook 过度膨胀。
 */
import {
  ALL_WORKFLOW_TEMPLATES,
  deriveTemplateBlockers,
  evaluateTemplateConnectors,
  matchDepartmentKey,
  type ConnectorBindings,
  type DepartmentKey,
  type WorkflowTemplateAsset,
} from '@/features/workflows/department-templates';

export function departmentLabel(category: WorkflowTemplateAsset['category'] | string, department?: string) {
  if (department) return department;
  if (category === 'business') return '业务自动化';
  if (category === 'system') return '系统运维';
  if (category === 'security') return '安全响应';
  return '研判与分析';
}

export function normalizeTemplateAsset(
  raw: Partial<WorkflowTemplateAsset> & { id: string; name: string },
  bindings: ConnectorBindings = {},
): WorkflowTemplateAsset {
  const fallback = ALL_WORKFLOW_TEMPLATES.find((item) => item.id === raw.id || item.name === raw.name);
  const connectors = raw.connectors?.length ? raw.connectors : (fallback?.connectors ?? []);
  const degrade = raw.degrade ?? fallback?.degrade;
  const evaluated = evaluateTemplateConnectors({ connectors, degrade }, bindings);
  const dependencyStatus = raw.dependencyStatus?.length
    ? raw.dependencyStatus
    : (raw.dependencies ?? fallback?.dependencies ?? connectors.map((c) => c.slot)).map((name) => ({
        name,
        status: (evaluated.blockers.some((b) => b.startsWith(`${name}：`)) ? 'unauthorized' : 'ready') as 'ready' | 'unauthorized',
        reason: evaluated.blockers.find((b) => b.startsWith(`${name}：`)),
      }));
  const blockers = evaluated.blockers.length
    ? evaluated.blockers
    : deriveTemplateBlockers({
      health: evaluated.health,
      dependencyStatus,
      blockers: raw.blockers ?? fallback?.blockers ?? [],
    });
  const health: WorkflowTemplateAsset['health'] = blockers.length > 0 ? '需授权' : evaluated.health;
  const department = (raw.department as DepartmentKey | undefined)
    ?? fallback?.department
    ?? matchDepartmentKey(raw.owner)
    ?? 'it';
  return {
    id: raw.id,
    name: raw.name,
    version: raw.version ?? fallback?.version ?? '1.0.0',
    category: (raw.category as WorkflowTemplateAsset['category']) ?? fallback?.category ?? 'business',
    department,
    departmentLabel: raw.departmentLabel ?? fallback?.departmentLabel ?? departmentLabel(department),
    audience: raw.audience ?? fallback?.audience ?? '内部用户',
    description: raw.description ?? fallback?.description ?? '',
    nodes: raw.nodes ?? fallback?.nodes ?? (raw.sequence?.length ?? 0),
    installs: raw.installs ?? fallback?.installs ?? 0,
    rating: raw.rating ?? fallback?.rating ?? 0,
    owner: raw.owner ?? fallback?.owner ?? '平台内置',
    verifiedAt: raw.verifiedAt ?? fallback?.verifiedAt ?? '—',
    risk: (raw.risk as WorkflowTemplateAsset['risk']) ?? fallback?.risk ?? 'L2',
    dependencies: raw.dependencies ?? fallback?.dependencies ?? connectors.map((c) => c.slot),
    dependencyStatus,
    health,
    healthHint: raw.healthHint ?? evaluated.healthHint ?? fallback?.healthHint,
    successRate: raw.successRate ?? fallback?.successRate ?? (raw.certification === 'certified' || fallback?.certification === 'certified' ? 'Certified' : '—'),
    sequence: (raw.sequence as WorkflowTemplateAsset['sequence']) ?? fallback?.sequence ?? ['event', 'decision', 'audit', 'notify'],
    blockers,
    variables: raw.variables ?? fallback?.variables ?? [],
    permissions: raw.permissions ?? fallback?.permissions ?? [],
    changelog: raw.changelog ?? fallback?.changelog ?? [],
    recentRuns: raw.recentRuns ?? fallback?.recentRuns ?? [],
    library: raw.library ?? fallback?.library ?? 'default',
    parentId: raw.parentId ?? fallback?.parentId,
    suggestedExpertRole: raw.suggestedExpertRole ?? fallback?.suggestedExpertRole,
    certification: raw.certification ?? fallback?.certification ?? (raw.library === 'advanced' ? 'advanced' : 'certified'),
    industryTags: raw.industryTags ?? fallback?.industryTags ?? ['all'],
    connectors,
    degrade,
    antiPatterns: raw.antiPatterns ?? fallback?.antiPatterns,
    graph: raw.graph ?? fallback?.graph,
    fixtures: raw.fixtures ?? fallback?.fixtures,
    builtin: raw.builtin ?? fallback?.builtin ?? (raw.source === 'personal' || raw.source === 'user' ? false : true),
    source: raw.source ?? fallback?.source ?? (raw.builtin === false ? 'personal' : 'platform'),
    ownerId: raw.ownerId ?? fallback?.ownerId,
    workspaceId: raw.workspaceId ?? fallback?.workspaceId,
    createdAt: raw.createdAt ?? fallback?.createdAt,
    updatedAt: raw.updatedAt ?? fallback?.updatedAt,
    knowledgePackageIds: raw.knowledgePackageIds ?? fallback?.knowledgePackageIds ?? [],
    requiredSkills: raw.requiredSkills ?? fallback?.requiredSkills ?? [],
    optionalSkills: raw.optionalSkills ?? fallback?.optionalSkills ?? [],
    scenarioId: raw.scenarioId ?? fallback?.scenarioId,
  };
}