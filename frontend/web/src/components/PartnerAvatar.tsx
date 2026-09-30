import { useState } from 'react';
import { cn } from '@qzda/web-utils';

type AvatarEmployee = {
  id: string;
  name: string;
  department?: string;
  avatarUrl?: string;
};

/** Bundled 3D cartoon icons under /avatars/employees/{id}.png */
const KNOWN_AVATARS = new Set([
  'de-sre', 'de-it', 'de-secops', 'de-change', 'de-alert-ops', 'de-capacity',
  'de-release-guard', 'de-vulnerability', 'de-threat-hunt', 'de-compliance',
  'de-it-head', 'de-endpoint-support',
  'de-identity-access', 'de-workplace',
  'de-marketing-manager', 'de-content-ops', 'de-bizops-manager', 'de-growth-ops',
  'de-hr-manager', 'de-hr-assistant', 'de-finance-manager', 'de-expense-ops',
  'de-rd-manager', 'de-qa-assistant', 'de-sales-manager', 'de-crm-assistant',
]);

const DEPT_FALLBACK: Record<string, string> = {
  信息技术部: 'de-it',
  市场部: 'de-content-ops',
  运营部: 'de-growth-ops',
  人事部: 'de-hr-assistant',
  财务部: 'de-expense-ops',
  研发部: 'de-qa-assistant',
  销售部: 'de-crm-assistant',
};

const TEMPLATE_AVATAR_IDS: Record<string, string> = {
  'det-sre': 'de-sre',
  'det-secops': 'de-secops',
  'det-service-desk': 'de-it',
  'det-alert-ops': 'de-alert-ops',
  'det-crm-assistant': 'de-crm-assistant',
  'det-content-ops': 'de-content-ops',
  'det-hr-assistant': 'de-hr-assistant',
  'det-expense-ops': 'de-expense-ops',
  'det-qa-assistant': 'de-qa-assistant',
  'det-growth-ops': 'de-growth-ops',
};

/** Map a岗位蓝图 / employee id to the bundled 3D avatar asset id. */
export function resolveEmployeeAvatarId(id: string, department?: string) {
  if (KNOWN_AVATARS.has(id)) return id;
  if (TEMPLATE_AVATAR_IDS[id]) return TEMPLATE_AVATAR_IDS[id]!;
  if (id.startsWith('det-')) {
    const asEmployee = `de-${id.slice(4)}`;
    if (KNOWN_AVATARS.has(asEmployee)) return asEmployee;
  }
  if (department && DEPT_FALLBACK[department]) return DEPT_FALLBACK[department]!;
  return 'de-it';
}

function resolveAvatarSrc(employee: AvatarEmployee) {
  if (employee.avatarUrl) return employee.avatarUrl;
  const avatarId = resolveEmployeeAvatarId(employee.id, employee.department);
  return `/avatars/employees/${avatarId}.png`;
}

/** 3D cartoon icon avatar for digital employees. */
export function DigitalPartnerAvatar({
  employee,
  size = 40,
  className,
}: {
  employee: AvatarEmployee;
  size?: number;
  className?: string;
  /** @deprecated 头像统一为圆形，此参数已忽略 */
  rounded?: 'full' | 'lg';
}) {
  const [failed, setFailed] = useState(false);
  const src = resolveAvatarSrc(employee);

  if (failed) {
    const initial = employee.name?.[0] ?? '?';
    return (
      <div
        aria-label={`${employee.name}头像`}
        className={cn('inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--bg-elevated)] font-semibold text-[var(--text-secondary)]', className)}
        style={{
          width: size,
          height: size,
          fontSize: size * 0.38,
          boxShadow: 'var(--saas-ring), var(--saas-elev-1)',
        }}
      >
        {initial}
      </div>
    );
  }

  return (
    <span
      className={cn('inline-flex shrink-0 overflow-hidden rounded-full bg-[var(--bg-elevated)]', className)}
      style={{
        width: size,
        height: size,
        boxShadow: 'var(--saas-ring), var(--saas-elev-1)',
      }}
    >
      <img
        src={src}
        alt={`${employee.name}头像`}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </span>
  );
}
