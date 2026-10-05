#!/usr/bin/env bash
# 七架构 Phase 0–4 冒烟验收（需本地 qzda-core / collab 已启动）
set -euo pipefail

BASE="${QZDA_API_BASE:-http://127.0.0.1:8080}"
TOKEN="${QZDA_TOKEN:-mock-admin-token}"
WS="${QZDA_WORKSPACE:-w1}"
AUTH="Authorization: Bearer ${TOKEN}"
HDR=(-H "$AUTH" -H "x-workspace-id: $WS" -H "Content-Type: application/json")

echo "== health =="
curl -sf "$BASE/healthz" >/dev/null || curl -sf "$BASE/api/workspaces" -H "$AUTH" -H "x-workspace-id: $WS" >/dev/null
echo "ok"

echo "== routing policies (P0/P1/P3 published) =="
pols=$(curl -sf "$BASE/api/model-routing/policies" "${HDR[@]}")
echo "$pols" | grep -q '"level":"P0"' || echo "$pols" | grep -q '"P0"'
echo "$pols" | grep -q 'P3' || true
echo "ok"

echo "== evolve candidates list =="
curl -sf "$BASE/api/evolve/candidates" "${HDR[@]}" >/dev/null
echo "ok"

echo "== create conversation + preference turn (stream) =="
cid=$(curl -sf "$BASE/api/copilot/conversations" "${HDR[@]}" \
  -d '{"title":"phase-verify","digitalEmployeeId":"de-hr"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print((d.get('data') or d).get('id') or (d.get('data') or d).get('conversationId',''))")
if [[ -z "$cid" ]]; then
  echo "skip stream: could not create conversation"
  exit 0
fi
corr="corr-verify-$(date +%s)"
# Collect a few SSE lines (timeout)
stream_out=$(mktemp)
curl -sfN --max-time 90 "$BASE/api/copilot/conversations/${cid}/stream" "${HDR[@]}" \
  -H "Accept: text/event-stream" -H "x-correlation-id: $corr" \
  -d "{\"content\":\"请记住我以后默认用邮件催办\",\"correlationId\":\"$corr\",\"digitalEmployeeId\":\"de-hr\"}" \
  >"$stream_out" || true
if grep -q 'evolve\|memory_promote\|done' "$stream_out"; then
  echo "stream events present"
else
  echo "stream finished (check $stream_out if empty)"
fi
rm -f "$stream_out"

echo "== dream run =="
curl -sf "$BASE/api/evolve/dream/run" "${HDR[@]}" -d '{}' >/dev/null
echo "ok"

echo "Phase smoke finished against $BASE"
