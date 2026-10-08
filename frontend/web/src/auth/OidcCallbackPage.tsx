import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getApiClient } from '@qzda/web-api';
import { toast } from '@qzda/web-ui';
import { useAuthStore } from '@/stores/authStore';
import type { LoginResponse } from '@qzda/web-types';

export default function OidcCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const code = params.get('code');
    const state = params.get('state');
    const idpError = params.get('error_description') ?? params.get('error');
    if (idpError || !code || !state) {
      toast.error(idpError ?? 'OIDC 回调参数缺失');
      navigate('/login', { replace: true });
      return;
    }

    getApiClient()
      .request<LoginResponse>('/api/auth/oidc/callback', { query: { code, state } })
      .then((data) => {
        login(data.user, data.token);
        toast.success(`欢迎回来，${data.user.name}`);
        navigate(data.user.role === 'auditor' ? '/audit-center' : '/home', { replace: true });
      })
      .catch((err: any) => {
        toast.error(err?.message ?? 'OIDC 登录失败');
        navigate('/login', { replace: true });
      });
  }, [params, login, navigate]);

  return (
    <div className="grid h-screen w-screen place-items-center text-sm text-[var(--text-muted)]">
      正在完成企业账号登录…
    </div>
  );
}
