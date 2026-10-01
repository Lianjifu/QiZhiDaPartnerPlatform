/**
 * 路由守卫 — 鉴权 + 权限
 */
import { Link, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';
import type { Permission, Role } from '@qzda/web-types';

interface Props {
  children: ReactNode;
  permission?: Permission;
  roles?: Role[];
}

export function ProtectedRoute({ children, permission, roles }: Props) {
  const { isAuthed, user } = useAuthStore();
  const location = useLocation();

  if (!isAuthed || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (permission && !user.permissions.includes(permission)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="text-5xl">🔒</div>
        <div className="text-lg font-semibold">无权访问</div>
        <div className="text-sm text-[var(--color-text-muted)]">
          当前角色 <b>{user.role.toUpperCase()}</b> 缺少权限 <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5">{permission}</code>
        </div>
      </div>
    );
  }

  if (roles && !roles.includes(user.role)) {
    if (user.role === 'auditor') {
      return <div className="flex h-full items-center justify-center bg-[var(--bg-elevated)] p-6"><section className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--bg)] p-6 text-center shadow-[var(--shadow-xs)]"><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-light)] text-xl">◉</div><h1 className="mt-4 text-lg font-semibold">审计工作范围</h1><p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">当前页面属于运营配置能力。请从侧栏「审计中心 / 持续验证」或核查入口进入只读复核。</p><div className="mt-5 grid gap-2 sm:grid-cols-2"><Link to="/audit-center" className="rounded-md bg-[var(--brand)] px-3 py-2 text-sm font-medium text-white">进入审计中心</Link><Link to="/zero-trust" className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-hover)]">查看持续验证</Link></div><p className="mt-4 text-[11px] text-[var(--text-muted)]">可查看授权范围内的策略版本、临时授权记录与操作证据流水。</p></section></div>;
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="text-5xl">🚫</div>
        <div className="text-lg font-semibold">角色受限</div>
        <div className="text-sm text-[var(--color-text-muted)]">
          该页面仅限 {roles.map((r) => r.toUpperCase()).join(' / ')} 角色访问
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
