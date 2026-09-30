/**
 * 调试面板 — 企业级 DevTools 体验
 * 4 大分组（Overview / Request / Tools / Compliance）+ 全文搜索 + correlationId 过滤
 * + 语法高亮 JSON 树 + 统一事件时间线 + 性能指标 + 导出 bundle
 * 按 调试 按钮打开 / Esc 关闭
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Badge, Button } from '@qzda/web-ui';
import {
  X, Bug, Receipt, Cpu, Wrench, Database, Activity, Copy, CheckCircle2, AlertCircle,
  Sparkles, ChevronRight, ChevronDown, ShieldCheck, ShieldAlert, FileText, ListChecks, Lock,
  Search, Filter, Download, RefreshCw, Clock, Hash, Zap, Server, History,
  Box, Layers, AlertOctagon, FileDown, TrendingUp, Activity as Pulse,
} from 'lucide-react';
import { cn } from '@qzda/web-utils';
import { getApiClient } from '@qzda/web-api';
import type { ReplayTurnResponse } from '@qzda/web-types';
import type { ChatMessageEx, ChatSession, ToolCall, Citation } from '@/hooks/types';

interface AgentMetaDebug {
  id: string; name: string; version: string; category: string;
  rating: number; ratingCount: number; lastActive: string;
  installCount: number; responseP95: number; totalTokens: number;
  sla: number; errorRate: number; knowledgeBases: number; tools: number; languages: string[];
  description?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  session: ChatSession | undefined;
  agentMeta: AgentMetaDebug | undefined;
}

/* ============ 4 大分组（每组含 2-3 个子 tab） ============ */
const GROUPS: { key: string; label: string; icon: any; tabs: { key: string; label: string; icon: any; badge?: (s: ChatSession | undefined) => number | null }[] }[] = [
  {
    key: 'overview',
    label: '总览',
    icon: Layers,
    tabs: [
      { key: 'summary', label: '会话摘要', icon: Box },
      { key: 'timeline', label: '事件时间线', icon: Pulse, badge: (s) => s?.messages.length ?? 0 },
      { key: 'metrics', label: '性能指标', icon: TrendingUp },
    ],
  },
  {
    key: 'request',
    label: '请求',
    icon: Receipt,
    tabs: [
      { key: 'request', label: 'Request', icon: Receipt },
      { key: 'response', label: 'Response', icon: Bug },
      { key: 'agent', label: 'Agent', icon: Cpu },
    ],
  },
  {
    key: 'tools',
    label: '工具与知识',
    icon: Wrench,
    tabs: [
      { key: 'reasoning', label: '推理', icon: Sparkles, badge: (s) => s?.messages.reduce((n, m) => n + (m.reasoningSteps?.length ?? 0), 0) ?? 0 },
      { key: 'tools', label: '工具调用', icon: Wrench, badge: (s) => s?.messages.reduce((n, m) => n + (m.toolCalls?.length ?? 0), 0) ?? 0 },
      { key: 'rag', label: 'RAG 引用', icon: Database, badge: (s) => s?.messages.reduce((n, m) => n + (m.citations?.length ?? 0), 0) ?? 0 },
    ],
  },
  {
    key: 'compliance',
    label: '合规与审计',
    icon: ShieldCheck,
    tabs: [
      { key: 'policy', label: '策略', icon: ShieldCheck, badge: (s) => s?.messages.reduce((n, m) => n + (m.toolCalls?.filter((t) => t.permission === 'approval-required').length ?? 0), 0) ?? 0 },
      { key: 'approval', label: '双签', icon: ListChecks, badge: (s) => s?.messages.filter((m) => m.approvalRequest).length ?? 0 },
      { key: 'audit', label: '审计', icon: FileText, badge: (s) => s?.messages.length ?? 0 },
      { key: 'logs', label: '日志', icon: Activity, badge: (s) => s?.messages.length ?? 0 },
    ],
  },
];

