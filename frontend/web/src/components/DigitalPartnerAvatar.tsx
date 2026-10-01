/**
 * components/DigitalPartnerAvatar — re-export shim
 *
 * DigitalPartnerAvatar 实际定义在 PartnerAvatar.tsx;早期 imports 散落在
 * HomeSpotlight / DepartmentTeamPanel 仍指向 @/components/DigitalPartnerAvatar。
 * 本文件保留兼容路径,避免再改多 consumer。
 */

export { DigitalPartnerAvatar } from './PartnerAvatar';