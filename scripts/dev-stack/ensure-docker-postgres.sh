#!/bin/bash
# Ensure local qzda-app talks to Docker Postgres (qzda-postgres), not Homebrew Postgres.
# Homebrew postgresql@N binding 127.0.0.1:5432 steals connections from Colima port-publish.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND="$ROOT/backend"
COMPOSE=(docker compose -f "$BACKEND/deploy/compose.yml")
DB_URL="${QZDA_DATABASE_URL:-postgres://de:de@127.0.0.1:5432/digital_employee?sslmode=disable}"

listening_pids() {
  /usr/sbin/lsof -tiTCP:5432 -sTCP:LISTEN 2>/dev/null || true
}

stop_homebrew_postgres() {
  local pid args
  for pid in $(listening_pids); do
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    case "$args" in
      *Cellar/postgresql*|*postgres\ -D\ /opt/homebrew/var/postgresql*)
        echo "ensure-docker-postgres: stopping Homebrew Postgres pid=$pid"
        kill "$pid" 2>/dev/null || true
        ;;
    esac
  done
  # Best-effort: brew services may not be loaded
  if command -v brew >/dev/null 2>&1; then
    for formula in postgresql@17 postgresql@16 postgresql@15 postgresql; do
      brew services stop "$formula" >/dev/null 2>&1 || true
    done
  fi
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    local still=0
    for pid in $(listening_pids); do
      args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
      case "$args" in
        *Cellar/postgresql*|*postgres\ -D\ /opt/homebrew/var/postgresql*)
          still=1
          if [ "$i" -ge 5 ]; then kill -9 "$pid" 2>/dev/null || true; fi
          ;;
      esac
    done
    [ "$still" = "0" ] && return 0
    sleep 1
  done
}

ensure_compose_postgres() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "ensure-docker-postgres: docker CLI missing" >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "ensure-docker-postgres: docker engine not running (start Colima / Docker Desktop)" >&2
    exit 1
  fi
  (cd "$BACKEND" && "${COMPOSE[@]}" up -d postgres redis) >/dev/null
  local i ok
  for i in $(seq 1 30); do
    ok="$(docker inspect -f '{{.State.Health.Status}}' qzda-postgres 2>/dev/null || echo starting)"
    [ "$ok" = "healthy" ] && return 0
    sleep 1
  done
  echo "ensure-docker-postgres: qzda-postgres not healthy" >&2
  exit 1
}

verify_docker_pg() {
  local ver
  ver="$(psql "$DB_URL" -Atc 'SHOW server_version;' 2>/dev/null || true)"
  case "$ver" in
    16.*|15.*)
      echo "ensure-docker-postgres: OK 127.0.0.1:5432 -> Postgres $ver (Docker)"
      return 0
      ;;
    17.*)
      echo "ensure-docker-postgres: FAIL still on local Homebrew Postgres $ver" >&2
      echo "  stop it: brew services stop postgresql@17 && kill local postgres on :5432" >&2
      exit 1
      ;;
    *)
      echo "ensure-docker-postgres: FAIL cannot query $DB_URL (got: ${ver:-empty})" >&2
      exit 1
      ;;
  esac
}

stop_homebrew_postgres
ensure_compose_postgres
# After local PG dies, Colima may need a moment to own the host port cleanly.
sleep 1
verify_docker_pg
