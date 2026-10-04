import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useApiMutation } from '@/services/query';
import { Button, Input, Badge, toast } from '@qzda/web-ui';
import { useUiStore } from '@/stores/uiStore';
import { Bot, ShieldCheck, Sun, Moon, Gauge } from 'lucide-react';
import type { LoginRequest, LoginResponse } from '@qzda/web-types';
import { MfaCodeField } from './components/MfaCodeField';
import { ExperienceRoleButtons } from './components/ExperienceRoleButtons';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuthStore();
  const { theme, toggleTheme } = useUiStore();
  const [email, setEmail] = useState('admin@acme.com');
  const [password, setPassword] = useState('demo123456');
  const [mfa, setMfa] = useState('');

  const mut = useApiMutation<LoginResponse, LoginRequest>(
    '/api/auth/login',
    {
      onSuccess: (data) => {
        login(data.user, data.token);
        toast.success(`欢迎回来，${data.user.name}`);
        const from = (location.state as any)?.from?.pathname ?? (data.user.role === 'auditor' ? '/audit-center' : '/home');
        navigate(from, { replace: true });
      },
      onError: (err: any) => {
        toast.error(err?.message ?? '登录失败');
      },
    },
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return toast.warn('请输入邮箱和密码');
    mut.mutate({ email, password });
  };

  const chooseRole = (nextEmail: string) => {
    setEmail(nextEmail);
    setPassword('demo123456');
  };

  return (
    <div className="grid h-screen w-screen place-items-center bg-[var(--bg-elevated)] px-4">
      {/* 主题切换按钮 */}
      <button
        onClick={toggleTheme}
        className="absolute right-6 top-6 grid h-9 w-9 place-items-center rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] shadow-sm"
        title={theme === 'light' ? '切换到深色' : '切换到浅色'}
      >
        {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </button>

      <div className="grid w-full max-w-[920px] grid-cols-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] shadow-xl md:grid-cols-2">
        {/* 左侧品牌 */}
        <div className="relative hidden flex-col justify-between bg-gradient-to-br from-[var(--brand)] via-[#5b4cdb] to-[var(--purple)] p-10 text-white md:flex">
          <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-16 -left-8 h-56 w-56 rounded-full bg-white/10 blur-3xl" />

          <div className="relative">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center">
                <svg viewBox="0 0 32 32" className="h-10 w-10" aria-hidden="true">
                  <path d="M6 8 H14 V13 A2.5 2.5 0 0 1 14 19 V24 H6 Q4 24 4 22 V10 Q4 8 6 8 Z" fill="#fff" />
                  <path d="M26 8 H18 V13 A2.5 2.5 0 0 1 18 19 V24 H26 Q28 24 28 22 V10 Q28 8 26 8 Z" fill="#fff" opacity="0.8" />
                </svg>
              </div>
              <div>
                <div className="text-lg font-bold">企业可信企智搭 · 数字伙伴平台</div>
                <div className="text-xs opacity-80">专家团队协同 · 岗位边界清晰</div>
              </div>
            </div>

            <h1 className="mb-3 text-[28px] font-bold leading-tight tracking-tight">
              安全零信任
              <br />
              驱动<span className="bg-gradient-to-r from-white via-yellow-100 to-white bg-clip-text text-transparent">先进生产力</span>
            </h1>
            <p className="text-sm opacity-90 leading-relaxed">
              以持续验证守住身份、权限、数据与执行边界，
              <br />
              让数字伙伴在受控协同中创造可衡量的业务价值。
              <br />
              以能力复用与精细化用量治理，重构智能执行成本。
            </p>
          </div>

          <div className="relative text-xs opacity-95">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> 安全零信任 · 持续验证 · 全程审计
              </div>
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4" /> 先进生产力 · 人机协同 · 受控执行
              </div>
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4" /> 成本新范式 · 用量治理 · 价值可度量
              </div>
            </div>
            <div className="mt-[100px] flex gap-1.5">
              <Badge tone="brand" className="bg-white/20 text-white">持续验证</Badge>
              <Badge tone="brand" className="bg-white/20 text-white">人机协同</Badge>
              <Badge tone="brand" className="bg-white/20 text-white">成本治理</Badge>
            </div>
          </div>
        </div>

        {/* 右侧表单 */}
        <form className="flex flex-col justify-center p-8 md:p-10" onSubmit={submit}>
          <div className="mb-1 flex items-center gap-2 md:hidden">
            <div className="flex h-9 w-9 items-center justify-center">
              <svg viewBox="0 0 32 32" className="h-9 w-9" aria-hidden="true">
                <path d="M6 8 H14 V13 A2.5 2.5 0 0 1 14 19 V24 H6 Q4 24 4 22 V10 Q4 8 6 8 Z" fill="#4f46e5" />
                <path d="M26 8 H18 V13 A2.5 2.5 0 0 1 18 19 V24 H26 Q28 24 28 22 V10 Q28 8 26 8 Z" fill="#8b5cf6" />
              </svg>
            </div>
            <span className="text-base font-bold">企智搭 · 数字伙伴平台</span>
          </div>

          <h2 className="mb-1 text-xl font-bold text-[var(--text)]">欢迎登录</h2>
          <p className="mb-6 text-xs text-[var(--text-muted)]">使用已授权的企业账号登录平台。</p>

          <label className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">企业邮箱</label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className="mb-4" />

          <label className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">密码</label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="mb-4" />

          <MfaCodeField value={mfa} onChange={setMfa} />

          <div className="mb-5 flex items-center justify-between text-xs">
            <label className="flex items-center gap-1.5 text-[var(--text-muted)] cursor-pointer">
              <input type="checkbox" defaultChecked className="accent-[var(--brand)]" /> 在本设备保持登录状态
            </label>
            <a className="text-[var(--brand)] hover:underline" href="#">忘记密码？</a>
          </div>

          <Button type="submit" loading={mut.isPending} className="w-full">
            登录平台
          </Button>

          <ExperienceRoleButtons onPick={chooseRole} />

          <div className="mt-5 text-center text-[11px] text-[var(--text-muted)]">
            登录即表示您已阅读并同意 <a className="text-[var(--brand)] hover:underline" href="#">《用户协议》</a> 与 <a className="text-[var(--brand)] hover:underline" href="#">《隐私政策》</a>
          </div>
        </form>
      </div>
    </div>
  );
}
