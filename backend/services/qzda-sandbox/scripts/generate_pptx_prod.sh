#!/usr/bin/env bash
# Production PPTX generator for Copilot builtin path (PilotDeck layout-library).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Prefer repo builtin skill; allow override.
SKILL_DIR="${PPTX_SKILL_DIR:-}"
if [[ -z "$SKILL_DIR" ]]; then
  for candidate in \
    "$SCRIPT_DIR/../builtin/skills/pptx" \
    "$SCRIPT_DIR/../../services/qzda-sandbox/builtin/skills/pptx"
  do
    if [[ -f "$candidate/scripts/pptx.sh" ]]; then
      SKILL_DIR="$(cd "$candidate" && pwd)"
      break
    fi
  done
fi
if [[ -z "${SKILL_DIR:-}" || ! -f "$SKILL_DIR/scripts/pptx.sh" ]]; then
  echo "pptx skill not found" >&2
  exit 2
fi

PPTX_SH="$SKILL_DIR/scripts/pptx.sh"
OUT=""
TITLE="演示文稿"
OUTLINE_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT="${2:-}"; shift 2 ;;
    --title) TITLE="${2:-}"; shift 2 ;;
    --outline-file) OUTLINE_FILE="${2:-}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$OUT" || -z "$OUTLINE_FILE" ]]; then
  echo "usage: generate_pptx_prod.sh --out FILE.pptx --title TITLE --outline-file FILE" >&2
  exit 2
fi

# Ensure Node runtime deps (prefer repo-local cache so CI/sandbox can write)
if [[ -z "${PPTX_SKILL_CACHE:-}" ]]; then
  if [[ -d "$SKILL_DIR/../../.cache" ]] || mkdir -p "$SKILL_DIR/../../.cache/pilotdeck-pptx" 2>/dev/null; then
    export PPTX_SKILL_CACHE="$(cd "$SKILL_DIR/../.." && pwd)/.cache/pilotdeck-pptx"
  fi
fi
CACHE_ROOT="${PPTX_SKILL_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/pilotdeck-pptx}"
mkdir -p "$CACHE_ROOT" 2>/dev/null || true

if ! PPTX_SKILL_CACHE="$CACHE_ROOT" bash "$PPTX_SH" check >/dev/null 2>&1; then
  PPTX_SKILL_CACHE="$CACHE_ROOT" bash "$PPTX_SH" fix >/dev/null
fi

export PPTX_SKILL_ROOT="$SKILL_DIR"
export PPTX_RUNTIME_ROOT="$CACHE_ROOT/runtime"
export PPTX_SKILL_CACHE="$CACHE_ROOT"

NODE_BIN="$(command -v node)"
"$NODE_BIN" "$SKILL_DIR/scripts/build_from_outline.mjs" \
  --title "$TITLE" \
  --outline-file "$OUTLINE_FILE" \
  --out "$OUT"
