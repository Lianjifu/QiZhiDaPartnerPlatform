/**
 * Message status / error hint dictionaries (extracted from CopilotPage).
 */
import type { MessageStatus, ErrorCategory } from '@/hooks/types';

export const STATUS_LABEL: Record<MessageStatus, string> = {
  queued: '排队中',
  in_flight: '请求中',
  streaming: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已停止',
  expired: '已过期',
  moderated: '已拦截',
};

export const STATUS_TONE: Record<MessageStatus, string> = {
  queued: 'neutral',
  in_flight: 'info',
  streaming: 'info',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'neutral',
  expired: 'warn',
  moderated: 'error',
};

export const ERROR_HINT: Record<ErrorCategory, string> = {
  network: '网络异常，请检查连通性',
  auth: '鉴权失败，请重新登录',
  timeout: '请求超时，可重试',
  rate_limit: '触发限流，请稍候重试',
  content_filter: '内容被安全策略拦截',
  tool_denied: '工具调用被权限策略拒绝',
  internal: '服务内部错误',
  unknown: '未知错误',
};