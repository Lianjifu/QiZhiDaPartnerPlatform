# W5 上传规范手册 — Multimodal 多模态

> 状态：实施就绪
> 日期：2026-09-08
> 前置：ADR-033（Multimodal provider 抽象 + 缓存）
> 关系：本手册是 W5-D2 多模态管道的用户 / 运维配套；不写 ADR 决策

## 1. 何时用

`/api/multimodal/extract` 是统一的多模态抽取入口：

| 用途 | Kind | Provider 示例 |
|---|---|---|
| 图片 OCR（截图、扫描件、UI 截图） | `ocr` | Tesseract / 云端 OCR SDK |
| 音频转写（语音消息、会议录音） | `asr` | Whisper / 云端 ASR SDK |
| 视频帧抽取（未来） | `video` | ffmpeg + OCR 组合 |

内部 cache 用 SHA256(content) 做 key，避免重复抽取相同文件。

## 2. 配置

| Env | 默认 | 说明 |
|---|---|---|
| `DE_MULTIMODAL_OCR` | _空_（关闭） | `stub` 启用 OCR stub provider；CI 用 stub 跑集成测试 |
| `DE_MULTIMODAL_ASR` | _空_（关闭） | `stub` 启用 ASR stub provider；同上 |
| `DE_MULTIMODAL_CACHE_DIR` | _空_（内存缓存） | 落盘目录；空 = 内存 map（重启即丢） |

启动时 stub provider 会写日志：

```
multimodal: cache dir=data/multimodal
multimodal: OCR provider=stub (no real extraction)
multimodal: ASR provider=stub (no real extraction)
```

## 3. 路由

| 路由 | 用途 | 权限 |
|---|---|---|
| `POST /api/multimodal/extract` | body: `multipart/form-data {file, kind}` → `{text, segments, meta, provider, cached, latencyMS}` | auth required |

错误码：
- `400 invalid_kind` — kind 不在白名单
- `400 missing_file` — file 字段空
- `501 no_provider` — Kind 对应 Provider 没注册（DE_MULTIMODAL_OCR/ASR 未启用）
- `503 provider_unavailable` — Provider `Available()` 返回 false
- `500 extract_failed` — Provider.Extract 抛错

权限：需要 `access.write`（不是仅 auth）。

## 4. 上传规范

### 4.1 内容要求

| 维度 | OCR | ASR |
|---|---|---|
| 格式 | PNG / JPEG / WebP / TIFF / BMP | WAV / MP3 / OGG / M4A / WebM |
| 最大尺寸 | 20 MB（hard cap in handler，目前不抽 env） | 20 MB |
| 分辨率 / 采样率 | 推荐 ≤ 4096×4096 | 推荐 ≤ 48 kHz / 16-bit |
| 时长 | — | 推荐 ≤ 10 分钟 |

### 4.2 调用样例

```bash
TOKEN=$(curl -sf -X POST http://127.0.0.1:8089/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@acme.com","password":"x"}' | jq -r .data.token)

# 1) OCR
curl -sf -X POST -H "Authorization: Bearer $TOKEN" \
  -F file=@tests/fixtures/multimodal/receipt.png \
  -F kind=ocr \
  http://127.0.0.1:8089/api/multimodal/extract | jq .data
# → { "text": "stub ocr: <base64>", "provider": "ocr-stub", "cached": false, "latencyMS": 3 }

# 2) ASR
curl -sf -X POST -H "Authorization: Bearer $TOKEN" \
  -F file=@tests/fixtures/multimodal/clip.wav \
  -F kind=asr \
  http://127.0.0.1:8089/api/multimodal/extract | jq .data

# 3) 第二次同文件 → cached=true
curl -sf -X POST -H "Authorization: Bearer $TOKEN" \
  -F file=@tests/fixtures/multimodal/receipt.png \
  -F kind=ocr \
  http://127.0.0.1:8089/api/multimodal/extract | jq .data.cached
# → true
```

### 4.3 客户端约束

