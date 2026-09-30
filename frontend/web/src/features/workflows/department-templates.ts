/**
 * 出厂默认流程模板（Certified）+ IT 高级库
 * 与 backend/builtin/workflows 对齐；API 不可用时作为前端回退源。
 */
import type { WorkflowNodeKind } from '@qzda/web-types';

export type TemplateHealth = '健康' | '需授权';
export type TemplateLibrary = 'default' | 'advanced';
export type TemplateCertification = 'certified' | 'preview' | 'advanced';
export type TemplateOrigin = 'platform' | 'personal';
export type DepartmentKey = 'office' | 'hr' | 'finance' | 'sales' | 'marketing' | 'operations' | 'rd' | 'it';

export type ConnectorSlot = {
  slot: string;
  label: string;
  required: boolean;
  capability: string;
  defaultBinding?: string;
};

export type TemplateDegrade = {
  whenMissingSlots: string[];
  mode: 'approval_only' | 'read_only';
  hint: string;
};

export type WorkflowTemplateAsset = {
  id: string;
  name: string;
  version: string;
  category: 'business' | 'system' | 'security' | 'ai';
  department: DepartmentKey;
  departmentLabel: string;
  audience: string;
  description: string;
  nodes: number;
  installs: number;
  rating: number;
  owner: string;
  verifiedAt: string;
  risk: 'L1' | 'L2' | 'L3';
  dependencies: string[];
  dependencyStatus: Array<{ name: string; status: 'ready' | 'unauthorized'; reason?: string }>;
  health: TemplateHealth;
  healthHint?: string;
  successRate: string;
  sequence: WorkflowNodeKind[];
  blockers: string[];
  variables: Array<{ key: string; label: string; required: boolean }>;
  permissions: Array<{ action: string; gate: string }>;
  changelog: Array<{ version: string; date: string; note: string }>;
  recentRuns: Array<{ id: string; time: string; status: 'success' | 'failed'; note: string }>;
  library: TemplateLibrary;
  parentId?: string;
  suggestedExpertRole?: string;
  certification: TemplateCertification;
  industryTags: string[];
  connectors: ConnectorSlot[];
  degrade?: TemplateDegrade;
  antiPatterns?: string;
  graph?: {
    nodes: Array<{ id: string; kind: string; label?: string; position?: { x: number; y: number } }>;
    edges: Array<{ id: string; source: string; target: string }>;
  };
  fixtures?: Array<{ name: string; variables: Record<string, unknown> }>;
  builtin?: boolean;
  /** platform = 平台内置；personal = 个人创建 */
  source?: TemplateOrigin | string;
  ownerId?: string;
  workspaceId?: string;
  createdAt?: string;
  updatedAt?: string;
  /** 办公开箱：配套知识包 */
  knowledgePackageIds?: string[];
  /** 办公开箱：推荐/必选技能 */
  requiredSkills?: string[];
  optionalSkills?: string[];
  scenarioId?: string;
};

export function templateOrigin(
  template: Pick<WorkflowTemplateAsset, 'builtin' | 'source' | 'id'>,
): TemplateOrigin {
  const source = String(template.source ?? '').toLowerCase();
  if (source === 'personal' || source === 'user' || source === 'workspace') return 'personal';
  if (template.builtin === false) return 'personal';
  const id = String(template.id ?? '');
  if (id.startsWith('wft-user-') || id.startsWith('personal.') || id.startsWith('user.')) return 'personal';
  if (source === 'platform' || template.builtin === true) return 'platform';
  if (id.startsWith('wf.')) return 'platform';
  return 'platform';
}

export function isPlatformTemplate(template: Pick<WorkflowTemplateAsset, 'builtin' | 'source' | 'id'>) {
  return templateOrigin(template) === 'platform';
}

export function isPersonalTemplate(template: Pick<WorkflowTemplateAsset, 'builtin' | 'source' | 'id'>) {
  return templateOrigin(template) === 'personal';
}

export const DEPARTMENT_OPTIONS: Array<{ key: DepartmentKey | 'all'; label: string }> = [
  { key: 'all', label: '全部部门' },
  { key: 'office', label: '办公通用' },
  { key: 'hr', label: '人事' },
  { key: 'finance', label: '财务' },
  { key: 'sales', label: '销售' },
  { key: 'marketing', label: '市场' },
  { key: 'operations', label: '运营' },
  { key: 'rd', label: '研发' },
  { key: 'it', label: 'IT' },
];

export const INDUSTRY_OPTIONS = [
  { key: 'all', label: '全部行业' },
  { key: 'saas', label: 'SaaS' },
  { key: 'manufacturing', label: '制造' },
  { key: 'retail', label: '零售' },
  { key: 'b2b', label: 'B2B' },
  { key: 'internet', label: '互联网' },
  { key: 'finance', label: '金融' },
  { key: 'healthcare', label: '医疗' },
] as const;

export function departmentLabel(key: DepartmentKey | string): string {
  return DEPARTMENT_OPTIONS.find((item) => item.key === key)?.label ?? String(key);
}

