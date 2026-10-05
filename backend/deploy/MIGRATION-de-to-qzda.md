# 迁移指南:`de-*` → `qzda-*`(Phase 3 破坏性变更)

> 本文档面向**运维 / 平台集成方**。产品 / 终端用户的变更见根目录 [`CHANGELOG.md`](../../CHANGELOG.md)。

Phase 3(commit `e978e14`)把所有运行时标识符从旧 `de-*` 前缀改为新 `qzh-*`。仓库内的引用已经全部迁移,本文档列出**仓库外**需要在下一个发版窗口处理的破坏性变更及其迁移步骤。

---

## 1. OIDC client_id:`de-core` → `qzda-core`

### 影响范围
- Authentik blueprint / Dex static client / Okta / Keycloak 等 IdP 中注册的 client_id `de-core` 必须改名或重新签发。
- 控制面前端(Vite 模式)通过 `VITE_OIDC_CLIENT_ID` / `QZDA_OIDC_CLIENT_ID` 等环境变量读取该值,**控制面与前端代码已同步使用 `qzda-core`**,但 IdP 端的 client 记录是租户配置,不在仓库内。

### 迁移步骤(以 Authentik 为例)

```bash
# 1. 进入 Authentik Admin → Applications → qzda-core
# 2. 在 Provider (OAuth2/OpenID) 中:
#    - Client ID: de-core  →  qzda-core
#    - Redirect URIs: 已留 / <obs-qzda-core>
# 3. 若 IdP 不允许改 client_id:
#    - 新建 Provider (Client ID: qzda-core)
#    - 把 Application 切到新 Provider
#    - 旧 client_id (de-core) 保留至所有 tenant 都迁移后再清理
```

```bash
# Dex 静态 client (本仓库 backend/deploy/dex/config.yaml 已同步)
# 但租户 IdP (Authentik) 的 client 记录是租户配置
```

### 验证
```bash
# 后端配置加载时应能解析到 qzda-core
curl -sS "https://auth.zenith.example.com/application/o/authorize/?client_id=qzda-core&..." \
  | head -20  # 应返回授权页 HTML,不是 400/401
```

---

## 2. Kafka / 事件 Proto 包名:`de.X.v1` → `qzda.X.v1`

### 影响范围
- 仓库内 Proto 包已迁移:`de.audit.v1` / `de.collab.v1` / `de.policy.v1` / `de.platform.v1` / `de.rag.v1` / `de.runtime.v1` / `de.partner.v1` → `qzda.*`。
- 下游消费者若按 Proto 包名(而非业务主键 ID)消费,需要滚动前滚。

### 迁移步骤(下游消费者侧)

1. **消费者代码侧**
   ```diff
   - import "github.com/qizhida-partner-platform/backend/gen/de/audit/v1"
   - import deauditv1 "github.com/qizhida-partner-platform/backend/gen/de/audit/v1"
   + import "github.com/qizhida-partner-platform/backend/gen/qzda/audit/v1"
   + import qzdaauditv1 "github.com/qizhida-partner-platform/backend/gen/qzda/audit/v1"
   ```

2. **Kafka topic 上的消息字段 `type.googleapis.com/de.audit.v1.AuditEvent`** 在 wire 层序列化后已直接变成 `type.googleapis.com/qzda.audit.v1.AuditEvent`(Proto package 重命名后,type URL 自动跟着改)。如果消费者按 `type.googleapis.com/de.audit.v1.*` 反序列化,会得到 `unrecognized type url` 错误。

3. **滚动步骤(零停机)**
   - **Step A**:生产端灰度发布 Phase 3 后,双写开关期(可选)— 同一事件既发到 `qzda.audit.v1` topic,又保留旧 `de.audit.v1` 一段时间。
   - **Step B**:消费者先**只**反序列化 `qzda.*`,丢弃 `de.*`,观察旧 topic 消费 lag 自然降到 0。
   - **Step C**:旧 topic 进入 `retention.ms` 过期清理。

### 验证
```bash
# Kafka 控制台查询 topic
kafka-topics.sh --bootstrap-server localhost:9092 --list | grep -E "^(de|qzda)\."
# 预期:已发布 qzda.audit.v1 / qzda.collab.v1 等,de.* 在 lag 归零后可删除

# 反序列化验证
kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic qzda.audit.v1.AuditEvent \
  --from-beginning --max-messages 1 | jq '.type' | grep qzda
```

