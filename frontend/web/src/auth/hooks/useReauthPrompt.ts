import { useState } from 'react';
import { useLogout, type LogoutSource } from './useLogout';

export type ReauthPromptKind = 'workspaces-error';

interface UseReauthPromptResult {
  /** 重新登录按钮的 onClick — 调 useLogout({ from: 'reauth' }) */
  triggerReauth: () => void;
  /** 上次触发的来源，便于日志/埋点 */
  lastSource: LogoutSource | null;
}

/**
 * 工作区列表加载失败 / 登录过期场景下的 reauth 触发器。
 * 仅封装"点击 → 退出登录 → 跳 /login"链路，UI 由调用方渲染。
 *
 * 行为不变性:
 *   - 调用方传入 `kind` 仅用于将来扩展更多 reauth 入口；
 *     现阶段所有 reauth 都走 from='reauth'。
 *   - 不在 hook 内部渲染任何 DOM，保持纯逻辑。
 */
export function useReauthPrompt(_kind: ReauthPromptKind = 'workspaces-error'): UseReauthPromptResult {
  const logout = useLogout();
  const [lastSource, setLastSource] = useState<LogoutSource | null>(null);

  const triggerReauth = () => {
    logout({ from: 'reauth' });
    setLastSource('reauth');
  };

  return { triggerReauth, lastSource };
}
