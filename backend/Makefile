# 单进程 Docker 部署 — Makefile
#
# 三段入口:
#   make run           — 启动完整 Docker 栈(postgres + redis + qzda-app + 沙箱/RAG/网关)
#   make run-app       — 不依赖 Docker,本机直接 go run qzda-app(需 PG/Redis 已在跑)
#   make smoke         — 健康/登录/查询 smoke test
#
# 所有配置通过 deploy/.env / QZDA_* 环境变量注入。

export QZDA_DATABASE_URL ?= postgres://de:de@127.0.0.1:5432/digital_employee?sslmode=disable
export QZDA_REDIS_URL ?= redis://127.0.0.1:6379/0
export QZDA_MODE ?= dev
export PATH := /opt/homebrew/bin:$(HOME)/go/bin:$(PATH)

GO ?= $(shell if [ -x "$(CURDIR)/.tools/go/bin/go" ]; then echo "$(CURDIR)/.tools/go/bin/go"; else echo go; fi)
COMPOSE := docker compose -f deploy/compose.yml

.PHONY: run run-app run-demo run-dev smoke build tidy test docker-engine compose-up compose-down compose-ps compose-logs infra-env db-reset-dev verify-builtins vet-builtins skill-gate

# === 默认入口:完整 Docker 栈 ===
# 自动拉起 Colima(如未启动) → 起 PG+Redis → 起 6 个应用容器。
# 端口:8089 gateway · 8100 qzda-app · 8093 qzda-sandbox · 8092 qzda-rag · 5432 PG · 6379 Redis
run: docker-engine compose-up
	@echo "monolith ready: http://127.0.0.1:8089 (gateway) → :8100 (qzda-app)"
	@echo "  control plane logs:  make compose-logs SERVICE=qzda-app"
	@echo "  stop everything:     make compose-down"

