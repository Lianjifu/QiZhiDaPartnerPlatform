# 模型服务契约（M0 冻结）

真相源：`frontend/packages/api/src/mock.ts` + `frontend/packages/types`。  
实现：`internal/server/handlers_models.go`、`internal/modelprov/`。

## 枚举

| 实体 | 允许值 |
|------|--------|
| Provider.status | `draft` \| `standby` \| `active` \| `disabled` \| `offline` |
| Policy.status | `draft` \| `ready` \| `published` \| `superseded`（校验失败保持 `draft`；`unpublish` 将 `published` 回退为 `draft`） |
| Provider.tier | `official` \| `self_hosted` \| `connectable` |

## 凭据

- 请求：`credential`（兼容 `apiKey`）
- 落库：仅 `credentialRef`（命名空间 URI，如 `model-providers/:id/credential` — 真生产用外部 KMS/Vault 注入，本地 dev 走 in-process secret store）+ `credentialMasked`
- pro：`QZDA_MODE=pro` 时拒绝无 `credentialRef` 的写凭据；mock token 禁用仅影响鉴权，不单独触发凭据门禁

## 关键响应

- discover：`{ protocol, baseUrl, models:[{id,name}], fetchedAt }`
- test：`{ providerId, status:"healthy", providerStatus, verifiedAt, credentialResolved, latencyMs }`
- failover：`{ id, policyId, scope, status:"passed", fromModelId, toModelId, correlationId }`
- governance：含 `healthyShare`、`avgLatencyMs`、`regionDistribution`、`updatedAt`、`budgetRisk`

## 安全

- 读写权限：`model.read` / `model.write`
- `:id` 动作必须 `workspaceId` 匹配（跨租户 → 404）
- PATCH 白名单；禁止明文 credential 落库
- test/discover/failover 限流 30/min/workspace
- Probe SSRF：默认禁私网，`QZDA_MODEL_ALLOW_PRIVATE=1` 放行（monolith 默认在 qzda-app 内；本机 Ollama / 内网网关）
- Copilot 真实调用：qzda-app 内 `POST .../stream` → `/api/model-invoke/stream`（凭据在同进程内解析）
- 逃生舱：`QZDA_LLM_BASE_URL` + `QZDA_LLM_API_KEY` + `QZDA_LLM_MODEL`（OpenAI-compatible）
