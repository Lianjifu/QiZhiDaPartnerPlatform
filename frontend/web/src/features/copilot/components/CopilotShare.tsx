/**
 * 只读分享页 — GET /api/share/:token
 */
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, Lock } from 'lucide-react';

type SharedPayload = {
  title?: string;
  digitalPartnerName?: string;
  readonly?: boolean;
  messages?: Array<{ id?: string; role?: string; content?: string; createdAt?: string }>;
};

export default function CopilotShare() {
  const { token = '' } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['copilot-share', token],
    enabled: Boolean(token),
    queryFn: async (): Promise<SharedPayload> => {
      const res = await fetch(`/api/share/${encodeURIComponent(token)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(body.error?.message || '分享不存在或已撤销');
      }
      const json = await res.json() as { data?: SharedPayload } & SharedPayload;
      return json.data ?? json;
    },
  });

  if (isLoading) {
    return <div className="grid min-h-[50vh] place-items-center text-sm text-[var(--text-muted)]">加载分享…</div>;
  }
  if (error || !data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-[var(--text-muted)]" />
        <h1 className="text-lg font-semibold">无法打开分享</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{error instanceof Error ? error.message : '分享不存在或已撤销'}</p>
        <Link to="/copilot" className="mt-6 inline-block text-sm text-[var(--brand)] underline-offset-2 hover:underline">返回专家协作</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--brand-light)] text-[var(--brand)]">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">{data.title || '共享会话'}</h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {data.digitalPartnerName ? `${data.digitalPartnerName} · ` : ''}只读分享 · 已脱敏
          </p>
        </div>
      </div>
      <div className="space-y-3">
        {(data.messages ?? []).map((m) => (
          <article key={m.id ?? `${m.role}-${m.createdAt}`} className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              {m.role === 'user' ? '用户' : '助手'}
              {m.createdAt ? ` · ${m.createdAt}` : ''}
            </div>
            <div className="whitespace-pre-wrap text-sm leading-6 text-[var(--text)]">{m.content}</div>
          </article>
        ))}
        {!data.messages?.length && (
          <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">暂无消息</div>
        )}
      </div>
    </div>
  );
}
