# W2 运维手册 · Skill 签名 / Workspace Publisher Key / Vault 凭据

> 适用版本：main（commit `17bfceb` 之后）
> 适用角色：SRE / 平台运维 / Workspace admin
> 关联 ADR：ADR-018（Skill Vetter） / ADR-019（Gateway 硬墙） / ADR-020（Publisher Key） / ADR-021（Vault）

---

## 1. Skill 签名密钥总览

后端通过两层信任保证 skill 包可信：

```
[Workspace Publisher Key]   ←  workspace 自己的 Ed25519 keypair（私钥 workspace 自留）
[Global Trusted Publishers] ←  data/skill-keys/trusted-publishers.json
[Dev Auto-Provisioned]      ←  demo / development only，绝不 prod
```

W1-D2 把「dev keypair 自动 provisioning」落地，verify 时 `TrustStore.LookupPublic` 用公钥验 Ed25519 签名。
W2-D1 加 workspace publisher 段（active / rotated / revoked）。
W2-D2 把私钥从 disk 迁到 Vault（可选）。

---

## 2. Workspace Publisher Key 操作手册

### 2.1 首次为 workspace 生成 publisher key

需要：workspace admin 权限。

```bash
curl -sf -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"acme-publisher","notes":"prod primary"}' \
  http://127.0.0.1:8089/api/workspaces/w-acme/publisher-key
```

返回：

```json
{
  "data": {
    "workspaceId": "w-acme",
    "keyId": "ed25519:abc123...",
    "publicKey": "AaBb...",
    "privateKey": "C2RE..."   ← 仅此一次！服务端不存，丢失需重新生成
  }
}
```

**警告**：私钥在返回那一刻之后服务端不再持有，请立即保存到安全位置（Vault / 1Password / 受限 KMS）。

### 2.2 把私钥放进 Vault（推荐）

```bash
# 1. 把私钥 base64 写到 vault
PRIV_B64="C2RE..."   # 上面返回的 privateKey 字段
KEYID="ed25519:abc123..."

curl -sf -X POST \
  -H "X-Vault-Token: $VAULT_TOKEN" \
  -d "{\"data\":{\"value\":\"$PRIV_B64\"}}" \
  $VAULT_ADDR/v1/secret/data/skill-keys/$KEYID
```

启用 Vault keystore（见 ADR-021）后，server 会从 Vault 拉私钥，私钥不再落 disk。

### 2.3 轮换 publisher key

```bash
curl -sf -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"notes":"quarterly rotation"}' \
  http://127.0.0.1:8089/api/workspaces/w-acme/publisher-key/rotate
```

行为：
- 旧 active → rotated（保留 grace 期，签过的包继续可验）
- 新 keypair 生成，新私钥一次性返回
- 老的 rotated 不删，进入历史

### 2.4 撤销 publisher key

```bash
curl -sf -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8089/api/workspaces/w-acme/publisher-key
```

行为：
- 当前 active → revoked（立即不再参与验签）
- 旧 rotated 是否一并 revoke 由 `?include_rotated=true` 决定

### 2.5 查询当前 publisher key 状态

```bash
curl -sf -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8089/api/workspaces/w-acme/publisher-key
```

返回 active + rotated 历史，admin 可一眼看清还有几个 grace 期的旧 key 在生效。

### 2.6 应急：让旧包立即失效（紧急事件）

1. `DELETE /api/workspaces/<ws>/publisher-key?include_rotated=true` — 一次性清掉所有 trusted
2. 等所有运行中的 skill runtime cache 失效（默认 5 分钟）
3. 重新生成新 keypair → 重新签所有还在用的 skill pack

---

## 3. 全局 Trusted Publishers（platform 级）

全局 trust 文件 `data/skill-keys/trusted-publishers.json`：

```json
{
  "keys": [
    {
      "keyId": "ed25519:deadbeef...",
      "publicKey": "...",
      "name": "DEP Platform Team",
      "addedAt": "2026-09-01T00:00:00Z",
      "addedBy": "ops@dep.local"
    }
  ]
}
```

运维加 publisher key 的步骤：

1. 让对方用 `sign-skill --print-pub` 把 base64 公钥给你
2. 写到 `data/skill-keys/trusted-publishers.json` 末尾
3. 重新跑 `make verify-builtins` 确认 builtin 全过
4. 部署新 trust 文件（`DE_TRUSTED_PUBLISHERS_PATH` 路径在 server 启动时读取，rotate 要 server 重启）

临时 override：

```bash
DE_TRUSTED_PUBLISHERS_PATH=/etc/dep/trusted-publishers.json ./qzda-app
```

---

## 4. Vault 接入（ADR-021）

### 4.1 dev / demo 模式（默认）

不设任何 Vault env，server 走 `DevKeyStore`，自动 provisioning `data/skill-keys/dev-keypair.json`。私钥在 disk。

```bash
DE_ENV=development ./qzda-app
```

