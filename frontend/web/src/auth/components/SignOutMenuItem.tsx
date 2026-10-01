import { LogOut } from 'lucide-react';

interface SignOutMenuItemProps {
  label: string;
  onClick: () => void;
}

/**
 * 用户菜单底部的「退出登录」危险项。
 * 类名与 AppLayout 中的 user-menu__item / user-menu__item--danger 保持一致，
 * 方便替换原 inline button。
 */
export function SignOutMenuItem({ label, onClick }: SignOutMenuItemProps) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="user-menu__item user-menu__item--danger">
      <span className="user-menu__icon-box"><LogOut className="h-3.5 w-3.5" /></span>
      <span className="user-menu__label">{label}</span>
    </button>
  );
}
