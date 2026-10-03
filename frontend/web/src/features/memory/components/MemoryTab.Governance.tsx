/**
 * MemoryTab.Governance — 策略面板(自进化候选 + 每日渐进提炼 + 审计)。
 * M07 P1 拆分原因:原 pages/Memory.tsx 单文件 1043L。
 */
import { useState } from 'react';
import { Badge, Button, Input } from '@qzda/web-ui';
import { BrainCircuit, History } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import { EmptyState } from '@/components/shared';
import type { EvolveCandidate, MemoryAuditEvent, MemoryPolicy } from '@qzda/web-types';
import { memoryAuditReactKey } from '@/features/memory/audit-list';
import { MemoryRow, memoryFormatFullTime } from './MemoryShared';

type Props = {
  policy?: MemoryPolicy;
  audit: MemoryAuditEvent[];
  evolveItems?: EvolveCandidate[];
  canMutate?: boolean;
  onUpdate: (patch: Partial<MemoryPolicy>) => void;
  onRun: () => void;
  onDream?: () => void;
  onEvolveReview?: (id: string, action: 'approve' | 'reject') => void;
  running: boolean;
  dreaming?: boolean;
};

export function MemoryTabGovernance({
  policy,
  audit,
  evolveItems = [],
  canMutate = false,
  onUpdate,
  onRun,
  onDream,
  onEvolveReview,
  running,
  dreaming,
}: Props) {
  const [time, setTime] = useState(policy?.dailyRefinementTime ?? '02:00');
  const [confidence, setConfidence] = useState(String(policy?.minimumConfidence ?? 0.85));
  const stages = [
    { key: 'shortToWorkingEnabled' as const, label: '短期 → 工作', desc: '会话结束后归纳上下文，作为任务与交接的可追溯工作记忆。' },
    { key: 'workingToLongEnabled' as const, label: '工作 → 长期', desc: '每日筛选达到置信阈值的任务经验，沉淀为可复用长期记忆。' },
    { key: 'longToKnowledgeEnabled' as const, label: '长期 → 知识候选', desc: '每日提炼长期记忆为待审核候选，审核后才创建知识包草稿。' },
  ];
  const kindLabel: Record<EvolveCandidate['kind'], string> = {
    memory_promote: '记忆晋升',
    skill_patch: '技能补丁',
    routing_hint: '路由草稿',
    dream: 'Dream 压缩',
  };
  const pendingEvolve = evolveItems.filter((item) => item.status === 'pending_review' || item.status === 'pending_countersign');

  return (
    <div className="memory-governance">
      <section className="memory-panel">
        <div className="memory-panel__head">
          <div>
            <h3>自进化候选（审核前不改生产）</h3>
            <p>回合偏好、点赞点踩与路由建议仅生成候选；通过后写入工作记忆或草稿，不会直接 published 路由/技能。</p>
          </div>
          {canMutate && onDream && (
            <Button size="sm" variant="secondary" loading={dreaming} onClick={onDream}>运行 Dream</Button>
          )}
        </div>
        {evolveItems.length ? (
          <div className="memory-audit-list">
            {evolveItems.slice(0, 20).map((item) => (
              <div key={item.id} className="memory-audit-item">
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.summary}</p>
                  <span className="font-mono">
                    {kindLabel[item.kind] ?? item.kind} · {item.status}
                    {item.correlationId ? ` · ${item.correlationId}` : ''}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <time>{memoryFormatFullTime(item.submittedAt)}</time>
                  {canMutate && (item.status === 'pending_review' || item.status === 'pending_countersign') && onEvolveReview && (
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => onEvolveReview(item.id, 'approve')}>
                        {item.status === 'pending_countersign'
                          ? '会签通过'
                          : item.kind === 'skill_patch' || item.kind === 'routing_hint'
                          ? '首签'
                          : '通过'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => onEvolveReview(item.id, 'reject')}>拒绝</Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={BrainCircuit} title="暂无自进化候选" description="会话偏好、点踩反馈或多专家回合后会出现待审项。" />
        )}
        {pendingEvolve.length > 0 && (
          <p className="mt-2 text-xs text-[var(--text-muted)]">待审 {pendingEvolve.length} 条</p>
        )}
      </section>

      <section className="memory-panel">
        <div className="memory-panel__head">
          <div>
            <h3>每日渐进提炼策略</h3>
            <p>{canMutate ? '生产环境由调度器按策略运行；此处触发一次提炼演练并写入审计。' : '只读核查调度策略与提炼链路；审计角色不可改写或演练。'}</p>
          </div>
          {canMutate && <Button size="sm" loading={running} onClick={onRun}>立即演练</Button>}
        </div>
        <div className="memory-stage-list">
          {stages.map((stage) => (
            <div key={stage.key} className="memory-stage">
              <div>
                <strong>{stage.label}</strong>
                <p>{stage.desc}</p>
              </div>
              {canMutate ? (
                <PolicyToggle
                  checked={policy?.[stage.key] ?? true}
                  onChange={(value) => onUpdate({ [stage.key]: value })}
                  label={stage.label}
                />
              ) : (
                <Badge tone={policy?.[stage.key] ?? true ? 'success' : 'neutral'}>
                  {policy?.[stage.key] ?? true ? '已启用' : '已关闭'}
                </Badge>
              )}
            </div>
          ))}
        </div>
        {canMutate ? (
          <>
            <div className="memory-gov-fields">
              <label>每日运行时间
                <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="mt-1.5 h-9 text-xs" />
              </label>
              <label>最低置信度
                <Input type="number" min="0" max="1" step="0.05" value={confidence} onChange={(event) => setConfidence(event.target.value)} className="mt-1.5 h-9 text-xs" />
              </label>
            </div>
            <div className="memory-gov-toggles">
              <label>
                <span>长期写入需审核</span>
                <PolicyToggle
                  checked={policy?.longTermWriteApproval ?? true}
                  onChange={(value) => onUpdate({ longTermWriteApproval: value })}
                  label="长期写入需审核"
                />
              </label>
              <label>
                <span>敏感数据脱敏</span>
                <PolicyToggle
                  checked={policy?.sensitiveDataMasking ?? true}
                  onChange={(value) => onUpdate({ sensitiveDataMasking: value })}
                  label="敏感数据脱敏"
                />
              </label>
            </div>
            <Button className="mt-4" onClick={() => onUpdate({ dailyRefinementTime: time, minimumConfidence: Number(confidence) })}>
              保存调度策略
            </Button>
          </>
        ) : (
          <dl className="memory-detail__grid mt-3">
            <MemoryRow label="每日运行时间" value={policy?.dailyRefinementTime ?? '02:00'} />
            <MemoryRow label="最低置信度" value={String(policy?.minimumConfidence ?? 0.85)} />
            <MemoryRow label="长期写入需审核" value={policy?.longTermWriteApproval ?? true ? '是' : '否'} />
            <MemoryRow label="敏感数据脱敏" value={policy?.sensitiveDataMasking ?? true ? '是' : '否'} />
          </dl>
        )}
      </section>

      <section className="memory-panel">
        <div className="memory-panel__head">
          <h3><History className="h-4 w-4" />记忆审计</h3>
        </div>
        {audit.length ? (
          <div className="memory-audit-list memory-audit-list--tall">
            {audit.map((event, index) => (
              <div key={memoryAuditReactKey(event, index)} className="memory-audit-item">
                <div>
                  <strong>{event.action}</strong>
                  <p>{event.target}</p>
                  <span className="font-mono">{event.actor} · {event.correlationId}</span>
                </div>
                <time>{memoryFormatFullTime(event.time)}</time>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={History} title="暂无记忆审计事件" />
        )}
      </section>
    </div>
  );
}

function PolicyToggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('memory-switch', checked && 'is-on')}
    >
      <span />
    </button>
  );
}