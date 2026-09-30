import { useEffect, useState } from 'react';
import { Badge, Button, Input } from '@qzda/web-ui';
import { Database, GitBranch, ShieldCheck, Webhook } from 'lucide-react';
import type { KnowledgeSourceConnection } from '@qzda/web-types';
import { cn } from '@qzda/web-utils';
import { Modal } from '@/components/shared';

export type ConnectSourceForm = {
  name: string;
  kind: KnowledgeSourceConnection['kind'];
  schedule: string;
  endpoint: string;
  credentialHint: string;
  syncNow: boolean;
};

const SOURCE_KIND_OPTIONS: Array<{
  value: KnowledgeSourceConnection['kind'];
  label: string;
  hint: string;
  endpointLabel: string;
  endpointPlaceholder: string;
  icon: typeof Database;
}> = [
  {
    value: 'REST API',
    label: 'REST API',
    hint: '拉取变更记录、工单或资产目录',
    endpointLabel: '接口地址',
    endpointPlaceholder: 'https://api.example.com/v1/knowledge',
    icon: Database,
  },
  {
    value: 'Git / Markdown',
    label: 'Git / Markdown',
    hint: '同步 Runbook 与文档仓库',
    endpointLabel: '仓库地址',
    endpointPlaceholder: 'git@github.com:acme/runbooks.git',
    icon: GitBranch,
  },
  {
    value: 'Webhook',
    label: 'Webhook',
    hint: '接收 SIEM / 变更事件推送',
    endpointLabel: '回调地址',
    endpointPlaceholder: '确认接入后由平台签发',
    icon: Webhook,
  },
  {
    value: '数据库只读连接',
    label: '数据库只读',
    hint: '只读查询配置表或知识表',
    endpointLabel: '连接标识',
    endpointPlaceholder: 'postgres://readonly@db:5432/knowledge',
    icon: Database,
  },
];

const SOURCE_SCHEDULE_OPTIONS = ['每 30 分钟', '每 1 小时', '每 6 小时', '手动同步'];

