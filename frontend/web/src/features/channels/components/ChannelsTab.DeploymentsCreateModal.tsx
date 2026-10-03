import { useEffect, useState } from 'react';
import { Cloud, KeyRound, MessageSquare, Send, Users } from 'lucide-react';
import { Button, Input } from '@qzda/web-ui';
import type { ChannelKind } from '@qzda/web-types';
import { Modal } from '@/components/shared';
import { cn } from '@qzda/web-utils';
import { Field, KIND_LABEL } from './ChannelsShared';

const DEPLOY_KIND_OPTIONS: Array<{ value: ChannelKind; label: string; hint: string; icon: typeof MessageSquare }> = [
  { value: 'feishu', label: '飞书', hint: '企业自建应用', icon: MessageSquare },
  { value: 'dingtalk', label: '钉钉', hint: '企业内部应用', icon: Cloud },
  { value: 'wecom', label: '企业微信', hint: '自建应用回调', icon: Users },
  { value: 'weixin', label: '个人微信', hint: 'ilink 长轮询', icon: Send },
];

export function DeploymentCreateModal({
  open,
  onClose,
  canWrite,
  workspaceId,
  submitting = false,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  canWrite: boolean;
  workspaceId: string;
  submitting?: boolean;
  onSubmit: (v: Record<string, unknown>) => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ChannelKind>('feishu');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [domain, setDomain] = useState('https://open.feishu.cn');
  const [connectionMode, setConnectionMode] = useState('websocket');
  const [verificationToken, setVerificationToken] = useState('');
  const [encryptKey, setEncryptKey] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [robotCode, setRobotCode] = useState('');
  const [corpId, setCorpId] = useState('');
  const [corpSecret, setCorpSecret] = useState('');
  const [agentId, setAgentId] = useState('');
  const [callbackToken, setCallbackToken] = useState('');
  const [callbackAesKey, setCallbackAesKey] = useState('');
  const [weixinToken, setWeixinToken] = useState('');
  const [allowFrom, setAllowFrom] = useState('');
  const [accountId, setAccountId] = useState('');

  const enterprise = kind === 'feishu' || kind === 'dingtalk' || kind === 'wecom' || kind === 'weixin';
  const valid = canWrite && name.trim().length > 0 && (
    kind === 'feishu' ? appId.trim() && appSecret.trim()
      : kind === 'dingtalk' ? clientId.trim() && clientSecret.trim()
        : kind === 'wecom' ? (
          connectionMode === 'websocket'
            ? clientId.trim() && clientSecret.trim()
            : corpId.trim() && corpSecret.trim() && agentId.trim()
        )
          : kind === 'weixin' ? weixinToken.trim().length > 0
            : false
  );

  useEffect(() => {
    if (!open) {
      setName('');
      setKind('feishu');
      setAppId('');
      setAppSecret('');
      setDomain('https://open.feishu.cn');
      setConnectionMode('websocket');
      setVerificationToken('');
      setEncryptKey('');
      setClientId('');
      setClientSecret('');
      setRobotCode('');
      setCorpId('');
      setCorpSecret('');
      setAgentId('');
      setCallbackToken('');
      setCallbackAesKey('');
      setWeixinToken('');
      setAllowFrom('');
      setAccountId('');
    }
  }, [open]);

  useEffect(() => {
    if (kind === 'feishu') {
      setDomain('https://open.feishu.cn');
      setConnectionMode('websocket');
    } else if (kind === 'dingtalk') {
      setDomain('https://api.dingtalk.com');
      setConnectionMode('stream');
    } else if (kind === 'wecom') {
      setDomain('https://qyapi.weixin.qq.com');
      setConnectionMode('webhook');
    } else if (kind === 'weixin') {
      setDomain('https://ilinkai.weixin.qq.com');
      setConnectionMode('long_poll');
    }
  }, [kind]);

  const handleSubmit = () => {
    if (!valid || submitting) return;
    if (kind === 'feishu') {
      const mode = connectionMode === 'webhook' ? 'webhook' : 'websocket';
      onSubmit({
        name: name.trim(), kind, workspaceId,
        appId: appId.trim(), appSecret: appSecret.trim(),
        domain: domain.trim() || 'https://open.feishu.cn',
        connectionMode: mode,
        ...(mode === 'webhook' ? {
          verificationToken: verificationToken.trim() || undefined,
          encryptKey: encryptKey.trim() || undefined,
        } : {}),
      });
      return;
    }
    if (kind === 'dingtalk') {
      onSubmit({
        name: name.trim(), kind, workspaceId,
        clientId: clientId.trim(), clientSecret: clientSecret.trim(),
        robotCode: robotCode.trim() || undefined,
        domain: domain.trim() || 'https://api.dingtalk.com',
        connectionMode,
      });
      return;
    }
    if (kind === 'wecom') {
      if (connectionMode === 'websocket') {
        onSubmit({
          name: name.trim(), kind, workspaceId, connectionMode: 'websocket',
          botId: clientId.trim(), botSecret: clientSecret.trim(),
        });
        return;
      }
      onSubmit({
        name: name.trim(), kind, workspaceId, connectionMode: 'webhook',
        corpId: corpId.trim(), corpSecret: corpSecret.trim(), agentId: agentId.trim(),
        callbackToken: callbackToken.trim() || undefined,
        callbackAesKey: callbackAesKey.trim() || undefined,
        apiBaseUrl: domain.trim() || 'https://qyapi.weixin.qq.com',
      });
      return;
    }
    if (kind === 'weixin') {
      onSubmit({
        name: name.trim(), kind, workspaceId,
        token: weixinToken.trim(),
        baseUrl: domain.trim() || 'https://ilinkai.weixin.qq.com',
        allowFrom: allowFrom.trim() || undefined,
        accountId: accountId.trim() || undefined,
      });
    }
  };

  const description = kind === 'feishu'
    ? '对齐 cc-connect：飞书企业自建应用 App ID / Secret；默认 WebSocket 长连接（无需公网）。'
    : kind === 'dingtalk'
      ? '对齐 cc-connect：钉钉企业内部应用 Client ID / Secret；默认 Stream 长连接。'
      : kind === 'wecom'
        ? '对齐 cc-connect：企业微信自建应用（CorpId / Secret / AgentId）或智能机器人 WebSocket。'
        : kind === 'weixin'
          ? '对齐 cc-connect：个人微信 ilink Token（扫码 setup / bind 后填入）。'
          : '凭据只写入引用。';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="接入渠道部署"
      description={description}
      size={enterprise ? 'md' : 'sm'}
      bodyClassName="channels-create-body"
      panelClassName="channels-create-modal"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>取消</Button>
          <Button disabled={!valid || submitting} onClick={() => void handleSubmit()}>
            {submitting ? '接入中…' : '确认接入'}
          </Button>
        </>
      )}
    >
      <div className="channels-create">
        <Field label="部署名称">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`例如：${KIND_LABEL[kind]} 生产机器人`}
            className="bg-[var(--bg)]"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
        </Field>

        <div className="channels-create__section">
          <span className="channels-create__label">渠道类型</span>
          <div className="channels-create__kinds" role="radiogroup" aria-label="渠道类型">
            {DEPLOY_KIND_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = kind === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={cn('channels-create__kind', active && 'is-active')}
                  onClick={() => setKind(option.value)}
                >
                  <span className="channels-create__kind-icon"><Icon className="h-3.5 w-3.5" /></span>
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </button>
              );
            })}
          </div>
        </div>

        {kind === 'feishu' ? (
          <>
            <div className="channels-create__grid">
              <Field label="App ID">
                <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="cli_xxxxxxxxxxxx" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
              </Field>
              <Field label="App Secret">
                <Input type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="开放平台凭据" className="bg-[var(--bg)]" autoComplete="new-password" />
              </Field>
            </div>
            <Field label="API 域名">
              <select value={domain} onChange={(e) => setDomain(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
                <option value="https://open.feishu.cn">飞书（open.feishu.cn）</option>
                <option value="https://open.larksuite.com">Lark 国际</option>
              </select>
            </Field>
            <Field label="事件接收模式">
              <select value={connectionMode} onChange={(e) => setConnectionMode(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
                <option value="websocket">WebSocket 长连接（对齐 cc-connect，无需公网）</option>
                <option value="webhook">Webhook（平台托管 URL，需公网/隧道）</option>
              </select>
            </Field>
            {connectionMode === 'webhook' ? (
              <div className="channels-create__grid">
                <Field label="Verification Token（可选）">
                  <Input value={verificationToken} onChange={(e) => setVerificationToken(e.target.value)} className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                </Field>
                <Field label="Encrypt Key（可选）">
                  <Input type="password" value={encryptKey} onChange={(e) => setEncryptKey(e.target.value)} className="bg-[var(--bg)]" autoComplete="new-password" />
                </Field>
              </div>
            ) : (
              <div className="channels-create__hint" role="note">
                <KeyRound className="h-3.5 w-3.5 shrink-0" />
                <p>开放平台「事件与回调」请选 <strong>使用长连接接收事件</strong>，并订阅 <code>im.message.receive_v1</code>。入站由本机/侧车 WebSocket 进程承接（与 cc-connect 相同），控制面负责凭证与出站。</p>
              </div>
            )}
          </>
        ) : null}

        {kind === 'dingtalk' ? (
          <>
            <div className="channels-create__grid">
              <Field label="Client ID (AppKey)">
                <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="dingxxxxxxxxxxxx" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
              </Field>
              <Field label="Client Secret">
                <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} className="bg-[var(--bg)]" autoComplete="new-password" />
              </Field>
            </div>
            <Field label="Robot Code（可选，默认=Client ID）">
              <Input value={robotCode} onChange={(e) => setRobotCode(e.target.value)} className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
            </Field>
            <Field label="事件接收模式">
              <select value={connectionMode} onChange={(e) => setConnectionMode(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
                <option value="stream">Stream 长连接（推荐，无需公网；侧车）</option>
                <option value="webhook">HTTP 回调（平台托管 URL）</option>
              </select>
            </Field>
          </>
        ) : null}

        {kind === 'wecom' ? (
          <>
            <Field label="接入模式">
              <select value={connectionMode} onChange={(e) => setConnectionMode(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
                <option value="webhook">自建应用 Webhook（CorpId + AgentId）</option>
                <option value="websocket">智能机器人 WebSocket（BotId）</option>
              </select>
            </Field>
            {connectionMode === 'websocket' ? (
              <div className="channels-create__grid">
                <Field label="Bot ID">
                  <Input value={clientId} onChange={(e) => setClientId(e.target.value)} className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                </Field>
                <Field label="Bot Secret">
                  <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} className="bg-[var(--bg)]" autoComplete="new-password" />
                </Field>
              </div>
            ) : (
              <>
                <div className="channels-create__grid">
                  <Field label="Corp ID">
                    <Input value={corpId} onChange={(e) => setCorpId(e.target.value)} placeholder="wwxxxxxxxxxxxx" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                  </Field>
                  <Field label="Agent ID">
                    <Input value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="1000002" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                  </Field>
                </div>
                <Field label="Corp Secret">
                  <Input type="password" value={corpSecret} onChange={(e) => setCorpSecret(e.target.value)} className="bg-[var(--bg)]" autoComplete="new-password" />
                </Field>
                <div className="channels-create__grid">
                  <Field label="Callback Token">
                    <Input value={callbackToken} onChange={(e) => setCallbackToken(e.target.value)} className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                  </Field>
                  <Field label="EncodingAESKey（43 位）">
                    <Input value={callbackAesKey} onChange={(e) => setCallbackAesKey(e.target.value)} className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                  </Field>
                </div>
              </>
            )}
          </>
        ) : null}

        {kind === 'weixin' ? (
          <>
            <Field label="ilink Bot Token">
              <Input type="password" value={weixinToken} onChange={(e) => setWeixinToken(e.target.value)} placeholder="扫码 setup / bind 后的 Bearer Token" className="bg-[var(--bg)]" autoComplete="new-password" />
            </Field>
            <div className="channels-create__grid">
              <Field label="Allow From（可选）">
                <Input value={allowFrom} onChange={(e) => setAllowFrom(e.target.value)} placeholder="user@im.wechat 或 *" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
              </Field>
              <Field label="Account ID（可选）">
                <Input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="多账号隔离" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
              </Field>
            </div>
          </>
        ) : null}

        <div className="channels-create__hint" role="note">
          <KeyRound className="h-3.5 w-3.5 shrink-0" />
          <div>
            {kind === 'feishu' && connectionMode === 'webhook' && <p>确认后将保存凭据并自动验证（tenant_access_token + bot/v3/info）。Webhook 模式会生成回调路径，填到开放平台「请求地址」。</p>}
            {kind === 'feishu' && connectionMode !== 'webhook' && <p>确认后将保存凭据并自动验证。请在开放平台启用「长连接」；本地需运行 WebSocket 侧车（对齐 cc-connect）承接入站。</p>}
            {kind === 'dingtalk' && <p>确认后将保存凭据并自动验证（oauth2/accessToken）。Stream 入站由侧车；Webhook 模式会生成 HTTP 回调地址。</p>}
            {kind === 'wecom' && <p>确认后将保存凭据并自动验证（gettoken）。自建应用请先接入再在企微后台保存「接收消息」URL；出站需企业可信 IP。</p>}
            {kind === 'weixin' && <p>确认后将保存 Token 并短调用 getUpdates 验证。出站需 context_token；长轮询入站由侧车承接。</p>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
