/**
 * SettingsPage — 平台设置路由壳:tab 切换 + URL 持久化 + 6 个查询 + 5 个 tab 面板分发 + 3 个嵌入式页面。
 * M09 P1 拆分:从 pages/Settings.tsx 主 Settings() 函数抽出(原行 50-158)。
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { useApiQuery } from '@/services/query';
import { cn } from '@qzda/web-utils';
import { useT } from '@/i18n';
import Governance from '@/pages/Governance';
import ZeroTrust from '@/pages/ZeroTrust';
import AuditCenter from '@/pages/AuditCenter';

import {
  MENU, SETTINGS_TAB_KEYS, panelClass, type TabKey,
} from './SettingsShared';
import { TenantPanel } from './SettingsTab.Tenant';
import { SecurityPanel } from './SettingsTab.Security';
import { BackupPanel } from './SettingsTab.Backup';
import { IntegrationPanel } from './SettingsTab.Integration';
import { BillingPanel } from './SettingsTab.Billing';

export default function SettingsPage() {
  const { t } = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const [active, setActive] = useState<TabKey>(() =>
    (tabFromUrl && SETTINGS_TAB_KEYS.has(tabFromUrl) ? tabFromUrl : 'tenant') as TabKey,
  );

  const { data: billing } = useApiQuery<any>(['billing'], '/api/billing');
  const { data: tenantProfile } = useApiQuery<any>(
    ['tenant-profile'],
    '/api/tenant/profile',
    undefined,
    { enabled: active === 'tenant' },
  );
  const { data: notifChannels = [] } = useApiQuery<any[]>(
    ['notification-channels'],
    '/api/notification-channels',
    undefined,
    { enabled: active === 'tenant' },
  );
  const { data: apiKeys = [] } = useApiQuery<any[]>(
    ['api-keys'],
    '/api/api-keys',
    undefined,
    { enabled: active === 'apikeys' },
  );
  const { data: webhooks = [] } = useApiQuery<any[]>(
    ['webhooks-config'],
    '/api/webhooks-config',
    undefined,
    { enabled: active === 'apikeys' },
  );
  const { data: backups = [] } = useApiQuery<any[]>(
    ['backups'],
    '/api/backups',
    undefined,
    { enabled: active === 'backup' },
  );

  const selectTab = (key: TabKey) => {
    setActive(key);
    setSearchParams(key === 'tenant' ? {} : { tab: key }, { replace: true });
  };

  useEffect(() => {
    if (tabFromUrl && SETTINGS_TAB_KEYS.has(tabFromUrl) && tabFromUrl !== active) {
      setActive(tabFromUrl as TabKey);
    }
  }, [tabFromUrl, active]);

  return (
    <div className="settings-page de-employee-page h-full min-w-0 overflow-y-auto bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5">
      <div className="settings-page__stack">
        <section className={panelClass}>
          <div className="settings-page__intro">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <div className="de-employee-icon-tile grid h-9 w-9 place-items-center rounded-lg">
                  <SettingsIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-base font-semibold text-[var(--text)]">{t('module.settings.title')}</h1>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{t('module.settings.subtitle')}</p>
                </div>
              </div>
            </div>
            <div className="settings-guardrail">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>安全基线已启用</span>
            </div>
          </div>
          <nav className="de-employee-tabs flex overflow-x-auto px-3" aria-label="设置分类">
            {MENU.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => selectTab(item.key)}
                className={cn(
                  'de-employee-tab flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-xs transition-colors',
                  active === item.key && 'is-active',
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {t(item.labelKey)}
              </button>
            ))}
          </nav>
        </section>

        {active === 'tenant' && (
          <TenantPanel
            billing={billing}
            tenantProfile={tenantProfile}
            notifChannels={notifChannels}
            onGotoAccess={() => selectTab('access')}
          />
        )}
        {active === 'security' && <SecurityPanel onGotoAccess={() => selectTab('access')} />}
        {active === 'backup' && <BackupPanel backups={backups} />}
        {active === 'apikeys' && <IntegrationPanel apiKeys={apiKeys} webhooks={webhooks} />}
        {active === 'billing' && billing && <BillingPanel billing={billing} />}
        {active === 'access' && <Governance embedded />}
        {active === 'zeroTrust' && <ZeroTrust embedded />}
        {active === 'auditCenter' && <AuditCenter embedded />}
      </div>
    </div>
  );
}