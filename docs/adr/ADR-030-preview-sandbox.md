# ADR-030 — Preview sandbox 语义（iframe 同源 / CSP / inline `?inline=1`）

- 状态：已接受
- 日期：2026-09-08
- 替代：[W1-W7-改进方案-todo.md §3 W3-D3](../../docs/W1-W7-改进方案-todo.md) 的"iframe sandbox + DOMPurify 同源代理"占位

## 1. 上下文

Skill 产物（docx / pptx / xlsx / pdf / 原图）目前通过三条 handler 暴露：

- `GET /api/skill-artifacts/<name>` — 原始下载（`Content-Disposition: attachment`）
- `GET /api/skill-artifacts/<name>/preview` — JSON envelope（脱敏后渲染进 SPA）
- `GET /api/skill-artifacts/<name>/slides/<n>.png` — pptx 幻灯片光栅图

历史事实：W1-D3 gateway 硬墙（ADR-019）将它们接到了统一闸门（path traversal / size cap / MIME 白名单 / auth / audit）。但因为产物永远是 `attachment`，浏览器实际不会把它放进 iframe —— 攻击面只到"诱骗用户下载"，尚可接受。

接下来 6 周要补的两件事改变了威胁模型：

1. **前端 FE-3 / W5 document-preview** 已经具备 inline 渲染能力（`document-preview.tsx` 654 行）；用户要求"打开即看"而不是"先下载再打开"。
2. **W4-D2 VisualDiff** 和 **W6-D2 Canvas** 都要把产物图塞进 iframe / canvas —— 一旦产出走 `<img>` / `<iframe>` 路径，浏览器会按 HTML / 图片解析，恶意内容就能跑。

需要重新定义"安全地内嵌一个产物"，不能等 W4-D2 出问题再补。

## 2. 决策

`W3-D3` 落地一组**最小、最保守**的响应头 + 一个可选 inline 模式，覆盖三条 handler 的成功路径：

| 头 | 值 | 用途 |
|---|---|---|
| `X-Frame-Options` | `SAMEORIGIN` | 拒绝跨源 iframe 嵌入 |
| `Content-Security-Policy` | `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'self'; base-uri 'self'` | 限定资源来源；允许 inline style 因前端 SSE 富文本需要；禁 `<base>` 劫持 |
| `X-Content-Type-Options` | `nosniff` | 禁止浏览器猜 MIME，杜绝 `.docx` 被认成 `text/html` |
| `Referrer-Policy` | `no-referrer` | 不向外泄露 URL（含 query） |
| `Cache-Control` | `private, max-age=0, no-store`（attachment）<br>`private, max-age=3600`（slide PNG） | 不让 CDN 缓存产物；slide 图允许 1h 私缓存 |

并引入查询参数 `?inline=1|true|yes`：

- 命中：handler 把 `Content-Disposition` 从 `attachment` 翻成 `inline; filename=…`（保留 `Save-As` 友好）
- 未命中：保持原 `attachment` 行为不变
- 不是 boolean 严格解析（`=0` / 空 → attachment），避免被人误传后"以为安全实际下载"

不在本 ADR 范围内：

- DOMPurify 后端代理（计划文档里提过，但前端 `document-preview.tsx` 渲染的是受控 JSON envelope，**不是**用户原始 HTML，sanitize 在前端用受信任渲染即可；后端代理多一跳无收益）
- rate limit / per-IP throttle（属于 W4 / W6 范畴）
- Vault 凭据下载（属于 W2-D2，独立 ADR-021）

## 3. 取舍

| 选项 | 优 | 劣 | 选 |
|---|---|---|---|
| A. 不改（始终 attachment） | 零攻击面 | 用户体验差；VisualDiff / Canvas 无法嵌入 | ✗ |
| B. 全部 inline + 全套 CSP | 用户体验最好 | 任何 IE11 / 老旧前端框架卡住（`frame-ancestors`） | ✗ |
| C. 默认 attachment + `?inline=1` opt-in（本文） | 用户能选；风险自承担 | 多一个 query 字段 | ✓ |

CSP 里保留 `'unsafe-inline'` 仅对 `style-src` —— 前端 React 内联样式 + 三方 library 的 `<style>` 注入仍然必要；`script-src` 严格 `'self'`（实际未在本响应里执行 JS，未来若加 embed JS 必须单独立 ADR）。

## 4. 实现

| 文件 | 角色 |
|---|---|
| `backend/internal/server/preview_sandbox.go` | 4 个 helper：`previewSandboxHeaders` / `writePreviewSandboxHeaders` / `wantInline` / `inlineContentDisposition` |
| `backend/internal/server/skill_artifacts.go` | `serveSkillArtifact` + `writeJSON` 共用 sandbox headers；attachment → inline 翻转 |
| `backend/internal/server/skill_artifacts_pptx_preview.go` | `serveSkillArtifactSlidePNG` 加 sandbox headers + 1h cache |
| `backend/internal/server/preview_sandbox_test.go` | 4 个回归测试（不在错误路径泄漏头 / 不在 inline query panic / 200 路径仍可达） |

`error` envelope（`writeErr` / `writeJSON` 的 4xx 路径）**故意不**挂 sandbox headers —— 不告诉攻击者这条路径是 gated 的。`serveSkillArtifact` / `serveSkillArtifactPreview` / `serveSkillArtifactSlidePNG` 在写 200 之前调用 `writePreviewSandboxHeaders(w)`，失败分支直接走 error envelope。

## 5. 后续

- W4-D2 VisualDiff 落地时复用本组 header，并扩展 `Cache-Control` 为差异图自定义 TTL。
- W6-D2 Canvas 若把 artifact iframe 进协作画布，需在 CSP 加 `frame-src 'self' https://<canvas-host>`（目前同一 host，无需改）。
- 若未来允许跨 workspace 协作（artifact 共享），需将 `frame-ancestors` 升级为 `frame-ancestors 'self' https://*.qzda-platform.com` —— 等需求出现再立 ADR。

## 6. 回退

3 个 handler 都是 `additive`（先调用 helper，再原有逻辑）；失败不会改 200 → 4xx 的状态码语义。可逐 handler revert。