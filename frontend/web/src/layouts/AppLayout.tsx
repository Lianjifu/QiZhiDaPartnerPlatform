/**
 * PSSP 主布局
 * - 顶部 60px Topbar（菜单 + Logo + Breadcrumb）
 * - 左侧 200px Sidebar（按角色分语义导航 + 用户菜单）
 * - 用户信息在左下角
 */
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import {
  Home, MessageSquare, ListChecks, Building2, BriefcaseBusiness, Workflow,
  BookOpen, Wrench, Brain, BrainCircuit, Send,
  Menu, Settings2, Languages, Sun, Moon,
  ChevronDown, X, CheckCircle2,
  ShieldAlert, ScrollText, Sparkles,
} from 'lucide-react';
import { useT } from '@/i18n';
import { useUiStore } from '@/stores/uiStore';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { Avatar } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { useApiQuery } from '@/services/query';
import { BrandLogo } from '@/components/brand';
import { OnboardingGuide } from '@/features/onboarding/OnboardingGuide';
import { getRoleNavGroups, navLabelKeyForPath } from '@/features/role-nav/role-nav';
import { useReauthPrompt, useLogout, SignOutMenuItem } from '@/auth';
import { useQueryClient } from '@tanstack/react-query';
import { preloadRoute } from '@/lib/routePreload';
import type { Workspace } from '@qzda/web-types';

const NAV_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Home, MessageSquare, ListChecks, BriefcaseBusiness, Workflow,
  BookOpen, Wrench, Brain, BrainCircuit, Send, ShieldAlert, ScrollText,
};

