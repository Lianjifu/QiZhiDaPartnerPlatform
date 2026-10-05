#!/bin/bash
# Restart the QiZhiDa · PartnerPlatform dev stack via launchd supervisor.
# Use this instead of `pkill bin/qzda-app` — supervisor will respawn instantly.
#
# Usage:
#   ./scripts/dev-stack/restart-stack.sh           # restart in place
#   ./scripts/dev-stack/restart-stack.sh stop      # stop
#   ./scripts/dev-stack/restart-stack.sh start     # start (idempotent)
#   ./scripts/dev-stack/restart-stack.sh status    # ports + procs
#
# See [[feedback-startup-protocol]] for why this exists.

set -u
PLIST="$HOME/Library/LaunchAgents/com.qizhida.dev-stack.plist"
PORTS=(8089 8100 5173)
BACKEND="/Users/LIANJIFU/ops/QiZhiDaPartnerPlatform/backend"

probe() {
  echo "=== procs ==="
  ps aux | grep -E "qzda-app|vite|qzda-gateway/main" | grep -v grep | awk '{printf "  %-7s %s\n", $2, substr($0, index($0,$11))}' | head -10
  echo "=== ports ==="
  for p in "${PORTS[@]}"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 1 "http://127.0.0.1:${p}/healthz" 2>/dev/null)
    code=${code:-000}
    if [ "$code" != "000" ]; then
      echo "  :${p}  ${code}  up"
    else
      echo "  :${p}  -    down"
    fi
  done
  echo "=== supervisor ==="
  launchctl list | grep qizhida || echo "  (supervisor not loaded)"
}

wait_down() {
  local timeout="${1:-20}"
  local i
  echo "waiting for :8089 :8100 to free..."
  for i in $(seq 1 "$timeout"); do
    local busy=0
    for p in 8089 8100; do
      if /usr/sbin/lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
        busy=1
      fi
    done
    if [ "$busy" = 0 ]; then
      return 0
    fi
    sleep 1
  done
  echo "ports still busy; reclaiming leftovers"
  for p in 8089 8100 8092 8093; do
    /usr/sbin/lsof -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null | while read pid; do kill -KILL "$pid" 2>/dev/null || true; done
  done
  sleep 1
}

wait_ready() {
  local timeout="${1:-30}"
  for i in $(seq 1 "$timeout"); do
    b=$(curl -s -o /dev/null -w "%{http_code}" --max-time 1 http://127.0.0.1:8100/healthz 2>/dev/null)
    f=$(curl -s -o /dev/null -w "%{http_code}" --max-time 1 http://127.0.0.1:5173/ 2>/dev/null)
    g=$(curl -s -o /dev/null -w "%{http_code}" --max-time 1 http://127.0.0.1:8089/healthz 2>/dev/null)
    if [ "$b" = "200" ] && [ "$f" = "200" ] && [ "$g" = "200" ]; then
      echo "stack ready after ${i}s (gateway:8089 backend:8100 frontend:5173)"
      return 0
    fi
    sleep 1
  done
  echo "stack not ready after ${timeout}s; check /tmp/qzda-stack/*.log"
  return 1
}

case "${1:-restart}" in
  status)
    probe
    ;;
  stop)
    [ -f "$PLIST" ] && launchctl unload "$PLIST" 2>&1 || true
    wait_down 20
    probe
    ;;
  start)
    if [ ! -f "$PLIST" ]; then
      echo "missing plist: $PLIST"; exit 1
    fi
    if launchctl list | grep -q qizhida; then
      echo "already loaded"
    else
      launchctl load "$PLIST"
    fi
    wait_ready
    ;;
  restart|"")
    if [ -f "$PLIST" ] && launchctl list | grep -q qizhida; then
      echo "unloading supervisor..."
      launchctl unload "$PLIST"
      wait_down 20
    fi
    # Ensure infra is up (PG + Redis)
    echo "ensuring PG/Redis..."
    (cd "$BACKEND" && make compose-up 2>&1 | tail -3)
    echo "loading supervisor..."
    launchctl load "$PLIST"
    wait_ready
    probe
    ;;
  *)
    echo "usage: $0 {restart|start|stop|status}"
    exit 1
    ;;
esac
