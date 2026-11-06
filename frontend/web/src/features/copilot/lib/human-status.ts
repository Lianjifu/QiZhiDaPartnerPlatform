/**
 * 状态译成人话：后端事件里的 detail / status 可能是机器状态
 * （success / done / skipped / denied…），直接显示像日志。
 * 只翻译已知的机器状态，其余（已中文化的说明，如「检索知识」）原样保留。
 */
const STATUS_LABELS: Record<string, string> = {
  success: '成功',
  succeeded: '成功',
  done: '已完成',
  completed: '已完成',
  skipped: '已跳过',
  failed: '失败',
  error: '失败',
  denied: '已拒绝',
  rejected: '已拒绝',
  running: '执行中',
  started: '执行中',
  pending: '等待中',
  waiting: '等待中',
  cancelled: '已取消',
  canceled: '已取消',
};

export function humanStatusLabel(raw: string | undefined | null): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  return STATUS_LABELS[text.toLowerCase()] ?? text;
}