export function ConnectSourceModal({
  open,
  onClose,
  onSubmit,
  connecting = false,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: ConnectSourceForm) => void;
  connecting?: boolean;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<KnowledgeSourceConnection['kind']>('REST API');
  const [schedule, setSchedule] = useState('每 1 小时');
  const [endpoint, setEndpoint] = useState('');
  const [credentialHint, setCredentialHint] = useState('');
  const [syncNow, setSyncNow] = useState(true);
  const kindMeta = SOURCE_KIND_OPTIONS.find((item) => item.value === kind) ?? SOURCE_KIND_OPTIONS[0];
  const valid = name.trim().length > 0 && (kind === 'Webhook' || endpoint.trim().length > 0);

  useEffect(() => {
    if (!open) {
      setName('');
      setKind('REST API');
      setSchedule('每 1 小时');
      setEndpoint('');
      setCredentialHint('');
      setSyncNow(true);
    }
  }, [open]);

  useEffect(() => {
    setEndpoint('');
    setCredentialHint('');
    if (kind === 'Webhook') setSchedule('手动同步');
  }, [kind]);

  const handleSubmit = () => {
    if (!valid || connecting) return;
    onSubmit({
      name: name.trim(),
      kind,
      schedule,
      endpoint: kind === 'Webhook' ? '' : endpoint.trim(),
      credentialHint: credentialHint.trim(),
      syncNow: kind === 'Webhook' ? false : syncNow,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="接入数据源"
      description="连接企业知识来源后，按计划同步并进入加工队列；首次接入会写入知识审计。"
      size="lg"
      bodyClassName="knowledge-connect-body"
      panelClassName="knowledge-connect-modal"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={connecting}>取消</Button>
          <Button disabled={!valid || connecting} onClick={handleSubmit}>
            <Database className="h-3.5 w-3.5" />
            {connecting ? '接入中…' : syncNow && kind !== 'Webhook' ? '确认接入并同步' : '确认接入'}
          </Button>
        </>
      )}
    >
      <div className="knowledge-connect">
        <section className="knowledge-connect__main">
          <div className="knowledge-connect__section">
            <header className="knowledge-connect__section-head">
              <h4>基础信息</h4>
              <p>先命名，便于在加工页识别与审计追溯。</p>
            </header>
            <Field label="数据源名称" required>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：生产变更记录库"
                className="de-employee-input bg-[var(--bg)]"
                onKeyDown={(event) => event.key === 'Enter' && handleSubmit()}
                autoFocus
              />
            </Field>
          </div>

          <div className="knowledge-connect__section">
            <header className="knowledge-connect__section-head">
              <h4>连接类型</h4>
              <p>选择后填写对应地址；Webhook 由平台签发回调。</p>
            </header>
            <div className="knowledge-source-kind-grid" role="radiogroup" aria-label="连接类型">
              {SOURCE_KIND_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = kind === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={cn('knowledge-source-kind', active && 'is-active')}
                    onClick={() => setKind(option.value)}
                  >
                    <span className="knowledge-source-kind__icon"><Icon className="h-3.5 w-3.5" /></span>
                    <strong>{option.label}</strong>
                    <small>{option.hint}</small>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="knowledge-connect__section">
            <header className="knowledge-connect__section-head">
              <h4>连接配置</h4>
              <p>地址用于同步任务；凭据说明仅作演示备注，不会落库密钥。</p>
            </header>
            <div className="knowledge-connect__fields">
              <Field label={kindMeta.endpointLabel} required={kind !== 'Webhook'}>
                <Input
                  value={kind === 'Webhook' ? '确认接入后自动签发' : endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder={kindMeta.endpointPlaceholder}
                  className="de-employee-input bg-[var(--bg)]"
                  disabled={kind === 'Webhook'}
                />
                {kind === 'Webhook' && (
                  <p className="knowledge-connect__hint">回调仅当前工作区可用，推送事件会进入加工队列。</p>
                )}
              </Field>

              <Field label="同步策略">
                <select
                  value={schedule}
                  onChange={(event) => setSchedule(event.target.value)}
                  className="de-employee-input h-10 w-full rounded-lg bg-[var(--bg)] px-3 text-xs text-[var(--text)]"
                  disabled={kind === 'Webhook'}
                >
                  {SOURCE_SCHEDULE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                {kind === 'Webhook' && (
                  <p className="knowledge-connect__hint">Webhook 为事件驱动，无需定时拉取。</p>
                )}
              </Field>

              {kind !== 'Webhook' && (
                <Field label="凭据说明（演示）">
                  <Input
                    value={credentialHint}
                    onChange={(event) => setCredentialHint(event.target.value)}
                    placeholder={
                      kind === 'REST API'
                        ? '例如：Bearer Token / 服务账号'
                        : kind === 'Git / Markdown'
                          ? '例如：Deploy Key / PAT'
                          : '例如：只读账号，不含生产写权限'
                    }
                    className="de-employee-input bg-[var(--bg)]"
                  />
                </Field>
              )}

              {kind !== 'Webhook' && (
                <label className="knowledge-connect__sync-now">
                  <input
                    type="checkbox"
                    checked={syncNow}
                    onChange={(event) => setSyncNow(event.target.checked)}
                  />
                  <span>
                    <strong>接入后立即同步一次</strong>
                    <small>跳过「待首次同步」，直接拉入样例资产并进入健康状态。</small>
                  </span>
                </label>
              )}
            </div>
          </div>
        </section>

        <aside className="knowledge-connect__aside">
          <div className="knowledge-source-summary">
            <div className="knowledge-source-summary__title">接入预览</div>
            <dl>
              <div><dt>名称</dt><dd>{name.trim() || '—'}</dd></div>
              <div><dt>类型</dt><dd><Badge tone="neutral">{kindMeta.label}</Badge></dd></div>
              <div><dt>同步</dt><dd>{kind === 'Webhook' ? '事件推送' : schedule}</dd></div>
              <div>
                <dt>目标</dt>
                <dd className="truncate" title={kind === 'Webhook' ? '平台签发回调' : endpoint}>
                  {kind === 'Webhook' ? '平台签发回调' : (endpoint.trim() || '待填写')}
                </dd>
              </div>
              {credentialHint.trim() && (
                <div><dt>凭据</dt><dd className="truncate">{credentialHint.trim()}</dd></div>
              )}
              <div>
                <dt>首次</dt>
                <dd>{kind === 'Webhook' ? '等待推送' : syncNow ? '立即同步' : '待手动同步'}</dd>
              </div>
            </dl>
          </div>

          <div className="knowledge-connect__note">
            <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--brand)]" />
            <p>
              确认后创建数据源并写入审计。生产环境由连接器、密钥托管与权限校验承接；当前为控制面可操作闭环。
            </p>
          </div>
        </aside>
      </div>
    </Modal>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="knowledge-connect__field">
      <label className="knowledge-connect__label">
        {label}{required && <span className="text-[var(--danger)]"> *</span>}
      </label>
      {children}
    </div>
  );
}
