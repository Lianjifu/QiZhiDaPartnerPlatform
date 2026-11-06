/**
 * 工具技术名 → 用户可读的能力名。
 *
 * 后端的 thought 文案已把内部代号翻译成人话，但工具调用卡片仍直接显示
 * knowledge.retrieve / memory.recall 这类标识，让整条回复读起来像日志。
 * 这里做同样的翻译；原始技术名保留在 title 里供排查。
 */
export function humanToolName(toolName: string | undefined | null): string {
  const name = (toolName ?? '').trim();
  if (!name) return '能力';
  const lower = name.toLowerCase();
  if (lower.includes('knowledge') || lower.includes('retrieve')) return '知识检索';
  if (lower.includes('memory') || lower.includes('recall')) return '记忆回忆';
  if (lower.includes('docx') || lower.includes('word')) return 'Word 文档';
  if (lower.includes('pptx') || lower.includes('ppt')) return '演示文稿';
  if (lower.includes('xlsx') || lower.includes('excel')) return '表格';
  if (lower.includes('web') || lower.includes('browse')) return '网页访问';
  if (lower.includes('shell')) return '受控命令';
  if (lower.includes('mcp')) return 'MCP 服务';
  if (lower.includes('chart')) return '图表生成';
  if (lower.includes('todo')) return '待办记录';
  if (lower.includes('artifact')) return '产物读取';
  if (lower.includes('ask_user')) return '向用户确认';
  return name;
}
