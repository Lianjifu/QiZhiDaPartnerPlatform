/**
 * M01 别名 / 规范化映射 — 来自 `@qzda/web-api`（`m01-builders.ts`）。
 *
 * 这些函数是 mock 层的实现细节；FE 端使用它们归一化伙伴能力名（CAPABILITY / CHANNEL）。
 * 重新导出是为了让 dashboard 内部 import 路径稳定。
 */
export {
  CAPABILITY_NAME_ALIASES,
  CHANNEL_NAME_ALIASES,
  normalizeCapabilityName,
  normalizeChannelName,
  normalizeEmployeeCapabilities,
} from '@qzda/web-api';