export function matchDepartmentKey(raw: string | undefined | null): DepartmentKey | null {
  const text = String(raw ?? '').toLowerCase();
  if (!text) return null;
  if (/办公|office|行政|全员/.test(text)) return 'office';
  if (/人事|人力|hr|human/.test(text)) return 'hr';
  if (/财务|finance|会计|资金/.test(text)) return 'finance';
  if (/销售|sales|商务|客户成功/.test(text)) return 'sales';
  if (/市场|marketing|品牌|增长/.test(text)) return 'marketing';
  if (/运营|operations|客服|客诉/.test(text)) return 'operations';
  if (/研发|rd|工程|开发|产品技术/.test(text)) return 'rd';
  if (/it|信息|基础设|平台|运维|sre|安全|合规/.test(text)) return 'it';
  return null;
}

function tpl(
  partial: Omit<WorkflowTemplateAsset, 'nodes' | 'library' | 'category' | 'departmentLabel' | 'certification' | 'industryTags' | 'connectors'> & {
    library?: TemplateLibrary;
    category?: WorkflowTemplateAsset['category'];
    certification?: TemplateCertification;
    industryTags?: string[];
    connectors?: ConnectorSlot[];
  },
): WorkflowTemplateAsset {
  const library = partial.library ?? 'default';
  const certification = partial.certification
    ?? (library === 'advanced' ? 'advanced' : 'certified');
  return {
    ...partial,
    library,
    certification,
    industryTags: partial.industryTags ?? ['all'],
    connectors: partial.connectors ?? [],
    category: partial.category ?? (library === 'advanced' ? 'system' : 'business'),
    departmentLabel: departmentLabel(partial.department),
    nodes: partial.sequence.length,
    builtin: true,
    source: 'platform',
  };
}

const ready = (name: string) => ({ name, status: 'ready' as const });
const slot = (s: Omit<ConnectorSlot, 'capability'> & { capability?: string }): ConnectorSlot => ({
  capability: s.capability ?? s.slot,
  ...s,
});

