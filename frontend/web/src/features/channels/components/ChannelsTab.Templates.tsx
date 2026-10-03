import { useState } from 'react';
import { FileText, Plus, Search, Users } from 'lucide-react';
import { Badge, Button, Input as Input } from '@qzda/web-ui';
import type { ChannelKind } from '@qzda/web-types';
import { EmptyState } from '@/components/shared';
import { cn } from '@qzda/web-utils';
import { BlacklistItem, ChannelTemplate, KIND_LABEL, formatTime, sanitizeTemplatePreview, templateToneIcon } from './ChannelsShared';

export function Templates({
  templates,
  blacklist,
  query,
  onQuery,
  canWrite,
  onCreate,
}: {
  templates: ChannelTemplate[];
  blacklist: BlacklistItem[];
  query: string;
  onQuery: (value: string) => void;
  canWrite: boolean;
  onCreate: (body: { name: string; desc: string; kind: ChannelKind }) => void;
}) {
  const [name, setName] = useState('');
  const visible = templates.filter((item) =>
    !query.trim() ||
    `${item.name} ${item.desc}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="channels-panel">
      <div className="channels-section-head">
        <div>
          <h2>消息模板 · {templates.length}</h2>
          <p>版本化模板、多语言与变量白名单；投递前脱敏。目标治理控制值班组与黑名单。</p>
        </div>
        <label className="channels-search">
          <Search className="h-3.5 w-3.5" />
          <Input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="检索模板"
            className="h-9 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
          />
        </label>
      </div>

      <div className="channels-templates-grid">
        <section className="channels-subpanel">
          <div className="channels-subpanel__head">
            <h3><FileText className="h-4 w-4 text-[var(--brand)]" />模板资产</h3>
            {canWrite ? (
              <div className="channels-inline-create">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="新模板名称"
                  className="h-8 w-36 text-xs"
                />
                <Button
                  size="sm"
                  disabled={!name.trim()}
                  onClick={() => {
                    onCreate({ name: name.trim(), desc: '新建模板草稿', kind: 'feishu' });
                    setName('');
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />新建
                </Button>
              </div>
            ) : null}
          </div>
          {visible.length ? (
            <div className="channels-template-list">
              {visible.map((item) => {
                const tone = templateToneIcon(item.tone);
                return (
                  <article key={item.id} className="channels-template-card">
                    <div className="channels-card__top">
                      <div className="channels-template-card__title">
                        <span className={cn('channels-template-icon', tone.className)}>
                          <tone.Icon className="h-3.5 w-3.5" />
                        </span>
                        <div>
                          <strong>{item.name}</strong>
                          <p>{item.desc}</p>
                        </div>
                      </div>
                      <Badge tone={item.status === 'published' ? 'success' : 'neutral'}>
                        {item.status === 'published' ? '已发布' : '草稿'}
                      </Badge>
                    </div>
                    <pre className="channels-template-preview">{sanitizeTemplatePreview(item.preview)}</pre>
                    <div className="channels-card__meta">
                      <span>{item.kind ? KIND_LABEL[item.kind] : '通用'}</span>
                      <span>{item.locale ?? 'zh-CN'}</span>
                      {item.updatedAt ? <span>更新 {formatTime(item.updatedAt)}</span> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={FileText} title="没有匹配的模板" />
          )}
        </section>

        <section className="channels-subpanel">
          <div className="channels-subpanel__head">
            <h3><Users className="h-4 w-4 text-[var(--brand)]" />目标治理</h3>
          </div>
          <p className="channels-subpanel__desc">策略仅可引用已批准目标组；黑名单阻止异常收件人接收生产告警。</p>
          {blacklist.length ? (
            <div className="channels-blacklist">
              {blacklist.map((item) => (
                <div key={item.id} className="channels-blacklist__row">
                  <div>
                    <strong>{item.value}</strong>
                    <p>{item.type} · {item.reason}</p>
                  </div>
                  <div className="channels-blacklist__meta">
                    <span>{item.addedBy}</span>
                    <span>至 {item.expires}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Users} title="暂无黑名单条目" />
          )}
        </section>
      </div>
    </div>
  );
}