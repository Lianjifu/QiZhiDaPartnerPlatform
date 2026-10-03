/**
 * SettingsTab.Security — 平台设置 / 身份:SSO + MFA + 会话策略 + FeatureCard 三栏。
 * M09 P1 拆分:从 pages/Settings.tsx 行 410-483 抽出。
 */
import {
  CheckCircle2, ShieldCheck, Timer, Users, Fingerprint,
} from 'lucide-react';
import { Badge, KpiCard } from '@qzda/web-ui';
import {
  FeatureCard, PanelHeader, panelClass,
} from './SettingsShared';

export function SecurityPanel({ onGotoAccess }: { onGotoAccess: () => void }) {
  return (
    <div className="settings-section">
      <section className="settings-kpis">
        <KpiCard label="身份源" value="OIDC" icon={Fingerprint} tone="brand" size="comfortable" />
        <KpiCard label="MFA 覆盖" value="96" sub="%" icon={ShieldCheck} tone="success" size="comfortable" />
        <KpiCard label="SSO 状态" value="已连接" icon={CheckCircle2} tone="info" size="comfortable" />
        <KpiCard label="会话超时" value="8h" icon={Timer} tone="warn" size="comfortable" />
      </section>

      <section className={panelClass}>
        <PanelHeader
          icon={Fingerprint}
          title="企业身份认证"
          description="数字伙伴与成员共用企业身份源；强制 MFA 与会话轮换，关键变更写入审计。"
          trailing={(
            <Badge tone="success">
              <CheckCircle2 className="mr-1 inline h-3 w-3" />
              企业 SSO 已连接
            </Badge>
          )}
        />

        <div className="settings-identity-strip">
          <div className="settings-identity-strip__item">
            <span>协议</span>
            <strong>OIDC</strong>
          </div>
          <div className="settings-identity-strip__item">
            <span>身份源</span>
            <strong>企业 IdP · ACME SSO</strong>
          </div>
          <div className="settings-identity-strip__item">
            <span>MFA</span>
            <strong>强制开启</strong>
          </div>
          <div className="settings-identity-strip__item">
            <span>最近同步</span>
            <strong className="font-mono">今天 09:12</strong>
          </div>
        </div>

        <div className="settings-feature-grid">
          <FeatureCard
            icon={ShieldCheck}
            title="单点登录"
            description="企业身份源同步成员与组映射，登录强制多因素验证。"
            meta={['OIDC', 'MFA', '组映射']}
            actionLabel="查看身份源"
          />
          <FeatureCard
            icon={Users}
            title="账户生命周期"
            description="入职同步、禁用回收与访问范围由访问控制统一管理。"
            meta={['成员同步', '禁用回收']}
            actionLabel="前往访问控制"
            onAction={onGotoAccess}
          />
          <FeatureCard
            icon={Timer}
            title="会话与令牌"
            description="Web 会话 8 小时，API Token 90 天轮换，异常登录自动告警。"
            meta={['8h 会话', '90 天 Token']}
            actionLabel="查看策略"
          />
        </div>

        <div className="settings-panel__foot">
          身份策略变更需管理员权限；数字伙伴运行身份继承企业 SSO，并受持续验证策略约束。
        </div>
      </section>
    </div>
  );
}
