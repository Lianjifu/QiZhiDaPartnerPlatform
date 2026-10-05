# Skill 签名与发布流水线（W1-D2 / W1-D3）

> 双闸门保护 builtin skill：先 vetter（内容危险模式扫描），
 再 signer（发布者 Ed25519 签名验证）。任何 skill 在装载到
 workspace 之前必须过两道关。

## 角色

| 角色 | 工具 | 何时用 |
|---|---|---|
| Skill 作者 / 维护者 | `cmd/sign-skill` | 改完 skill 内容后重新签名 |
| 运维 / CI | `cmd/verify-skill` | 发布前 / 合并前校验 |
| Server (启动时) | `bootstrapSkillSigning` | 自动加载 trust store + 必要时生成 dev keypair |
| Server (运行时) | `verifyBuiltinSignature` / `verifyImportSignature` | 每次装载 builtin 或用户导入 skill 时强制校验 |

## 发布流水线（日常）

```bash
# 1. 编辑 skill（builtin 或新 skill）
$EDITOR services/qzda-sandbox/builtin/skills/docx/SKILL.md

# 2. 重新签名（默认 dev keypair 自动使用）
go run ./cmd/sign-skill --key data/skill-keys/dev-keypair.json \
    --manifest services/qzda-sandbox/builtin/skills/manifest.json services/qzda-sandbox/builtin/skills/docx

# 3. CI gate — 校验所有 builtin
make skill-gate
# 输出：vetter verdict=pass findings=0  →  signer verified=34 failed=0
# 失败即阻断 PR 合并
```

## 签名格式

每个 skill 包携带一个 Ed25519 签名，覆盖：
- `name` + `version`（identity）
- `skillMdSha256`（SKILL.md 内容指纹）
- `files[]`（包内每个文件的 SHA256，按路径字典序排序）
- `entrypoints[]`、`riskLevel`（声明）

Canonical 编码规则：JSON object keys 按字典序排序、no whitespace。
实现见 [`canonical.go`](canonical.go)。

签名 64 字节 → base64（std encoding）→ 88 字符。KeyID 格式
`ed25519:` + 公钥 SHA256[:8] 16 字符 hex，例如
`ed25519:9a5c62d02dc4a7f1`。

## 信任锚

信任锚在 `data/skill-keys/trusted-publishers.json`：

```json
{
  "keys": [
    {
      "keyId": "ed25519:9a5c62d02dc4a7f1",
      "publicKey": "ykttJvuuWAIyr8diyru9QCVHYCiknCHhXOT8o2/wBRE=",
      "name": "DEP Platform Team",
      "addedAt": "2026-09-07T12:34:56Z",
      "addedBy": "security@acme.com"
    }
  ]
}
```

启动时加载到 `Server.SkillTrustStore`。dev/demo 模式下若
`QZDA_BAN_DEV_KEYPAIR` 未设置，会自动生成一对 Ed25519 密钥，
公钥自动加入 trust store。生产模式（staging/production）必须
预填 trust file，否则无法启动。

## 环境变量

| Env | 默认 | 行为 |
|---|---|---|
| `QZDA_REQUIRE_SKILL_SIGNATURE` | `enabled` | 是否强制签名 verify |
| `QZDA_BAN_DEV_KEYPAIR` | `0` | 强制 prod 启动时禁止生成 dev keypair |
| `QZDA_TRUSTED_PUBLISHERS_PATH` | `data/skill-keys/trusted-publishers.json` | trust store 路径 |
| `QZDA_DEV_KEYPAIR_PATH` | `data/skill-keys/dev-keypair.json` | dev keypair 路径 |
| `QZDA_SANDBOX_VETTER` | `enabled` | vetter 闸门（`enabled` / `warn_only` / `disabled`） |

## 错误码

| Code | 触发 |
|---|---|
| `E_SKILL_VET_DENIED` | vetter 命中危险模式 |
| `E_SKILL_VET_INVALID` | vetter 自身出错 |
| `E_SKILL_SIGNATURE_INVALID` | 签名验证不通过（篡改 / 错 key） |
| `E_SKILL_SIGNATURE_MISSING` | 包没带签名 |
| `E_SKILL_SIGNATURE_UNKNOWN_KEY` | KeyID 不在 trust store |

签名失败会写入 `audit.events`：
- builtin 装载：`actor=系统 action=skill 签名验证`
- 用户导入：`actor=<user> action=skill 签名验证`

## 篡改检测

```bash
# 改一个 builtin 文件
echo "" >> services/qzda-sandbox/builtin/skills/docx/scripts/extract.sh

# 校验立刻报失败
go run ./cmd/verify-skill --manifest services/qzda-sandbox/builtin/skills/manifest.json services/qzda-sandbox/builtin/skills/docx
# FAIL docx: ed25519 verify: signing: signature mismatch
# exit status 1
```

## 不在 W1 范围内（W2+）

- ~~Workspace 用户的 skill 签名（独立 publisher workspace 抽象）~~ → **W2-D1 已完成**，见下文
- Vault 集成（dev keypair 用本地文件，prod 走 Vault KV-v2）
- 时间戳（TSA）防"先签后 revoke"窗口
- 多签 quorum（多发布者联签）