/** 出厂 Certified 主清单（与 builtin/workflows 对齐） */
export const DEPARTMENT_TEMPLATES: WorkflowTemplateAsset[] = [
  tpl({
    id: 'wf.hr.onboarding', name: '员工入职开通', version: '1.0.0', department: 'hr',
    audience: '新员工 / HRBP / IT', description: '入职申请、材料核验、账号开通、权限分配与欢迎通知；跨行业通用。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L2',
    dependencies: ['identity.provision', 'notify.send'],
    dependencyStatus: [ready('identity.provision'), ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'retrieve', 'decision', 'approval', 'execute', 'task', 'audit', 'notify'], blockers: [],
    variables: [
      { key: 'employee_name', label: '入职人姓名', required: true },
      { key: 'start_date', label: '入职日期', required: true },
      { key: 'role_profile', label: '岗位画像', required: true },
      { key: 'permission_set', label: '权限集', required: true },
    ],
    permissions: [{ action: '开通企业账号', gate: '人事经理审批' }],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '出厂 Certified 首发' }],
    recentRuns: [{ id: 'fx-onboard', time: '沙箱', status: 'success', note: 'fixture 通过' }],
    suggestedExpertRole: '人事经理', industryTags: ['all', 'saas', 'manufacturing', 'retail'],
    connectors: [
      slot({ slot: 'identity.provision', label: '账号开通', required: true, defaultBinding: 'sandbox:identity.mock' }),
      slot({ slot: 'knowledge.retrieve', label: '制度知识检索', required: false, defaultBinding: 'builtin:knowledge.retrieve' }),
      slot({ slot: 'notify.send', label: '通知渠道', required: true }),
    ],
    antiPatterns: '不适用于外包临时访客的分钟级开通（请用权限申请模板）。',
  }),
  tpl({
    id: 'wf.hr.offboarding', name: '离职交接与权限回收', version: '1.0.0', department: 'hr',
    audience: '离职员工 / HRBP / IT', description: '资产交还、账号回收、证明开具与交接确认，保障离场安全基线。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L2',
    dependencies: ['identity.revoke', 'notify.send'],
    dependencyStatus: [ready('identity.revoke'), ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'retrieve', 'approval', 'execute', 'audit', 'notify'], blockers: [],
    variables: [
      { key: 'employee_id', label: '员工工号', required: true },
      { key: 'last_day', label: '最后工作日', required: true },
    ],
    permissions: [{ action: '回收账号权限', gate: '人事经理 + IT 审批' }],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '出厂 Certified 首发' }],
    recentRuns: [{ id: 'fx-offboard', time: '沙箱', status: 'success', note: 'fixture 通过' }],
    suggestedExpertRole: '人事经理', industryTags: ['all'],
    connectors: [
      slot({ slot: 'identity.revoke', label: '权限回收', required: true, defaultBinding: 'sandbox:identity.mock' }),
      slot({ slot: 'notify.send', label: '通知渠道', required: true }),
    ],
  }),
  tpl({
    id: 'wf.it.access_request', name: '权限申请', version: '1.0.0', department: 'it',
    audience: '全体员工 / IT 服务台', description: '权限申请、影响评估、审批开通/时限授权与到期回收。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L2',
    dependencies: ['identity.provision', 'notify.send'],
    dependencyStatus: [ready('identity.provision'), ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'retrieve', 'decision', 'approval', 'execute', 'schedule', 'audit', 'notify'], blockers: [],
    variables: [
      { key: 'account', label: '账号', required: true },
      { key: 'permission_set', label: '权限集', required: true },
      { key: 'expire_days', label: '授权天数', required: false },
    ],
    permissions: [{ action: '变更权限', gate: 'IT 管理员审批' }],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '出厂 Certified 首发' }],
    recentRuns: [{ id: 'fx-access', time: '沙箱', status: 'success', note: 'fixture 通过' }],
    suggestedExpertRole: 'IT 支持专员', industryTags: ['all'],
    connectors: [
      slot({ slot: 'identity.provision', label: '权限变更', required: true, defaultBinding: 'sandbox:identity.mock' }),
      slot({ slot: 'notify.send', label: '通知渠道', required: true }),
    ],
  }),
  tpl({
    id: 'wf.fin.expense', name: '费用报销', version: '1.0.0', department: 'finance',
    audience: '报销人 / 财务共享',
    description: '票据校验、预算核验、分级审批；无付款连接器时可降级为仅审批闭环。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L3',
    dependencies: ['notify.send', 'payment.initiate'],
    dependencyStatus: [ready('notify.send'), { name: 'payment.initiate', status: 'unauthorized', reason: 'payment.initiate：未绑定付款连接器（可降级）' }],
    health: '健康', healthHint: '未绑定付款连接器：本模板以降级模式运行（仅审批与归档，不发起付款）。',
    successRate: 'Certified',
    sequence: ['event', 'retrieve', 'decision', 'policy', 'approval', 'execute', 'compensate', 'audit', 'notify'],
    blockers: [],
    variables: [
      { key: 'amount', label: '报销金额', required: true },
      { key: 'cost_center', label: '成本中心', required: true },
      { key: 'invoice_ids', label: '票据编号', required: true },
    ],
    permissions: [{ action: '发起付款', gate: '财务负责人审批（可选付款槽位）' }],
    changelog: [
      { version: '1.0.0', date: '2026-08-21', note: '出厂 Certified；支持付款槽位降级' },
      { version: '1.1.0', date: '2026-09-01', note: '（预告）预算科目多维校验' },
    ],
    recentRuns: [{ id: 'fx-expense', time: '沙箱', status: 'success', note: '降级 fixture 通过' }],
    suggestedExpertRole: '财务专员', industryTags: ['all', 'saas', 'retail'],
    connectors: [
      slot({ slot: 'knowledge.retrieve', label: '财务制度检索', required: false, defaultBinding: 'builtin:knowledge.retrieve' }),
      slot({ slot: 'payment.initiate', label: '付款执行', required: false }),
      slot({ slot: 'notify.send', label: '通知渠道', required: true }),
    ],
    degrade: {
      whenMissingSlots: ['payment.initiate'],
      mode: 'approval_only',
      hint: '未绑定付款连接器：本模板以降级模式运行（仅审批与归档，不发起付款）。',
    },
  }),
  tpl({
    id: 'wf.fin.purchase', name: '采购申请', version: '1.0.0', department: 'finance',
    audience: '采购 / 预算责任人', description: '采购立项、预算占用、审批与订单回写；可按企业裁剪三单匹配。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L3',
    dependencies: ['notify.send'],
    dependencyStatus: [ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'retrieve', 'decision', 'approval', 'execute', 'task', 'audit', 'notify'], blockers: [],
    variables: [
      { key: 'po_title', label: '采购事项', required: true },
      { key: 'budget_code', label: '预算科目', required: true },
      { key: 'amount', label: '金额', required: true },
    ],
    permissions: [{ action: '占用预算', gate: '预算责任人 + 财务审批' }],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '出厂 Certified 首发' }],
    recentRuns: [{ id: 'fx-po', time: '沙箱', status: 'success', note: 'fixture 通过' }],
    suggestedExpertRole: '财务专员', industryTags: ['all', 'manufacturing'],
    connectors: [
      slot({ slot: 'erp.purchase', label: '采购/ERP', required: false }),
      slot({ slot: 'notify.send', label: '通知渠道', required: true }),
    ],
  }),
  tpl({
    id: 'wf.ops.ticket_escalate', name: '客诉升级闭环', version: '1.0.0', department: 'operations',
    audience: '客服 / 运营 / 值班', description: '工单分级、SLA 监控、升级人工、回访与知识沉淀。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L2',
    dependencies: ['notify.send'],
    dependencyStatus: [ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'retrieve', 'decision', 'task', 'approval', 'execute', 'audit', 'notify'], blockers: [],
    variables: [
      { key: 'ticket_id', label: '工单号', required: true },
      { key: 'sla_minutes', label: 'SLA（分钟）', required: false },
    ],
    permissions: [{ action: '升级人工', gate: '值班负责人' }],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '出厂 Certified 首发' }],
    recentRuns: [{ id: 'fx-ticket', time: '沙箱', status: 'success', note: 'fixture 通过' }],
    suggestedExpertRole: '运营专员', industryTags: ['all', 'retail', 'saas'],
    connectors: [
      slot({ slot: 'ticket.manage', label: '工单系统', required: false }),
      slot({ slot: 'knowledge.retrieve', label: '知识检索', required: false, defaultBinding: 'builtin:knowledge.retrieve' }),
      slot({ slot: 'notify.send', label: '通知渠道', required: true }),
    ],
  }),
  tpl({
    id: 'wf.sales.contract_approve', name: '合同与折扣审批', version: '1.0.0', department: 'sales',
    audience: '销售代表 / 销售经理', description: '商机报价、折扣超阈审批、合同归档与 CRM 阶段回写。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L2',
    dependencies: ['notify.send'],
    dependencyStatus: [ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'retrieve', 'decision', 'policy', 'approval', 'execute', 'audit', 'notify'], blockers: [],
    variables: [
      { key: 'opportunity_id', label: '商机编号', required: true },
      { key: 'discount_pct', label: '折扣比例', required: false },
      { key: 'contract_amount', label: '合同金额', required: true },
    ],
    permissions: [{ action: '合同盖章申请', gate: '销售经理审批' }],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '出厂 Certified 首发' }],
    recentRuns: [{ id: 'fx-contract', time: '沙箱', status: 'success', note: 'fixture 通过' }],
    suggestedExpertRole: '销售顾问', industryTags: ['saas', 'b2b'],
    connectors: [
      slot({ slot: 'crm.update_stage', label: 'CRM 回写', required: false }),
      slot({ slot: 'notify.send', label: '通知渠道', required: true }),
    ],
  }),
  tpl({
    id: 'wf.rd.release_gate', name: '发版门禁', version: '1.0.0', department: 'rd',
    audience: '产品 / 研发负责人', description: '需求关联、测试门禁、环境审批到发布通报；对齐沙箱/预发/生产。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L2',
    dependencies: ['notify.send'],
    dependencyStatus: [ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'retrieve', 'decision', 'approval', 'parallel', 'condition', 'execute', 'audit', 'notify'], blockers: [],
    variables: [
      { key: 'requirement_id', label: '需求编号', required: true },
      { key: 'target_env', label: '目标环境', required: true },
    ],
    permissions: [{ action: '生产发版', gate: '研发负责人审批' }],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '出厂 Certified 首发' }],
    recentRuns: [{ id: 'fx-release', time: '沙箱', status: 'success', note: 'fixture 通过' }],
    suggestedExpertRole: '研发效能专家', industryTags: ['saas', 'internet'],
    connectors: [
      slot({ slot: 'ci.pipeline', label: 'CI/发布', required: false }),
      slot({ slot: 'notify.send', label: '通知渠道', required: true }),
    ],
  }),
  tpl({
    id: 'wf.compliance.export_review', name: '数据导出审批', version: '1.0.0', department: 'it',
    audience: '业务申请人 / 合规 / 数据管理员', description: '敏感数据导出申请、脱敏策略校验、审批与审计留痕。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L3',
    dependencies: ['notify.send'],
    dependencyStatus: [ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'policy', 'decision', 'approval', 'execute', 'audit', 'notify'], blockers: [],
    variables: [
      { key: 'dataset', label: '数据集', required: true },
      { key: 'classification', label: '密级', required: true },
      { key: 'purpose', label: '用途说明', required: true },
    ],
    permissions: [{ action: '导出敏感数据', gate: '合规 + 数据责任人' }],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '出厂 Certified 首发' }],
    recentRuns: [{ id: 'fx-export', time: '沙箱', status: 'success', note: 'fixture 通过' }],
    suggestedExpertRole: '合规审计员', industryTags: ['all', 'finance', 'healthcare'],
    connectors: [
      slot({ slot: 'data.export', label: '导出执行', required: false }),
      slot({ slot: 'notify.send', label: '通知渠道', required: true }),
    ],
  }),
];

