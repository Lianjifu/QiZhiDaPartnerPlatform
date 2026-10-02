/**
 * 数字伙伴入职视图 — 受控能力装配分支 body：
 *
 *  - `OnboardingCapabilityBody` — `EmployeeConfigurationWorkbench mode === 'capability'` 时的 body 渲染
 *
 * 编辑器选型（`CapabilityAssemblySelector` / `syncCapabilityModes`）来自 `PartnersTab.Capability.Assembly`。
 */
import type { DigitalPartner, DigitalPartnerBoundaryPolicy } from '@qzda/web-types';
import { type DigitalPartnerCapabilityCatalog } from './PartnersTab.Capability.LinkedAsset';
import { CapabilityAssemblySelector } from './PartnersTab.Capability.Assembly';
import { resolveBoundaryPolicy } from './PartnersDetail.Content';

export type OnboardingCapabilities = Pick<DigitalPartner['capabilities'], 'agentId' | 'model' | 'knowledge' | 'skills' | 'tools' | 'workflows' | 'channels' | 'cognitive'>;

export function OnboardingCapabilityBody({ employee, catalog, capabilities, onChangeCapabilities, policy, onChangePolicy }: {
  employee: DigitalPartner;
  catalog?: DigitalPartnerCapabilityCatalog;
  capabilities: OnboardingCapabilities;
  onChangeCapabilities: (next: OnboardingCapabilities) => void;
  policy: DigitalPartnerBoundaryPolicy;
  onChangePolicy: (next: DigitalPartnerBoundaryPolicy) => void;
}) {
  return (
    <main className="min-w-0 flex-1">
      <CapabilityAssemblySelector
        catalog={catalog}
        capabilities={capabilities}
        policy={policy}
        onChangeCapabilities={onChangeCapabilities}
        onChangePolicy={onChangePolicy}
      />
    </main>
  );
}

export function deriveInitialBoundaryPolicy(employee: DigitalPartner): DigitalPartnerBoundaryPolicy {
  return resolveBoundaryPolicy(employee);
}