const ROLE_LABEL: Record<string, string> = {
  admin: '管理员',
  operator: '业务构建者',
  auditor: '合规审计员',
  viewer: '只读成员',
};

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sidebarCollapsed, toggleSidebar, theme, toggleTheme, mobileDrawerOpen, openMobileDrawer, closeMobileDrawer } = useUiStore();
  const { locale, t, setLocale } = useT();
  const { user } = useAuthStore();
  const { current, setCurrent, setList } = useWorkspaceStore();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [userMenuPos, setUserMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userTriggerRef = useRef<HTMLButtonElement>(null);
  const userPanelRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const selectWorkspace = (workspace: Workspace) => {
    setCurrent(workspace);
    setWorkspaceMenuOpen(false);
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    void queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'conversation' });
  };

  const { data: workspaces, refetch: refetchWorkspaces, isError: workspacesError } = useApiQuery<Workspace[]>(['workspaces'], '/api/workspaces');
  // v3：三角色侧栏 IA（待办/核查/审计主航）升版，已完成 v2 的账号再展示一次。
  const onboardingStorageKey = user ? `de-onboarding-completed:v3:${user.id}` : null;

  useEffect(() => {
    if (!onboardingStorageKey) {
      setOnboardingOpen(false);
      return;
    }
    setOnboardingOpen(localStorage.getItem(onboardingStorageKey) !== 'true');
  }, [onboardingStorageKey]);

  const closeOnboarding = () => {
    if (onboardingStorageKey) localStorage.setItem(onboardingStorageKey, 'true');
    setOnboardingOpen(false);
  };

  useEffect(() => {
    if (workspaces && workspaces.length) {
      setList(workspaces);
      if (!current || !workspaces.some((item) => item.id === current.id)) {
        const preferred = workspaces.find((item) => item.id === 'w1') ?? workspaces[0];
        setCurrent(preferred);
      }
      return;
    }
    // 列表成功但为空时，再拉一次以触发后端 ensure 默认工作区
    if (Array.isArray(workspaces) && workspaces.length === 0) {
      const timer = window.setTimeout(() => { void refetchWorkspaces(); }, 300);
      return () => window.clearTimeout(timer);
    }
  }, [workspaces, current, setCurrent, setList, refetchWorkspaces]);

  useLayoutEffect(() => {
    if (!userMenuOpen || !userTriggerRef.current) {
      setUserMenuPos(null);
      return;
    }
    const place = () => {
      const rect = userTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuWidth = 248;
      const gap = 8;
      const panelH = userPanelRef.current?.offsetHeight || 300;
      let top = rect.top - panelH - gap;
      if (top < 12) top = Math.min(rect.bottom + gap, window.innerHeight - panelH - 12);
      let left = sidebarCollapsed ? rect.right + gap : rect.left;
      if (left + menuWidth > window.innerWidth - 12) left = Math.max(12, rect.right - menuWidth);
      left = Math.min(Math.max(12, left), window.innerWidth - menuWidth - 12);
      setUserMenuPos({ top: Math.max(12, top), left, width: menuWidth });
    };
    place();
    const raf = window.requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [userMenuOpen, sidebarCollapsed]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = userMenuRef.current?.contains(target);
      const inPanel = userPanelRef.current?.contains(target);
      if (!inTrigger && !inPanel) setUserMenuOpen(false);
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(target)) {
        setWorkspaceMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setUserMenuOpen(false);
        setWorkspaceMenuOpen(false);
      }
    };
    if (userMenuOpen || workspaceMenuOpen) {
      document.addEventListener('mousedown', handler);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [userMenuOpen, workspaceMenuOpen]);

  const logout = useLogout();
  const { triggerReauth } = useReauthPrompt('workspaces-error');
  const onLogout = () => {
    setUserMenuOpen(false);
    logout({ from: 'menu' });
  };

  const visibleNavGroups = useMemo(() => getRoleNavGroups(user?.role), [user?.role]);
  const breadcrumbKey = navLabelKeyForPath(location.pathname, user?.role);

  return (
    <div
      className="grid h-screen w-screen overflow-hidden bg-[var(--bg-elevated)] lg:[grid-template-columns:var(--sidebar-width)_1fr] lg:[grid-template-rows:60px_1fr]"
      style={{ '--sidebar-width': sidebarCollapsed ? '72px' : '200px', gridTemplateRows: '60px 1fr' } as CSSProperties}
    >
      {mobileDrawerOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={closeMobileDrawer}
          aria-hidden="true"
        />
      )}
      <header
        className="app-glass col-span-2 sticky top-0 z-30 flex h-[60px] items-center gap-2 border-b px-3 shadow-[var(--shadow-xs)] md:gap-6 md:px-6"
        style={{ gridColumn: '1 / -1' }}
      >
        <button
          onClick={() => {
            if (window.innerWidth < 1024) openMobileDrawer();
            else toggleSidebar();
          }}
          className="grid h-9 w-9 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
          aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
        >
          <Menu className="h-4 w-4" />
        </button>

        <NavLink to="/home" className="flex items-center gap-2 text-[var(--text)]">
          <BrandLogo className="h-7 w-7 shrink-0" />
          {!sidebarCollapsed && (
            <span className="hidden leading-[1.15] sm:flex sm:flex-col">
              <span className="text-[15px] font-bold tracking-tight">{t('app.name')}</span>
              <span className="text-[10px] font-medium text-[var(--text-muted)]">{t('app.subtitle')}</span>
            </span>
          )}
        </NavLink>

        <div ref={workspaceMenuRef} className="relative hidden sm:block">
          <button
            type="button"
            onClick={() => setWorkspaceMenuOpen((open) => !open)}
            className={cn('flex h-8 max-w-[240px] items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 text-left text-xs transition-colors hover:border-[var(--brand)]', workspaceMenuOpen && 'border-[var(--brand)] bg-[var(--brand-light)]')}
            aria-haspopup="menu"
            aria-expanded={workspaceMenuOpen}
          >
            <Building2 className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
            <span className="min-w-0 flex-1 truncate font-semibold">{current?.name ?? t('workspace.select')}</span>
            {current && <span className="hidden rounded bg-[var(--bg-elevated)] px-1 py-0.5 font-mono text-[9px] text-[var(--text-muted)] lg:inline">{current.region}</span>}
            <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform', workspaceMenuOpen && 'rotate-180')} />
          </button>
          {workspaceMenuOpen && (
            <div role="menu" className="app-glass-panel absolute left-0 top-full z-50 mt-2 w-[320px] overflow-hidden rounded-lg shadow-xl">
              <div className="border-b border-[var(--border)] px-3 py-2">
                <div className="text-xs font-semibold">{t('workspace.switch')}</div>
                <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{t('workspace.switch.desc')}</div>
              </div>
              <div className="max-h-[280px] overflow-y-auto p-1.5">
                {workspacesError ? (
                  <div className="space-y-2 px-2.5 py-3">
                    <p className="text-[11px] text-[var(--text-muted)]">工作区列表加载失败（登录可能已过期）。请重新登录后重试。</p>
                    <button
                      type="button"
                      className="w-full rounded-md border border-[var(--border)] px-2.5 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--bg-hover)]"
                      onClick={() => {
                        setWorkspaceMenuOpen(false);
                        triggerReauth();
                      }}
                    >
                      重新登录
                    </button>
                  </div>
                ) : (workspaces ?? []).length === 0 ? (
                  <div className="space-y-2 px-2.5 py-3">
                    <p className="text-[11px] text-[var(--text-muted)]">暂无可用工作区。系统将自动初始化默认工作区。</p>
                    {user?.role === 'admin' && (
                      <button
                        type="button"
                        className="w-full rounded-md bg-[var(--brand)] px-2.5 py-2 text-xs font-semibold text-white hover:opacity-90"
                        onClick={() => {
                          setWorkspaceMenuOpen(false);
                          navigate('/workspaces');
                        }}
                      >
                        打开工作区管理
                      </button>
                    )}
                  </div>
                ) : (
                  (workspaces ?? []).map((workspace) => (
                  <button
                    key={workspace.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={workspace.id === current?.id}
                    onClick={() => selectWorkspace(workspace)}
                    className={cn('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]', workspace.id === current?.id && 'bg-[var(--brand-light)]')}
                  >
                    <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md', workspace.id === current?.id ? 'bg-[var(--brand)] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]')}><Building2 className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{workspace.name}</span><span className="block text-[10px] text-[var(--text-muted)]">{workspace.region} · {workspace.memberCount} 成员 · 合规 {workspace.complianceScore}</span></span>
                    {workspace.id === current?.id && <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--brand)]" />}
                  </button>
                  ))
                )}
              </div>
              {user?.role === 'admin' && (
                <div className="border-t border-[var(--border)] p-1.5">
                  <button type="button" onClick={() => { setWorkspaceMenuOpen(false); navigate('/workspaces'); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-[var(--brand)] hover:bg-[var(--brand-light)]"><Settings2 className="h-3.5 w-3.5" />{t('workspace.manage')}</button>
                </div>
              )}
            </div>
          )}
        </div>

        {!sidebarCollapsed && (
          <div className="hidden items-center gap-2 text-[13px] text-[var(--text-muted)] sm:flex">
            <span>·</span>
            <span className="text-[var(--text-secondary)]">{t(breadcrumbKey)}</span>
          </div>
        )}

        <div className="ml-auto" />
      </header>

      <aside
        className={cn(
          'row-start-2 flex flex-col border-r border-[var(--border)] bg-[var(--bg)]',
          'lg:relative lg:translate-x-0',
          'fixed top-0 bottom-0 left-0 z-50 w-[260px] transition-transform duration-200',
          mobileDrawerOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          sidebarCollapsed ? 'items-center lg:w-[72px]' : 'lg:w-[200px]',
        )}
      >
        <nav className="flex-1 px-3 pt-4 pb-3 overflow-y-auto">
          {visibleNavGroups.map((group, groupIndex) => (
            <div key={group.labelKey ?? `home-${groupIndex}`} className={cn(groupIndex > 0 && (sidebarCollapsed ? 'mt-3 pt-3 border-t border-[var(--border)]' : 'mt-4'))}>
              {!sidebarCollapsed && group.labelKey && (
                <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {t(group.labelKey)}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = NAV_ICONS[item.icon] ?? Home;
                  return (
                    <NavLink
                      key={`${item.to}:${item.i18n}`}
                      to={item.to}
                      onClick={closeMobileDrawer}
                      onMouseEnter={() => preloadRoute(item.to)}
                      onFocus={() => preloadRoute(item.to)}
                      className={({ isActive }) =>
                        cn(
                          'group flex items-center gap-3 rounded-md text-[13px] transition-all duration-150',
                          sidebarCollapsed ? 'h-10 w-10 justify-center mx-auto' : 'px-3 py-2.5',
                          isActive
                            ? 'bg-[var(--brand-light)] text-[var(--brand)] font-semibold'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]',
                        )
                      }
                      title={sidebarCollapsed ? t(item.i18n) : undefined}
                    >
                      <Icon className="h-4 w-4 shrink-0 transition-colors group-hover:text-[var(--brand)]" />
                      {!sidebarCollapsed && <span className="flex-1 truncate">{t(item.i18n)}</span>}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {user && (
          <div ref={userMenuRef} className={cn('relative shrink-0', sidebarCollapsed ? 'w-full' : '')}>
            {sidebarCollapsed ? (
              <button
                ref={userTriggerRef}
                type="button"
                onClick={() => setUserMenuOpen((v) => !v)}
                className={cn('user-trigger justify-center h-14', userMenuOpen && 'user-trigger--open')}
                title={`${user.name} · ${ROLE_LABEL[user.role] ?? user.role}`}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
              >
                <Avatar name={user.name} size={30} />
              </button>
            ) : (
              <button
                ref={userTriggerRef}
                type="button"
                onClick={() => setUserMenuOpen((v) => !v)}
                className={cn('user-trigger', userMenuOpen && 'user-trigger--open')}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                title={`${user.name} · ${ROLE_LABEL[user.role] ?? user.role} · ${current?.name ?? ''}`}
              >
                <Avatar name={user.name} size={32} />
                <div className="user-trigger__info">
                  <div className="user-trigger__name">{user.name}</div>
                  <div className="user-trigger__meta">
                    {ROLE_LABEL[user.role] ?? user.role.toUpperCase()}
                    {current?.name ? ` · ${current.name}` : ''}
                  </div>
                </div>
                <ChevronDown className={cn('user-trigger__chevron h-4 w-4', userMenuOpen && 'user-trigger__chevron--open')} />
              </button>
            )}

            {userMenuOpen && userMenuPos && createPortal(
              <div
                ref={userPanelRef}
                role="menu"
                className="user-menu user-menu--portal"
                style={{
                  position: 'fixed',
                  top: userMenuPos.top,
                  left: userMenuPos.left,
                  width: userMenuPos.width,
                  zIndex: 80,
                }}
              >
                <div className="user-menu__identity">
                  <Avatar name={user.name} size={36} />
                  <div className="min-w-0">
                    <div className="user-menu__identity-name">{user.name}</div>
                    <div className="user-menu__identity-meta">
                      {ROLE_LABEL[user.role] ?? user.role} · {current?.name ?? '未选择工作区'}
                    </div>
                  </div>
                </div>
                <div className="user-menu__group-title">{t('account.preferences')}</div>
                {user.role === 'admin' && (
                  <UserMenuItem
                    icon={Settings2}
                    label={t('account.platformSettings')}
                    shortcut="⌘,"
                    onClick={() => { setUserMenuOpen(false); navigate('/settings'); }}
                  />
                )}
                {user.role === 'admin' && (
                  <button
                    type="button"
                    role="menuitem"
                    className="user-menu__item"
                    onClick={() => { setUserMenuOpen(false); navigate('/workspaces'); }}
                  >
                    <span className="user-menu__icon-box"><Building2 className="h-3.5 w-3.5" /></span>
                    <span className="user-menu__label">{t('workspace.manage')}</span>
                    <span className="user-menu__value">{current?.name ?? '—'}</span>
                  </button>
                )}
                <UserMenuItem icon={Sparkles} label="启用向导" onClick={() => { setUserMenuOpen(false); setOnboardingOpen(true); }} />
                <button
                  type="button"
                  role="menuitem"
                  className="user-menu__item"
                  onClick={() => { setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN'); setUserMenuOpen(false); }}
                  title={locale === 'zh-CN' ? 'Switch to English' : '切换为简体中文'}
                >
                  <span className="user-menu__icon-box"><Languages className="h-3.5 w-3.5" /></span>
                  <span className="user-menu__label">{t('account.language')}</span>
                  <span className="user-menu__value">{locale === 'zh-CN' ? t('common.lang.zh') : t('common.lang.en')}</span>
                </button>

                <div className="user-menu__divider" />

                <button
                  type="button"
                  role="menuitem"
                  className="user-menu__item"
                  onClick={() => { toggleTheme(); setUserMenuOpen(false); }}
                >
                  <span className="user-menu__icon-box">
                    {theme === 'light' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                  </span>
                  <span className="user-menu__label">{t('account.theme')}</span>
                  <span className="user-menu__value">{theme === 'light' ? t('common.theme.light') : t('common.theme.dark')}</span>
                </button>

                <div className="user-menu__divider" />

                <SignOutMenuItem label={t('account.signOut')} onClick={onLogout} />
              </div>,
              document.body,
            )}
          </div>
        )}
      </aside>

      <main className={cn('row-start-2 col-span-2 min-w-0 min-h-0 bg-[var(--bg-elevated)] lg:col-start-2 lg:col-span-1', location.pathname.startsWith('/workflows') || location.pathname.startsWith('/partners') || location.pathname.startsWith('/copilot') ? 'overflow-hidden' : 'overflow-y-auto')}>
        <Outlet />
      </main>
      <OnboardingGuide open={onboardingOpen} onClose={closeOnboarding} role={user?.role} />
    </div>
  );
}

function UserMenuItem({
  icon: Icon, label, shortcut, onClick,
}: {
  icon: any;
  label: string;
  shortcut?: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="user-menu__item">
      <span className="user-menu__icon-box">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="user-menu__label">{label}</span>
      {shortcut && <kbd className="user-menu__shortcut">{shortcut}</kbd>}
    </button>
  );
}
