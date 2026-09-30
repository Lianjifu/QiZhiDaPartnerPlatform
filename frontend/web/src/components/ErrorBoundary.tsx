/**
 * ErrorBoundary — 友好降级 UI
 * 任何子组件崩溃时显示降级页（不白屏）
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@qzda/web-ui';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  /** 路由变化时自动清空错误，避免侧栏切换后仍卡在旧页崩溃态 */
  resetKey?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
    this.setState({ errorInfo });
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    const err = this.state.error;
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="grid h-full place-items-center bg-[var(--bg-elevated)] p-8"
      >
        <div className="max-w-md w-full rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-8 shadow-lg text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-[var(--danger-bg)] text-[var(--danger)] mx-auto mb-4">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h2 className="text-lg font-semibold text-[var(--text)] mb-1">
            {this.props.fallbackTitle ?? '页面遇到问题'}
          </h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            抱歉，组件渲染时发生错误。已记录到日志，可重试或返回首页。
          </p>
          {err && (
            <details className="text-left mb-4 rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] p-3">
              <summary className="text-xs text-[var(--text-muted)] cursor-pointer font-mono">错误详情</summary>
              <pre className="mt-2 text-[10px] font-mono text-[var(--danger)] overflow-x-auto whitespace-pre-wrap break-all">
{err.message}
{err.stack?.split('\n').slice(0, 4).join('\n')}
              </pre>
            </details>
          )}
          <div className="flex gap-2 justify-center">
            <Button size="sm" variant="secondary" onClick={() => (window.location.href = '/home')}>
              <Home className="h-3.5 w-3.5" />返回首页
            </Button>
            <Button size="sm" onClick={this.reset}>
              <RotateCcw className="h-3.5 w-3.5" />重试
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

/** 随路由自动复位的 ErrorBoundary，用于布局级包裹 */
export function RouteErrorBoundary({ children, fallbackTitle }: { children: ReactNode; fallbackTitle?: string }) {
  const location = useLocation();
  return (
    <ErrorBoundary fallbackTitle={fallbackTitle} resetKey={`${location.pathname}${location.search}`}>
      {children}
    </ErrorBoundary>
  );
}

/** 用于 ErrorBoundary 内显示路由错误的轻量回退（无标题） */
export function PageErrorFallback() {
  return (
    <div className="grid h-full place-items-center bg-[var(--bg-elevated)] p-8">
      <div className="rounded-md border border-[var(--danger)]/40 bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger)] flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        当前页面加载失败
      </div>
    </div>
  );
}
