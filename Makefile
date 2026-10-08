.PHONY: help test build lint skill-gate vet visualdiff ci-frontend ci-backend run-app run-app-stop run-app-status

# Default target prints the menu.
help:
	@echo "Digital Employee Platform — make targets"
	@echo ""
	@echo "  make test            — backend unit + integration tests (race)"
	@echo "  make build           — go build ./..."
	@echo "  make lint            — go vet ./..."
	@echo "  make skill-gate      — W1-D1 退出门槛：vetter strict + 签名 verify-skill"
	@echo "  make ci-backend      — alias for test + lint"
	@echo "  make ci-frontend     — frontend/web vitest (run inside frontend/web)"
	@echo "  make run-app         — start local dev stack (gateway :8089 + qzda-app :8100 + vite :8010)"
	@echo "  make run-app-stop    — stop local dev stack"
	@echo "  make run-app-status  — show dev stack ports + processes"
	@echo ""
	@echo "Env knobs (override on the command line):"
	@echo "  SKILL_DIR    builtin skills dir   [backend/builtin/skills]"
	@echo "  MANIFEST      manifest.json path    [backend/builtin/skills/manifest.json]"
	@echo "  QZDA_STACK      monolith | coarse    [monolith]"

# ---------- Backend ----------

test:
	cd backend && go test -race -count=1 -timeout 300s ./internal/...

build:
	cd backend && go build ./...

lint vet:
	cd backend && go vet ./...

ci-backend: test lint

# ---------- W1-D1 退出门槛 ----------
# Runs BOTH vetter (strict) AND signature verify on every builtin skill
# directory under SKILL_DIR. Exits non-zero on first failure.

# Relative to backend/ since we cd into it.
BACKEND_SKILL_DIR ?= builtin/skills
BACKEND_MANIFEST  ?= builtin/skills/manifest.json

skill-gate:
	cd backend && go run ./cmd/verify-skill --manifest $(BACKEND_MANIFEST) --vet=strict $(BACKEND_SKILL_DIR)

# ---------- Frontend ----------

ci-frontend:
	cd frontend/web && npm ci --no-audit --no-fund && npx vitest run --reporter=default

# ---------- Local dev stack ----------
#
# Brings up the full monolith stack: gateway :8089 (Vite proxy target) +
# qzda-app :8100 + sandbox :8093 + Vite :8010. Wraps the launchd-supervised
# restart-stack.sh so the stack survives transient crashes.
#
# QZDA_STACK=coarse switches to the split qzda-sys / qzda-collab / qzda-cap
# topology. See docs/数字伙伴平台-架构文档.md.

QZDA_STACK ?= monolith
export QZDA_STACK

run-app:
	QZDA_STACK=$(QZDA_STACK) ./scripts/dev-stack/restart-stack.sh start

run-app-stop:
	./scripts/dev-stack/restart-stack.sh stop

run-app-status:
	./scripts/dev-stack/restart-stack.sh status