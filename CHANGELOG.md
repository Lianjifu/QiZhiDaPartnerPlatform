# Changelog

所有「未发布」的破坏性变更记录在本文档顶部。
发布后请将 `## Unreleased` 区块移入带日期的版本段落,并保留 git tag 可追溯。

---

## Unreleased — 品牌升级:数字工作伙伴平台 → 企智搭 · 数字伙伴平台

> Brand refactor: Digital Work Partner Platform → QiZhiDa · PartnerPlatform (企智搭 · 数字伙伴平台)
>
> 三阶段独立提交,可独立 `git revert`:
> - Phase 1 (`bff4946`) — 品牌文案
> - Phase 2 (`1fd8c65`) — 代码标识(Go module、proto、Go 类型、HTTP 路径、JSON 字段、npm name)
> - Phase 3 (`e978e14`) — 服务前缀 + infra(`de-*` → `qzda-*`、compose、envoy、Prometheus、SPIFFE、cert、OIDC、LaunchAgent)

### 面向用户 / 终端使用者

- 控制台顶部品牌 Logo / 主标题 / 系统提示词已统一为「企智搭 · 数字伙伴平台」(`数字工作伙伴平台` → `数字伙伴平台`)。
- 数字工作伙伴实体改称「**数字伙伴**」,模型层 `DigitalEmployee*` → `DigitalPartner*`。
- HTTP API 路径 `/api/digital-employees/*` → `/api/partners/*`(前端同步,无 consumer 改造)。

### 面向运维 / 集成方 — 需在下一个发版窗口处理,详见 `backend/deploy/MIGRATION-de-to-qzda.md`

- **OIDC client_id `de-core` → `qzda-core`**(在 Authentik / Dex / Okta / Keycloak 等 IdP 中 rename 或重新签发)。
- **Kafka / 事件 Proto 包名 `de.audit.v1` / `de.collab.v1` / `de.policy.v1` / `de.platform.v1` / `de.rag.v1` / `de.runtime.v1` / `de.partner.v1` → `qzda.*`**(下游消费者需滚动前滚)。
- **SPIFFE trust domain `de.local` → `qzda.local`**(联邦 SPIRE bundle / federation 关系需重新协商)。
- **LaunchAgent label `com.digital-employee.dev-stack` → `com.qizhida.dev-stack`**(本地 `~/Library/LaunchAgents/` 仓库外迁移,已完成)。
- **Docker 资源命名**:容器名 / 镜像名 / 网络 (`de_net` → `qzda_net`) / 卷 (`de_pg`、`de_redis`、`de_milvus_*`、`de_opensearch`、`de_prometheus`、`de_grafana`、`de_authentik_*`) 已全部迁移到 `qzda_*`。升级到新版本前请执行 `docker compose down -v && docker volume prune -f`,避免旧 `de_*` 卷与新 `qzda_*` 冲突。

### 未变更(刻意保留)

- `DE_*` 环境变量(121 个)— ops / config 命名空间,与品牌无强耦合。
- 数据库名 `digital_employee`、数据库角色 `de` — 单独 ops 迁移排期,与品牌无关。
- Mock partner ID(`de-office` / `de-it` / `de-sre` / `de-qa` 等)— 领域语义,非品牌。