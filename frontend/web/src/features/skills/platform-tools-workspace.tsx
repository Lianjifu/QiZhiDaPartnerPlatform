import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Input, KpiCard } from '@de/web-ui';
import {
  BookOpen,
  Brain,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  FileCode2,
  Globe,
  Layers,
  ListTodo,
  Package,
  Plug,
  Search,
  Shield,
  Sparkles,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react';
import { cn } from '@de/web-utils';
import { EmptyState } from '@/components/shared';
import { useApiQuery } from '@/services/query';
import { clampMemoryPage, memoryPageCount, paginateItems } from '@/features/memory/record-list';
import { PackInstallPanel } from '@/features/skills/pack-install-panel';

type RegistryTool = {
  name: string;
  kind?: string;
  mode?: string;
  description?: string;
  harness?: string;
  executor?: string;
  availability?: string;
  removable?: boolean;
  phase?: string;
};

type PlatformToolsRegistry = {
  packId: string;
  packName: string;
  platformTools: RegistryTool[];
  runtimeTools: RegistryTool[];
};

type WorkspaceTab = 'catalog' | 'packs';
type ScopeFilter = 'all' | 'platform' | 'runtime';
type PhaseFilter = 'all' | 'P0' | 'P1' | 'P2' | 'P3';

const PHASE_ORDER: PhaseFilter[] = ['P0', 'P1', 'P2', 'P3'];
const PAGE_SIZE = 6;

const PHASE_META: Record<string, { label: string; hint: string; tone: 'success' | 'info' | 'warn' | 'purple' }> = {
  P0: { label: 'P0 · 基础', hint: '默认可用，Copilot 冷启动即装配', tone: 'success' },
  P1: { label: 'P1 · 扩展', hint: '文件编辑、Web 搜索等增强能力', tone: 'info' },
  P2: { label: 'P2 · 协作', hint: '用户交互、代码执行与附件', tone: 'warn' },
  P3: { label: 'P3 · 编排', hint: '子 Agent、任务与 MCP 集成', tone: 'purple' },
};

function modeLabel(mode?: string) {
  switch (mode) {
    case 'execute': return '可执行';
    case 'approval_required': return '需审批';
    case 'recommend': return '推荐';
    default: return mode ?? '—';
  }
}

function toolPhase(tool: RegistryTool): string {
  const phase = (tool.phase ?? '').trim().toUpperCase();
  return PHASE_ORDER.includes(phase as PhaseFilter) ? phase : 'P0';
}

function toolIcon(name: string) {
  if (name.startsWith('task_')) return ListTodo;
  if (name.includes('mcp')) return Plug;
  if (name.includes('web_') || name.includes('fetch')) return Globe;
  if (['read_file', 'write_file', 'edit_file', 'glob', 'grep', 'edit_notebook'].includes(name)) return FileCode2;
  if (['bash', 'execute_code', 'agent'].includes(name)) return Terminal;
  if (name.includes('knowledge') || name.includes('skill.read')) return BookOpen;
  if (name.includes('memory')) return Brain;
  if (name.includes('time')) return Clock;
  if (name.includes('plan')) return Layers;
  if (name.includes('todo') || name.includes('ask_user') || name.includes('structured')) return Sparkles;
  if (name.includes('send_attachment')) return Package;
  return Wrench;
}

function groupByPhase(tools: RegistryTool[]): Map<string, RegistryTool[]> {
  const map = new Map<string, RegistryTool[]>();
  for (const tool of tools) {
    const phase = toolPhase(tool);
    const bucket = map.get(phase) ?? [];
    bucket.push(tool);
    map.set(phase, bucket);
  }
  for (const [, items] of map) {
    items.sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}

function ToolsPagination({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (next: number) => void;
}) {
  if (total <= PAGE_SIZE) return null;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3 text-[11px] text-[var(--text-muted)]">
      <span>显示 {from}–{to} / 共 {total} 项</span>
      <nav className="flex items-center gap-1" aria-label="工具分页">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="grid h-7 w-7 place-items-center rounded-md border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="上一页"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-[4.5rem] text-center font-mono text-xs text-[var(--text-secondary)]">
          {page} / {pageCount}
        </span>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          className="grid h-7 w-7 place-items-center rounded-md border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="下一页"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </nav>
    </div>
  );
}

function ToolCard({ tool }: { tool: RegistryTool }) {
  const Icon = toolIcon(tool.name);
  const phase = toolPhase(tool);
  const phaseMeta = PHASE_META[phase];
  const isPlatform = tool.kind === 'platform';

  return (
    <article className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4 transition-all hover:border-[var(--brand)]/25 hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--brand)]/35 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-start gap-3">
        <div className={cn(
          'grid h-9 w-9 shrink-0 place-items-center rounded-lg border',
          isPlatform
            ? 'border-[var(--success)]/25 bg-[var(--success-bg)] text-[var(--success)]'
            : 'border-[var(--warning)]/25 bg-[var(--warning-bg)] text-[var(--warning)]',
        )}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <code className="truncate text-sm font-semibold text-[var(--text)]">{tool.name}</code>
            <Badge tone={isPlatform ? 'success' : 'warn'}>{isPlatform ? 'platform' : tool.kind ?? 'runtime'}</Badge>
          </div>
          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[var(--text-muted)]">{tool.description ?? '—'}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {phaseMeta && <Badge tone={phaseMeta.tone}>{phaseMeta.label}</Badge>}
        <Badge tone={tool.mode === 'approval_required' ? 'warn' : 'success'}>{modeLabel(tool.mode)}</Badge>
        {tool.availability === 'opt_in' && <Badge tone="neutral">按需启用</Badge>}
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
        {tool.harness ? `Harness · ${tool.harness}` : tool.executor ? `执行层 · ${tool.executor}` : '平台内置 · 不可卸载'}
      </p>
    </article>
  );
}

