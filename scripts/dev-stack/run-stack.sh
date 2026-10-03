#!/bin/bash
# Keep local FE+BE up for 企智搭 · 数字伙伴平台 (QiZhiDa · PartnerPlatform) (real API + PG/Redis; no frontend mock).
# Defaults: DE_ENV=development, DE_BAN_MOCK_TOKEN=1. See docs/环境与数据模式.md.
set -u
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/Users/LIANJIFU/ops/QiZhiDaPartnerPlatform/backend/.tools/go/bin:$PATH"
ROOT="/Users/LIANJIFU/ops/QiZhiDaPartnerPlatform"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
GATEWAY_COARSE="$ROOT/scripts/dev-stack/gateway-proxy.py"
GATEWAY_MONOLITH="$ROOT/scripts/dev-stack/gateway-proxy-monolith.py"
LOGDIR="/tmp/qzda-stack"
DE_STACK="${DE_STACK:-monolith}"
mkdir -p "$LOGDIR"
cd "$BACKEND" || exit 1

# Real control-plane env (PG/Redis/LLM keys live in deploy/.env — never commit secrets).
if [ -f "$BACKEND/deploy/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$BACKEND/deploy/.env"
  set +a
fi
export DE_ENV="${DE_ENV:-development}"
export DE_BAN_MOCK_TOKEN="${DE_BAN_MOCK_TOKEN:-1}"
export DE_BAN_DEMO_TOKEN="${DE_BAN_DEMO_TOKEN:-$DE_BAN_MOCK_TOKEN}"
export DE_ALLOW_PASSWORD_LOGIN="${DE_ALLOW_PASSWORD_LOGIN:-1}"
export DE_ALLOW_MOCK_IDENTITY="${DE_ALLOW_MOCK_IDENTITY:-0}"
export DE_ALLOW_RUNTIME_STUB="${DE_ALLOW_RUNTIME_STUB:-0}"
export DE_MODEL_DISCOVER_FALLBACK="${DE_MODEL_DISCOVER_FALLBACK:-0}"
export DE_EMBEDDED_CHAT="${DE_EMBEDDED_CHAT:-0}"
export DE_DATABASE_URL="${DE_DATABASE_URL:-postgres://de:de@127.0.0.1:5432/digital_employee?sslmode=disable}"
# Postgres must be Docker (qzda-postgres). Homebrew postgresql@N on :5432 steals host connections.
if ! bash "$ROOT/scripts/dev-stack/ensure-docker-postgres.sh"; then
  echo "$(date '+%F %T') ensure-docker-postgres failed" >>"$LOGDIR/keeper.log"
  exit 1
fi
# Redis optional for local: only set when 6379 is listening (Docker Compose redis).
if /usr/sbin/lsof -nP -iTCP:6379 -sTCP:LISTEN >/dev/null 2>&1; then
  export DE_REDIS_URL='redis://127.0.0.1:6379/0'
else
  unset DE_REDIS_URL 2>/dev/null || true
  echo "$(date '+%F %T') warn: redis :6379 not listening; starting without DE_REDIS_URL" >>"$LOGDIR/keeper.log"
fi
export DE_PUBLIC_BASE_URL='http://127.0.0.1:8089'
SKILL_BIN="$BACKEND/builtin/skills/runtime/bin"
export DE_BUILTIN_SKILL_BIN="$SKILL_BIN"
export PATH="$SKILL_BIN:$PATH"
export DE_MODEL_CANDIDATE_TIMEOUT="${DE_MODEL_CANDIDATE_TIMEOUT:-45}"
export DE_COPILOT_STREAM_TIMEOUT="${DE_COPILOT_STREAM_TIMEOUT:-300}"

listening() { /usr/sbin/lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

start_one() {
  local port="$1" name="$2"; shift 2
  if listening "$port"; then return 0; fi
  echo "$(date '+%F %T') start $name :$port" >>"$LOGDIR/keeper.log"
  nohup "$@" >>"$LOGDIR/${name}.log" 2>&1 </dev/null &
  echo $! >"$LOGDIR/${name}.pid"
  sleep 0.5
}

start_vite() {
  if listening 5173; then return 0; fi
  # reclaim drifted ports
  for p in 5174 5175; do
    /usr/sbin/lsof -tiTCP:$p -sTCP:LISTEN 2>/dev/null | while read pid; do kill -9 "$pid" 2>/dev/null || true; done
  done
  echo "$(date '+%F %T') start de-web :5173" >>"$LOGDIR/keeper.log"
  (
    cd "$FRONTEND/web" || exit 1
    nohup ./node_modules/.bin/vite --host 127.0.0.1 --port 5173 --strictPort >>"$LOGDIR/de-web.log" 2>&1 </dev/null &
    echo $! >"$LOGDIR/de-web.pid"
  )
  sleep 1
}

echo "$(date '+%F %T') keeper boot pid=$$ stack=$DE_STACK" >>"$LOGDIR/keeper.log"
if [ ! -x "$BACKEND/bin/qzda-app" ] || [ ! -x "$BACKEND/bin/qzda-sys" ]; then
  echo "$(date '+%F %T') building backend binaries..." >>"$LOGDIR/keeper.log"
  (cd "$BACKEND" && make build) >>"$LOGDIR/keeper.log" 2>&1 || true
fi
while true; do
  if [ "$DE_STACK" = "monolith" ]; then
    unset DE_CAP_URL DE_COLLAB_URL DE_POLICY_URL 2>/dev/null || true
    export DE_RUNTIME_MODE=local
    export DE_SANDBOX_RUNTIME_URL="${DE_SANDBOX_RUNTIME_URL:-http://127.0.0.1:8093}"
    export DE_WORKFLOW_URL="${DE_WORKFLOW_URL:-http://127.0.0.1:8103}"
    start_one 8100 qzda-app env DE_RUNTIME_MODE=local DE_SANDBOX_RUNTIME_URL="$DE_SANDBOX_RUNTIME_URL" DE_WORKFLOW_URL="$DE_WORKFLOW_URL" DE_EMBEDDED_CHAT=0 DE_MODEL_CANDIDATE_TIMEOUT=45 DE_COPILOT_STREAM_TIMEOUT=300 DE_BUILTIN_SKILL_BIN="$SKILL_BIN" PATH="$SKILL_BIN:$PATH" "$BACKEND/bin/qzda-app"
    start_one 8093 qzda-skill env DE_SANDBOX_REQUIRE_ISOLATION=0 DE_SANDBOX_ARTIFACT_DIR=/tmp/qzda-stack/artifacts DE_BIND_HOST=127.0.0.1 DE_BIND_PORT=8093 python3 "$BACKEND/services/qzda-sandbox/main.py"
    if [ -n "${DE_WITH_WORKFLOW:-}" ]; then
      start_one 8103 qzda-workflow env DE_WORKFLOW_WORKER=0 DE_WORKFLOW_URL=http://127.0.0.1:8103 "$BACKEND/bin/qzda-workflow"
    fi
    start_one 8089 qzda-gateway python3 "$GATEWAY_MONOLITH"
  else
    export DE_POLICY_URL='http://127.0.0.1:8100'
    export DE_CAP_URL='http://127.0.0.1:8102'
    start_one 8100 qzda-sys "$BACKEND/bin/qzda-sys"
    start_one 8101 qzda-collab env DE_POLICY_URL=http://127.0.0.1:8100 DE_CAP_URL=http://127.0.0.1:8102 DE_EMBEDDED_CHAT=0 DE_MODEL_CANDIDATE_TIMEOUT=45 DE_COPILOT_STREAM_TIMEOUT=300 DE_BUILTIN_SKILL_BIN="$SKILL_BIN" PATH="$SKILL_BIN:$PATH" "$BACKEND/bin/qzda-collab"
    start_one 8102 qzda-cap env DE_POLICY_URL=http://127.0.0.1:8100 DE_PUBLIC_BASE_URL=http://127.0.0.1:8089 DE_EMBEDDED_CHAT=0 DE_MODEL_CANDIDATE_TIMEOUT=45 DE_COPILOT_STREAM_TIMEOUT=300 DE_BUILTIN_SKILL_BIN="$SKILL_BIN" PATH="$SKILL_BIN:$PATH" "$BACKEND/bin/qzda-cap"
    start_one 8103 qzda-workflow env DE_WORKFLOW_WORKER=0 "$BACKEND/bin/qzda-workflow"
    start_one 8091 qzda-agent python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8091 --app-dir "$BACKEND/services/qzda-agent-runtime"
    start_one 8093 qzda-skill env DE_SANDBOX_REQUIRE_ISOLATION=0 DE_SANDBOX_ARTIFACT_DIR=/tmp/qzda-stack/artifacts DE_BIND_HOST=127.0.0.1 DE_BIND_PORT=8093 python3 "$BACKEND/services/qzda-sandbox/main.py"
    start_one 8089 qzda-gateway python3 "$GATEWAY_COARSE"
  fi
  start_vite
  sleep 5
done