# === 本机直跑 Go 控制面 ===
# 需要先 make compose-up 启 PG+Redis(infra-env 也会调 ensure-docker-postgres.sh)
run-app: infra-env
	QZDA_MODE=$${QZDA_MODE:-dev} \
	QZDA_RUNTIME_MODE=local \
	QZDA_SANDBOX_RUNTIME_URL=$${QZDA_SANDBOX_RUNTIME_URL:-http://127.0.0.1:8093} \
	QZDA_RAG_URL=$${QZDA_RAG_URL:-http://127.0.0.1:8092} \
	$(GO) run ./cmd/qzda-app

# 演示模式:dev + 内存存储 + ACME seed,不写 PG。
run-demo:
	QZDA_MODE=dev QZDA_DATA_BACKEND=memory QZDA_SERVICE=app QZDA_LISTEN_ADDR=:8100 $(GO) run ./cmd/qzda-app

# 开发模式:同 run-app,但 infra-env 自动确保 PG+Redis 在跑。
run-dev: infra-env run-app

# === 单元测试(隔离 qzda-rag 默认端口 8092) ===
test:
	QZDA_RAG_URL=http://127.0.0.1:1 $(GO) test ./...

tidy:
	$(GO) mod tidy

# 编译两个 Go 二进制到 ./bin/
build:
	$(GO) build -o ./bin/qzda-app ./cmd/qzda-app
	$(GO) build -o ./bin/qzda-local-llm ./cmd/qzda-local-llm

# 本地 OpenAI-compatible chat(默认 :8180),Copilot 无云端 key 时 fallback
local-llm:
	$(GO) run ./cmd/qzda-local-llm

# === Docker 引擎自检 ===
docker-engine:
	@command -v docker >/dev/null || { echo "docker CLI missing; brew install docker colima"; exit 1; }
	@if ! docker info >/dev/null 2>&1; then \
		echo "starting Colima Docker engine..."; \
		colima start --cpu 2 --memory 4 --disk 20; \
	fi
	@docker info >/dev/null

# === Compose 入口 ===
compose-up: docker-engine
	$(COMPOSE) up -d postgres redis
	@echo "waiting for all services healthy..."
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do \
		pg=$$(docker inspect -f '{{.State.Health.Status}}' qzda-postgres 2>/dev/null || echo starting); \
		rd=$$(docker inspect -f '{{.State.Health.Status}}' qzda-redis 2>/dev/null || echo starting); \
		app=$$(docker inspect -f '{{.State.Health.Status}}' qzda-app 2>/dev/null || echo starting); \
		sb=$$(docker inspect -f '{{.State.Health.Status}}' qzda-sandbox 2>/dev/null || echo starting); \
		rag=$$(docker inspect -f '{{.State.Health.Status}}' qzda-rag 2>/dev/null || echo starting); \
		gw=$$(docker inspect -f '{{.State.Health.Status}}' qzda-gateway 2>/dev/null || echo starting); \
		echo "  try $$i: pg=$$pg redis=$$rd app=$$app sandbox=$$sb rag=$$rag gateway=$$gw"; \
		if [ "$$pg" = "healthy" ] && [ "$$rd" = "healthy" ] && [ "$$app" = "healthy" ] && [ "$$sb" = "healthy" ] && [ "$$rag" = "healthy" ] && [ "$$gw" = "healthy" ]; then \
			echo "monolith ready"; \
			echo "  gateway :8089 → qzda-app :8100"; \
			echo "  sandbox :8093  rag :8092  pg :5432  redis :6379"; \
			exit 0; \
		fi; \
		sleep 2; \
	done
	@echo "stack not healthy after 60s; try: make compose-logs"; exit 1

compose-down:
	$(COMPOSE) down

compose-ps:
	$(COMPOSE) ps

compose-logs:
	$(COMPOSE) logs --tail=100

# === 基础设施 prep ===
infra-env:
	@test -f deploy/.env || cp deploy/.env.example deploy/.env
	@bash ../scripts/dev-stack/ensure-docker-postgres.sh
	@echo "using QZDA_DATABASE_URL=$(QZDA_DATABASE_URL)"
	@echo "using QZDA_REDIS_URL=$(QZDA_REDIS_URL)"

# 重置开发库(drop schema 后由 qzda-app 自动重新 hydrate)
db-reset-dev: docker-engine
	@bash ../scripts/dev-stack/ensure-docker-postgres.sh
	@echo "WARNING: drops application schemas in Docker Postgres ($(QZDA_DATABASE_URL))"
	@$(COMPOSE) exec -T postgres psql -U de -d digital_employee -c "DROP SCHEMA IF EXISTS platform CASCADE; DROP SCHEMA IF EXISTS audit CASCADE; DROP SCHEMA IF EXISTS policy CASCADE;" || true
	@echo "Restart qzda-app with QZDA_MODE=dev to re-apply migrations / empty durable store."

# === Skill 安全门禁(W1-D3) ===
verify-builtins:
	@echo "==> verifying all builtins against $(PWD)/services/qzda-sandbox/builtin/skills/manifest.json"
	@$(GO) run ./cmd/verify-skill --manifest $(PWD)/services/qzda-sandbox/builtin/skills/manifest.json $(PWD)/services/qzda-sandbox/builtin/skills

vet-builtins:
	@echo "==> vetting core builtins against dangerous-pattern scanner"
	@$(GO) run ./cmd/verify-skill --vet=strict --manifest $(PWD)/services/qzda-sandbox/builtin/skills/manifest.json $(PWD)/services/qzda-sandbox/builtin/skills

skill-gate: vet-builtins verify-builtins
	@echo "==> skill-gate: PASS"

# === Smoke test(假设栈已起) ===
BASE ?= http://127.0.0.1:8089
smoke:
	@curl -sf $(BASE)/healthz >/dev/null && echo "healthz ok" || (echo "start stack first: make run" && exit 1)
	@TOKEN=$$(curl -sf -X POST $(BASE)/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@acme.com","password":"x"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])') && \
	curl -sf -H "Authorization: Bearer $$TOKEN" $(BASE)/api/workspaces >/dev/null && echo "workspaces ok" && \
	curl -sf -H "Authorization: Bearer $$TOKEN" $(BASE)/api/skills >/dev/null && echo "skills ok" && \
	curl -sf -H "Authorization: Bearer $$TOKEN" $(BASE)/api/sessions >/dev/null && echo "sessions ok" && \
	curl -sf -X POST -H "Authorization: Bearer $$TOKEN" -H 'Content-Type: application/json' -d '{"resource":"workflow","action":"publish"}' $(BASE)/api/zero-trust/evaluate >/dev/null && echo "evaluate ok"