export const IT_ADVANCED_TEMPLATES: WorkflowTemplateAsset[] = [
  tpl({
    id: 'wf.it.incident_mitigate', name: '生产事件缓解', version: '1.0.0', department: 'it', audience: 'SRE / 平台',
    description: '告警触发、研判、双重审批、受控执行与补偿回滚（运维高级库）。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L3',
    dependencies: ['infra.execute', 'notify.send'],
    dependencyStatus: [
      { name: 'infra.execute', status: 'unauthorized', reason: 'infra.execute：当前工作区未授权生产写权限' },
      ready('notify.send'),
    ],
    health: '需授权', successRate: 'Advanced',
    sequence: ['event', 'retrieve', 'decision', 'policy', 'approval', 'execute', 'compensate', 'audit', 'notify'],
    blockers: ['infra.execute：当前工作区未授权生产写权限'],
    variables: [
      { key: 'incident_id', label: '事件单号', required: true },
      { key: 'cluster', label: '目标集群', required: true },
    ],
    permissions: [{ action: '生产受控执行', gate: '双重审批 + 生产写权限' }],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: 'IT 高级库' }],
    recentRuns: [{ id: 'fx-incident', time: '沙箱', status: 'failed', note: '缺生产写权限' }],
    library: 'advanced', category: 'system', suggestedExpertRole: 'SRE 专家',
    certification: 'advanced', industryTags: ['internet', 'saas'],
    connectors: [
      slot({ slot: 'infra.execute', label: '受控执行', required: true }),
      slot({ slot: 'notify.send', label: '通知渠道', required: true }),
    ],
  }),
  tpl({
    id: 'tpl-adv-cache-oom', name: 'cache-oom 受控恢复', version: '2.4.0', department: 'it', audience: 'SRE / 平台',
    description: 'Redis 缓存 OOM 受控恢复 + LRU 策略；生产写操作需授权与补偿回滚。',
    installs: 0, rating: 4.8, owner: 'SRE 平台组', verifiedAt: '2026-07-16', risk: 'L3',
    dependencies: ['redis-cli', 'kubernetes-mcp'],
    dependencyStatus: [ready('redis-cli'), { name: 'kubernetes-mcp', status: 'unauthorized', reason: 'kubernetes-mcp：当前工作区未授权生产写权限' }],
    health: '需授权', successRate: 'Advanced',
    sequence: ['event', 'retrieve', 'decision', 'policy', 'approval', 'execute', 'compensate', 'audit', 'notify'],
    blockers: ['kubernetes-mcp：当前工作区未授权生产写权限'],
    variables: [{ key: 'cluster', label: '目标集群', required: true }, { key: 'approver_group', label: '审批组', required: true }],
    permissions: [{ action: 'CONFIG SET', gate: '双重审批 + 生产写权限' }],
    changelog: [{ version: '2.4.0', date: '2026-07-16', note: '迁入 IT 高级库' }],
    recentRuns: [{ id: 'r-adv-01', time: '07-16 14:28', status: 'success', note: '验证集通过' }],
    library: 'advanced', category: 'system', suggestedExpertRole: 'SRE 专家',
    certification: 'advanced', industryTags: ['internet', 'saas'],
    connectors: [
      slot({ slot: 'infra.execute', label: '受控执行', required: true }),
      slot({ slot: 'notify.send', label: '通知渠道', required: true }),
    ],
  }),
];

