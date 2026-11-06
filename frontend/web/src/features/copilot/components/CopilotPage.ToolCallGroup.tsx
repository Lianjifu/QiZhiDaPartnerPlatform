/**
 * ToolCallGroup — 一整组工具调用的折叠条(Claude Code 风格)。
 *
 * 收起时是一行淡灰文字「调用了 N 项能力」;展开后是一个浅灰圆角盒,
 * 盒内每项能力一行(复用 ToolCallRow:状态点 + 能力名 + 参数摘要 + 耗时)。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ToolCall } from '@/hooks/types';
import { ToolCallRow } from './CopilotPage.ToolCallRow';

export function ToolCallGroup({
  toolCalls,
  streaming,
}: {
  toolCalls: ToolCall[];
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // 用户手动展开过就不再被自动开合接管。
  const manual = useRef(false);

  // 流式期间自动展开,结束后自动收起——与 Claude Code 一致,让运行过程可见。
  useEffect(() => {
    if (!manual.current) setExpanded(streaming === true);
  }, [streaming]);

  if (toolCalls.length === 0) return null;

  return (
    <div className="copilot-tool-group w-full max-w-[800px]">
      <button
        type="button"
        onClick={() => {
          manual.current = true;
          setExpanded((value) => !value);
        }}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 text-[12.5px] text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        <span>调用了 {toolCalls.length} 项能力</span>
      </button>
      {expanded ? (
        <div className="mt-1.5 space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2">
          {toolCalls.map((tc) => (
            <ToolCallRow key={tc.id} toolCall={tc} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
