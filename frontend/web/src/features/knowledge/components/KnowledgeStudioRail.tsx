import { CheckCircle2, Circle, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@qzda/web-utils';

export function KnowledgeStudioRail<T extends string>({
  steps,
  current,
  onSelect,
  collapsed,
  onToggle,
  label,
  sequential = true,
}: {
  steps: Array<{ key: T; index: string; label: string; hint: string; status?: string }>;
  current: T;
  onSelect: (key: T) => void;
  collapsed?: boolean;
  onToggle?: () => void;
  label: string;
  sequential?: boolean;
}) {
  const currentIndex = steps.findIndex((item) => item.key === current);
  return (
    <div className="wf-studio__rail">
      {onToggle && (
        <button type="button" className="wf-studio__rail-toggle" onClick={onToggle}>
          {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
          <span>{collapsed ? '展开步骤' : '收起'}</span>
        </button>
      )}
      <ol className="de-partner-wizard__rail" aria-label={label}>
        {steps.map((item, index) => {
          const state = item.key === current ? 'current' : sequential && index < currentIndex ? 'done' : 'todo';
          return (
            <li key={item.key} className={cn(index < steps.length - 1 && 'has-line')}>
              <button
                type="button"
                className={cn('de-partner-wizard__step', `is-${state}`)}
                onClick={() => onSelect(item.key)}
              >
                <span className="de-partner-wizard__index" aria-hidden>
                  {state === 'done' ? <CheckCircle2 className="h-4 w-4" /> : state === 'current' ? item.index : <Circle className="h-3.5 w-3.5" />}
                </span>
                <span className="de-partner-wizard__meta">
                  <strong>{item.label}</strong>
                  <em>{item.hint}</em>
                  {item.status && <small>{item.status}</small>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function ingestQuery(packageId?: string | null) {
  return packageId ? `?package=${encodeURIComponent(packageId)}` : '';
}
