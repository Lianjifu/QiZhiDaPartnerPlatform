/**
 * CopilotPage.BubbleSplitter — 把一条 assistant 消息切成多个气泡片段(hybrid 模式)。
 *
 * 拆分规则:
 *   1. THOUGHT          — reasoningSteps / thinking / [thinking] / cognitive.phases / turnTasks
 *   2. TOOL_CALL        — 全部 toolCall 合并为一条(由 ToolCallGroup 折叠展示)
 *   3. TOOL_OBSERVATION — 工具组之后的观察文字(浅色)
 *   4. ANSWER           — 去除以上片段后的正文(标准气泡)
 *   5. META             — citations / attachments 摘要(折叠)
 *
 * 用户消息 / 工具消息不拆分(单气泡)。
 *
 * 这是纯函数;视觉差异由 CopilotPageMessageBubble 的 bubbleProps.variantStyle 控制。
 * 关键:thought 泡承载 TurnThoughtPanel(认知阶段 + 任务卡),answer 泡设置 skipTurnPanel=true
 *       避免 TurnThoughtPanel 在两处重复出现。
 */
import type { ChatMessageEx, ReasoningStep, ToolCall, Citation } from '@/hooks/types';

export type BubbleKind =
  | 'thought'
  | 'tool_call'
  | 'tool_observation'
  | 'answer'
  | 'meta';

export type BubbleVariantStyle = 'compact' | 'standard' | 'muted';

/**
 * 单个气泡片段。messageOverride 与原 m 合并(后者覆盖前者);
 * 渲染时把当前 slice 的 overrides 应用到原 m,再传给 MessageBubble。
 */
export interface BubbleSlice {
  kind: BubbleKind;
  index: number;
  messageOverride: Partial<ChatMessageEx>;
  bubbleProps?: {
    /** 紧凑 / 标准 / muted 变体样式 */
    variantStyle?: BubbleVariantStyle;
    /** 是否显示气泡头部(头像 + 名字 + 时间) */
    showHeader?: boolean;
    /** 折叠(默认 false = 展开) */
    collapse?: boolean;
    /** 跳过 TurnThoughtPanel(让 thought 泡独占,answer 泡不重复) */
    skipTurnPanel?: boolean;
    /** 用于调试 / 排序的简短标记 */
    tag?: string;
  };
}

/**
 * 拆分入口:把 assistant 消息切成 BubbleSlice 数组;非 assistant 直接返回单元素。
 *
 * 流式期间策略:
 *   - 当 m.status ∈ {queued, in_flight, streaming} 时,**只返回 1 个单泡**。
 *   - 这样避免 SSE 每来一个事件都触发 splitter 重切,产生多个"内容还没到"的空泡。
 *   - 流式完成后 status → succeeded,re-render 时 splitter 跑完整切分,出多泡。
 */