---

# W2-D1：Workspace Publisher 签名（per-workspace keypair + sidecar 解析）

> W1-D2 的签名路径只覆盖 builtin / dev keypair；W2-D1 起，每个
> workspace 拥有自己的 Ed25519 publisher keypair，user 上传的
> `.skill` 包必须用 **该 workspace 当前 active** 的 key 签名。

## 新增的角色 / 工具

| 角色 | 工具 | 何时用 |
|---|---|---|
| Workspace admin | `POST /api/workspaces/<ws>/publisher-key` | 首次为工作区生成 publisher keypair（私钥一次性返回） |
| Workspace admin | `POST /api/workspaces/<ws>/publisher-key/rotate` | 轮换（旧 key 进入 grace，签过的包仍可验） |
| Workspace admin | `DELETE /api/workspaces/<ws>/publisher-key` | 撤销（旧 key 立即失效） |
| Workspace admin | `GET /api/workspaces/<ws>/publisher-key` | 查询当前 active + rotated 历史 |
| Skill 发布者（user） | `cmd/sign-skill-pack` | 把 `.skill` archive 用 workspace private key 签出带 `.skillpkg.signature.json` 的版本 |
| Server | `parseSkillPackage` | import 时解 sidecar，把签名字段填进 manifest |
| Server | `resolvePublisherKey` | 验签时按 KeyID 在 workspace active / rotated / global / dev-auto 顺序查找 |

## 端到端流程

```bash
# 0. 登录拿 token（admin）
TOKEN=$(curl -sf -X POST http://127.0.0.1:8089/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@acme.com","password":"x"}' | jq -r .data.token)

# 1. 生成 workspace w1 的 publisher keypair（私钥一次性返回）
curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"mode":"generate","name":"W1 publisher"}' \
  http://127.0.0.1:8089/api/workspaces/w1/publisher-key | tee /tmp/wp.json
# → 响应含 privateKey（base64 64B），server 不保留
PRIV=$(jq -r .privateKey /tmp/wp.json)
KEYID=$(jq -r .keyId   /tmp/wp.json)

# 2. 准备 .skill 包（含 SKILL.md）
mkdir -p /tmp/foo-skill
cat > /tmp/foo-skill/SKILL.md <<'EOF'
---
name: foo-skill
description: end-to-end W2-D1 test
version: 0.1.0
risk: low
---
body
EOF
(cd /tmp/foo-skill && zip -r /tmp/foo.skill .)   # 注意：签名 CLI 期望 zip

# 3. 用 workspace 私钥签出带 sidecar 的版本
QZDA_SIGNER_PRIVATE_KEY=$PRIV go run ./cmd/sign-skill-pack \
  --archive /tmp/foo.skill \
  --workspace w1 \
  --server http://127.0.0.1:8089 \
  --auth-token "Bearer $TOKEN"
# → 写 /tmp/foo.skill.signed.skill，zip 内多出一个
#   <root>/.skillpkg.signature.json，{ keyId, signature, signedAt, signerName }

# 4. 上传 signed 包，server 自动解析 sidecar → 验签 → 写入 audit
SIGNED=$(ls /tmp/foo.skill.signed.skill)
curl -sf -X POST -H "Authorization: Bearer $TOKEN" \
  -F "file=@$SIGNED" \
  http://127.0.0.1:8089/api/skills/import-package
# → HTTP 200；response.data.publisherKeyId == $KEYID
# → response.data.signatureTrust == "workspace"
# → audit.events 写入 actor=<user> action='skill 签名验证' result=success
```

## Sidecar 格式

`<package-root>/.skillpkg.signature.json`：

```json
{
  "keyId": "ed25519:9a5c62d02dc4a7f1",
  "signature": "BASE64_64B",
  "signedAt": "2026-09-07T12:34:56Z",
  "signerName": "Acme Workspace 1 Publisher"
}
```

`shouldSkipSkillPackagePath` 显式 allowlist 这个文件名（不被
dotfile 短路规则过滤）；`materializeSkillPackage` 在落盘前额外
skip 一次（sidecar 只用于 verify，不复制到 workspace）。

## 信任解析优先级（`resolvePublisherKey`）

| 顺序 | 来源 | 适用模式 |
|---|---|---|
| 1 | workspace 当前 `status=active` 的 publisher key | `PolicyAny` / `PolicyWorkspace` |
| 2 | workspace 历史 `status=rotated` 的 key（rotate grace 窗口） | `PolicyAny` / `PolicyWorkspace` |
| 3 | global trust store（builtin publisher + dev key） | `PolicyAny` only |
| 4 | dev mode auto-provision key | `PolicyAny` only |
| — | `PolicyWorkspace` 命中 step 3/4 → `SkillSignatureUnknownKey` + audit `non_workspace_publisher` | 拒绝 |

## 环境变量扩展