---

## 3. SPIFFE trust domain:`de.local` → `qzda.local`

### 影响范围
- 仓库内 `internal/auth/spiffe.go` 的 trust domain 已是 `qzda.local`(Phase 2)。
- 与外部 SPIRE federation 协商的 trust domain 是组织级配置,不在仓库内。

### 迁移步骤

1. **SPIRE Server 配置**(主集群):
   ```bash
   spire-server cli update-federation-bundle \
     -spiffeID "spiffe://qzda.local/ns/spire/sa/spire-agent"
   ```
2. **联邦对端**(其他集群 / 第三方服务):
   - 在对方 SPIRE Server 的 federation 中,把 trust domain `de.local` 的对端 bundle 改名为 `qzda.local`,重发 bundle URL。
3. **服务间 mTLS**(envoy + SPIRE Agent):
   - envoy 的 SVID filter 在 trust domain 校验失败时会拒接;重启 envoy 拉新 SVID 即可。
   - 重启后 `spiffe://qzda.local/sa/qzda-*` 应该是 cert SAN 中的 URI SAN。

### 验证
```bash
# 服务启动后查证书
openssl s_client -connect qzda-app:8100 -cert /tmp/qzda-stack/certs/qzda-core.crt \
  -key /tmp/qzda-stack/certs/qzda-core.key -servername qzda-core 2>/dev/null \
  | openssl x509 -noout -text | grep -E "URI|Subject"
# 预期: URI:spiffe://qzda.local/sa/qzda-core
```

---

## 4. LaunchAgent label(本地,已完成 ✅)

```bash
# 已执行 (2026-09-30):
launchctl unload ~/Library/LaunchAgents/com.digital-employee.dev-stack.plist
rm        ~/Library/LaunchAgents/com.digital-employee.dev-stack.plist
launchctl load ~/Library/LaunchAgents/com.qizhida.dev-stack.plist
launchctl kickstart -k "gui/$(id -u)/com.qizhida.dev-stack"
```

新 plist 已指向 `/Users/LIANJIFU/ops/QiZhiDaPartnerPlatform/scripts/dev-stack/run-stack.sh`。

---

## 5. Docker 资源清理(本地开发,执行前需用户确认)

升级到 Phase 3 后的第一件事:清理旧 `de_*` 容器 / 卷 / 网络,避免与新 `qzda_*` 冲突。

```bash
cd backend
make compose-down      # docker compose down
docker volume prune -f # 移除 de_pg / de_redis / de_milvus_* 等旧卷(本地数据丢失)
docker network prune -f # 移除 de_net / de_exec_net

make certs             # 重新生成 qzda-* certs(已用 gitignored 新 cert 文件)
make compose-up-monolith
```

> ⚠️ `docker volume prune -f` 会**删除所有未被引用的本地卷**,包括 `qzda_*` 卷之外的其他项目卷。请在执行前确认。

---

## 6. Mock partner ID(领域语义,不动)

仓库内的 mock 数据用 `de-office` / `de-it` / `de-sre` / `de-qa` / `de-hr` / `de-bad` / `de-freeze` 等作为业务伙伴 ID(模拟外部系统的部门标识)。这些是领域语义而非品牌,**未迁移**,且在新版本中继续生效。

---

## 7. 回滚路径

每个 Phase 是独立 commit,可单独 `git revert`:

```bash
# 仅回滚 Phase 3 (保留 Phase 1/2)
git revert e978e14
git push origin main
# 然后重新生成旧 cert,改回 docker compose + envoy + plist

# 回滚 Phase 3 + Phase 2 (保留 Phase 1 品牌文案)
git revert 1fd8c65 e978e14

# 完全回滚到迁移前
git revert 1fd8c65 e978e14 bff4946
```

回滚后:
- 旧 `de_*` 命名空间立即生效(Kafka topic、OIDC client、SPIFFE 端点等外部集成需同步切回)
- DB 角色 / `QZDA_*` env vars / DB name `digital_employee` 不需要回滚(从未迁移)