/** 办公开箱 Certified（与 builtin/workflows/wf.office.* 对齐） */
export const OFFICE_TEMPLATES: WorkflowTemplateAsset[] = [
  tpl({
    id: 'wf.office.ask_policy', name: '制度问答与答复留痕', version: '1.0.0', department: 'office',
    audience: '全员 / 办公协作', description: '针对制度疑问检索员工手册与制度包，生成可留痕答复并通知提问人。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L1',
    dependencies: ['knowledge.retrieve', 'notify.send'], dependencyStatus: [ready('knowledge.retrieve'), ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'retrieve', 'decision', 'audit', 'notify'], blockers: [],
    variables: [{ key: 'question', label: '制度问题', required: true }], permissions: [],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '办公开箱首发' }], recentRuns: [],
    suggestedExpertRole: '办公助手', knowledgePackageIds: ['kp.office.handbook', 'kp.office.leave_travel'],
    requiredSkills: ['summarize'], scenarioId: 'sc.office.ask_policy',
    connectors: [
      slot({ slot: 'knowledge.retrieve', label: '知识检索', required: false, defaultBinding: 'builtin:knowledge.retrieve' }),
      slot({ slot: 'notify.send', label: '通知渠道', required: false }),
    ],
  }),
  tpl({
    id: 'wf.office.meeting_minutes', name: '会议纪要生成与分发', version: '1.0.0', department: 'office',
    audience: '全员 / 办公协作', description: '按会议规范整理要点，生成纪要文档并分发给参会人。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L1',
    dependencies: ['knowledge.retrieve', 'notify.send'], dependencyStatus: [ready('knowledge.retrieve'), ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'retrieve', 'decision', 'execute', 'task', 'audit', 'notify'], blockers: [],
    variables: [{ key: 'meeting_title', label: '会议主题', required: true }], permissions: [],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '办公开箱首发' }], recentRuns: [],
    suggestedExpertRole: '办公助手', knowledgePackageIds: ['kp.office.meeting'],
    requiredSkills: ['summarize', 'docx'], optionalSkills: ['pdf'], scenarioId: 'sc.office.meeting_minutes',
    connectors: [
      slot({ slot: 'knowledge.retrieve', label: '知识检索', required: false, defaultBinding: 'builtin:knowledge.retrieve' }),
      slot({ slot: 'notify.send', label: '通知渠道', required: false }),
    ],
  }),
  tpl({
    id: 'wf.office.weekly_report', name: '周报汇总', version: '1.0.0', department: 'office',
    audience: '全员 / 办公协作', description: '汇总本周工作进展，按写作规范生成周报并通知相关人。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L1',
    dependencies: ['knowledge.retrieve', 'notify.send'], dependencyStatus: [ready('knowledge.retrieve'), ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['schedule', 'retrieve', 'transform', 'execute', 'audit', 'notify'], blockers: [],
    variables: [{ key: 'week', label: '周次', required: true }], permissions: [],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '办公开箱首发' }], recentRuns: [],
    suggestedExpertRole: '办公助手', knowledgePackageIds: ['kp.office.writing'],
    requiredSkills: ['summarize', 'docx'], scenarioId: 'sc.office.weekly_report',
    connectors: [
      slot({ slot: 'knowledge.retrieve', label: '知识检索', required: false, defaultBinding: 'builtin:knowledge.retrieve' }),
      slot({ slot: 'notify.send', label: '通知渠道', required: false }),
    ],
  }),
  tpl({
    id: 'wf.office.doc_review', name: '文档审阅与定稿', version: '1.0.0', department: 'office',
    audience: '全员 / 办公协作', description: '按文档质量清单审阅材料，经确认后定稿归档。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L2',
    dependencies: ['knowledge.retrieve', 'notify.send'], dependencyStatus: [ready('knowledge.retrieve'), ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'retrieve', 'approval', 'execute', 'audit', 'notify'], blockers: [],
    variables: [{ key: 'doc_title', label: '文档标题', required: true }], permissions: [],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '办公开箱首发' }], recentRuns: [],
    suggestedExpertRole: '办公助手', knowledgePackageIds: ['kp.office.writing'],
    requiredSkills: ['docx', 'pdf'], scenarioId: 'sc.office.doc_review',
    connectors: [
      slot({ slot: 'knowledge.retrieve', label: '知识检索', required: false, defaultBinding: 'builtin:knowledge.retrieve' }),
      slot({ slot: 'notify.send', label: '通知渠道', required: false }),
    ],
  }),
  tpl({
    id: 'wf.office.leave_request', name: '请假申请', version: '1.0.0', department: 'office',
    audience: '全员 / 办公协作', description: '对照假勤制度提交请假，经审批后通知相关人。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L2',
    dependencies: ['knowledge.retrieve', 'notify.send'], dependencyStatus: [ready('knowledge.retrieve'), ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'retrieve', 'policy', 'approval', 'audit', 'notify'], blockers: [],
    variables: [{ key: 'leave_type', label: '假种', required: true }, { key: 'days', label: '天数', required: true }], permissions: [],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '办公开箱首发' }], recentRuns: [],
    suggestedExpertRole: '办公助手', knowledgePackageIds: ['kp.office.leave_travel'],
    requiredSkills: [], scenarioId: 'sc.office.leave_request',
    connectors: [
      slot({ slot: 'knowledge.retrieve', label: '知识检索', required: false, defaultBinding: 'builtin:knowledge.retrieve' }),
      slot({ slot: 'notify.send', label: '通知渠道', required: false }),
    ],
  }),
  tpl({
    id: 'wf.office.travel_request', name: '出差申请', version: '1.0.0', department: 'office',
    audience: '全员 / 办公协作', description: '对照差旅标准提交出差申请，审批后通知与留痕。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L2',
    dependencies: ['knowledge.retrieve', 'notify.send'], dependencyStatus: [ready('knowledge.retrieve'), ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'retrieve', 'policy', 'approval', 'task', 'audit', 'notify'], blockers: [],
    variables: [{ key: 'destination', label: '目的地', required: true }], permissions: [],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '办公开箱首发' }], recentRuns: [],
    suggestedExpertRole: '办公助手', knowledgePackageIds: ['kp.office.leave_travel'],
    requiredSkills: [], scenarioId: 'sc.office.travel_request',
    connectors: [
      slot({ slot: 'knowledge.retrieve', label: '知识检索', required: false, defaultBinding: 'builtin:knowledge.retrieve' }),
      slot({ slot: 'notify.send', label: '通知渠道', required: false }),
    ],
  }),
  tpl({
    id: 'wf.office.expense_precheck', name: '报销前自查', version: '1.0.0', department: 'office',
    audience: '全员 / 办公协作', description: '按报销常识自查票据与不可报项，通过后可衔接部门报销流程。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L1',
    dependencies: ['knowledge.retrieve', 'notify.send'], dependencyStatus: [ready('knowledge.retrieve'), ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'retrieve', 'decision', 'task', 'audit', 'notify'], blockers: [],
    variables: [{ key: 'amount', label: '金额', required: true }], permissions: [],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '办公开箱首发' }], recentRuns: [],
    suggestedExpertRole: '办公助手', knowledgePackageIds: ['kp.office.expense_lite'],
    requiredSkills: ['summarize'], scenarioId: 'sc.office.expense_precheck',
    antiPatterns: '不替代财务费用报销主流程（请用 wf.fin.expense）。',
    connectors: [
      slot({ slot: 'knowledge.retrieve', label: '知识检索', required: false, defaultBinding: 'builtin:knowledge.retrieve' }),
      slot({ slot: 'notify.send', label: '通知渠道', required: false }),
    ],
  }),
  tpl({
    id: 'wf.office.meeting_book', name: '会议预约协作', version: '1.0.0', department: 'office',
    audience: '全员 / 办公协作', description: '发起会议预约意向，确认时间与参会人后通知相关方。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L1',
    dependencies: ['notify.send'], dependencyStatus: [ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'condition', 'approval', 'task', 'notify'], blockers: [],
    variables: [{ key: 'slot', label: '期望时段', required: true }], permissions: [],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '办公开箱首发' }], recentRuns: [],
    suggestedExpertRole: '办公助手', knowledgePackageIds: ['kp.office.meeting'],
    requiredSkills: [], scenarioId: 'sc.office.meeting_book',
    connectors: [slot({ slot: 'notify.send', label: '通知渠道', required: false })],
  }),
  tpl({
    id: 'wf.office.it_helpdesk', name: 'IT 求助工单', version: '1.0.0', department: 'office',
    audience: '全员 / 办公协作', description: '先检索 IT 自助知识，无法解决则升级人工处理并通知。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L1',
    dependencies: ['knowledge.retrieve', 'notify.send'], dependencyStatus: [ready('knowledge.retrieve'), ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'retrieve', 'decision', 'task', 'audit', 'notify'], blockers: [],
    variables: [{ key: 'issue', label: '问题描述', required: true }], permissions: [],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '办公开箱首发' }], recentRuns: [],
    suggestedExpertRole: '办公助手', knowledgePackageIds: ['kp.office.it_selfservice'],
    requiredSkills: ['summarize'], scenarioId: 'sc.office.it_helpdesk',
    connectors: [
      slot({ slot: 'knowledge.retrieve', label: '知识检索', required: false, defaultBinding: 'builtin:knowledge.retrieve' }),
      slot({ slot: 'notify.send', label: '通知渠道', required: false }),
    ],
  }),
  tpl({
    id: 'wf.office.announce', name: '通知拟稿与发布', version: '1.0.0', department: 'office',
    audience: '全员 / 办公协作', description: '按写作规范拟订通知，审批后通过渠道发布。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L2',
    dependencies: ['knowledge.retrieve', 'notify.send'], dependencyStatus: [ready('knowledge.retrieve'), ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['event', 'retrieve', 'approval', 'execute', 'audit', 'notify'], blockers: [],
    variables: [{ key: 'title', label: '通知标题', required: true }], permissions: [],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '办公开箱首发' }], recentRuns: [],
    suggestedExpertRole: '办公助手', knowledgePackageIds: ['kp.office.writing', 'kp.office.handbook'],
    requiredSkills: ['docx', 'summarize'], scenarioId: 'sc.office.announce',
    connectors: [
      slot({ slot: 'knowledge.retrieve', label: '知识检索', required: false, defaultBinding: 'builtin:knowledge.retrieve' }),
      slot({ slot: 'notify.send', label: '通知渠道', required: false }),
    ],
  }),
  tpl({
    id: 'wf.office.todo_followup', name: '待办跟催', version: '1.0.0', department: 'office',
    audience: '全员 / 办公协作', description: '对会议纪要或任务中的动作项到期提醒并回传结果。',
    installs: 0, rating: 5, owner: '平台内置', verifiedAt: '2026-08-21', risk: 'L1',
    dependencies: ['knowledge.retrieve', 'notify.send'], dependencyStatus: [ready('knowledge.retrieve'), ready('notify.send')],
    health: '健康', successRate: 'Certified',
    sequence: ['schedule', 'retrieve', 'task', 'notify'], blockers: [],
    variables: [{ key: 'todo_id', label: '待办编号', required: true }], permissions: [],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '办公开箱首发' }], recentRuns: [],
    suggestedExpertRole: '办公助手', knowledgePackageIds: ['kp.office.meeting'],
    requiredSkills: [], scenarioId: 'sc.office.todo_followup',
    connectors: [
      slot({ slot: 'knowledge.retrieve', label: '知识检索', required: false, defaultBinding: 'builtin:knowledge.retrieve' }),
      slot({ slot: 'notify.send', label: '通知渠道', required: false }),
    ],
  }),
];

