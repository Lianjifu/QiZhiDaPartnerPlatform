# qzda-agent-runtime

Python FastAPI 实现的 agent 运行时 sidecar,默认监听 `127.0.0.1:8091`,为 Go 控制面 [qzda-app](../../) 提供 OpenAI 兼容 LLM 调用与 **LoopEvent(SSE)** 流式执行能力。

> 运维/集成细节(端口、环境变量完整表、启动命令)见同目录的 [SERVICE.md](SERVICE.md)。

---

## 在整个系统里的位置

```
┌──────────────────────┐
│ qzda-app (Go)        │   生产真相源:Harness / Workflow / 工具执行
│ QZDA_RUNTIME_MODE    │
│  = local  ──► 进程内 │
│  = remote ──► ↓      │
└──────────┬───────────┘
           │  HTTP
           ▼
┌──────────────────────┐    ┌─────────────────┐
│ qzda-agent-runtime   │───►│ OpenAI-compat   │
│ (本服务,Python)      │    │ LLM             │
│ /v1/invoke  /v1/run  │    │ (QZDA_LLM_BASE_ │
│ LoopEvent SSE        │    │  URL)           │
│ tool sidecar         │    └─────────────────┘
│                      │    ┌─────────────────┐
│                      │───►│ qzda-rag        │
│                      │    │ /v1/retrieve    │
└──────────────────────┘    └─────────────────┘
```

- `local` 模式下 Go Harness **直接在进程内跑**,不经过本服务。
- `remote` 模式下 Go 把 `/v1/run` 调用转给本服务,由本服务拿 LLM 结果并按 LoopEvent 协议流回。
- 本服务 **不** 替代 Go 的工作流执行,只补两件事:① 提供 OpenAI 兼容的 LLM 入口;② 把工具调用结果组装成 LoopEvent 流。

---

## 提供的能力

| Endpoint | 用途 | 协议 | LLM 失败且未开 stub 时 |
|----------|------|------|------------------------|
| `GET /healthz` (同 `/`) | 健康检查 + 当前模式探测 | JSON | 永远 200 |
| `POST /v1/invoke` | 单次补全,返回一次性 `output` | JSON | `503 E_RUNTIME_UNAVAILABLE` |
| `POST /v1/run` | 一次 agent run 的全流程事件流 | SSE (`text/event-stream`) | `503 E_RUNTIME_UNAVAILABLE` |

### LoopEvent 顺序(与 Go Harness 对齐)

```
stage=running  →  tool 事件 0..N  →  delta 0..M  →  done
```

每条事件以 SSE 帧下发:

```
event: <type>
data: <json>

```

`type` 取自事件自身的 `type` 字段,缺省时回退 `message`。完整字段定义见 [app/main.py](app/main.py) 的 `_sse` 与 [app/loop.py](app/loop.py) 的 `iter_run_events`。

---

## 工具分派(sidecar 的核心职责)

| 工具名 | 实际行为 |
|--------|----------|
| `knowledge.retrieve` | POST `QZDA_RAG_URL/v1/retrieve`,把结果作为 `tool` 事件下发,带 `hits` / `hitCount` / `backend` |
| `memory.recall` | 直接读 `snapshot.memoryProvenance`,不发网络请求,标 `source=snapshot` |
| 其它任何 | 标 `status=skipped`,`reason` 标明 sidecar 只观测注册,真正执行仍由 Go Harness 负责 |

`retrieve` 参数可在测试时被替换为 stub;生产路径上它默认是 [app/tools.py](app/tools.py) 里的 `retrieve_published`。

---

## 目录结构

```
backend/services/qzda-agent-runtime/
├── main.py            # uvicorn 启动入口(镜像 Dockerfile CMD)
├── Dockerfile         # python:3.12-slim,EXPOSE 8091
├── requirements.txt   # fastapi / uvicorn,无其它三方依赖
├── README.md          # 本文件:定位 + 模块导览
├── SERVICE.md         # 运维参考:端口、环境变量、启动命令的完整表
├── app/
│   ├── main.py        # FastAPI 路由 + SSE 帧打包(_sse) + stub 兜底(_allow_stub)
│   ├── llm.py         # OpenAI 兼容客户端 + 提示词拼装 + 文本分片(chunk_text)
│   ├── loop.py        # LoopEvent 序列生成(与 Go Harness 对齐)
│   └── tools.py       # 工具分派 + qzda-rag 客户端(retrieve_published)
└── tests/
    └── test_run.py    # chunk_text / build_run_prompt / tool_loop_events 烟雾测试
```

每个文件的函数级 docstring 都是中文,作为代码层的索引;新读者建议先看 [app/main.py](app/main.py) 摸清端点,再看 [app/loop.py](app/loop.py) 弄清 LoopEvent 形状,最后看 [app/tools.py](app/tools.py) 弄清工具分派规则。

---

## 配置(摘要)

完整表格见 [SERVICE.md](SERVICE.md)。最关键的环境变量:

- `QZDA_LLM_BASE_URL` —— 生产必填,指向 OpenAI 兼容的 chat completions 端点
- `QZDA_MODE=dev`(默认) —— **仅限开发联调**,无 LLM 时返回 stub 文本
- `QZDA_RAG_URL` —— 默认 `http://127.0.0.1:8092`,sidecar 调 [qzda-rag](../qzda-rag/) 用
- `QZDA_LLM_MODEL` / `QZDA_LLM_API_KEY` / `QZDA_LLM_TIMEOUT` —— LLM 调用参数
- `QZDA_BIND_HOST` / `QZDA_BIND_PORT` —— 监听地址,默认 `127.0.0.1:8091`

Go 控制面相关:

- `QZDA_RUNTIME_MODE` —— 默认 `local`;`remote`/`sidecar`/`python` 才会调到本服务
- `QZDA_AGENT_RUNTIME_URL` —— sidecar 基址,默认 `http://127.0.0.1:8091`

---

## 本地运行

```bash
cd backend
pip install -r services/qzda-agent-runtime/requirements.txt
cd services/qzda-agent-runtime && python3 main.py
```

或:

```bash
cd backend/services/qzda-agent-runtime
uvicorn app.main:app --host 127.0.0.1 --port 8091
```

冒烟测试(无须 LLM 即可跑):

```bash
cd backend/services/qzda-agent-runtime
python3 tests/test_run.py
```

Docker:

```bash
docker build -t qzda-agent-runtime:local backend/services/qzda-agent-runtime
docker run -p 8091:8091 qzda-agent-runtime:local
```

---

## 重要约束

- **生产必须配置 `QZDA_LLM_BASE_URL`**。`QZDA_MODE=dev` 时即便不配 LLM 也能起服务,但返回的 `[runtime stub] 已处理:...` **不是** 真实推理结果,只用于联调;`QZDA_MODE=pro` 下无 LLM 直接 503。
- **sidecar 不执行工具**:除 `knowledge.retrieve` / `memory.recall` 外,其它工具一律 `status=skipped`,reason 标明真正执行仍在 Go Harness。契约测试通过 ≠ 远程分发完成。
- **`remote` 模式 ≠ 默认**:Go 控制面默认 `QZDA_RUNTIME_MODE=local`,进程内跑 Harness。要让请求真的走本服务,需要在 Go 侧显式切 `remote`/`sidecar`/`python`,并设 `QZDA_AGENT_RUNTIME_URL`。
- **超时与降级**:`retrieve_published` 默认 3s 超时,失败时返回 `backend=unavailable` 的空结果,不让 LLM 端崩溃;`invoke_openai_compatible` 同样在网络/解析异常时返回 `None`,由上层决定是否走 stub。