前端 `features/copilot/composer-media.ts` 已经做了：
- `isOverCap(8 MB)` — 在 composer 阶段就拒绝 8 MB+ 文件
- `pickSupportedAudioMime()` — 自动选浏览器支持的 mime（webm/ogg/mp4）
- `captureAudio/captureImage` — mic / 摄像头采集后 `<8 MB` 才入队

服务端侧 20 MB 上限是 **hard cap**（handler `io.LimitReader` + `r.ParseMultipartForm(20 << 20)`）；客户端 8 MB 是 **soft cap**（UX 防抖）。

## 5. 现象对照

| 现象 | 可能原因 | 怎么查 |
|---|---|---|
| `501 no_provider` | `DE_MULTIMODAL_OCR` / `ASR` 没设 | 启动 log；env 在 systemd unit / docker compose 里 |
| `503 provider_unavailable` | Provider 自检失败（如 Tesseract 二进制缺失） | 检查 `Provider.Available()` 实现；外部依赖版本 |
| `413 too_large` | 文件超过 20 MB hard cap（handler 内 `io.LimitReader`） | 调小文件；后续 W6-P2 计划抽 env flag |
| 第二次同文件还是 `cached:false` | 缓存目录权限 / 写失败 | 看 log；`DE_MULTIMODAL_CACHE_DIR` 路径 |
| 落盘后进程重启，缓存还在 | `DE_MULTIMODAL_CACHE_DIR` 有效 | 检查目录内容；`{sha256}.json` |
| stub 返回内容很奇怪 | stub 是 echo 输入；非真 OCR | 接真 provider（`DE_MULTIMODAL_OCR=tesseract` 等） |

## 6. 接入真 Provider

### 6.1 实现 Provider 接口

```go
// internal/multimodal/multimodal.go
type Provider interface {
    Name() string
    Kind() Kind
    Available() bool
    Extract(ctx context.Context, input []byte, mime string) (Extraction, error)
}
```

### 6.2 注册

```go
// internal/server/handlers_multimodal.go initMultimodal()
if modeOCR == "tesseract" {
    r.Register(&tesseractProvider{binPath: "/usr/bin/tesseract"})
}
```

### 6.3 自检

`Available()` 必须返回真；启动时会调用一次决定 503 vs 501。
Provider 实现里要确保首次启动时即检查外部依赖版本（Tesseract / Whisper 二进制 / SDK 鉴权）。

## 7. 端到端 smoke（CI 路径）

CI 默认开 `DE_MULTIMODAL_OCR=stub` + `DE_MULTIMODAL_ASR=stub`，跑：

```bash
DE_MULTIMODAL_OCR=stub DE_MULTIMODAL_ASR=stub ./qzda-app -mode app &

curl -sf -X POST -H "Authorization: Bearer mock-admin-token" \
  -F file=@tests/fixtures/multimodal/receipt.png \
  -F kind=ocr \
  http://127.0.0.1:8089/api/multimodal/extract
# → 200 + text 含 "stub ocr"
```

## 8. 已知边界

- **缓存粒度** — SHA256(content) 是唯一 key；不同 mime 但同字节仍命中（通常无害）
- **跨 workspace** — 缓存全局共享；workspace 隔离由调用方按需另加
- **多 Provider** — 同 Kind 只能注册一个；后注册覆盖前一个
- **进程重启** — 内存缓存丢失；磁盘缓存保留（`DE_MULTIMODAL_CACHE_DIR` 路径）
- **大小写 mime** — Provider 收到的 mime 来自 multipart form header，caller 需自己归一
- **stub 不读内容** — 只是 echo `<base64>`；真实可用性必须接真 provider 才验证
- **janitor** — 默认每小时扫一次；TTL 由 Provider 实现决定；当前 stub 永不过期

---

## 9. 相关路由 / 手册索引

- `internal/multimodal/` — Provider 接口 + Registry + 缓存
- `internal/server/handlers_multimodal.go` — 路由 + initMultimodal + stub provider
- `frontend/web/src/features/copilot/composer-media.ts` — 客户端采集 + 8 MB cap
- 手册-W2 §4 vault 部分（如果接入云端 OCR / ASR 凭据管理）