export function splitMessageIntoBubbles(m: ChatMessageEx): BubbleSlice[] {
  // 用户消息 / tool 消息 → 不拆分
  if (m.role === 'user' || m.role === 'tool') {
    return [singleSlice(m, 0, 'answer', { variantStyle: 'standard', showHeader: true })];
  }
  if (m.role !== 'assistant') {
    return [singleSlice(m, 0, 'answer', { variantStyle: 'standard', showHeader: true })];
  }

  const slices: BubbleSlice[] = [];
  let idx = 0;
  const toolCalls = m.toolCalls ?? [];

  // 1) THOUGHT:有 reasoning / cognitive narrative / turnTasks / streaming 时都出 thought 泡
  //    让 TurnThoughtPanel(认知阶段 + 任务卡)只显示在 thought 泡,answer 泡跳过
  //    避免 thought 内容与 answer 同处一个气泡(用户诉求:多泡分隔)
  //
  //    thought 泡不承载正文:推理过程属于内部叙事,由 TurnThoughtPanel 折叠展示。
  //    把 step.detail 直接拼进正文会把内部代号(如 client_hint / default_logic)
  //    泄进用户可见的回复里,因此这里只保留结构化数据,正文留空。
  const thought = extractThought(m);
  if (thought) {
    // 叙述文本:优先用消息自带的 thinking,其次是 [thinking] 标记里的正文。
    // 它属于内部叙事,由 TurnThoughtPanel 折叠展示,不进正文。
    const narrative = thought.text.trim();
    slices.push({
      kind: 'thought',
      index: idx++,
      messageOverride: {
        content: '',
        thinking: narrative || m.thinking,
        reasoningSteps: thought.steps,
        // thought 不带工具 / 引用(单独显示)
        toolCalls: [],
        citations: undefined,
      },
      bubbleProps: {
        variantStyle: 'muted',
        showHeader: true,
        tag: 'thought',
      },
    });
  }

  // 2 + 3) TOOL_CALL(整组合并) + TOOL_OBSERVATION(统一后置)
  // 工具调用收成"一组":MessageBubble 用 ToolCallGroup 折叠展示,展开后才是逐行明细,
  // 与 Claude Code 的 "Ran N commands ⌄" 一致。
  // 最后一个 tool 的观察不单独成泡,自然并入下面的 ANSWER,
  // 避免"obs 末尾 + answer 开头"内容重复(无 marker 区分)。
  if (toolCalls.length > 0) {
    slices.push({
      kind: 'tool_call',
      index: idx++,
      messageOverride: {
        // 整组工具交给 ToolCallGroup 渲染
        toolCalls,
        content: '',
        role: 'tool',
        variants: undefined,
        citations: undefined,
      },
      bubbleProps: {
        variantStyle: 'compact',
        showHeader: true,
        tag: `tool:${toolCalls.length}`,
      },
    });

    // 中间观察文字统一后置到工具组之后;最后一个工具的观察并入 ANSWER。
    const observations = toolCalls
      .slice(0, -1)
      .map((_, i) => extractObservationForTool(m.content, toolCalls, i))
      .filter((text): text is string => Boolean(text && text.trim()));
    if (observations.length > 0) {
      slices.push({
        kind: 'tool_observation',
        index: idx++,
        messageOverride: {
          content: observations.join('\n\n'),
          role: 'assistant',
          // observation 不带工具(避免递归)
          toolCalls: [],
        },
        bubbleProps: {
          variantStyle: 'muted',
          showHeader: false,
          tag: 'obs',
        },
      });
    }
  }

  // 4) ANSWER(去掉已分配片段后的正文)—— 永远 slice 化,保持回合结构稳定;
  // 即使正文为空也保留,作为该 turn 的"收尾"占位。
  // skipTurnPanel: true 避免与 thought 泡重复渲染 TurnThoughtPanel
  const answer = extractAnswerBody(m);
  slices.push({
    kind: 'answer',
    index: idx++,
    messageOverride: {
      content: answer,
      role: 'assistant',
      status: m.status,
      // 主回答保留完整 meta(variants / citations / 审计)
    },
    bubbleProps: {
      variantStyle: 'standard',
      showHeader: true,
      skipTurnPanel: true, // 关键:让 thought 泡独占 TurnThoughtPanel
    },
  });

  // 5) META(citations / attachments / 审计折叠)
  const hasMeta =
    (m.citations && m.citations.length > 0) ||
    m.attachment !== undefined;
  if (hasMeta) {
    slices.push({
      kind: 'meta',
      index: idx++,
      messageOverride: {
        content: '',
        // citations / attachment 仍由 MessageBubble 内部组件渲染
      },
      bubbleProps: {
        variantStyle: 'compact',
        showHeader: false,
        collapse: true,
        skipTurnPanel: true,
        tag: 'meta',
      },
    });
  }

  // 兜底:至少 1 个 slice(避免空数组导致渲染 bug)
  if (slices.length === 0) {
    slices.push(singleSlice(m, 0, 'answer'));
  }
  return slices;
}

/**
 * 提取推理段:优先 reasoningSteps;fallback 到 [thinking] ... [/thinking] 包裹的首段;
 * 也支持 turnTasks / cognitive.phases 这类"非纯文本"的 thought 数据。
 * 若都没找到返回 null(将由 answer 段承载整段内容)。
 *
 * 注意:reasoningSteps 只作为结构化数据返回(交给 TurnThoughtPanel 渲染),
 * 不把 step.detail 拼成正文——step.detail 是内部推理细节,直接展示会泄露
 * 内部代号并让回复看起来像日志。
 */
function extractThought(m: ChatMessageEx): { text: string; steps?: ReasoningStep[] } | null {
  if (m.reasoningSteps && m.reasoningSteps.length > 0) {
    return { text: '', steps: m.reasoningSteps };
  }
  if (m.thinking && m.thinking.trim()) {
    return { text: m.thinking };
  }
  if (m.content) {
    const thinkMatch = m.content.match(
      /^\s*(?:\[thinking\]|<thinking>|【思考】)\s*([\s\S]+?)\s*(?:\[\/thinking\]|<\/thinking>|【\/思考】)/i,
    );
    if (thinkMatch) {
      const text = thinkMatch[1].trim();
      if (text) return { text };
    }
  }
  // 兜底:cognitive narrative / turnTasks 也算 thought(让 TurnThoughtPanel 独占 thought 泡)
  if (m.cognitive?.phases && m.cognitive.phases.length > 0) {
    return { text: '' }; // 文本为空,TurnThoughtPanel 仍会渲染(用 m.cognitive / m.turnTasks)
  }
  if (m.turnTasks && m.turnTasks.length > 0) {
    return { text: '' };
  }
  if (m.turnMeta?.tasks && m.turnMeta.tasks.length > 0) {
    return { text: '' };
  }
  return null;
}

