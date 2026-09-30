import {
  Wrench, Globe, Box, AlertTriangle, ShieldAlert, ShieldCheck,
} from 'lucide-react';
import type { Skill, SkillRuntimeHealth, CapabilityRef } from '@qzda/web-types';

export const KIND_META: Record<string, { label: string; tone: 'info' | 'success' | 'warn'; icon: typeof Wrench; exec: string }> = {
  skill: { label: 'Skill', tone: 'info', icon: Wrench, exec: 'gVisor 沙箱' },
  mcp: { label: 'MCP', tone: 'success', icon: Globe, exec: 'HTTP/JSON 外部协议' },
  tool: { label: 'Tool', tone: 'warn', icon: Box, exec: 'REST/RPC 内部 API' },
};

export const KIND_PROFILE: Record<Skill['kind'], { caption: string; primaryLabel: string; primaryValue: string; secondaryLabel: string; secondaryValue: string; rail: string; iconSurface: string }> = {
  skill: { caption: '可执行技能', primaryLabel: '运行隔离', primaryValue: 'gVisor 沙箱', secondaryLabel: '执行边界', secondaryValue: '命令允许清单', rail: 'border-l-[var(--info)]', iconSurface: 'bg-[var(--info-bg)] text-[var(--info)]' },
  mcp: { caption: '协议连接器', primaryLabel: '连接协议', primaryValue: 'MCP / HTTPS', secondaryLabel: '认证方式', secondaryValue: 'OAuth / Token', rail: 'border-l-[var(--success)]', iconSurface: 'bg-[var(--success-bg)] text-[var(--success)]' },
  tool: { caption: '受控接口工具', primaryLabel: '接口契约', primaryValue: 'OpenAPI / Schema', secondaryLabel: '动作权限', secondaryValue: '读写策略控制', rail: 'border-l-[var(--warning)]', iconSurface: 'bg-[var(--warning-bg)] text-[var(--warning)]' },
};

export const STORE_LIST = [
  { id: 'st2', kind: 'skill' as const, name: 'pg-cli', version: '1.8.0', description: 'PostgreSQL 客户端', rating: 4.6, installCount: 2800, riskLevel: 'mid' as const, calls: '—', cacheable: true },
  { id: 'st3', kind: 'mcp' as const, name: 'gitlab-mcp', version: '0.9.0', description: 'GitLab MR/Issue MCP', rating: 4.4, installCount: 1200, riskLevel: 'mid' as const, calls: '—', cacheable: false },
  { id: 'st4', kind: 'mcp' as const, name: 'jenkins-mcp', version: '1.0.0', description: 'Jenkins 构建触发', rating: 4.3, installCount: 880, riskLevel: 'high' as const, calls: '—', cacheable: false },
  { id: 'st5', kind: 'tool' as const, name: 'slack-tool', version: '1.2.0', description: 'Slack 消息发送', rating: 4.5, installCount: 1100, riskLevel: 'low' as const, calls: '—', cacheable: true },
  { id: 'st6', kind: 'tool' as const, name: 'github-tool', version: '1.4.0', description: 'GitHub PR/Issue', rating: 4.6, installCount: 1500, riskLevel: 'low' as const, calls: '—', cacheable: true },
];

export type SkillRow = {
  id: string;
  kind: 'skill' | 'mcp' | 'tool';
  name: string;
  version: string;
  description: string;
  rating: number;
  installCount: number;
  riskLevel: 'low' | 'mid' | 'high';
  calls: string;
  cacheable: boolean;
  perf: { calls24h: number; errorRate: number; p95Ms: number };
} & Pick<Skill, 'lifecycleStatus' | 'source' | 'owner' | 'team' | 'lastVerifiedAt' | 'hasUpdate' | 'upgradeVersion' | 'tags'>
  & Partial<Pick<Skill, 'hasScripts' | 'scripts' | 'packageFileName' | 'packagePath'>>;

export type SkillCenterTab = 'workspace' | 'store' | 'platformTools' | 'workflowSkills' | 'integration' | 'governance';

export type ModalKind = 'importSkill' | 'configureMcp' | 'configureTool' | 'uninstall' | 'upgrade' | null;

export function toCapabilityRef(skill: Pick<Skill, 'id' | 'kind' | 'name' | 'version'>): CapabilityRef {
  return {
    id: skill.id,
    kind: skill.kind,
    name: skill.name,
    pinnedVersion: skill.version,
  };
}

export function formatCallsDaily(calls24h: number): string {
  if (calls24h <= 0) return '0/日';
  if (calls24h >= 1000) return `${(calls24h / 1000).toFixed(1).replace(/\.0$/, '')}k/日`;
  return `${calls24h}/日`;
}

export function perfFromHealth(health?: SkillRuntimeHealth | null) {
  return {
    calls24h: health?.calls24h ?? 0,
    errorRate: health?.errorRate ?? 0,
    p95Ms: health?.p95Ms ?? 0,
  };
}

export function enrichSkillRow(skill: Skill, healthBySkillId: Map<string, SkillRuntimeHealth>): SkillRow {
  const health = healthBySkillId.get(skill.id);
  const perf = perfFromHealth(health);
  return {
    ...skill,
    description: skill.description ?? '',
    rating: skill.rating ?? 0,
    installCount: skill.installCount ?? 0,
    riskLevel: skill.riskLevel ?? 'mid',
    cacheable: Boolean(skill.cacheable),
    calls: formatCallsDaily(perf.calls24h),
    perf,
  };
}

export function buildHealthBySkillId(health: SkillRuntimeHealth[] | null | undefined): Map<string, SkillRuntimeHealth> {
  return new Map((health ?? []).map((item) => [item.skillId, item]));
}

export function buildReferenceBySkillId(health: SkillRuntimeHealth[] | null | undefined): Map<string, number> {
  return new Map((health ?? []).map((item) => [item.skillId, item.references]));
}

export function riskIcon(risk: string) {
  if (risk === 'high') return ShieldAlert;
  if (risk === 'mid') return AlertTriangle;
  return ShieldCheck;
}