function PhaseToolGroup({
  phase,
  tools,
}: {
  phase: string;
  tools: RegistryTool[];
}) {
  const [page, setPage] = useState(1);
  const meta = PHASE_META[phase] ?? { label: phase, hint: '', tone: 'neutral' as const };
  const pageCount = memoryPageCount(tools.length, PAGE_SIZE);
  const pageSafe = clampMemoryPage(page, pageCount);
  const visible = useMemo(() => paginateItems(tools, pageSafe, PAGE_SIZE), [tools, pageSafe]);

  useEffect(() => {
    setPage(1);
  }, [tools.length]);

  if (tools.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="text-xs text-[var(--text-muted)]">{meta.hint}</span>
        </div>
        <Badge tone="neutral">{tools.length} 项</Badge>
      </header>
      <div className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((tool) => (
            <ToolCard key={`${phase}-${tool.name}`} tool={tool} />
          ))}
        </div>
        <ToolsPagination page={pageSafe} pageCount={pageCount} total={tools.length} onPage={setPage} />
      </div>
    </section>
  );
}

export function PlatformToolsWorkspace() {
  const [notice, setNotice] = useState<string | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('catalog');
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all');
  const [searchQ, setSearchQ] = useState('');
  const [flatPage, setFlatPage] = useState(1);

  const { data, isLoading } = useApiQuery<PlatformToolsRegistry>(
    ['platform-tools-registry'],
    '/api/platform-tools/registry',
  );

  const platformTools = data?.platformTools ?? [];
  const runtimeTools = data?.runtimeTools ?? [];
  const allTools = useMemo(
    () => [...platformTools.map((t) => ({ ...t, kind: t.kind ?? 'platform' })), ...runtimeTools.map((t) => ({ ...t, kind: t.kind ?? 'runtime' }))],
    [platformTools, runtimeTools],
  );

  const stats = useMemo(() => ({
    platform: platformTools.length,
    runtime: runtimeTools.length,
    approval: allTools.filter((t) => t.mode === 'approval_required').length,
    optIn: allTools.filter((t) => t.availability === 'opt_in').length,
  }), [allTools, platformTools.length, runtimeTools.length]);

  const filteredTools = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return allTools.filter((tool) => {
      if (scope === 'platform' && tool.kind !== 'platform') return false;
      if (scope === 'runtime' && tool.kind !== 'runtime') return false;
      if (phaseFilter !== 'all' && toolPhase(tool) !== phaseFilter) return false;
      if (!q) return true;
      const hay = `${tool.name} ${tool.description ?? ''} ${tool.executor ?? ''} ${tool.harness ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [allTools, scope, phaseFilter, searchQ]);

  const grouped = useMemo(() => groupByPhase(filteredTools), [filteredTools]);
  const flatPageCount = memoryPageCount(filteredTools.length, PAGE_SIZE);
  const flatPageSafe = clampMemoryPage(flatPage, flatPageCount);
  const flatVisible = useMemo(
    () => paginateItems(filteredTools, flatPageSafe, PAGE_SIZE),
    [filteredTools, flatPageSafe],
  );

  useEffect(() => {
    setFlatPage(1);
  }, [scope, phaseFilter, searchQ]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-28 animate-pulse rounded-xl bg-[var(--surface-2)]" />
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-[var(--surface-2)]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {notice && (
        <div className="rounded-lg border border-[var(--info)]/30 bg-[var(--info-bg)] px-3 py-2 text-xs text-[var(--info)]">
          {notice}
        </div>
      )}

      {/* Hero */}
      <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-gradient-to-br from-[var(--surface-1)] via-[var(--bg)] to-[var(--brand-light)]/30 px-5 py-4">
        <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[var(--brand)]/5 blur-2xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-[var(--brand)]" />
              <h2 className="text-base font-semibold text-[var(--text)]">平台工具与运行时</h2>
              <Badge tone="brand">{data?.packName ?? '通用'}</Badge>
            </div>
            <p className="mt-2 max-w-2xl text-xs leading-6 text-[var(--text-secondary)]">
              平台工具由 Go Harness 直接执行；运行时工具通过 skill.open / skill.run 在沙箱中运行。
              Copilot 默认可用 knowledge.retrieve、memory.recall、skill.read、time.now 等基础能力。
            </p>
          </div>
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-0.5" role="tablist" aria-label="平台工具分区">
            {([
              ['catalog', '工具目录'],
              ['packs', '岗位包'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={workspaceTab === key}
                onClick={() => setWorkspaceTab(key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  workspaceTab === key
                    ? 'bg-[var(--brand)] text-white shadow-sm'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {workspaceTab === 'packs' ? (
        <PackInstallPanel onInstalled={setNotice} />
      ) : (
        <>
          {/* KPI */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard size="comfortable" tone="success" icon={Zap} label="平台工具" value={stats.platform} sub="Harness" />
            <KpiCard size="comfortable" tone="warn" icon={Terminal} label="运行时工具" value={stats.runtime} sub="Sandbox" />
            <KpiCard size="comfortable" tone="info" icon={Shield} label="需审批" value={stats.approval} sub="写操作" />
            <KpiCard size="comfortable" tone="neutral" icon={Globe} label="按需启用" value={stats.optIn} sub="Opt-in" />
          </div>

          {/* Filters */}
          <div className="sticky top-0 z-10 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)]/95 p-4 backdrop-blur-sm">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <Input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="搜索工具名称、描述或执行层…"
                className="h-9 pl-9 text-xs"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium text-[var(--text-muted)]">类型</span>
              {([
                ['all', '全部'],
                ['platform', '平台'],
                ['runtime', '运行时'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setScope(key)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    scope === key
                      ? 'border-[var(--brand)] bg-[var(--brand-light)] text-[var(--brand)]'
                      : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                  )}
                >
                  {label}
                </button>
              ))}
              <span className="mx-1 hidden h-4 w-px bg-[var(--border)] sm:inline" />
              <span className="text-[11px] font-medium text-[var(--text-muted)]">阶段</span>
              {(['all', ...PHASE_ORDER] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPhaseFilter(key)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    phaseFilter === key
                      ? 'border-[var(--brand)] bg-[var(--brand-light)] text-[var(--brand)]'
                      : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                  )}
                >
                  {key === 'all' ? '全部阶段' : (PHASE_META[key]?.label ?? key)}
                </button>
              ))}
            </div>
          </div>

          {/* Grouped / paginated catalog */}
          {filteredTools.length === 0 ? (
            <EmptyState
              icon={Search}
              title="未找到匹配的工具"
              description="尝试调整搜索词或筛选条件"
            />
          ) : phaseFilter === 'all' ? (
            <div className="space-y-4">
              {PHASE_ORDER.map((phase) => (
                <PhaseToolGroup key={phase} phase={phase} tools={grouped.get(phase) ?? []} />
              ))}
            </div>
          ) : (
            <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)]">
              <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                <Badge tone={PHASE_META[phaseFilter]?.tone ?? 'neutral'}>
                  {PHASE_META[phaseFilter]?.label ?? phaseFilter}
                </Badge>
                <Badge tone="neutral">{filteredTools.length} 项</Badge>
              </header>
              <div className="p-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {flatVisible.map((tool) => (
                    <ToolCard key={tool.name} tool={tool} />
                  ))}
                </div>
                <ToolsPagination
                  page={flatPageSafe}
                  pageCount={flatPageCount}
                  total={filteredTools.length}
                  onPage={setFlatPage}
                />
              </div>
            </section>
          )}

          <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-3 text-[11px] leading-5 text-[var(--text-muted)]">
            <Wrench className="mr-1 inline h-3.5 w-3.5" />
            运行时工具需在数字伙伴「能力装配」中勾选后才会对 Copilot 生效；带「需审批」标记的工具在执行写操作前会触发治理拦截。
          </p>
        </>
      )}
    </div>
  );
}
