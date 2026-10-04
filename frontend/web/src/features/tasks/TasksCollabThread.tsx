import { useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import type { TaskComment } from '@qzda/web-types';
import { Input } from '@qzda/web-ui';
import { useApiMutation, useApiQuery } from '@/services/query';

export function TasksCollabThread({ taskId, canMutate }: { taskId: string; canMutate: boolean }) {
  const [body, setBody] = useState('');
  const { data: comments = [] } = useApiQuery<TaskComment[]>(['controlled-task-comments', taskId], `/api/tasks/${taskId}/comments`, undefined, { refetchInterval: 5_000 });
  const send = useApiMutation<TaskComment, { body: string }>(`/api/tasks/${taskId}/comments`, { onSuccess: () => setBody('') });
  return (
    <section className="task-drawer-section">
      <h3><MessagesSquare size={15} />团队留言</h3>
      <ol className="task-audit-list">
        {comments.map((item) => (
          <li key={item.id}>
            <span>{item.body}</span>
            <small>{new Date(item.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · {item.actor}</small>
          </li>
        ))}
      </ol>
      {comments.length === 0 && <p className="task-governance-muted">还没有留言。协办人可在此同步进展。</p>}
      {canMutate && (
        <div className="mt-3 flex gap-2">
          <Input value={body} onChange={(event) => setBody(event.target.value)} placeholder="写给协办人的进展或请求" />
          <button type="button" className="task-saas-btn task-saas-btn--primary" disabled={!body.trim() || send.isPending} onClick={() => send.mutate({ body: body.trim() })}>发送</button>
        </div>
      )}
    </section>
  );
}
