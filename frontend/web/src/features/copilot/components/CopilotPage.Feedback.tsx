/**
 * CopilotPage — FeedbackForm (inline feedback widget for messages).
 * Extracted from CopilotPage.tsx to satisfy file-size gates.
 */
import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { ChatMessageEx, FeedbackTag } from '@/hooks/types';

export const FEEDBACK_TAGS: { key: FeedbackTag; label: string }[] = [
  { key: 'factuality', label: '事实性' },
  { key: 'helpfulness', label: '有用' },
  { key: 'style', label: '风格' },
  { key: 'outdated', label: '信息陈旧' },
  { key: 'harmful', label: '有害' },
  { key: 'other', label: '其他' },
];

export function FeedbackForm({ target, onSubmit }: { target: ChatMessageEx; onSubmit: (p: { tags?: FeedbackTag[]; comment?: string }) => void }) {
  const [tags, setTags] = useState<FeedbackTag[]>(target.feedback?.tags ?? []);
  const [comment, setComment] = useState(target.feedback?.comment ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const toggle = (k: FeedbackTag) => setTags((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);
  const handleSubmit = () => {
    if (submitting || submitted) return;
    setSubmitting(true);
    // 模拟提交反馈（含短暂 loading → 成功）
    setTimeout(() => {
      onSubmit({ tags, comment: comment || undefined });
      setSubmitting(false);
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 1500);
    }, 500);
  };
  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-md bg-[var(--bg)] border border-[var(--border)] p-2 text-[10px] text-[var(--text-muted)]">
        反馈将进入自进化候选队列（审核前不改生产记忆 / 知识）。
      </div>
      <div>
        <div className="text-[10px] text-[var(--text-muted)] mb-1">问题分类（多选）</div>
        <div className="flex flex-wrap gap-1.5">
          {FEEDBACK_TAGS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => toggle(t.key)}
              aria-pressed={tags.includes(t.key)}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-[10px] border transition-colors',
                tags.includes(t.key)
                  ? 'bg-[var(--brand)] text-white border-[var(--brand)]'
                  : 'bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--brand)]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="fb-comment" className="text-[10px] text-[var(--text-muted)] block mb-1">详细说明</label>
        <textarea
          id="fb-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          placeholder="例如：第 2 步引用文档已过期 / 回答不够具体..."
          className="w-full rounded border border-[var(--border)] bg-[var(--bg)] p-2 text-xs"
        />
      </div>
      <Button
        size="sm"
        onClick={handleSubmit}
        disabled={submitting || submitted}
      >
        {submitted ? <><CheckCircle2 className="h-3 w-3" />已提交</> : submitting ? '提交中…' : '提交反馈'}
      </Button>
    </div>
  );
}