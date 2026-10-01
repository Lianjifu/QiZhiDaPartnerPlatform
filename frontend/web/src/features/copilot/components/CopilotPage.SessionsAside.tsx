/**
 * CopilotPage.SessionsAside — left aside with sessions list (search + grouped).
 */
import { Pin, Plus, Search, Trash2, Bot } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@qzda/web-utils';
import { Badge, Button } from '@qzda/web-ui';
import { useCopilotContext } from '@/features/copilot/components/useCopilotController';
import { rolePageCopy } from '@/features/role-nav/role-nav';
import { useT } from '@/i18n';
import type { SessionItem } from '@/features/copilot/components/CopilotPage.helpers';

const GROUP_LABELS = {
  pinned: '置顶',
  today: '今天',
  yesterday: '昨天',
  week: '本周',
  earlier: '更早',
} as const;

export function CopilotPageSessionsAside() {
  const ctrl = useCopilotContext();
  const { s, canMutate, currentUser, grouped, filteredSessions, switchSession, actions, sessionsOpen } = ctrl;
  const queryClient = useQueryClient();
  const pageCopy = rolePageCopy('copilot', currentUser?.role);

  return (
    <aside
      id="copilot-sessions"
      className="copilot-sessions"
      aria-label="会话列表"
      data-open={sessionsOpen ? 'true' : 'false'}
    >
      <div className="copilot-sessions__head">
        <div className="copilot-sessions__title-row">
          <h2>{pageCopy.title}</h2>
          <span className="copilot-sessions__count" title="当前工作区可见会话数">{filteredSessions.length}</span>
        </div>
        {canMutate ? (
          <Button size="sm" className="copilot-sessions__new" onClick={actions.openNewSessionPicker}>
            <Plus className="h-3.5 w-3.5" />新会话
          </Button>
        ) : (
          <p className="px-1 text-[10px] leading-4 text-[var(--text-muted)]">{pageCopy.subtitle}</p>
        )}
        <div className="copilot-sessions__search">
          <Search className="h-3.5 w-3.5" />
          <input
            value={s.searchQ}
            onChange={(e) => s.setSearchQ(e.target.value)}
            placeholder="搜索会话..."
            aria-label="搜索会话"
          />
        </div>
      </div>

      <div className="copilot-sessions__body">
        {(['pinned', 'today', 'yesterday', 'week', 'earlier'] as const).map((g) =>
          grouped[g].length === 0 ? null : (
            <section key={g} className="copilot-sessions__group">
              <div className="copilot-sessions__group-head">
                {g === 'pinned' && <Pin className="h-3 w-3" />}
                <span>{GROUP_LABELS[g]}</span>
                <span className="copilot-sessions__group-count">{grouped[g].length}</span>
              </div>
              <div className="copilot-sessions__list">
                {grouped[g].map((session) => {
                  const active = session.id === s.chat.state.activeId;
                  const sessionGenerating = Boolean(session.pendingTurn)
                    || session.messages.some((m: any) => m.status === 'streaming' || m.status === 'in_flight' || m.status === 'queued');
                  return (
                    <div key={session.id} className="copilot-session-item__wrap group">
                      <button
                        type="button"
                        onClick={() => switchSession(session.id)}
                        onDoubleClick={() => s.chat.togglePin(session.id)}
                        className={cn('session-item copilot-session-item', active && 'session-item--active')}
                        aria-current={active ? 'page' : undefined}
                        aria-label={`${session.title}，${sessionGenerating ? '生成中' : session.status === 'active' ? '进行中' : '已完成'}${session.unread ? `，${session.unread} 条未读` : ''}`}
                      >
                        <div className="session-item__top">
                          <div className="session-item__title">
                            {session.pinned && <Pin className="h-3 w-3 shrink-0 text-[var(--brand)]" />}
                            <span className="truncate">{session.title}</span>
                          </div>
                          {session.unread ? (
                            <span className="session-item__unread">{session.unread}</span>
                          ) : (
                            <time className="session-item__time">{session.time}</time>
                          )}
                        </div>
                        <div className="session-item__preview">{session.preview || '暂无消息'}</div>
                        <div className="session-item__meta">
                          <span className="session-item__agent">{session.agent}</span>
                          <Badge tone={sessionGenerating ? 'info' : session.status === 'active' ? 'brand' : 'success'} className="text-[10px]">
                            {sessionGenerating ? '生成中' : session.status === 'active' ? '进行中' : '已完成'}
                          </Badge>
                        </div>
                      </button>
                      {canMutate && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void (async () => {
                              const convId = session.conversationId ?? session.id;
                              await s.chat.delSession(session.id);
                              queryClient.removeQueries({ queryKey: ['conversation', convId] });
                              if (convId !== session.id) {
                                queryClient.removeQueries({ queryKey: ['conversation', session.id] });
                              }
                              queryClient.setQueryData<SessionItem[]>(['sessions', s.currentWorkspaceId], (prev) =>
                                (prev ?? []).filter((item) => item.id !== session.id),
                              );
                              void queryClient.invalidateQueries({ queryKey: ['sessions'] });
                            })();
                          }}
                          className="copilot-session-item__delete"
                          aria-label={`删除会话：${session.title}`}
                          title="删除"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )
        )}
        {filteredSessions.length === 0 && (
          <div className="copilot-sessions__empty">
            <Bot className="h-8 w-8" />
            <strong>{canMutate ? '还没有会话' : '暂无协作记录'}</strong>
            <span>{canMutate ? '点击「新会话」选择在岗专家开始协作' : '工作区会话证据将在此只读展示'}</span>
          </div>
        )}
      </div>
    </aside>
  );
}

// re-export for callers
export { useT };
