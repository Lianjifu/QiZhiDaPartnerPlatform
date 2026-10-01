/**
 * 专家协作空态「建议试试」：按岗位/部门/职责生成，避免所有专家共用 SRE 示例。
 */

export type ExpertSuggestionIcon =
  | 'zap'
  | 'server'
  | 'shield'
  | 'bell'
  | 'users'
  | 'file'
  | 'clipboard'
  | 'book'
  | 'activity'
  | 'briefcase'
  | 'search'
  | 'wrench';

export type ExpertSuggestion = {
  id: string;
  title: string;
  desc: string;
  icon: ExpertSuggestionIcon;
};

export type ExpertSuggestionSource = {
  role?: string;
  department?: string;
  description?: string;
  serviceObject?: string;
  responsibilities?: string[];
  capabilities?: {
    skills?: string[];
    tools?: string[];
    workflows?: string[];
    knowledge?: string[];
  };
};

type Domain =
  | 'sre'
  | 'security'
  | 'hr'
  | 'finance'
  | 'it_service'
  | 'sales'
  | 'ops'
  | 'generic';

const DOMAIN_PRESETS: Record<Exclude<Domain, 'generic'>, ExpertSuggestion[]> = {
  sre: [
    { id: 'sre-oom', title: 'Redis 集群 OOM', desc: 'prod-redis-01 触发 maxmemory 限制', icon: 'zap' },
    { id: 'sre-k8s', title: 'K8s 节点扩容', desc: '为 cn-east-1 增加 2 个 worker', icon: 'server' },
    { id: 'sre-latency', title: '接口 P95 飙升', desc: '订单服务近 15 分钟延迟翻倍', icon: 'activity' },
    { id: 'sre-runbook', title: '执行受控恢复', desc: '按已发布 Runbook 完成回滚验证', icon: 'wrench' },
  ],
  security: [
    { id: 'sec-cve', title: 'CVE 周报', desc: '本周漏洞与影响资产', icon: 'shield' },
    { id: 'sec-noise', title: '告警降噪', desc: '合并重复 SIEM 告警规则', icon: 'bell' },
    { id: 'sec-hunt', title: '威胁狩猎线索', desc: '关联异常登录与横向移动迹象', icon: 'search' },
    { id: 'sec-baseline', title: '安全基线差距', desc: '汇总未整改控制项与证据缺口', icon: 'clipboard' },
  ],
  hr: [
    { id: 'hr-onboard', title: '入职材料清单', desc: '新员工入职材料是否齐全', icon: 'clipboard' },
    { id: 'hr-policy', title: '人事政策问答', desc: '年假额度与请假流程怎么走', icon: 'book' },
    { id: 'hr-recruit', title: '招聘进度简报', desc: '本周关键岗位面试与 offer 进度', icon: 'users' },
    { id: 'hr-probation', title: '试用期节点提醒', desc: '本月到期试用评估名单', icon: 'file' },
  ],
  finance: [
    { id: 'fin-expense', title: '报销单完整性核验', desc: '缺发票或科目不符的单据清单', icon: 'clipboard' },
    { id: 'fin-invoice', title: '发票制度匹配', desc: '核验票面信息与费用制度', icon: 'file' },
    { id: 'fin-anomaly', title: '费用异常提示', desc: '本周超阈值或重复报销风险', icon: 'activity' },
    { id: 'fin-payment', title: '付款前核对清单', desc: '对公付款申请的必填项与审批链', icon: 'briefcase' },
  ],
  it_service: [
    { id: 'itsm-ticket', title: '工单分诊建议', desc: '根据现象给出处理组与优先级', icon: 'wrench' },
    { id: 'itsm-endpoint', title: '终端故障诊断', desc: '办公电脑无法连接内网 VPN', icon: 'server' },
    { id: 'itsm-access', title: '访问权限申请核验', desc: '核对岗位与系统权限是否匹配', icon: 'shield' },
    { id: 'itsm-collab', title: '协作平台配置请求', desc: '新建项目空间与成员权限建议', icon: 'users' },
  ],
  sales: [
    { id: 'sales-pipeline', title: '商机跟进摘要', desc: '本周重点客户推进与风险点', icon: 'briefcase' },
    { id: 'sales-quote', title: '报价材料核对', desc: '核对折扣、条款与审批要求', icon: 'file' },
    { id: 'sales-handoff', title: '售前转交付清单', desc: '成单后需交接的范围与风险', icon: 'clipboard' },
    { id: 'sales-faq', title: '产品能力问答', desc: '客户关心的交付边界与 SLA', icon: 'book' },
  ],
  ops: [
    { id: 'ops-kpi', title: '运营指标周报', desc: '核心漏斗与异常波动解读', icon: 'activity' },
    { id: 'ops-campaign', title: '活动执行核对', desc: '上线前物料、渠道与风控清单', icon: 'clipboard' },
    { id: 'ops-feedback', title: '用户反馈归类', desc: '本周工单主题与优先改进项', icon: 'users' },
    { id: 'ops-sop', title: 'SOP 执行检查', desc: '关键流程步骤是否按规范完成', icon: 'book' },
  ],
};