| Env | 值 | 含义 |
|---|---|---|
| `QZDA_REQUIRE_SKILL_SIGNATURE` | `off` / `disabled` / 空 | dev 默认；不验签 |
| 同上 | `enabled` / `any` | 任意 trust store 来源均接受 |
| 同上 | `workspace` / `strict` | 必须 workspace publisher；global / dev-auto 拒绝 |
| 同上 | `builtin_only` | 当前等同 `any`（未来会分离） |

## CLI：`cmd/sign-skill-pack` vs `cmd/sign-skill`

| | `sign-skill` | `sign-skill-pack` |
|---|---|---|
| 输入 | skill 目录 | `.skill` zip archive |
| 输出 | 更新 `services/qzda-sandbox/builtin/skills/manifest.json` | `<archive>.signed.skill`（含 sidecar） |
| 私钥来源 | `--key data/skill-keys/dev-keypair.json` | `QZDA_SIGNER_PRIVATE_KEY` env（base64） |
| 用途 | builtin pack 作者 | workspace 用户 / 第三方 publisher |

两者职责清晰，互不替代。

## 13 个测试（`make skill-gate` 包含）

| 测试 | 文件 | 验证 |
|---|---|---|
| `TestParseSkillPackageReadsSignatureSidecar` | `internal/server/skill_package_test.go` | 带 sidecar → `meta.Signature/KeyID/SignedAt/SignerName` 填 |
| `TestParseSkillPackageAcceptsMissingSidecar` | 同上 | 未签名包不被拒（向后兼容） |
| `TestParseSkillPackageIgnoresMalformedSidecar` | 同上 | sidecar JSON 损坏不阻断，签名字段空 |
| `TestShouldSkipSkillPackagePathAllowsSignatureSidecar` | 同上 | sidecar 不被 dotfile skip |
| `TestPublisherKeySnapshotHydrate` | `internal/store/publisher_key_test.go` | store roundtrip（active + rotated 都保留） |
| `TestCreatePublisherKeyGenerateMode` | `handlers_workspaces_publisher_test.go` | generate 响应含 privateKey，store 只有 pubkey |
| `TestCreatePublisherKeyRegisterMode` | 同上 | register 模式 + 外部 pubkey |
| `TestCreatePublisherKeyRejectsDuplicateActive` | 同上 | 已存在 active → 拒 |
| `TestRotatePublisherKeyPreservesOldKeyInGrace` | 同上 | rotate 后旧 keyId 仍可验 |
| `TestRevokePublisherKeyRejectsOldKey` | 同上 | revoke 后立即拒 |
| `TestGetPublisherKeyOmitsPrivateKey` | 同上 | GET 不返 privateKey |
| `TestCrossWorkspacePublisherKeyAccessDenied` | 同上 | 跨 ws 访问 403 |
| `TestAuditWrittenOnPublisherKeyMutation` | 同上 | audit 行齐全 |
| `TestImportRevokedWorkspaceKeyDenied` | `handlers_workspaces_publisher_test.go` | revoke 后用旧 key 签 → SkillSignatureUnknownKey |
| `TestImportUnsignedDeniedUnderWorkspacePolicy` | 同上 | PolicyWorkspace 下 unsigned 拒 |
| `TestImportActiveWorkspaceKeySucceeds` | 同上 | active key 签 → success |
| `TestImportRotatedWorkspaceKeySucceedsInGrace` | 同上 | rotated key 签 → 仍可 import |
| `TestSignSkillPackArchiveRoundtrip` | `cmd/sign-skill-pack/main_test.go` | zip → CLI → 服务端验签通过 |
| `TestSignSkillPackPreservesFiles` | 同上 | 签后 zip 内容 + sidecar 齐全 |
| `TestSignSkillPackRefusesOverwriteWithoutForce` | 同上 | 不带 `--force` 不覆盖 |
| `TestSignSkillPackForceOverwrites` | 同上 | `--force` 覆盖 |
| `TestSignSkillPackStripsPreviousSidecarBeforeSigning` | 同上 | 重签时旧 sidecar 不污染新 digest |
| `TestSignSkillPackRejectsArchiveWithoutSkillMD` | 同上 | 无 SKILL.md → 拒 |
| `TestParseFrontmatterMeta*` (3 tests) | 同上 | frontmatter 解析 |
| `TestExtractZipRawSkipsDirectoriesAndLocatesSkillMD` | 同上 | extract 行为 |

## 回退路径

```bash
# 切回 W1-D2 行为（任意 trust store 来源 + 不强制 workspace）
QZDA_REQUIRE_SKILL_SIGNATURE=any go run ./cmd/app
# 或完全关闭 verify（仅 dev）
QZDA_REQUIRE_SKILL_SIGNATURE=off go run ./cmd/app
```

## 已知边界 / 不做

- 不做 Vault / KMS 集成；prod 模式下 generate 的私钥**一次性**返回后丢弃，operator 必须自己存好。
- 不做时间戳（TSA）；operator 在 rotate / revoke 之后到 grace 期结束前的窗口内仍可签发。
- 不做跨 workspace 共享 publisher key。
- 不自动 claim 既有未签 skill；切到 `PolicyWorkspace` 后必须重传。
- 不做多签 quorum。