export const ALL_WORKFLOW_TEMPLATES: WorkflowTemplateAsset[] = [...OFFICE_TEMPLATES, ...DEPARTMENT_TEMPLATES, ...IT_ADVANCED_TEMPLATES];
export const DEFAULT_VISIBLE_TEMPLATES = [...OFFICE_TEMPLATES, ...DEPARTMENT_TEMPLATES];
export const FACTORY_CERTIFIED_IDS = DEFAULT_VISIBLE_TEMPLATES.filter((t) => t.certification === 'certified').map((t) => t.id);

const PLATFORM_SATISFIED = new Set(['notify.send', 'knowledge.retrieve']);

export type ConnectorBindings = Record<string, string>;

export function connectorBindingsKey(workspaceId: string) {
  return `de.wf.connector-bindings:${workspaceId}`;
}

export function loadConnectorBindings(workspaceId: string): ConnectorBindings {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(connectorBindingsKey(workspaceId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ConnectorBindings;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveConnectorBindings(workspaceId: string, bindings: ConnectorBindings) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(connectorBindingsKey(workspaceId), JSON.stringify(bindings));
}

export function evaluateTemplateConnectors(
  template: Pick<WorkflowTemplateAsset, 'connectors' | 'degrade'>,
  bindings: ConnectorBindings = {},
): { health: TemplateHealth; blockers: string[]; healthHint?: string; degraded: boolean } {
  const missingRequired: string[] = [];
  const missingOptionalTracked: string[] = [];
  for (const c of template.connectors ?? []) {
    const bound = Boolean(bindings[c.slot] || c.defaultBinding);
    const platformOk = PLATFORM_SATISFIED.has(c.slot);
    if (bound || platformOk) continue;
    if (c.required) missingRequired.push(c.slot);
    else missingOptionalTracked.push(c.slot);
  }
  const degradeSlots = new Set(template.degrade?.whenMissingSlots ?? []);
  const hardMissing = missingRequired.filter((s) => !degradeSlots.has(s));
  if (hardMissing.length) {
    return {
      health: '需授权',
      blockers: hardMissing.map((s) => `${s}：未绑定连接器槽位`),
      degraded: false,
    };
  }
  const degradeMissing = [...missingRequired, ...missingOptionalTracked].filter((s) => degradeSlots.has(s));
  if (degradeMissing.length && template.degrade) {
    return {
      health: '健康',
      blockers: [],
      healthHint: template.degrade.hint,
      degraded: true,
    };
  }
  return { health: '健康', blockers: [], degraded: false };
}

export function isTemplateReusable(template: Pick<WorkflowTemplateAsset, 'health' | 'blockers' | 'dependencyStatus'>) {
  return template.health === '健康'
    && (template.blockers?.length ?? 0) === 0;
}

export function needsTemplateReview(template: Pick<WorkflowTemplateAsset, 'health' | 'blockers' | 'dependencyStatus'>) {
  return !isTemplateReusable(template);
}

export function deriveTemplateBlockers(template: Pick<WorkflowTemplateAsset, 'health' | 'dependencyStatus' | 'blockers'>) {
  if (template.blockers?.length) return template.blockers;
  return (template.dependencyStatus ?? [])
    .filter((item) => item.status === 'unauthorized')
    .map((item) => item.reason ?? `${item.name}：当前工作区未授权`);
}

export function groupTemplatesByDepartment(templates: WorkflowTemplateAsset[]) {
  const order = DEPARTMENT_OPTIONS.filter((item) => item.key !== 'all').map((item) => item.key as DepartmentKey);
  return order
    .map((key) => ({
      key,
      label: departmentLabel(key),
      mains: templates.filter((t) => t.department === key && !t.parentId),
      children: templates.filter((t) => t.department === key && t.parentId),
    }))
    .filter((group) => group.mains.length + group.children.length > 0);
}

export function filterByIndustry(templates: WorkflowTemplateAsset[], industry: string) {
  if (!industry || industry === 'all') return templates;
  return templates.filter((t) => (t.industryTags ?? []).includes('all') || (t.industryTags ?? []).includes(industry));
}

export type TemplateUpgradeDiff = {
  available: boolean;
  fromVersion: string;
  toVersion: string;
  sequenceAdded: string[];
  sequenceRemoved: string[];
  connectorAdded: string[];
  connectorRemoved: string[];
  notes: string[];
};

export function diffTemplateUpgrade(
  current: Pick<WorkflowTemplateAsset, 'version' | 'sequence' | 'connectors' | 'changelog'>,
  latest: Pick<WorkflowTemplateAsset, 'version' | 'sequence' | 'connectors' | 'changelog'>,
): TemplateUpgradeDiff {
  const fromSeq = new Set(current.sequence ?? []);
  const toSeq = new Set(latest.sequence ?? []);
  const fromSlots = new Set((current.connectors ?? []).map((c) => c.slot));
  const toSlots = new Set((latest.connectors ?? []).map((c) => c.slot));
  const notes = (latest.changelog ?? [])
    .filter((c) => c.version === latest.version || compareSemver(c.version, current.version) > 0)
    .map((c) => `${c.version}: ${c.note}`);
  return {
    available: compareSemver(latest.version, current.version) > 0,
    fromVersion: current.version,
    toVersion: latest.version,
    sequenceAdded: [...toSeq].filter((k) => !fromSeq.has(k as WorkflowNodeKind)),
    sequenceRemoved: [...fromSeq].filter((k) => !toSeq.has(k)),
    connectorAdded: [...toSlots].filter((s) => !fromSlots.has(s)),
    connectorRemoved: [...fromSlots].filter((s) => !toSlots.has(s)),
    notes,
  };
}

/** 简易 semver 比较；非数字段按字符串 */
export function compareSemver(a: string, b: string): number {
  const pa = String(a).replace(/^v/i, '').split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = String(b).replace(/^v/i, '').split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x > y ? 1 : -1;
      continue;
    }
    const sx = String(x);
    const sy = String(y);
    if (sx !== sy) return sx > sy ? 1 : -1;
  }
  return 0;
}

/** API/mock 精简列表 */
export function toApiTemplateSummaries(templates: WorkflowTemplateAsset[] = DEFAULT_VISIBLE_TEMPLATES) {
  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    department: t.department,
    library: t.library,
    parentId: t.parentId,
    nodes: t.nodes,
    installs: t.installs,
    rating: t.rating,
    certification: t.certification,
    version: t.version,
    risk: t.risk,
    health: t.health,
    industryTags: t.industryTags,
    connectors: t.connectors,
    builtin: t.builtin !== false,
    source: t.source ?? 'platform',
    owner: t.owner,
  }));
}
