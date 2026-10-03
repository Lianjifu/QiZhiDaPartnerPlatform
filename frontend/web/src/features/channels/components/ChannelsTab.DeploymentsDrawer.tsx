import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button, Input } from '@qzda/web-ui';
import type { ChannelDeployment } from '@qzda/web-types';
import { Drawer } from '@/components/shared';
import { Field, KIND_LABEL } from './ChannelsShared';

export function DeploymentEditDrawer({
  deployment,
  onClose,
  canWrite,
  submitting = false,
  onSubmit,
}: {
  deployment: ChannelDeployment | null;
  onClose: () => void;
  canWrite: boolean;
  submitting?: boolean;
  onSubmit: (v: Record<string, unknown> & { reverify?: boolean }) => void | Promise<void>;
}) {
  const open = Boolean(deployment);
  const kind = deployment?.kind ?? 'feishu';
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  const [domain, setDomain] = useState('');
  const [connectionMode, setConnectionMode] = useState('websocket');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [encryptKey, setEncryptKey] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [robotCode, setRobotCode] = useState('');
  const [corpId, setCorpId] = useState('');
  const [corpSecret, setCorpSecret] = useState('');
  const [agentId, setAgentId] = useState('');
  const [weixinToken, setWeixinToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [reverify, setReverify] = useState(true);

  useEffect(() => {
    if (!deployment) return;
    setName(deployment.name);
    setEnvironment(deployment.environment);
    setDomain(deployment.domain ?? '');
    setConnectionMode(
      deployment.connectionMode === 'long_connection' ? 'websocket'
        : (deployment.connectionMode ?? (kind === 'dingtalk' ? 'stream' : kind === 'weixin' ? 'long_poll' : 'websocket')),
    );
    setAppId('');
    setAppSecret('');
    setVerificationToken('');
    setEncryptKey('');
    setClientId('');
    setClientSecret('');
    setRobotCode(deployment.robotCode ?? '');
    setCorpId('');
    setCorpSecret('');
    setAgentId(deployment.agentId ?? '');
    setWeixinToken('');
    setAccountId(deployment.accountId ?? '');
    setReverify(true);
  }, [deployment, kind]);

  const valid = canWrite && name.trim().length > 0;

  const handleSave = () => {
    if (!valid || !deployment || submitting) return;
    const body: Record<string, unknown> & { reverify?: boolean } = {
      name: name.trim(),
      environment,
      reverify,
    };
    if (domain.trim()) body.domain = domain.trim();

    if (kind === 'feishu') {
      const mode = connectionMode === 'webhook' ? 'webhook' : 'websocket';
      body.connectionMode = mode;
      if (appId.trim()) body.appId = appId.trim();
      if (appSecret.trim()) body.appSecret = appSecret.trim();
      if (mode === 'webhook') {
        if (verificationToken.trim()) body.verificationToken = verificationToken.trim();
        if (encryptKey.trim()) body.encryptKey = encryptKey.trim();
      }
    } else if (kind === 'dingtalk') {
      body.connectionMode = connectionMode === 'webhook' ? 'webhook' : 'stream';
      if (clientId.trim()) body.clientId = clientId.trim();
      if (clientSecret.trim()) body.clientSecret = clientSecret.trim();
      if (robotCode.trim()) body.robotCode = robotCode.trim();
    } else if (kind === 'wecom') {
      body.connectionMode = connectionMode === 'websocket' ? 'websocket' : 'webhook';
      if (connectionMode === 'websocket') {
        if (clientId.trim()) body.botId = clientId.trim();
        if (clientSecret.trim()) body.botSecret = clientSecret.trim();
      } else {
        if (corpId.trim()) body.corpId = corpId.trim();
        if (corpSecret.trim()) body.corpSecret = corpSecret.trim();
        if (agentId.trim()) body.agentId = agentId.trim();
      }
    } else if (kind === 'weixin') {
      if (weixinToken.trim()) body.token = weixinToken.trim();
      if (accountId.trim()) body.accountId = accountId.trim();
    }

    onSubmit(body);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="编辑渠道部署"
      description={`${KIND_LABEL[kind] ?? kind} · ${deployment?.credentialMasked ?? ''}；密钥留空则保留原凭据。`}
      width={520}
      footer={(
        <div className="flex items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
            <input type="checkbox" checked={reverify} onChange={(e) => setReverify(e.target.checked)} disabled={!canWrite || submitting} />
            保存后重新验证
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>取消</Button>
            <Button size="sm" disabled={!valid || submitting} onClick={handleSave}>
              {submitting ? '保存中…' : '保存修改'}
            </Button>
          </div>
        </div>
      )}
    >
      <div className="channels-create">
        <Field label="显示名称">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-[var(--bg)]" autoComplete="off" />
        </Field>
        <div className="channels-create__grid">
          <Field label="环境">
            <select value={environment} onChange={(e) => setEnvironment(e.target.value as 'sandbox' | 'production')} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
              <option value="sandbox">沙箱</option>
              <option value="production">生产</option>
            </select>
          </Field>
          <Field label="类型">
            <Input value={KIND_LABEL[kind] ?? kind} disabled className="bg-[var(--bg)]" />
          </Field>
        </div>

        {(kind === 'feishu') ? (
          <>
            <div className="channels-create__grid">
              <Field label={`App ID（当前 ${deployment?.appIdMasked ?? deployment?.credentialMasked ?? '••••'}）`}>
                <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
              </Field>
              <Field label="App Secret">
                <Input type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)]" autoComplete="new-password" />
              </Field>
            </div>
            <Field label="API 域名">
              <select value={domain || 'https://open.feishu.cn'} onChange={(e) => setDomain(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
                <option value="https://open.feishu.cn">飞书（open.feishu.cn）</option>
                <option value="https://open.larksuite.com">Lark 国际</option>
              </select>
            </Field>
            <Field label="事件接收模式">
              <select value={connectionMode} onChange={(e) => setConnectionMode(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
                <option value="websocket">WebSocket 长连接（无需公网）</option>
                <option value="webhook">Webhook（平台托管 URL）</option>
              </select>
            </Field>
            {connectionMode === 'webhook' ? (
              <div className="channels-create__grid">
                <Field label="Verification Token">
                  <Input value={verificationToken} onChange={(e) => setVerificationToken(e.target.value)} placeholder="可选，留空保留" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                </Field>
                <Field label="Encrypt Key">
                  <Input type="password" value={encryptKey} onChange={(e) => setEncryptKey(e.target.value)} placeholder="可选，留空保留" className="bg-[var(--bg)]" autoComplete="new-password" />
                </Field>
              </div>
            ) : (
              <div className="channels-create__hint" role="note">
                <KeyRound className="h-3.5 w-3.5 shrink-0" />
                <p>开放平台请选「使用长连接接收事件」。切换为 WebSocket 后将不再暴露 Webhook 回调路径。</p>
              </div>
            )}
          </>
        ) : null}

        {kind === 'dingtalk' ? (
          <>
            <div className="channels-create__grid">
              <Field label={`Client ID（当前 ${deployment?.clientIdMasked ?? deployment?.credentialMasked ?? '••••'}）`}>
                <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
              </Field>
              <Field label="Client Secret">
                <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)]" autoComplete="new-password" />
              </Field>
            </div>
            <Field label="Robot Code（可选）">
              <Input value={robotCode} onChange={(e) => setRobotCode(e.target.value)} className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
            </Field>
            <Field label="事件接收模式">
              <select value={connectionMode} onChange={(e) => setConnectionMode(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
                <option value="stream">Stream 长连接</option>
                <option value="webhook">Webhook</option>
              </select>
            </Field>
          </>
        ) : null}

        {kind === 'wecom' ? (
          <>
            <Field label="连接模式">
              <select value={connectionMode} onChange={(e) => setConnectionMode(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
                <option value="webhook">自建应用 Webhook</option>
                <option value="websocket">智能机器人 WebSocket</option>
              </select>
            </Field>
            {connectionMode === 'websocket' ? (
              <div className="channels-create__grid">
                <Field label="Bot ID">
                  <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                </Field>
                <Field label="Bot Secret">
                  <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)]" autoComplete="new-password" />
                </Field>
              </div>
            ) : (
              <div className="channels-create__grid">
                <Field label={`Corp ID（当前 ${deployment?.corpIdMasked ?? deployment?.credentialMasked ?? '••••'}）`}>
                  <Input value={corpId} onChange={(e) => setCorpId(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                </Field>
                <Field label="Corp Secret">
                  <Input type="password" value={corpSecret} onChange={(e) => setCorpSecret(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)]" autoComplete="new-password" />
                </Field>
                <Field label="Agent ID">
                  <Input value={agentId} onChange={(e) => setAgentId(e.target.value)} className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                </Field>
              </div>
            )}
          </>
        ) : null}

        {(kind === 'weixin') ? (
          <div className="channels-create__grid">
            <Field label={`Token（当前 ${deployment?.tokenMasked ?? deployment?.credentialMasked ?? '••••'}）`}>
              <Input type="password" value={weixinToken} onChange={(e) => setWeixinToken(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)]" autoComplete="new-password" />
            </Field>
            <Field label="Account ID">
              <Input value={accountId} onChange={(e) => setAccountId(e.target.value)} className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
            </Field>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
