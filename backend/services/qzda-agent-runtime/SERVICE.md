# qzda-agent-runtime

FastAPI agent runtime on port **8091**.

## Endpoints

- `GET /healthz` — `{status, service: agent-runtime, mode}`
- `POST /v1/invoke` — `{output, graph, nodes, provider}`（单次补全；无 LLM 且未开 stub 时 HTTP 503 + `E_RUNTIME_UNAVAILABLE`）
- `POST /v1/run` — `text/event-stream` LoopEvent（`stage` / `delta` / `done`）。请求体对齐 `RunRequest`：`input`、`envelope`、`snapshot`、`enabledTools`、`modelId`。无 LLM 且未开 stub 时 HTTP 503 + `E_RUNTIME_UNAVAILABLE`

Collab 通过 `DE_RUNTIME_MODE=remote` 调用 `/v1/run`。默认 **`local`** 使用进程内 Go Harness（生产真相源）。Python sidecar 会对 `knowledge.retrieve` 调 `DE_RAG_URL/v1/retrieve`，`memory.recall` 读 snapshot.memoryProvenance；其余工具标 skipped。契约测试通过不等于生产切 remote。

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `DE_BIND_HOST` | `127.0.0.1` | Bind address |
| `DE_BIND_PORT` | `8091` | Bind port |
| `DE_LLM_BASE_URL` | — | OpenAI-compatible base URL |
| `DE_LLM_API_KEY` | — | API key |
| `DE_LLM_MODEL` | `gpt-4o-mini` | Model name |
| `DE_LLM_TIMEOUT` | `20` | Request timeout (seconds) |
| `DE_ALLOW_RUNTIME_STUB` | — | 仅非生产联调：无 LLM 时返回 stub 文本。生产必须配置 `DE_LLM_BASE_URL` |
| `DE_RAG_URL` | `http://127.0.0.1:8092` | sidecar `knowledge.retrieve` 调用的 published retrieve |

Go 控制面：

| Variable | Default | Description |
|----------|---------|-------------|
| `DE_RUNTIME_MODE` | `local` | `local` 进程内 Harness；`remote`/`sidecar`/`python` 调本服务 `/v1/run` |
| `DE_AGENT_RUNTIME_URL` | `http://127.0.0.1:8091` | sidecar 基址 |
| `DE_RUNTIME_FAILOVER_LOCAL` | — | `true` 时 remote 失败回落 local；**生产信号下无效** |

## Run locally

```bash
cd backend
pip install -r services/qzda-agent-runtime/requirements.txt
python3 runtimes/de_agent_runtime/main.py
# or
cd services/qzda-agent-runtime && uvicorn app.main:app --host 127.0.0.1 --port 8091
```

## Docker

```bash
docker build -t qzda-agent-runtime:local backend/services/qzda-agent-runtime
docker run -p 8091:8091 qzda-agent-runtime:local
```
