import { Globe, Lock, ShieldAlert } from 'lucide-react';
import { Badge, Input } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { KnowledgePackage } from '@qzda/web-types';
import { Field } from './KnowledgeShared';

export const KNOWLEDGE_DOMAINS = ['SRE', '安全', '财务', '客服', '办公', '研发'];

export const CLASS_OPTIONS: Array<{
  value: KnowledgePackage['classification'];
  label: string;
  hint: string;
  icon: typeof Globe;
}> = [
  { value: 'internal', label: '内部', hint: '工作区内可检索、可装配', icon: Globe },
  { value: 'confidential', label: '机密', hint: '仅授权岗位与流程可引用', icon: Lock },
  { value: 'restricted', label: '受限', hint: '高敏感，发布与引用需复核', icon: ShieldAlert },
];

export function PackageIdentityForm({
  name,
  description,
  domain,
  classification,
  disabled,
  onName,
  onDescription,
  onDomain,
  onClassification,
}: {
  name: string;
  description: string;
  domain: string;
  classification: KnowledgePackage['classification'];
  disabled?: boolean;
  onName: (value: string) => void;
  onDescription: (value: string) => void;
  onDomain: (value: string) => void;
  onClassification: (value: KnowledgePackage['classification']) => void;
}) {
  const classMeta = CLASS_OPTIONS.find((item) => item.value === classification) ?? CLASS_OPTIONS[0];
  return (
    <div className="knowledge-pkg-create">
      <div className="knowledge-pkg-create__main">
        <section className="knowledge-pkg-create__block">
          <header className="knowledge-pkg-create__block-head">
            <span>01</span>
            <div>
              <h2>基本信息</h2>
              <p>名称用于目录与引用；业务域帮助伙伴按场景装配。</p>
            </div>
          </header>
          <div className="knowledge-pkg-create__fields">
            <Field label="知识包名称" required>
              <Input value={name} disabled={disabled} onChange={(event) => onName(event.target.value)} placeholder="例如：生产故障处置知识包" />
            </Field>
            <Field label="业务域">
              <div className="knowledge-pkg-domain">
                {KNOWLEDGE_DOMAINS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    disabled={disabled}
                    className={cn('knowledge-pkg-domain__chip', domain === item && 'is-active')}
                    onClick={() => onDomain(item)}
                  >
                    {item}
                  </button>
                ))}
                <input
                  value={KNOWLEDGE_DOMAINS.includes(domain) ? '' : domain}
                  disabled={disabled}
                  onChange={(event) => onDomain(event.target.value)}
                  placeholder="自定义"
                  aria-label="自定义业务域"
                  className="knowledge-pkg-domain__custom"
                />
              </div>
            </Field>
            <div className="knowledge-pkg-create__wide">
              <Field label="说明">
                <textarea
                  value={description}
                  disabled={disabled}
                  onChange={(event) => onDescription(event.target.value)}
                  rows={3}
                  placeholder="适用范围、主要来源、谁可以引用、使用边界。"
                  className="de-employee-input w-full rounded-lg bg-[var(--bg)] px-3 py-2 text-xs leading-5"
                />
              </Field>
            </div>
          </div>
        </section>
        <section className="knowledge-pkg-create__block">
          <header className="knowledge-pkg-create__block-head">
            <span>02</span>
            <div>
              <h2>数据分级</h2>
              <p>决定检索范围与发布复核强度。</p>
            </div>
          </header>
          <div className="knowledge-pkg-class-grid" role="radiogroup" aria-label="数据分级">
            {CLASS_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = classification === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  className={cn('knowledge-pkg-class', active && 'is-active')}
                  onClick={() => onClassification(option.value)}
                >
                  <span className="knowledge-pkg-class__icon"><Icon className="h-4 w-4" /></span>
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </button>
              );
            })}
          </div>
        </section>
      </div>
      <aside className="knowledge-pkg-create__aside">
        <div className="knowledge-pkg-create__preview">
          <div className="knowledge-pkg-create__preview-kicker">预览</div>
          <h3>{name.trim() || '未命名知识包'}</h3>
          <div className="knowledge-pkg-create__preview-tags">
            <Badge tone="neutral">{domain.trim() || '业务域'}</Badge>
            <Badge tone={classification === 'internal' ? 'info' : 'warn'}>{classMeta.label}</Badge>
          </div>
          <p>{description.trim() || '补充说明后，伙伴能更快判断能否装配。'}</p>
        </div>
      </aside>
    </div>
  );
}