CI / 演示环境可以一直这样。

### 4.2 staging / production 模式

启用 Vault keystore：

```bash
export DE_VAULT_ADDR=https://vault.internal:8200
export DE_VAULT_TOKEN=<token-with-secret-read-write>
export DE_VAULT_KV_MOUNT=secret
export DE_SKILL_KEYSTORE=vault
export DE_VAULT_KEYSTORE_PROBE=ed25519:probe   # 可选，默认就是这个

./qzda-app
```

启动期 `bootstrapVaultSkillSigning()` 会用 probe keyID 做一次 lookup，失败立即在 log 里写出，避免第一次签名才发现 vault 配错。

prod 不要设 `DE_SKILL_KEYSTORE=vault` 时 server 会 fallback 到 dev 路径并在 log 里提示 — 这是 fail-fast。

### 4.3 模型凭据（model provider API key）

model provider 的 `credentialRef` 在 Vault 里：

```
vault://model-providers/<provider-id>/credential  →  sk-xxxxx
```

增改：

```bash
curl -sf -X POST -H "Authorization: Bearer $TOKEN" \
  -d '{"credential":"sk-xxx"}' \
  http://127.0.0.1:8089/api/model-providers/<id>/credential
```

服务端会调用 `vault.Client.Put`。批量轮换走 `vault.Client.PutMap`（admin endpoint 还在建设中）。

### 4.4 Vault token rotate

1. 在 Vault 端生成新 token
2. 更新 `DE_VAULT_TOKEN` env
3. 重启 server（startup-time read）

**注意**：运行期不轮换 Vault token 是已知 limitation，列在 ADR-021 的「不在范围内」。

---

## 5. skill-gate CI 闸门

`make skill-gate = vet-builtins + verify-builtins`，两步都过才允许合并到 main。

### 5.1 vet-builtins（内容审查）

```bash
make vet-builtins
```

跑 `cmd/verify-skill --vet=strict` 扫 builtin/skills 的 destructive / egress / credential / escalation / persistence 5 类危险模式。失败输出第一个 bad skill 的 keyID + 文件路径。

绕过（仅紧急）：`DE_SKILL_VETTER=off make vet-builtins` — 但 bypass 必须记录在 PR 描述里。

### 5.2 verify-builtins（签名校验）

```bash
make verify-builtins
```

对每个 builtin 校验：manifest.json 中的 Ed25519 签名 + 每个文件 SHA256。CI 失败即阻断 PR。

### 5.3 加新 builtin 的步骤

1. 把 skill 包放进 `builtin/skills/<name>/`
2. 跑 `sign-skill` 签出（私钥在 dev 自动 provisioning 路径上）
3. commit 整个目录 + manifest.json
4. 推 PR，等 CI skill-gate 跑通

---

## 6. 故障排查

| 现象 | 排查方向 |
|---|---|
| `signing: unknown keyID` | publisher key 不在 trust 里。检查 `data/skill-keys/trusted-publishers.json` 或 workspace `PublisherKey` 状态 |
| `vault keystore: resolve vault:skill-keys/...` 失败 | Vault token / 路径不对。检查 `DE_VAULT_ADDR/TOKEN/MOUNT` |
| `E_SKILL_VET_DENIED` | builtin / 上传 skill 触发 vetter 规则。`cmd/verify-skill --vet=info --manifest ...` 看具体规则 |
| `E_PAYLOAD_TOO_LARGE` 上传 skill | 调 `DE_ARTIFACT_MAX_BYTES`（默认 100 MB）。docx/pptx 一般不超过 50 MB |
| `E_UNSUPPORTED_MEDIA_TYPE` 下载产物 | 产物后缀不在 `{docx, pptx, xlsx, pdf, png, jpg, jpeg}` 白名单。改源生成端 |
| skill runtime 找不到 builtin | 跑 `make sync-builtin-skills` 把 builtin 同步进 `data/skill-runtime/` |
| `dev keystore: keyID mismatch` | `DevKeyStore.Signer("wrong-keyID")` 调用方传错了 keyID。dev keypair 只有一个 keyID |

---

## 7. 监控（Prometheus 指标）

| 指标 | 含义 |
|---|---|
| `de_skill_vetter_total{verdict}` | vetter 调用次数，verdict ∈ {allow, warn, deny} |
| `de_skill_sign_total{result}` | 签名结果，result ∈ {success, invalid, unknown_key, denied} |
| `de_vault_resolve_seconds{ref}` | vault Resolve 耗时，ref 标注是 skill-key 还是 model-credential |
| `de_expert_inbox_pending` | 待审核的 expert inbox 条目数（按 workspace 累计） |

指标挂在 `/metrics` 端点。Grafana 看板待补（W4 任务）。

---

## 8. 变更日志

- W2-D1（commit `9ecc607`）— Workspace Publisher Key 段
- W2-D2（commit `217924c`）— Vault 接入
- ADR-020 / 021 定稿