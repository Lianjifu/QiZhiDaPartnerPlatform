/**
 * 技能中心 · 公共 barrel 导出（M09 P1 拆分）。
 *
 * 默认导出 `SkillsPage`（App.tsx lazy import 兼容）。
 * 同时按需暴露 tab 组件，便于将来直接复用（例如侧栏面板、预览侧栏）。
 */
export { default as SkillsPage } from './components/SkillsPage';
export { SkillsTabCatalog } from './components/SkillsTab.Catalog';
export { CatalogStoreView } from './components/SkillsTab.CatalogStore';
export { WorkflowSkillList, PackInstallPanel } from './components/SkillsTab.Packages';
export { IntegrationWorkspace } from './components/SkillsTab.Integration';
export { GovernanceWorkspace } from './components/SkillsTab.Governance';
export { PlatformToolsWorkspace } from './components/SkillsTab.PlatformTools';
export {
  ImportSkillModal, CapabilityConfigModal, StoreSkillDetail, Stat, Mini, Field,
} from './components/SkillsModals';
export { SkillsDetailModal } from './components/SkillsDetailModal';
export {
  RuntimePanel, VersionsPanel, AccessPanel, OverviewPanel,
} from './components/SkillsDetailModal.Panels';
export {
  KIND_META, KIND_PROFILE, STORE_LIST, riskIcon,
  buildHealthBySkillId, buildReferenceBySkillId, enrichSkillRow,
  formatCallsDaily, perfFromHealth, toCapabilityRef,
  type SkillRow, type SkillCenterTab, type ModalKind,
} from './components/SkillsShared';