export function DebugPanel({ open, onClose, session, agentMeta }: Props) {
  const [activeGroup, setActiveGroup] = useState('overview');
  const [activeTab, setActiveTab] = useState('summary');
  const [searchQ, setSearchQ] = useState('');
  const [filterCorr, setFilterCorr] = useState<string>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [replayCorr, setReplayCorr] = useState<string | null>(null);
  const [replayState, setReplayState] = useState<{ loading: boolean; error?: string; data?: ReplayTurnResponse }>({ loading: false });

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); (document.getElementById('debug-search') as HTMLInputElement | null)?.focus(); }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);

  const copy = async (text: string, key?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (key) { setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1200); }
    } catch {}
  };

  const selectTab = useCallback((groupKey: string, tabKey: string) => {
    setActiveGroup(groupKey);
    setActiveTab(tabKey);
  }, []);

  const runReplay = useCallback(async (corr: string) => {
    const conversationId = session?.conversationId || session?.id;
    if (!conversationId || !corr) return;
    setReplayCorr(corr);
    setReplayState({ loading: true });
    selectTab('compliance', 'audit');
    try {
      const data = await getApiClient().request<ReplayTurnResponse>(
        `/api/copilot/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(corr)}/replay`,
      );
      setReplayState({ loading: false, data });
    } catch (err) {
      setReplayState({ loading: false, error: err instanceof Error ? err.message : '复盘失败' });
    }
  }, [session, selectTab]);

  // 全部 message 列表（受搜索 + correlationId 过滤）
  const allMessages = useMemo(() => session?.messages ?? [], [session]);

  const corrIds = useMemo(() => {
    const set = new Set<string>();
    allMessages.forEach((m) => { if (m.correlationId) set.add(m.correlationId); });
    return Array.from(set);
  }, [allMessages]);

  const matchedMessages = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return allMessages.filter((m) => {
      if (filterCorr !== 'all' && m.correlationId !== filterCorr) return false;
      if (!q) return true;
      const blob = JSON.stringify(m).toLowerCase();
      return blob.includes(q) || m.content.toLowerCase().includes(q) || (m.correlationId ?? '').toLowerCase().includes(q);
    });
  }, [allMessages, searchQ, filterCorr, refreshKey]);

  const allToolCalls = useMemo(() => allMessages.flatMap((m) => (m.toolCalls ?? []).map((tc) => ({ ...tc, mid: m.id, createdAt: m.createdAt, agentName: m.agentName, correlationId: m.correlationId }))), [allMessages]);
  const allCites = useMemo(() => allMessages.flatMap((m) => (m.citations ?? []).map((c) => ({ ...c, mid: m.id, createdAt: m.createdAt, correlationId: m.correlationId }))), [allMessages]);
  const allReasoning = useMemo(() => allMessages.flatMap((m) => (m.reasoningSteps ?? []).map((s) => ({ ...s, mid: m.id, createdAt: m.createdAt, correlationId: m.correlationId }))), [allMessages]);
  const allApprovals = useMemo(() => allMessages.filter((m) => m.approvalRequest), [allMessages]);

  // 性能指标聚合
  const perfMetrics = useMemo(() => {
    const assistants = allMessages.filter((m) => m.role === 'assistant');
    const ttfts = assistants.map((m) => m.metrics?.ttftMs ?? 0).filter((v) => v > 0);
    const durations = assistants.map((m) => m.metrics?.durationMs ?? 0).filter((v) => v > 0);
    const promptTokens = assistants.reduce((s, m) => s + (m.metrics?.promptTokens ?? 0), 0);
    const completionTokens = assistants.reduce((s, m) => s + (m.metrics?.completionTokens ?? 0), 0);
    const cacheHits = assistants.reduce((s, m) => s + (m.metrics?.cacheHits ?? 0), 0);
    const succeeded = assistants.filter((m) => m.status === 'succeeded').length;
    const failed = assistants.filter((m) => m.status === 'failed').length;
    const cancelled = assistants.filter((m) => m.status === 'cancelled').length;
    return {
      count: assistants.length,
      ttfts, durations, promptTokens, completionTokens, cacheHits,
      succeeded, failed, cancelled,
      avgTtft: ttfts.length ? Math.round(ttfts.reduce((a, b) => a + b, 0) / ttfts.length) : 0,
      p50Ttft: ttfts.length ? ttfts.sort((a, b) => a - b)[Math.floor(ttfts.length / 2)] : 0,
      p95Ttft: ttfts.length ? ttfts.sort((a, b) => a - b)[Math.floor(ttfts.length * 0.95)] : 0,
    };
  }, [allMessages, refreshKey]);

  // 统一事件时间线
  const events = useMemo(() => {
    const out: { ts: string; kind: string; actor: string; text: string; tone: 'info' | 'success' | 'warn' | 'error' | 'neutral'; corr?: string; mid?: string }[] = [];
    if (session) {
      out.push({ ts: new Date(session.createdAt).toISOString(), kind: 'session', actor: 'system', text: `会话创建 · ${session.id.slice(0, 12)}`, tone: 'info' });
    }
    allMessages.forEach((m) => {
      const actor = m.agentName ?? (m.role === 'user' ? '王昊' : m.role === 'tool' ? '工具' : 'Agent');
      const text = m.content?.slice(0, 80) || `${m.role} message`;
      out.push({ ts: m.createdAt, kind: m.role, actor, text, tone: m.role === 'user' ? 'info' : 'success', corr: m.correlationId, mid: m.id });
      (m.toolCalls ?? []).forEach((tc) => {
        out.push({ ts: m.createdAt, kind: 'tool', actor: tc.name, text: `${tc.permission ?? 'auto'} · ${tc.status}${tc.sandboxId ? ` · sandbox:${tc.sandboxId}` : ''}${tc.traceId ? ` · ${tc.traceId}` : ''}`, tone: tc.status === 'failed' ? 'error' : tc.status === 'denied' ? 'warn' : 'neutral', corr: m.correlationId, mid: m.id });
      });
      (m.citations ?? []).forEach((c) => {
        out.push({ ts: m.createdAt, kind: 'rag', actor: c.source, text: `score ${(c.score * 100).toFixed(0)}%${c.page ? ` · p.${c.page}` : ''}`, tone: 'info', corr: m.correlationId, mid: m.id });
      });
      (m.approvalRequest?.signers ?? []).forEach((s) => {
        if (s.signed) out.push({ ts: s.signedAt ?? m.createdAt, kind: 'sign', actor: s.name, text: `${s.role} 签名 · ${s.signatureHash?.slice(-6) ?? '—'}`, tone: s.role === 'auditor' ? 'info' : 'success', corr: m.correlationId, mid: m.id });
      });
    });
    out.sort((a, b) => a.ts.localeCompare(b.ts));
    return out;
  }, [session, allMessages, refreshKey]);

  if (!open) return null;
  const currentGroup = GROUPS.find((g) => g.key === activeGroup) ?? GROUPS[0];
  const currentTab = currentGroup.tabs.find((t) => t.key === activeTab) ?? currentGroup.tabs[0];

  // 导出整个会话 bundle
  const exportBundle = () => {
    const bundle = {
      schema: 'de-debug-bundle@1',
      exportedAt: new Date().toISOString(),
      session: {
        id: session?.id,
        title: session?.title,
        agent: session?.agent,
        createdAt: session?.createdAt,
        messageCount: session?.messages.length ?? 0,
        metrics: perfMetrics,
      },
      events,
      toolCalls: allToolCalls,
      citations: allCites,
      reasoning: allReasoning,
      approvals: allApprovals,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `debug-${session?.id ?? 'session'}-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
      <div
        className="relative flex h-full w-[820px] max-w-[96vw] flex-col border-l border-[var(--border)] bg-[var(--bg)] shadow-2xl animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ============ 顶栏：标题 + 操作 ============ */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--bg-elevated)]/60 px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-[var(--brand-light)] text-[var(--brand)] shrink-0">
              <Bug className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold flex items-center gap-1.5">
                调试控制台
                <Badge tone="brand" className="text-[9px]">DevTools</Badge>
              </div>
              <div className="text-[10px] text-[var(--text-muted)] font-mono truncate">
                {session?.id ?? '—'} · {allMessages.length} 消息 · {allToolCalls.length} 工具 · {allCites.length} 引用
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              className="grid h-7 w-7 place-items-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
              title="刷新"
              aria-label="刷新"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={exportBundle}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--text)]"
              title="导出 Bundle"
            >
              <FileDown className="h-3 w-3" />导出
            </button>
            <button
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded-md border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-muted)] hover:border-[var(--danger)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] transition-colors"
              aria-label="关闭调试面板"
              title="关闭（Esc）"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* ============ 搜索 + correlationId 过滤 ============ */}
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
            <input
              id="debug-search"
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="搜索消息内容 / 工具 / 引用 / correlationId（⌘K）"
              className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] pl-8 pr-12 text-xs outline-none focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_var(--brand-light)]"
            />
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-[var(--text-muted)] font-mono border border-[var(--border)] rounded px-1">⌘K</kbd>
          </div>
          <select
            value={filterCorr}
            onChange={(e) => setFilterCorr(e.target.value)}
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs"
            title="按 correlationId 过滤"
          >
            <option value="all">全部 corr ({corrIds.length})</option>
            {corrIds.map((c) => <option key={c} value={c}>{c.slice(0, 16)}</option>)}
          </select>
          {filterCorr !== 'all' && (
            <button
              onClick={() => { void runReplay(filterCorr); }}
              disabled={replayState.loading}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[11px] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--text)] disabled:opacity-50"
              title="按 correlationId 只读复盘，不会再调用模型"
            >
              <History className="h-3 w-3" />
              {replayState.loading && replayCorr === filterCorr ? '复盘中' : '复盘本回合'}
            </button>
          )}
          {(searchQ || filterCorr !== 'all') && (
            <button
              onClick={() => { setSearchQ(''); setFilterCorr('all'); }}
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] px-2"
            >
              清空
            </button>
          )}
        </div>

        <div className="flex flex-1 min-h-0">
          {/* ============ 左侧分组导航 ============ */}
          <nav className="w-44 shrink-0 border-r border-[var(--border)] bg-[var(--bg-elevated)]/30 py-2 flex flex-col gap-0.5">
            {GROUPS.map((g) => {
              const active = g.key === activeGroup;
              return (
                <button
                  key={g.key}
                  onClick={() => { setActiveGroup(g.key); setActiveTab(g.tabs[0].key); }}
                  className={cn(
                    'mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs',
                    active
                      ? 'bg-[var(--brand-light)] text-[var(--brand)] font-semibold'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                  )}
                >
                  <g.icon className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-[var(--brand)]' : 'text-[var(--text-muted)]')} />
                  <span className="truncate">{g.label}</span>
                </button>
              );
            })}
            <div className="mx-3 my-2 h-px bg-[var(--border)]" />
            <div className="mx-3 mt-1 text-[9px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
              {currentGroup.label}
            </div>
            {currentGroup.tabs.map((t) => {
              const active = t.key === activeTab;
              const badgeCount = t.badge?.(session);
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={cn(
                    'mx-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] relative',
                    active ? 'bg-[var(--bg-hover)] text-[var(--text)] font-semibold' : 'text-[var(--text-muted)] hover:text-[var(--text)]',
                  )}
                >
                  <t.icon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{t.label}</span>
                  {badgeCount != null && badgeCount > 0 && (
                    <span className="ml-auto text-[9px] font-mono text-[var(--text-muted)]">{badgeCount}</span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* ============ 主内容区 ============ */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* 当前 tab header */}
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-2">
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                <span className="font-semibold text-[var(--text)]">{currentGroup.label}</span>
                <ChevronRight className="h-3 w-3" />
                <span className="font-mono">{currentTab.label}</span>
                {(searchQ || filterCorr !== 'all') && <Badge tone="brand" className="text-[9px]">已过滤 {matchedMessages.length}</Badge>}
              </div>
              <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] font-mono">
                <span>消息</span><span className="text-[var(--text)] font-semibold">{matchedMessages.length}</span>
                <span>·</span><span>工具</span><span className="text-[var(--text)] font-semibold">{allToolCalls.length}</span>
                <span>·</span><span>引用</span><span className="text-[var(--text)] font-semibold">{allCites.length}</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              {/* ============ 总览组 ============ */}
              {activeTab === 'summary' && (
                <SummaryView
                  session={session}
                  agentMeta={agentMeta}
                  perfMetrics={perfMetrics}
                  allToolCalls={allToolCalls}
                  allCites={allCites}
                  allApprovals={allApprovals}
                />
              )}

              {activeTab === 'timeline' && (
                <TimelineView events={events} onSelectMid={(mid) => { const m = allMessages.find((x) => x.id === mid); if (m) setSearchQ(m.content?.slice(0, 20) ?? ''); }} />
              )}

              {activeTab === 'metrics' && (
                <MetricsView perf={perfMetrics} allToolCalls={allToolCalls} />
              )}

              {/* ============ 请求组 ============ */}
              {activeTab === 'request' && (
                <RequestView messages={matchedMessages} copiedKey={copiedKey} onCopy={copy} />
              )}
              {activeTab === 'response' && (
                <ResponseView messages={matchedMessages.filter((m) => m.role !== 'user')} copiedKey={copiedKey} onCopy={copy} />
              )}
              {activeTab === 'agent' && agentMeta && (
                <AgentView agentMeta={agentMeta} />
              )}

              {/* ============ 工具与知识组 ============ */}
              {activeTab === 'reasoning' && (
                <ReasoningView items={allReasoning} />
              )}
              {activeTab === 'tools' && (
                <ToolsView tools={allToolCalls} copiedKey={copiedKey} onCopy={copy} />
              )}
              {activeTab === 'rag' && (
                <RagView cites={allCites} copiedKey={copiedKey} onCopy={copy} />
              )}

              {/* ============ 合规与审计组 ============ */}
              {activeTab === 'policy' && (
                <PolicyView tools={allToolCalls} />
              )}
              {activeTab === 'approval' && (
                <ApprovalView items={allApprovals} />
              )}
              {activeTab === 'audit' && (
                <AuditView
                  session={session}
                  messages={matchedMessages}
                  replayCorr={replayCorr}
                  replayState={replayState}
                  onReplay={(corr) => { void runReplay(corr); }}
                />
              )}
              {activeTab === 'logs' && (
                <LogsView events={events} />
              )}
            </div>
          </div>
        </div>

        {/* ============ 底部状态栏 ============ */}
        <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--bg-elevated)]/60 px-4 py-1.5 text-[10px] text-[var(--text-muted)] font-mono">
          <div className="flex items-center gap-3">
            <span>TTFT avg <span className="text-[var(--text)] font-semibold">{perfMetrics.avgTtft}ms</span></span>
            <span>p95 <span className="text-[var(--text)] font-semibold">{perfMetrics.p95Ttft}ms</span></span>
            <span>tokens <span className="text-[var(--text)] font-semibold">{(perfMetrics.promptTokens + perfMetrics.completionTokens).toLocaleString()}</span></span>
            <span>cache <span className="text-[var(--text)] font-semibold">{perfMetrics.cacheHits}</span></span>
          </div>
          <div className="flex items-center gap-2">
            <span>✓ {perfMetrics.succeeded}</span>
            <span>✕ {perfMetrics.failed}</span>
            <span>■ {perfMetrics.cancelled}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ 视图组件 ============ */

function SummaryView({ session, agentMeta, perfMetrics, allToolCalls, allCites, allApprovals }: {
  session: ChatSession | undefined;
  agentMeta: AgentMetaDebug | undefined;
  perfMetrics: ReturnType<typeof Object> | any;
  allToolCalls: any[];
  allCites: any[];
  allApprovals: ChatMessageEx[];
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="消息总数" value={session?.messages.length ?? 0} icon={Hash} tone="brand" />
        <Stat label="工具调用" value={allToolCalls.length} icon={Wrench} tone="info" />
        <Stat label="RAG 引用" value={allCites.length} icon={Database} tone="info" />
        <Stat label="双签请求" value={allApprovals.length} icon={ShieldCheck} tone="warn" />
        <Stat label="成功" value={perfMetrics.succeeded} icon={CheckCircle2} tone="success" />
        <Stat label="失败 / 取消" value={`${perfMetrics.failed} / ${perfMetrics.cancelled}`} icon={AlertCircle} tone={perfMetrics.failed > 0 ? 'error' : 'neutral'} />
      </div>
      {agentMeta && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="h-3.5 w-3.5 text-[var(--brand)]" />
            <span className="font-semibold text-xs">Agent</span>
            <span className="text-[10px] text-[var(--text-muted)] font-mono">{agentMeta.id} · v{agentMeta.version}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-[10px]">
            <Field label="名称" value={agentMeta.name} />
            <Field label="分类" value={agentMeta.category} />
            <Field label="SLA" value={`${agentMeta.sla}%`} />
            <Field label="错误率" value={`${((agentMeta.errorRate ?? 0) * 100).toFixed(2)}%`} />
            <Field label="P95" value={`${agentMeta.responseP95}ms`} />
            <Field label="工具" value={`${agentMeta.tools}`} />
          </div>
        </div>
      )}
      {session && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
          <div className="flex items-center gap-2 mb-2">
            <Box className="h-3.5 w-3.5 text-[var(--brand)]" />
            <span className="font-semibold text-xs">会话</span>
          </div>
          <div className="space-y-0.5 text-[10px] font-mono">
            <div className="flex justify-between"><span className="text-[var(--text-muted)]">id</span><span className="text-[var(--text)]">{session.id}</span></div>
            <div className="flex justify-between"><span className="text-[var(--text-muted)]">title</span><span className="text-[var(--text)]">{session.title}</span></div>
            <div className="flex justify-between"><span className="text-[var(--text-muted)]">status</span><Badge tone={session.status === 'done' ? 'success' : 'brand'} className="text-[9px]">{session.status}</Badge></div>
            <div className="flex justify-between"><span className="text-[var(--text-muted)]">createdAt</span><span className="text-[var(--text)]">{new Date(session.createdAt).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-[var(--text-muted)]">owner</span><span className="text-[var(--text)]">{session.ownerName ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-[var(--text-muted)]">workspace</span><span className="text-[var(--text)]">{session.workspaceId ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-[var(--text-muted)]">shareToken</span><span className="text-[var(--text)]">{session.shareToken ?? '—'}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineView({ events, onSelectMid }: { events: any[]; onSelectMid: (id: string) => void }) {
  if (events.length === 0) return <EmptyTab text="暂无事件。" />;
  return (
    <div className="relative pl-3">
      <div className="absolute left-1.5 top-2 bottom-2 w-px bg-[var(--border)]" />
      <div className="space-y-1.5">
        {events.map((e, i) => (
          <button
            key={i}
            onClick={() => e.mid && onSelectMid(e.mid)}
            className="relative flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
          >
            <span className={cn(
              'absolute -left-0.5 top-2.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--bg)]',
              e.tone === 'success' ? 'bg-[var(--success)]' : e.tone === 'warn' ? 'bg-[var(--warning)]' : e.tone === 'error' ? 'bg-[var(--danger)]' : e.tone === 'info' ? 'bg-[var(--info)]' : 'bg-[var(--text-muted)]',
            )} />
            <div className="flex-1 min-w-0 ml-3">
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="font-mono text-[var(--text-muted)]">{new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                <Badge tone={e.tone === 'error' ? 'error' : e.tone === 'warn' ? 'warn' : e.tone === 'success' ? 'success' : 'neutral'} className="text-[9px]">{e.kind}</Badge>
                <span className="font-semibold text-[var(--text-secondary)]">{e.actor}</span>
                {e.corr && <span className="font-mono text-[var(--text-muted)] text-[9px]">{e.corr.slice(0, 12)}</span>}
              </div>
              <div className="text-[11px] text-[var(--text)] truncate">{e.text}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function MetricsView({ perf, allToolCalls }: { perf: any; allToolCalls: any[] }) {
  const maxTtft = Math.max(...perf.ttfts, 1);
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="h-3.5 w-3.5 text-[var(--brand)]" />
          <span className="font-semibold text-xs">TTFT（首 token 时间）</span>
          <span className="ml-auto text-[10px] text-[var(--text-muted)] font-mono">avg {perf.avgTtft}ms · p50 {perf.p50Ttft}ms · p95 {perf.p95Ttft}ms</span>
        </div>
        <div className="flex items-end gap-1.5 h-20">
          {perf.ttfts.length === 0 ? (
            <div className="text-[10px] text-[var(--text-muted)]">无数据</div>
          ) : perf.ttfts.map((v: number, i: number) => (
            <div
              key={i}
              className="flex-1 rounded-t bg-gradient-to-t from-[var(--brand)] to-[var(--purple)]"
              style={{ height: `${(v / maxTtft) * 100}%`, minHeight: '4px' }}
              title={`${v}ms`}
            />
          ))}
        </div>
        <div className="mt-1 text-[10px] text-[var(--text-muted)] flex justify-between font-mono">
          <span>1st</span><span>last</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Prompt tokens" value={perf.promptTokens.toLocaleString()} icon={Hash} tone="info" />
        <Stat label="Completion tokens" value={perf.completionTokens.toLocaleString()} icon={Hash} tone="info" />
        <Stat label="Cache 命中" value={perf.cacheHits} icon={Zap} tone="success" />
      </div>

      {allToolCalls.length > 0 && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
          <div className="flex items-center gap-2 mb-2">
            <Wrench className="h-3.5 w-3.5 text-[var(--brand)]" />
            <span className="font-semibold text-xs">工具执行时长</span>
          </div>
          <div className="space-y-1">
            {allToolCalls.slice(0, 10).map((tc, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <span className="font-mono flex-1 truncate">{tc.name}</span>
                <div className="w-24 h-1.5 rounded-full bg-[var(--bg)] overflow-hidden">
                  <div
                    className={cn('h-full', tc.status === 'failed' ? 'bg-[var(--danger)]' : 'bg-[var(--success)]')}
                    style={{ width: `${Math.min(100, ((tc.durationMs ?? 0) / 1500) * 100)}%` }}
                  />
                </div>
                <span className="font-mono text-[var(--text-muted)] w-12 text-right">{tc.durationMs}ms</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RequestView({ messages, copiedKey, onCopy }: { messages: any[]; copiedKey: string | null; onCopy: (t: string, k: string) => void }) {
  if (messages.length === 0) return <EmptyTab text="暂无消息。发送一条消息后在此查看请求体。" />;
  return (
    <div className="space-y-2">
      {messages.map((m) => (
        <JsonBlock
          key={m.id}
          title={`${m.role.toUpperCase()} · ${m.correlationId?.slice(0, 12) ?? '—'}`}
          sub={`${new Date(m.createdAt).toLocaleString('zh-CN', { hour12: false })} · ${m.id.slice(0, 8)}`}
          json={pickRequest(m)}
          copyKey={`req_${m.id}`}
          copiedKey={copiedKey}
          onCopy={onCopy}
        />
      ))}
    </div>
  );
}

function ResponseView({ messages, copiedKey, onCopy }: { messages: any[]; copiedKey: string | null; onCopy: (t: string, k: string) => void }) {
  if (messages.length === 0) return <EmptyTab text="暂无 Agent 回复。" />;
  return (
    <div className="space-y-2">
      {messages.map((m) => (
        <JsonBlock
          key={m.id}
          title={`${m.agentName ?? m.role} · ${m.status ?? '—'}`}
          sub={`${new Date(m.createdAt).toLocaleString('zh-CN', { hour12: false })} · TTFT ${m.metrics?.ttftMs ?? '—'}ms · ${m.metrics?.durationMs ?? '—'}ms`}
          json={pickResponse(m)}
          copyKey={`res_${m.id}`}
          copiedKey={copiedKey}
          onCopy={onCopy}
        />
      ))}
    </div>
  );
}

function AgentView({ agentMeta }: { agentMeta: AgentMetaDebug }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="ID" value={agentMeta.id} />
        <Field label="名称" value={agentMeta.name} />
        <Field label="版本" value={agentMeta.version} />
        <Field label="分类" value={agentMeta.category} />
        <Field label="评分" value={`${agentMeta.rating} (${agentMeta.ratingCount} 人)`} />
        <Field label="最后活跃" value={agentMeta.lastActive} />
        <Field label="安装数" value={agentMeta.installCount.toLocaleString()} />
        <Field label="P95" value={`${agentMeta.responseP95}ms`} />
        <Field label="Token 累计" value={agentMeta.totalTokens.toLocaleString()} />
        <Field label="SLA" value={`${agentMeta.sla}%`} />
        <Field label="错误率" value={`${((agentMeta.errorRate ?? 0) * 100).toFixed(2)}%`} />
        <Field label="知识库" value={`${agentMeta.knowledgeBases} 个`} />
        <Field label="工具" value={`${agentMeta.tools} 个`} />
        <Field label="语言" value={agentMeta.languages?.join(' · ') ?? '—'} />
      </div>
      {agentMeta.description && (
        <div>
          <div className="text-[10px] text-[var(--text-muted)] mb-0.5">描述</div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 text-[11px]">{agentMeta.description}</div>
        </div>
      )}
    </div>
  );
}

function ReasoningView({ items }: { items: any[] }) {
  if (items.length === 0) return <EmptyTab text="暂无推理步骤。" />;
  const byMsg = items.reduce<Record<string, { ts: string; corr?: string; steps: any[] }>>((acc, s) => {
    acc[s.mid] = acc[s.mid] ?? { ts: s.createdAt, corr: s.correlationId, steps: [] };
    acc[s.mid].steps.push(s);
    return acc;
  }, {});
  return (
    <div className="space-y-2">
      {Object.entries(byMsg).map(([mid, g]) => (
        <div key={mid} className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="h-3 w-3 text-[var(--brand)]" />
            <span className="font-semibold text-[11px]">消息 {mid.slice(0, 8)}</span>
            <span className="text-[10px] text-[var(--text-muted)] font-mono">{new Date(g.ts).toLocaleString('zh-CN', { hour12: false })}</span>
            {g.corr && <span className="text-[9px] font-mono text-[var(--text-muted)]">{g.corr.slice(0, 12)}</span>}
            <Badge tone="brand" className="text-[9px] ml-auto">{g.steps.length} 步</Badge>
          </div>
          <ol className="space-y-1.5">
            {g.steps.map((s, i) => (
              <li key={s.id} className="flex items-start gap-2 text-[11px]">
                <span className="grid h-4 w-4 place-items-center rounded-full bg-[var(--brand-light)] text-[var(--brand)] text-[9px] font-mono shrink-0 mt-0.5">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <Badge tone="neutral" className="text-[8px] font-mono">{s.kind}</Badge>
                    <span className="font-semibold">{s.title}</span>
                  </div>
                  {s.detail && <div className="text-[var(--text-muted)] mt-0.5">{s.detail}</div>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function ToolsView({ tools, copiedKey, onCopy }: { tools: any[]; copiedKey: string | null; onCopy: (t: string, k: string) => void }) {
  if (tools.length === 0) return <EmptyTab text="暂无工具调用。" />;
  return (
    <div className="space-y-2">
      {tools.map((tc, i) => (
        <div key={i} className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)]">
            <Wrench className="h-3 w-3 text-[var(--brand)]" />
            <span className="font-mono font-semibold text-[11px]">{tc.name}</span>
            <Badge tone={tc.status === 'failed' ? 'error' : tc.status === 'denied' ? 'error' : 'success'} className="text-[9px]">{tc.status}</Badge>
            <Badge tone={tc.permission === 'auto' ? 'success' : tc.permission === 'approval-required' ? 'warn' : 'neutral'} className="text-[9px]">{tc.permission ?? 'auto'}</Badge>
            <span className="text-[10px] text-[var(--text-muted)] font-mono ml-auto">{tc.durationMs}ms</span>
            <button
              onClick={() => onCopy(JSON.stringify(tc, null, 2), `tc_${i}`)}
              className="grid h-5 w-5 place-items-center rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]"
              title="复制"
            >
              {copiedKey === `tc_${i}` ? <CheckCircle2 className="h-3 w-3 text-[var(--success)]" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
          <div className="p-2 space-y-1 text-[10px] font-mono">
            {tc.sandboxId && <div><span className="text-[var(--text-muted)]">sandbox:</span> {tc.sandboxId}</div>}
            {tc.traceId && <div><span className="text-[var(--text-muted)]">traceId:</span> {tc.traceId}</div>}
            {tc.correlationId && <div><span className="text-[var(--text-muted)]">corrId:</span> {tc.correlationId}</div>}
            <details className="mt-1">
              <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text)]">args</summary>
              <pre className="mt-1 text-[10px] bg-[var(--bg)] rounded p-1.5 overflow-x-auto">{JSON.stringify(tc.args, null, 2)}</pre>
            </details>
            {tc.result && (
              <details>
                <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text)]">result</summary>
                <pre className="mt-1 text-[10px] bg-[var(--bg)] rounded p-1.5 overflow-x-auto text-[var(--success)]">→ {tc.result}</pre>
              </details>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function RagView({ cites, copiedKey, onCopy }: { cites: any[]; copiedKey: string | null; onCopy: (t: string, k: string) => void }) {
  if (cites.length === 0) return <EmptyTab text="暂无 RAG 引用。" />;
  return (
    <div className="space-y-2">
      {cites.map((c, i) => (
        <div key={i} className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)]">
            <Database className="h-3 w-3 text-[var(--brand)]" />
            <Badge tone="info" className="text-[9px]">{c.source}</Badge>
            <span className="font-mono text-[10px] text-[var(--text-secondary)] truncate flex-1">{c.id}</span>
            <span className="text-[10px] font-mono text-[var(--success)]">{(c.score * 100).toFixed(0)}%</span>
            {c.rerankScore != null && <span className="text-[10px] font-mono text-[var(--text-muted)]">重排 {(c.rerankScore * 100).toFixed(0)}%</span>}
            <button
              onClick={() => onCopy(JSON.stringify(c, null, 2), `cite_${i}`)}
              className="grid h-5 w-5 place-items-center rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)]"
              title="复制"
            >
              {copiedKey === `cite_${i}` ? <CheckCircle2 className="h-3 w-3 text-[var(--success)]" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
          <div className="p-2 space-y-1 text-[10px]">
            {c.page && <div className="text-[var(--text-muted)]">页码: <span className="font-mono">p.{c.page}</span></div>}
            {c.span && <div className="text-[var(--text-muted)]">片段: <span className="font-mono">{c.span.start}-{c.span.end}</span></div>}
            {c.evalLabel && <div>eval: <Badge tone={c.evalLabel === 'gold' ? 'success' : c.evalLabel === 'harmful' ? 'error' : 'neutral'} className="text-[9px]">{c.evalLabel}</Badge></div>}
            <div className="text-[var(--text)] line-clamp-3 mt-1">"{c.text}"</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PolicyView({ tools }: { tools: any[] }) {
  if (tools.length === 0) return <EmptyTab text="暂无策略命中。" />;
  return (
    <div className="space-y-2">
      {tools.map((tc, i) => (
        <div key={i} className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 text-[11px]">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <ShieldCheck className="h-3 w-3 text-[var(--brand)]" />
            <span className="font-mono font-semibold">{tc.name}</span>
            <Badge tone={tc.permission === 'auto' ? 'success' : tc.permission === 'approval-required' ? 'warn' : 'error'} className="text-[9px]">
              <Lock className="mr-0.5 inline h-2.5 w-2.5" />{tc.permission ?? 'auto'}
            </Badge>
            {tc.sandboxId && <span className="text-[9px] font-mono text-[var(--text-muted)]">[sandbox:{tc.sandboxId}]</span>}
            <span className="text-[9px] font-mono text-[var(--text-muted)] ml-auto">{tc.status} · {tc.durationMs}ms</span>
          </div>
          <div className="space-y-0.5 text-[10px] text-[var(--text-muted)] font-mono">
            <div>traceId: {tc.traceId ?? '—'}</div>
            <div>status: {tc.status}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ApprovalView({ items }: { items: ChatMessageEx[] }) {
  if (items.length === 0) return <EmptyTab text="暂无双签请求。" />;
  return (
    <div className="space-y-2">
      {items.map((m) => (
        <div key={m.id} className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)]/30 p-2.5 text-[11px]">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <ListChecks className="h-3 w-3 text-[var(--danger)]" />
            <span className="font-semibold">{m.approvalRequest!.action}</span>
            {m.approvalRequest!.reason && <Badge tone="warn" className="text-[9px]">{m.approvalRequest!.reason}</Badge>}
            <Badge tone={m.approvalRequest!.decision === 'approved' ? 'success' : m.approvalRequest!.decision === 'rejected' ? 'error' : 'warn'} className="text-[9px] ml-auto">
              {m.approvalRequest!.decision}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[10px] text-[var(--text-muted)] font-mono mb-1.5">
            <div>resource: {m.approvalRequest!.resource ?? '—'}</div>
            <div>ticket: {m.approvalRequest!.ticketId ?? '—'}</div>
            <div>progress: {m.approvalRequest!.signed}/{m.approvalRequest!.required}</div>
            <div>policyHash: {(m.approvalRequest!.policyHash ?? '—').slice(0, 12)}</div>
          </div>
          <div className="space-y-0.5">
            {m.approvalRequest!.signers.map((s, i) => (
              <div key={i} className="text-[10px] flex items-center gap-1.5">
                <span className={cn('w-2 h-2 rounded-full', s.signed ? (s.role === 'auditor' ? 'bg-[var(--info)]' : 'bg-[var(--success)]') : 'bg-[var(--text-muted)]')} />
                <span className="font-mono">{s.name}</span>
                <Badge tone={s.role === 'auditor' ? 'info' : 'neutral'} className="text-[9px]">{s.role}</Badge>
                {s.signedAt && <span className="text-[var(--text-muted)] font-mono ml-auto">{s.signedAt.slice(11, 19)}</span>}
                {s.signatureHash && <span className="text-[9px] font-mono text-[var(--text-muted)]">#{s.signatureHash.slice(-6)}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditView({
  session, messages, replayCorr, replayState, onReplay,
}: {
  session: ChatSession | undefined;
  messages: ChatMessageEx[];
  replayCorr: string | null;
  replayState: { loading: boolean; error?: string; data?: ReplayTurnResponse };
  onReplay: (corr: string) => void;
}) {
  return (
    <div className="space-y-2">
      {session && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 text-[11px]">
          <div className="flex items-center gap-1.5 mb-1.5">
            <ShieldCheck className="h-3 w-3 text-[var(--success)]" />
            <span className="font-semibold">SignedLog 摘要</span>
            <Badge tone="success" className="text-[9px] ml-auto">等保 3</Badge>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-[var(--text-muted)] font-mono">
            <div>sessionId: {session.id}</div>
            <div>workspace: {session.workspaceId ?? 'w1'}</div>
            <div>owner: {session.ownerName ?? 'u1'}</div>
            <div className="col-span-2">createdAt: {new Date(session.createdAt).toISOString()}</div>
          </div>
        </div>
      )}
      {(replayState.loading || replayState.error || replayState.data) && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 text-[11px]">
          <div className="flex items-center gap-1.5 mb-1.5">
            <History className="h-3 w-3 text-[var(--brand)]" />
            <span className="font-semibold">回合复盘</span>
            <span className="ml-auto font-mono text-[10px] text-[var(--text-muted)]">{replayCorr?.slice(0, 16) ?? '—'}</span>
          </div>
          {replayState.loading && <div className="text-[10px] text-[var(--text-muted)]">正在读取快照，不会调用模型。</div>}
          {replayState.error && <div className="text-[10px] text-[var(--danger)]">{replayState.error}</div>}
          {replayState.data && (
            <div className="space-y-1 text-[10px] font-mono text-[var(--text-muted)]">
              <div>snapshotId: {replayState.data.snapshot?.id ?? '—'}</div>
              <div>sessionMode: {replayState.data.snapshot?.sessionMode ?? '—'}</div>
              <div>historyTurns: {replayState.data.snapshot?.historyTurns ?? 0} · ragHits: {replayState.data.snapshot?.ragHits ?? 0}</div>
              <div>tools: {(replayState.data.snapshot?.toolRegistry ?? []).join(', ') || '—'}</div>
              <div>events: {(replayState.data.events ?? []).map((e) => e.type).join(' → ') || '—'}</div>
            </div>
          )}
        </div>
      )}
      {messages.map((m) => (
        <div key={m.id} className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 text-[11px]">
          <div className="flex items-center gap-1.5 mb-1">
            <FileText className="h-3 w-3 text-[var(--text-muted)]" />
            <span className="font-semibold">{m.role} · {m.agentName ?? 'user'}</span>
            <span className="ml-auto text-[10px] font-mono text-[var(--text-muted)]">{m.correlationId?.slice(0, 16) ?? '—'}</span>
          </div>
          <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[10px] text-[var(--text-muted)] font-mono">
            <div>status: {m.status ?? '—'}</div>
            <div>ttft: {m.metrics?.ttftMs ?? '—'}ms</div>
            <div>duration: {m.metrics?.durationMs ?? '—'}ms</div>
            <div>prompt: {m.metrics?.promptTokens ?? 0}t</div>
            <div>completion: {m.metrics?.completionTokens ?? 0}t</div>
            <div>cache: {m.metrics?.cacheHits ?? 0}</div>
            <div>model: {m.metrics?.model ?? '—'}</div>
            <div>provider: {m.metrics?.provider ?? '—'}</div>
            <div>snapshot: {m.metrics?.snapshotId?.slice(0, 12) ?? '—'}</div>
          </div>
          {m.correlationId && m.role === 'assistant' && (
            <button
              type="button"
              onClick={() => onReplay(m.correlationId!)}
              disabled={replayState.loading}
              className="mt-1.5 inline-flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--text)] disabled:opacity-50"
            >
              <History className="h-3 w-3" />复盘本回合
            </button>
          )}
          {m.safety && (
            <div className="mt-1.5 pt-1.5 border-t border-[var(--border)] text-[10px] flex items-center gap-1.5">
              <ShieldAlert className="h-3 w-3 text-[var(--warning)]" />
              <span>safety: {m.safety.flaggedCategory ?? '—'} · {m.safety.action ?? '—'}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function LogsView({ events }: { events: any[] }) {
  if (events.length === 0) return <EmptyTab text="暂无日志。" />;
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
      <pre className="overflow-x-auto p-3 text-[10px] leading-relaxed font-mono max-h-[60vh]">
        {events.map((e, i) => (
          <div key={i} className={cn(
            'flex gap-2',
            e.tone === 'success' ? 'text-[var(--success)]' : e.tone === 'warn' ? 'text-[var(--warning)]' : e.tone === 'error' ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]',
          )}>
            <span className="shrink-0">{new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false })}</span>
            <span className="shrink-0 text-[var(--brand)]">[{e.kind}]</span>
            <span className="shrink-0 font-semibold">{e.actor}</span>
            <span className="flex-1">{e.text}</span>
            {e.corr && <span className="shrink-0 text-[var(--text-muted)]">{e.corr.slice(0, 8)}</span>}
          </div>
        ))}
      </pre>
    </div>
  );
}

/* ============ 通用组件 ============ */

function Stat({ label, value, icon: Icon, tone }: { label: string; value: any; icon: any; tone: 'brand' | 'info' | 'success' | 'warn' | 'error' | 'neutral' }) {
  const color = tone === 'brand' ? 'text-[var(--brand)]' : tone === 'info' ? 'text-[var(--info)]' : tone === 'success' ? 'text-[var(--success)]' : tone === 'warn' ? 'text-[var(--warning)]' : tone === 'error' ? 'text-[var(--danger)]' : 'text-[var(--text)]';
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 flex items-center gap-2">
      <Icon className={cn('h-3.5 w-3.5 shrink-0', color)} />
      <div className="min-w-0">
        <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">{label}</div>
        <div className={cn('text-sm font-bold font-mono', color)}>{value}</div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between rounded bg-[var(--bg-elevated)] px-2.5 py-1.5 border border-[var(--border)]">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="text-[11px] font-semibold">{value}</span>
    </div>
  );
}

function JsonBlock({ title, sub, json, copyKey, copiedKey, onCopy }: {
  title: string; sub?: string; json: any; copyKey: string; copiedKey: string | null; onCopy: (t: string, k: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const text = useMemo(() => JSON.stringify(json, null, 2), [json]);
  return (
    <div className="rounded-md border border-[var(--border)] overflow-hidden">
      <div className="flex items-center justify-between bg-[var(--bg-elevated)] px-3 py-1.5 border-b border-[var(--border)]">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 min-w-0 text-left"
        >
          {open ? <ChevronDown className="h-3 w-3 text-[var(--text-muted)]" /> : <ChevronRight className="h-3 w-3 text-[var(--text-muted)]" />}
          <div className="min-w-0">
            <div className="text-[11px] font-semibold truncate">{title}</div>
            {sub && <div className="text-[10px] text-[var(--text-muted)] truncate">{sub}</div>}
          </div>
        </button>
        <button
          onClick={() => onCopy(text, copyKey)}
          className="grid h-6 w-6 place-items-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          title="复制 JSON"
        >
          {copiedKey === copyKey ? <CheckCircle2 className="h-3 w-3 text-[var(--success)]" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      {open && (
        <pre className="overflow-x-auto p-3 text-[11px] leading-relaxed max-h-72 overflow-y-auto bg-[var(--bg)] font-mono">
          {text}
        </pre>
      )}
    </div>
  );
}

function EmptyTab({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Bug className="h-8 w-8 text-[var(--text-muted)] opacity-30 mb-2" />
      <div className="text-[11px] text-[var(--text-muted)]">{text}</div>
    </div>
  );
}

function pickRequest(m: ChatMessageEx) {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    correlationId: m.correlationId,
    clientMsgId: m.clientMsgId,
    createdAt: m.createdAt,
    attachments: m.attachment,
  };
}

function pickResponse(m: ChatMessageEx) {
  return {
    id: m.id,
    role: m.role,
    agentName: m.agentName,
    content: m.content,
    status: m.status,
    serverMsgId: m.serverMsgId,
    correlationId: m.correlationId,
    metrics: m.metrics,
    toolCalls: m.toolCalls,
    citations: m.citations,
    reasoningSteps: m.reasoningSteps,
    approvalRequest: m.approvalRequest,
    feedback: m.feedback,
    safety: m.safety,
  };
}
