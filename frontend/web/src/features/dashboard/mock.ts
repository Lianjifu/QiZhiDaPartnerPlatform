/**
 * M01 运营总览 mock bits — 来自 `@qzda/web-api`（`mock.ts`）。
 *
 * 真正的 mock handler 路由委托在 `packages/api/src/m01-mock-handlers.ts` 内实现
 * （handlers 需要访问 mock 层私有表 mockDigitalPartners / mockTasks 等，无法下沉到 web）。
 *
 * 这里仅重新导出：
 *  - M01 类型契约（HomeExtraLive 等）；
 *  - `mockHomeExtra`（@deprecated 兼容旧引用）；
 *  - live-aggregate 构建器（buildHomeExtraLive / buildOpsOverviewLive），
 *    供 FE 单元测试或离线渲染使用。
 *
 * ⚠️ 不要在本文件添加新 handler —— 所有路由在 `@qzda/web-api/mockHandler` 内部注册。
 */
export {
  buildHomeExtraLive,
  buildOpsOverviewLive,
  mockHomeExtra,
  type HomeExtra,
  type HomeExtraLive,
} from '@qzda/web-api';
