/**
 * 全局搜索（⌘K）— 任务 / 数字伙伴 / 文档
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/services/query';
import { Input, Badge, Avatar } from '@qzda/web-ui';
import {
  Search, FileText, Bot, ListChecks, ArrowRight, Sparkles, X, CornerDownLeft,
} from 'lucide-react';
import { cn } from '@qzda/web-utils';
import type { Task, DigitalPartner, KnowledgeDoc } from '@qzda/web-types';
import { sortDigitalPartners } from '@/lib/digital-employees';

type Result = { type: 'task' | 'employee' | 'doc'; id: string; title: string; subtitle?: string; to: string; meta?: string };

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const { data: tasks = [] } = useApiQuery<Task[]>(['search-tasks'], '/api/tasks');
  const { data: employees = [] } = useApiQuery<DigitalPartner[]>(['search-digital-employees'], '/api/partners');
  const { data: docs = [] } = useApiQuery<KnowledgeDoc[]>(['search-docs'], '/api/knowledge/docs');

  const orderedEmployees = useMemo(() => sortDigitalPartners(employees), [employees]);

  // ⌘K / Ctrl+K 全局打开
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // 搜索结果
  const results = useMemo<Result[]>(() => {
    if (!q.trim()) {
      return [
        ...tasks.slice(0, 3).map((t) => ({ type: 'task' as const, id: t.id, title: t.title, subtitle: t.code, to: '/tasks', meta: t.assignee })),
        ...orderedEmployees.slice(0, 3).map((employee) => ({ type: 'employee' as const, id: employee.id, title: employee.role || employee.name, subtitle: `${employee.department} · ${employee.name}`, to: `/partners?employeeId=${employee.id}`, meta: `v${employee.version}` })),
        ...docs.slice(0, 3).map((d) => ({ type: 'doc' as const, id: d.id, title: d.title, subtitle: d.source, to: '/knowledge', meta: `${d.chunks} chunks` })),
      ];
    }
    const ql = q.toLowerCase();
    const out: Result[] = [];
    tasks.forEach((t) => {
      if (t.title.toLowerCase().includes(ql) || t.code.toLowerCase().includes(ql)) {
        out.push({ type: 'task', id: t.id, title: t.title, subtitle: t.code, to: '/tasks', meta: t.assignee });
      }
    });
    orderedEmployees.forEach((employee) => {
      if ([employee.name, employee.role, employee.department, employee.description].join(' ').toLowerCase().includes(ql)) {
        out.push({ type: 'employee', id: employee.id, title: employee.role || employee.name, subtitle: `${employee.department} · ${employee.name}`, to: `/partners?employeeId=${employee.id}`, meta: `v${employee.version}` });
      }
    });
    docs.forEach((d) => {
      if (d.title.toLowerCase().includes(ql) || d.source.toLowerCase().includes(ql)) {
        out.push({ type: 'doc', id: d.id, title: d.title, subtitle: d.source, to: '/knowledge', meta: `${d.chunks} chunks` });
      }
    });
    return out.slice(0, 20);
  }, [q, tasks, orderedEmployees, docs]);

  // 键盘上下选择
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter' && results[active]) {
        e.preventDefault();
        navigate(results[active].to);
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, results, active, navigate]);

  return (
    <>
      {/* 顶栏触发按钮 */}
      <button
        onClick={() => setOpen(true)}
        aria-label="全局搜索 (⌘K)"
        className="relative flex-1 max-w-md h-9 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] pl-9 pr-12 text-left text-sm text-[var(--text-muted)] hover:border-[var(--brand)] transition-colors"
      >
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" />
        <span className="leading-9">搜索任务、数字伙伴、文档...</span>
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-[var(--bg)] px-1.5 py-0.5 text-[10px] font-mono border border-[var(--border)]">
          ⌘K
        </kbd>
      </button>

      {/* 浮层 */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="全局搜索"
        >
          <div
            className="w-[640px] max-w-[92vw] rounded-xl border border-[var(--border)] bg-[var(--surface-1)] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
              <Search className="h-4 w-4 text-[var(--text-muted)]" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => { setQ(e.target.value); setActive(0); }}
                placeholder="搜索任务、数字伙伴、文档..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]"
                aria-label="搜索输入"
              />
              <button onClick={() => setOpen(false)} aria-label="关闭搜索" className="text-[var(--text-muted)] hover:text-[var(--text)]">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[420px] overflow-y-auto p-2">
              {results.length === 0 ? (
                <div className="py-12 text-center text-xs text-[var(--text-muted)]">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  没有找到 "{q}" 相关结果
                </div>
              ) : (
                results.map((r, i) => (
                  <button
                    key={`${r.type}-${r.id}`}
                    onClick={() => { navigate(r.to); setOpen(false); }}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      'w-full flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      active === i ? 'bg-[var(--brand-light)] text-[var(--brand)]' : 'hover:bg-[var(--bg-hover)]',
                    )}
                  >
                    <div className={cn(
                      'grid h-8 w-8 place-items-center rounded-md shrink-0',
                      r.type === 'task' ? 'bg-[var(--info-bg)] text-[var(--info)]' :
                      r.type === 'employee' ? 'bg-[var(--brand-light)] text-[var(--brand)]' :
                      'bg-[var(--purple-bg)] text-[var(--purple)]',
                    )}>
                      {r.type === 'task' ? <ListChecks className="h-4 w-4" /> :
                       r.type === 'employee' ? <Bot className="h-4 w-4" /> :
                       <FileText className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{r.title}</div>
                      {r.subtitle && <div className="truncate text-[10px] text-[var(--text-muted)] font-mono">{r.subtitle}</div>}
                    </div>
                    {r.meta && <span className="text-[10px] text-[var(--text-muted)] shrink-0">{r.meta}</span>}
                    <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
                  </button>
                ))
              )}
            </div>

            <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2 text-[10px] text-[var(--text-muted)]">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1"><kbd className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono border border-[var(--border)]">↑↓</kbd>选择</span>
                <span className="flex items-center gap-1"><kbd className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono border border-[var(--border)]">⏎</kbd>打开</span>
                <span className="flex items-center gap-1"><kbd className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono border border-[var(--border)]">esc</kbd>关闭</span>
              </div>
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                {results.length} 个结果
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
