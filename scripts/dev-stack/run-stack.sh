#!/bin/bash
# Keep local FE+BE up for 企智搭 · 数字伙伴平台 (QiZhiDa · PartnerPlatform) (real API + PG/Redis; no frontend mock).
# Defaults: QZDA_ENV=development, QZDA_BAN_MOCK_TOKEN=1. See docs/环境与数据模式.md.
set -u
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/Users/LIANJIFU/ops/QiZhiDaPartnerPlatform/backend/.tools/go/bin:$PATH"
ROOT="/Users/LIANJIFU/ops/QiZhiDaPartnerPlatform"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
GATEWAY_MONOLITH="$BACKEND/services/qzda-gateway/main.py"
LOGDIR="/tmp/qzda-stack"
mkdir -p "$LOGDIR"
cd "$BACKEND" || exit 1

# Real control-plane env (PG/Redis/LLM keys live in deploy/.env — never commit secrets).
if [ -f "$BACKEND/deploy/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$BACKEND/deploy/.env"
  set +a
fi
export QZDA_ENV="${QZDA_ENV:-development}"
export QZDA_BAN_MOCK_TOKEN="${QZDA_BAN_MOCK_TOKEN:-1}"
export QZDA_BAN_DEMO_TOKEN="${QZDA_BAN_DEMO_TOKEN:-$QZDA_BAN_MOCK_TOKEN}"
export QZDA_ALLOW_PASSWORD_LOGIN="${QZDA_ALLOW_PASSWORD_LOGIN:-1}"
export QZDA_ALLOW_MOCK_IDENTITY="${QZDA_ALLOW_MOCK_IDENTITY:-0}"
export QZDA_ALLOW_RUNTIME_STUB="${QZDA_ALLOW_RUNTIME_STUB:-0}"
export QZDA_MODEL_DISCOVER_FALLBACK="${QZDA_MODEL_DISCOVER_FALLBACK:-0}"
export QZDA_EMBEDDED_CHAT="${QZDA_EMBEDDED_CHAT:-0}"
export QZDA_DATABASE_URL="${QZDA_DATABASE_URL:-postgres://de:de@127.0.0.1:5432/digital_employee?sslmode=disable}"
export QZDA_PGVECTOR_URL="${QZDA_PGVECTOR_URL:-$QZDA_DATABASE_URL}"
# Postgres must be Docker (qzda-postgres). Homebrew postgresql@N on :5432 steals host connections.
if ! bash "$ROOT/scripts/dev-stack/ensure-docker-postgres.sh"; then
  echo "$(date '+%F %T') ensure-docker-postgres failed" >>"$LOGDIR/keeper.log"
  exit 1
fi
# Redis optional for local: only set when 6379 is listening (Docker Compose redis).
if /usr/sbin/lsof -nP -iTCP:6379 -sTCP:LISTEN >/dev/null 2>&1; then
  export QZDA_REDIS_URL='redis://127.0.0.1:6379/0'
else
  unset QZDA_REDIS_URL 2>/dev/null || true
  echo "$(date '+%F %T') warn: redis :6379 not listening; starting without QZDA_REDIS_URL" >>"$LOGDIR/keeper.log"
fi
export QZDA_PUBLIC_BASE_URL='http://127.0.0.1:8089'
SKILL_BIN="$BACKEND/builtin/skills/runtime/bin"
export QZDA_BUILTIN_SKILL_BIN="$SKILL_BIN"
export PATH="$SKILL_BIN:$PATH"
export QZDA_MODEL_CANDIDATE_TIMEOUT="${QZDA_MODEL_CANDIDATE_TIMEOUT:-45}"
export QZDA_COPILOT_STREAM_TIMEOUT="${QZDA_COPILOT_STREAM_TIMEOUT:-300}"

# 沙箱 HMAC 密钥:控制面与 qzda-sandbox 必须共用同一份(默认占位
# "qzda-skill-run-dev" 在阶段 4 fail-closed 中被拒)。首次启动生成一次,
# 后续复用同一文件,重启后 RunToken 仍可校验。
SKILL_SECRET_FILE="$LOGDIR/skill-run-secret"
if [ ! -s "$SKILL_SECRET_FILE" ]; then
  umask 077
  head -c 32 /dev/urandom | shasum -a 256 | awk '{print $1}' >"$SKILL_SECRET_FILE"
fi
export QZDA_SANDBOX_RUN_SECRET_FILE="$SKILL_SECRET_FILE"

export PYTHONUNBUFFERED=1

listening() { /usr/sbin/lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

pid_alive() {
  local f="$LOGDIR/${1}.pid"
  [ -s "$f" ] || return 1
  kill -0 "$(cat "$f")" 2>/dev/null
}

reclaim_port() {
  local port="$1"
  local pids
  pids=$(/usr/sbin/lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  [ -n "$pids" ] || return 0
  echo "$(date '+%F %T') reclaim :$port pids=$pids" >>"$LOGDIR/keeper.log"
  # shellcheck disable=SC2086
  kill -TERM $pids 2>/dev/null || true
  sleep 1
  # shellcheck disable=SC2086
  kill -KILL $pids 2>/dev/null || true
}

start_one() {
  local port="$1" name="$2"; shift 2
  if pid_alive "$name" && listening "$port"; then
    return 0
  fi
  if pid_alive "$name"; then
    echo "$(date '+%F %T') $name pid alive but :$port not listening; restart" >>"$LOGDIR/keeper.log"
    kill -TERM "$(cat "$LOGDIR/${name}.pid")" 2>/dev/null || true
    sleep 1
  fi
  if listening "$port"; then
    return 0
  fi
  echo "$(date '+%F %T') start $name :$port" >>"$LOGDIR/keeper.log"
  nohup env PYTHONUNBUFFERED=1 "$@" >>"$LOGDIR/${name}.log" 2>&1 </dev/null &
  echo $! >"$LOGDIR/${name}.pid"
  local i
  for i in 1 2 3 4 5 6 7 8; do
    if listening "$port"; then
      return 0
    fi
    sleep 0.4
  done
  echo "$(date '+%F %T') $name failed to bind :$port (see $LOGDIR/${name}.log)" >>"$LOGDIR/keeper.log"
}

start_vite() {
  if pid_alive de-web && listening 5173; then return 0; fi
  for p in 5174 5175; do
    /usr/sbin/lsof -tiTCP:$p -sTCP:LISTEN 2>/dev/null | while read pid; do kill -9 "$pid" 2>/dev/null || true; done
  done
  if listening 5173 && ! pid_alive de-web; then
    return 0
  fi
  echo "$(date '+%F %T') start de-web :5173" >>"$LOGDIR/keeper.log"
  (
    cd "$FRONTEND/web" || exit 1
    nohup ./node_modules/.bin/vite --host 127.0.0.1 --port 5173 --strictPort >>"$LOGDIR/de-web.log" 2>&1 </dev/null &
    echo $! >"$LOGDIR/de-web.pid"
  )
  sleep 1
}

cleanup() {
  echo "$(date '+%F %T') keeper shutdown pid=$$" >>"$LOGDIR/keeper.log"
  local name pid
  for name in qzda-app qzda-gateway qzda-rag qzda-skill de-web; do
    if pid_alive "$name"; then
      pid=$(cat "$LOGDIR/${name}.pid")
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  local i
  for i in $(seq 1 12); do
    listening 8100 || listening 8089 || break
    sleep 1
  done
  for name in qzda-app qzda-gateway qzda-rag qzda-skill de-web; do
    if pid_alive "$name"; then
      kill -KILL "$(cat "$LOGDIR/${name}.pid")" 2>/dev/null || true
    fi
  done
  for port in 8100 8089 8092 8093 5173; do
    listening "$port" && reclaim_port "$port"
  done
  exit 0
}
trap cleanup TERM INT

echo "$(date '+%F %T') keeper boot pid=$$ stack=monolith" >>"$LOGDIR/keeper.log"
if [ ! -x "$BACKEND/bin/qzda-app" ]; then
  echo "$(date '+%F %T') building backend binaries..." >>"$LOGDIR/keeper.log"
  (cd "$BACKEND" && make build) >>"$LOGDIR/keeper.log" 2>&1 || true
fi
while true; do
  export QZDA_RUNTIME_MODE=local
  export QZDA_SANDBOX_RUNTIME_URL="${QZDA_SANDBOX_RUNTIME_URL:-http://127.0.0.1:8093}"
  workflow_env=()
  if [ -n "${QZDA_WITH_WORKFLOW:-}" ]; then
    workflow_env=(QZDA_WORKFLOW_WORKER=1 QZDA_TEMPORAL_HOST="${QZDA_TEMPORAL_HOST:-127.0.0.1:7233}")
  else
    workflow_env=(QZDA_WORKFLOW_WORKER=0)
  fi
  start_one 8100 qzda-app env "${workflow_env[@]}" QZDA_RAG_URL=http://127.0.0.1:8092 QZDA_RUNTIME_MODE=local QZDA_SANDBOX_RUNTIME_URL="$QZDA_SANDBOX_RUNTIME_URL" QZDA_EMBEDDED_CHAT=0 QZDA_MODEL_CANDIDATE_TIMEOUT=45 QZDA_COPILOT_STREAM_TIMEOUT=300 QZDA_BUILTIN_SKILL_BIN="$SKILL_BIN" PATH="$SKILL_BIN:$PATH" "$BACKEND/bin/qzda-app"
  start_one 8093 qzda-skill env QZDA_SANDBOX_REQUIRE_ISOLATION=0 QZDA_SANDBOX_ARTIFACT_DIR=/tmp/qzda-stack/artifacts QZDA_BIND_HOST=127.0.0.1 QZDA_BIND_PORT=8093 python3 "$BACKEND/services/qzda-sandbox/main.py"
  start_one 8092 qzda-rag env QZDA_BIND_HOST=127.0.0.1 QZDA_BIND_PORT=8092 QZDA_PGVECTOR_URL="$QZDA_PGVECTOR_URL" python3 "$BACKEND/services/qzda-rag/main.py"
  start_one 8089 qzda-gateway python3 "$GATEWAY_MONOLITH"
  start_vite
  sleep 5
done