function haystack(employee: ExpertSuggestionSource): string {
  return [
    employee.role,
    employee.department,
    employee.description,
    employee.serviceObject,
    ...(employee.responsibilities ?? []),
    ...(employee.capabilities?.skills ?? []),
    ...(employee.capabilities?.workflows ?? []),
    ...(employee.capabilities?.knowledge ?? []),
  ].filter(Boolean).join(' ').toLowerCase();
}

export function detectExpertDomain(employee: ExpertSuggestionSource): Domain {
  const text = haystack(employee);
  const hit = (...words: string[]) => words.some((word) => text.includes(word.toLowerCase()));

  if (hit('人事', '招聘', '入职', '考勤', '编制', '劳动合同', 'hr')) return 'hr';
  if (hit('费用', '报销', '财务', '发票', '付款', '核算', '税务')) return 'finance';
  if (hit('安全', '漏洞', '威胁', 'siem', 'cve', '合规核查', '狩猎')) return 'security';
  if (hit('sre', '故障', '告警', 'redis', 'k8s', '扩容', '运维', '自愈', 'runbook')) return 'sre';
  if (hit('终端', '工单', '服务台', '协作平台', '访问申请', 'itsm', '权限')) return 'it_service';
  if (hit('销售', '商机', '客户', '报价', '签约', '售前')) return 'sales';
  if (hit('运营', '活动', '增长', '漏斗', '投放')) return 'ops';
  return 'generic';
}

function fromResponsibilities(employee: ExpertSuggestionSource): ExpertSuggestion[] {
  const duties = (employee.responsibilities ?? []).map((item) => item.trim()).filter(Boolean);
  const skills = (employee.capabilities?.skills ?? []).map((item) => item.trim()).filter(Boolean);
  const service = employee.serviceObject?.trim();
  const icons: ExpertSuggestionIcon[] = ['clipboard', 'book', 'search', 'activity', 'users', 'file'];

  const seeds = [...duties];
  for (const skill of skills) {
    if (seeds.length >= 4) break;
    if (!seeds.includes(skill)) seeds.push(skill);
  }

  if (seeds.length === 0) {
    const role = employee.role?.trim() || '当前岗位';
    return [
      { id: 'gen-brief', title: `${role}态势简报`, desc: service ? `围绕「${service}」汇总今日重点` : '汇总今日待办与风险', icon: 'activity' },
      { id: 'gen-guide', title: '岗位边界确认', desc: '说明可执行事项与须人工接管场景', icon: 'shield' },
      { id: 'gen-checklist', title: '标准作业清单', desc: '生成一次完整协作的检查项', icon: 'clipboard' },
      { id: 'gen-handoff', title: '升级人工建议', desc: '判断何时应转交岗位负责人', icon: 'users' },
    ];
  }

  return seeds.slice(0, 4).map((seed, index) => ({
    id: `duty-${index}`,
    title: seed.length > 18 ? `${seed.slice(0, 16)}…` : seed,
    desc: service ? `针对「${service}」给出可执行建议` : `按岗位职责「${seed}」给出下一步建议`,
    icon: icons[index % icons.length],
  }));
}

/** 生成最多 4 条与专家岗位匹配的建议试试。 */
export function buildExpertSuggestions(employee: ExpertSuggestionSource): ExpertSuggestion[] {
  const domain = detectExpertDomain(employee);
  if (domain !== 'generic') return DOMAIN_PRESETS[domain].slice(0, 4);
  return fromResponsibilities(employee).slice(0, 4);
}
