/**
 * M01 运营总览 TS 类型 — 来自 `@qzda/web-api`（`home-live-aggregate.ts`）。
 *
 * 这些类型是 FE 与后端 `internal/server/ops_aggregate.go` 的共享契约；
 * FE 通过本文件重新导出，便于单点 import。
 */
export type {
  AggregateEmployee,
  AggregateMember,
  AggregateSession,
  AggregateTask,
  HomeExtraLive,
  UsageMeter,
} from '@qzda/web-api';
