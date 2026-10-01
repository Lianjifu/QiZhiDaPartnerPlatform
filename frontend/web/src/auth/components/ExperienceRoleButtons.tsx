import { UserRound, Shield, ScrollText } from 'lucide-react';

interface ExperienceRoleButtonsProps {
  onPick: (email: string) => void;
}

const ROLE_BUTTONS = [
  { email: 'user@acme.com', label: '普通用户', Icon: UserRound },
  { email: 'admin@acme.com', label: '管理员', Icon: Shield },
  { email: 'audit@acme.com', label: '审计用户', Icon: ScrollText },
] as const;

/**
 * 一键填充体验角色邮箱的三连按钮。
 * onPick 触发后由调用方负责 setState('xxx@acme.com') + 重置密码。
 */
export function ExperienceRoleButtons({ onPick }: ExperienceRoleButtonsProps) {
  return (
    <div className="mt-5 border-t border-[var(--border)] pt-4">
      <p className="mb-2 text-[11px] font-medium text-[var(--text-muted)]">体验角色权限</p>
      <div className="grid grid-cols-3 gap-2">
        {ROLE_BUTTONS.map(({ email, label, Icon }) => (
          <button
            key={email}
            type="button"
            onClick={() => onPick(email)}
            className="rounded-md border border-[var(--border)] px-2 py-2 text-left text-[10px] hover:border-[var(--brand)] hover:bg-[var(--brand-light)]"
          >
            <Icon className="mb-1 h-3.5 w-3.5 text-[var(--brand)]" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
