/**
 * 404 友好错误页
 */
import { Link, useLocation } from 'react-router-dom';
import { Button, Badge } from '@de/web-ui';
import { Home, Search, ArrowLeft, Compass, Bot, FileText, Workflow, AlertCircle } from 'lucide-react';

const QUICK_LINKS = [
  { to: '/home', label: '首页', icon: Home },
  { to: '/copilot', label: '会话', icon: Bot },
  { to: '/tasks', label: '任务', icon: AlertCircle },
  { to: '/workflows', label: '工作流', icon: Workflow },
  { to: '/knowledge', label: '知识', icon: FileText },
];

export function NotFound() {
  const loc = useLocation();
  return (
    <div className="grid h-full place-items-center bg-[var(--bg-elevated)] p-8" role="alert">
      <div className="max-w-lg w-full text-center">
        {/* 大数字 404 */}
        <div className="text-[120px] font-bold leading-none tracking-tighter text-gradient mb-2">
          404
        </div>

        <h1 className="text-2xl font-bold mb-2">页面不存在</h1>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          路径 <code className="rounded bg-[var(--bg)] border border-[var(--border)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--brand)]">{loc.pathname}</code> 不在企智搭 · 数字伙伴平台的 11 个模块中。
        </p>

        <div className="flex gap-2 justify-center mb-6">
          <Button size="md" onClick={() => window.history.back()}>
            <ArrowLeft className="h-3.5 w-3.5" />返回上页
          </Button>
          <Link to="/home">
            <Button size="md" variant="primary">
              <Home className="h-3.5 w-3.5" />返回首页
            </Button>
          </Link>
          <Button size="md" variant="secondary">
            <Search className="h-3.5 w-3.5" />全局搜索
          </Button>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3 flex items-center gap-1.5">
            <Compass className="h-3.5 w-3.5" />
            11 模块快速导航
          </div>
          <div className="grid grid-cols-5 gap-2">
            {QUICK_LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="flex flex-col items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-[11px] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors"
              >
                <l.icon className="h-4 w-4" />
                <span>{l.label}</span>
              </Link>
            ))}
          </div>
          <div className="mt-3 text-[10px] text-[var(--text-muted)]">
            还有 6 个模块：智能体 / 技能 / 模型 / 渠道 / 设置 / 工作区
          </div>
        </div>
      </div>
    </div>
  );
}