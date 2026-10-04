/**
 * CopilotPage.Header — conversation identity: title + bound digital partner.
 */
import { BriefcaseBusiness, PanelRight, RefreshCw } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { useCopilotContext } from '@/features/copilot/components/useCopilotController';
import { DigitalPartnerAvatar } from '@/features/partners/components/DigitalPartnerAvatar';

export function CopilotPageHeader() {
  const ctrl = useCopilotContext();
  const { s, currentSession, workbench, isGenerating,
    expertName, expertMeta, hasBoundExpert, activeEmployee, canMutate,
    actions, detailsOpen, openContext, closeContext,
  } = ctrl;

  if (!currentSession) {
    return (
      <header className="copilot-header copilot-header--lite">
        <div className="copilot-work-header">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--brand-light)] text-[var(--brand)]">
              <BriefcaseBusiness className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="copilot-work-title truncate font-semibold">专家协作</div>
              <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">选择数字伙伴后开始对话</p>
            </div>
          </div>
          {canMutate && (
            <Button size="sm" onClick={actions.openNewSessionPicker}>选择数字伙伴</Button>
          )}
        </div>
      </header>
    );
  }

  return (
    <header className="copilot-header copilot-header--lite">
      <div className="copilot-work-header">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            className="shrink-0 rounded-full"
            onClick={canMutate ? (hasBoundExpert ? actions.openRebindExpertPicker : actions.openNewSessionPicker) : undefined}
            aria-label={hasBoundExpert ? '更换数字伙伴' : '选择数字伙伴'}
            disabled={!canMutate}
          >
            {activeEmployee ? (
              <DigitalPartnerAvatar employee={activeEmployee} size={32} />
            ) : (
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--brand-light)] text-[var(--brand)]">
                <BriefcaseBusiness className="h-4 w-4" />
              </span>
            )}
          </button>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="copilot-work-title truncate font-semibold" title={workbench.title}>{workbench.title}</span>
              {isGenerating && <Badge tone="info" className="shrink-0 text-[10px]">生成中</Badge>}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
              {hasBoundExpert ? [expertName, expertMeta].filter(Boolean).join(' · ') : '尚未选择数字伙伴'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canMutate && (
            <button
              type="button"
              className="copilot-toolbar-btn"
              onClick={hasBoundExpert ? actions.openRebindExpertPicker : actions.openNewSessionPicker}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {hasBoundExpert ? '更换伙伴' : '选择伙伴'}
            </button>
          )}
          <button
            ref={s.detailsToggleRef}
            type="button"
            className={cn('copilot-toolbar-btn', detailsOpen && 'is-active')}
            onClick={() => (detailsOpen ? closeContext() : openContext('overview'))}
            aria-pressed={detailsOpen}
            aria-controls="copilot-context"
            title="打开右侧上下文（⌘⇧E）"
          >
            <PanelRight className="h-3.5 w-3.5" />
            上下文
          </button>
        </div>
      </div>
    </header>
  );
}