/**
 * 按 <<<TOOL>>>...<<<END>>> 块切割 content,提取第 i 个 tool call 之后的观察文字。
 *
 * 假设 content 形如:
 *   "<<<thought/intro>>>...<<<TOOL>>>...<<<END>>> observation1...<<<TOOL>>>...<<<END>>> observation2...answer"
 *   parts[0] = thought/intro(可能空)
 *   parts[1] = observation1
 *   parts[i+1] = observation(i 从 0 开始)
 *
 * 若没有 <<<TOOL>>> 标记(LLM 直接走自然语言),返回 null,由 ANSWER 段承接整段 content。
 */
function extractObservationForTool(
  content: string | undefined,
  _toolCalls: ToolCall[],
  index: number,
): string | null {
  if (!content) return null;
  const parts = content.split(/<<<TOOL>>>[\s\S]*?<<<END>>>/);
  const obsIndex = index + 1;
  if (obsIndex >= parts.length) return null;
  const obs = parts[obsIndex].trim();
  return obs || null;
}

/**
 * 提取 ANSWER 正文:去掉 [thinking] 段、<<<TOOL>>> 块、首段 thought。
 *
 * 简化策略:在 ANSWER 与 THOUGHT/TOOL 之间用 marker 切分。
 * 若 marker 都没有(content 是纯文本),整段 content 作为 ANSWER。
 */
function extractAnswerBody(m: ChatMessageEx): string {
  if (!m.content) return '';
  let body = m.content;
  // 去掉 [thinking] / 【思考】 包裹的首段(支持中英文括号变体)
  body = body.replace(
    /^\s*(?:\[thinking\]|<thinking>|【思考】)\s*[\s\S]+?\s*(?:\[\/thinking\]|<\/thinking>|【\/思考】)\s*/i,
    '',
  );
  // 取最后一个 <<<END>>> 之后的所有内容(包含最后一次观察的延续 + 最终回答)
  // 不再做精确切分,因 obs 与 answer 之间没有显式 marker;保留宽容度。
  const lastEndIdx = body.lastIndexOf('<<<END>>>');
  if (lastEndIdx >= 0) {
    body = body.substring(lastEndIdx + '<<<END>>>'.length);
  } else {
    // 没有 tool 块,只剩纯文字(可能含已去 thought)
    body = body.replace(/<<<TOOL>>>[\s\S]*?<<<END>>>/g, '');
  }
  return body.trim();
}

/**
 * 辅助:构造单一 slice(非 assistant / tool 消息用)。
 */
function singleSlice(
  m: ChatMessageEx,
  index: number,
  kind: BubbleKind,
  bubbleProps?: BubbleSlice['bubbleProps'],
): BubbleSlice {
  return {
    kind,
    index,
    messageOverride: { role: m.role, content: m.content, status: m.status },
    bubbleProps,
  };
}

/**
 * 把 slices 应用到原 m 上,生成最终渲染用的 ChatMessageEx 数组。
 * 简单合并:{ ...m, ...slice.messageOverride }
 */
export function applySliceToMessage(
  m: ChatMessageEx,
  slice: BubbleSlice,
): ChatMessageEx {
  // 仅在 override 字段确实有值时覆盖,保持其他字段不变
  const merged: ChatMessageEx = { ...m, ...slice.messageOverride } as ChatMessageEx;
  return merged;
}

/**
 * 简化调试:把 slices 序列化成可读字符串,方便在 console 里快速查看。
 */
export function describeSlices(slices: BubbleSlice[]): string {
  return slices.map((s) => `${s.index}:${s.kind}${s.bubbleProps?.tag ? `:${s.bubbleProps.tag}` : ''}`).join(' → ');
}

/**
 * 把切片列表拆分成"稳定 ID + 切片对象"对,方便 React key 渲染。
 */
export function withStableKeys(
  m: ChatMessageEx,
  slices: BubbleSlice[],
): Array<{ key: string; slice: BubbleSlice; merged: ChatMessageEx }> {
  return slices.map((s) => ({
    key: `${m.id}__${s.kind}__${s.index}`,
    slice: s,
    merged: applySliceToMessage(m, s),
  }));
}

// 显式引用避免被 tree-shake(测试 / 文档用)
export type _CitationRef = Citation;