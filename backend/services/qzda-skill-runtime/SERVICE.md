# qzda-skill-runtime

FastAPI skill sandbox on port **8093**. **Monolith 与 coarse 均必须独立部署**（不可并入 qzda-app）。RunToken HMAC verification and package script execution.

## Endpoints

- `GET /healthz` — sandbox status and isolation probe
- `POST /v1/execute` — execute skill with RunToken

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `DE_BIND_HOST` | `127.0.0.1` | Bind address |
| `DE_BIND_PORT` | `8093` | Bind port |
| `DE_SKILL_RUN_SECRET` | `qzda-skill-run-dev` | HMAC secret for RunToken |
| `DE_SKILL_SANDBOX` | `gvisor-local` | Sandbox mode |
| `DE_SKILL_REQUIRE_ISOLATION` | `0` (local) / `1` (Docker) | Reject if control-plane reachable |

On startup, control-plane DSN env vars (`DE_DATABASE_URL`, etc.) are stripped.

## Run locally

```bash
cd backend
pip install -r services/qzda-skill-runtime/requirements.txt
python3 runtimes/de_skill_runtime/main.py
# or
cd services/qzda-skill-runtime && uvicorn app.main:app --host 127.0.0.1 --port 8093
```

## Docker

```bash
docker build -t qzda-skill-runtime:local backend/services/qzda-skill-runtime
docker run -p 8093:8093 -e DE_SKILL_REQUIRE_ISOLATION=1 qzda-skill-runtime:local
```

Compose (`deploy/compose.yml`) builds from `services/qzda-skill-runtime/Dockerfile`.
