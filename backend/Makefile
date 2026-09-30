.PHONY: run test tidy build compose-up compose-up-full compose-up-temporal compose-up-oidc compose-up-authentik compose-up-kafka compose-up-mtls compose-up-spiffe compose-up-coarse compose-up-monolith compose-up-monolith-workflow compose-up-milvus compose-up-opa compose-up-search compose-up-obs compose-up-staging compose-up-replica compose-down compose-ps compose-logs infra-env smoke smoke-coarse smoke-monolith test-python runtime rag skill sync-builtin-skills qzda-workflow docker-engine buf-generate buf-lint worker certs certs-rotate run-sys run-collab run-cap run-app run-workflow run-policy run-audit run-demo run-dev db-reset-dev


export DE_DATABASE_URL ?= postgres://de:de@127.0.0.1:5432/digital_employee?sslmode=disable
export DE_REDIS_URL ?= redis://127.0.0.1:6379/0
export DE_ENV ?= development
export PATH := /opt/homebrew/bin:$(HOME)/go/bin:$(PATH)

# Prefer backend/.tools/go when present (toolchain bootstrap; not a source tree).
GO ?= $(shell if [ -x "$(CURDIR)/.tools/go/bin/go" ]; then echo "$(CURDIR)/.tools/go/bin/go"; else echo go; fi)
COMPOSE := docker compose -f deploy/compose.yml

# Primary local entry: monolith stack (gateway :8089 → qzda-app :8100 + qzda-skill :8093).
# Data mode: DE_ENV=development (production-shaped persist, no demo seed on empty DB).
run: compose-up-monolith

# 演示环境：内存 + ACME seed，不写 Postgres。
run-demo:
	DE_ENV=demo DE_SERVICE=app DE_LISTEN_ADDR=:8100 $(GO) run ./cmd/qzda-app

# 本机生产数据模式：需 PG；空库不灌演示 seed。
run-dev: infra-env run-app

run-sys: infra-env
	$(GO) run ./cmd/qzda-sys

run-app: infra-env
	DE_ENV=$${DE_ENV:-development} \
	DE_RUNTIME_MODE=local \
	DE_SKILL_RUNTIME_URL=$${DE_SKILL_RUNTIME_URL:-http://127.0.0.1:8093} \
	$(GO) run ./cmd/qzda-app

db-reset-dev: docker-engine
	@bash ../scripts/dev-stack/ensure-docker-postgres.sh
	@echo "WARNING: drops application schemas in Docker Postgres ($(DE_DATABASE_URL))"
	@$(COMPOSE) exec -T postgres psql -U de -d digital_employee -c "DROP SCHEMA IF EXISTS platform CASCADE; DROP SCHEMA IF EXISTS audit CASCADE; DROP SCHEMA IF EXISTS policy CASCADE; DROP SCHEMA IF EXISTS collab CASCADE; DROP SCHEMA IF EXISTS cap CASCADE;" || true
	@echo "Restart qzda-app with DE_ENV=development to re-apply migrations / empty durable store."

run-collab: infra-env
	DE_CAP_URL=$${DE_CAP_URL:-http://127.0.0.1:8102} DE_WORKFLOW_URL=$${DE_WORKFLOW_URL:-http://127.0.0.1:8103} $(GO) run ./cmd/qzda-collab

run-cap: infra-env
	$(GO) run ./cmd/qzda-cap

run-workflow: infra-env
	DE_WORKFLOW_HTTP=1 DE_WORKFLOW_WORKER=$${DE_WORKFLOW_WORKER:-0} $(GO) run ./cmd/qzda-workflow

run-policy: infra-env
	$(GO) run ./cmd/qzda-policy

run-audit: infra-env
	$(GO) run ./cmd/qzda-audit

test:
	# Isolate unit tests from a locally running FastAPI RAG on :8092.
	DE_RAG_URL=http://127.0.0.1:1 $(GO) test ./...

tidy:
	$(GO) mod tidy

build:
	$(GO) build -o ./bin/qzda-sys ./cmd/qzda-sys
	$(GO) build -o ./bin/qzda-app ./cmd/qzda-app
	$(GO) build -o ./bin/qzda-collab ./cmd/qzda-collab
	$(GO) build -o ./bin/qzda-cap ./cmd/qzda-cap
	$(GO) build -o ./bin/qzda-workflow ./cmd/qzda-workflow
	$(GO) build -o ./bin/qzda-policy ./cmd/qzda-policy
	$(GO) build -o ./bin/qzda-audit ./cmd/qzda-audit
	$(GO) build -o ./bin/qzda-local-llm ./cmd/qzda-local-llm

# Local OpenAI-compatible chat (default :18080) for Copilot when no cloud key is set.
local-llm:
	$(GO) run ./cmd/qzda-local-llm

docker-engine:
	@command -v docker >/dev/null || { echo "docker CLI missing; brew install docker colima"; exit 1; }
	@if ! docker info >/dev/null 2>&1; then \
		echo "starting Colima Docker engine..."; \
		colima start --cpu 2 --memory 4 --disk 20; \
	fi
	@docker info >/dev/null

compose-up: docker-engine
	$(COMPOSE) up -d
	@echo "waiting for postgres + redis healthy..."
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do \
		ok=$$(docker inspect -f '{{.State.Health.Status}}' qzda-postgres 2>/dev/null || echo starting); \
		rok=$$(docker inspect -f '{{.State.Health.Status}}' qzda-redis 2>/dev/null || echo starting); \
		echo "  try $$i: postgres=$$ok redis=$$rok"; \
		if [ "$$ok" = "healthy" ] && [ "$$rok" = "healthy" ]; then \
			echo "applying SQL migrations (idempotent)..."; \
			for f in deploy/migrations/*.sql; do \
				docker exec -i qzda-postgres psql -U de -d digital_employee < "$$f" >/dev/null; \
			done; \
			echo "infra ready"; \
			echo "  DE_DATABASE_URL=$(DE_DATABASE_URL)"; \
			echo "  DE_REDIS_URL=$(DE_REDIS_URL)"; \
			exit 0; \
		fi; \
		sleep 2; \
	done; \
	echo "infra not healthy yet; check: make compose-logs"; exit 1

compose-up-full: docker-engine
	$(COMPOSE) --profile full up -d
	@$(MAKE) compose-up

compose-up-temporal: docker-engine
	$(COMPOSE) --profile temporal up -d
	@echo "Temporal frontend: 127.0.0.1:7233 — set DE_TEMPORAL_HOST=127.0.0.1:7233"
	@echo "Worker: cd backend && make worker"

compose-up-oidc: docker-engine
	$(COMPOSE) --profile oidc up -d
	@echo "Dex OIDC: http://127.0.0.1:5556/dex"
	@echo "  DE_OIDC_ISSUER=http://127.0.0.1:5556/dex"
	@echo "  DE_OIDC_CLIENT_ID=qzda-core"
	@echo "  DE_OIDC_CLIENT_SECRET=qzda-core-secret"
	@echo "  DE_OIDC_AUTH_PATH=/auth"

compose-up-authentik: docker-engine
	$(COMPOSE) --profile authentik up -d
	@echo "Authentik UI: http://127.0.0.1:9000 (bootstrap admin@acme.com / authentik)"
	@echo "  setup OAuth2 app slug=de → see deploy/authentik/README.md"
	@echo "  DE_OIDC_ISSUER=http://127.0.0.1:9000/application/o/de/"

compose-up-obs: docker-engine
	$(COMPOSE) --profile obs up -d
	@echo "Prometheus: http://127.0.0.1:9090  Grafana: http://127.0.0.1:3000 (admin/admin)"

compose-up-kafka: docker-engine
	$(COMPOSE) --profile kafka up -d
	@echo "Redpanda Kafka: 127.0.0.1:19092 — set DE_KAFKA_BROKERS=127.0.0.1:19092"

compose-up-mtls: docker-engine certs
	$(COMPOSE) --profile mtls up -d
	@echo "Envoy mTLS: https://127.0.0.1:8443"

compose-up-spiffe: docker-engine certs
	$(COMPOSE) --profile spiffe up -d
	@echo "Envoy SPIFFE mTLS: https://127.0.0.1:8444 — see deploy/spiffe/README.md"

compose-up-coarse: docker-engine
	@$(MAKE) compose-up
	$(COMPOSE) --profile coarse up -d --build
	@echo "coarse: gateway:8089 → sys:8100 collab:8101 cap:8102 workflow:8103 + FastAPI 8091-8093"
	@echo "  FE proxy default → http://127.0.0.1:8089"

compose-up-monolith: docker-engine
	@$(MAKE) compose-up
	$(COMPOSE) --profile monolith up -d --build
	@echo "monolith: gateway:8089 → qzda-app:8100 + qzda-skill:8093"
	@echo "  FE proxy default → http://127.0.0.1:8089"
	@echo "  optional workflow: make compose-up-monolith-workflow"

compose-up-monolith-workflow: docker-engine
	@$(MAKE) compose-up
	DE_WORKFLOW_URL=http://qzda-workflow:8103 $(COMPOSE) --profile monolith --profile monolith-workflow up -d --build
	@echo "monolith+workflow: qzda-app + qzda-skill + qzda-workflow:8103"

compose-up-milvus: docker-engine
	$(COMPOSE) --profile milvus up -d
	@echo "waiting for Milvus healthy..."
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do \
		ok=$$(docker inspect -f '{{.State.Health.Status}}' qzda-milvus 2>/dev/null || echo starting); \
		echo "  try $$i: milvus=$$ok"; \
		if [ "$$ok" = "healthy" ]; then \
			echo "Milvus ready: http://127.0.0.1:19530"; \
			echo "  export DE_MILVUS_URI=http://127.0.0.1:19530"; \
			echo "  pip install -r services/qzda-rag/requirements-milvus.txt && make rag"; \
			exit 0; \
		fi; \
		sleep 3; \
	done; \
	echo "Milvus not healthy yet; check: docker logs qzda-milvus"; exit 1

compose-up-replica: docker-engine
	$(COMPOSE) --profile replica up -d
	@echo "waiting for PG replica recovery..."
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do \
		ok=$$(docker inspect -f '{{.State.Health.Status}}' qzda-postgres-replica 2>/dev/null || echo starting); \
		echo "  try $$i: replica=$$ok"; \
		if [ "$$ok" = "healthy" ]; then \
			echo "PG replica ready: postgres://de:de@127.0.0.1:5433/digital_employee?sslmode=disable"; \
			echo "  export DE_DATABASE_REPLICA_URL=postgres://de:de@127.0.0.1:5433/digital_employee?sslmode=disable"; \
			echo "  export DE_REPLICA_MODE=standby"; \
			exit 0; \
		fi; \
		sleep 3; \
	done; \
	echo "replica not healthy; existing PG volume may lack replication hba."; \
	echo "  docker exec qzda-postgres sh -c 'echo \"host replication de all scram-sha-256\" >> \$$PGDATA/pg_hba.conf && psql -U de -c \"SELECT pg_reload_conf()\"'"; \
	echo "  or recreate: $(COMPOSE) down -v && $(MAKE) compose-up-replica"; \
	exit 1

compose-up-opa: docker-engine
	$(COMPOSE) --profile opa up -d
	@echo "OPA: http://127.0.0.1:8181 — set DE_OPA_URL=http://127.0.0.1:8181"

compose-up-search: docker-engine
	$(COMPOSE) --profile search up -d
	@echo "waiting for OpenSearch healthy..."
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do \
		ok=$$(docker inspect -f '{{.State.Health.Status}}' qzda-opensearch 2>/dev/null || echo starting); \
		echo "  try $$i: opensearch=$$ok"; \
		if [ "$$ok" = "healthy" ]; then \
			echo "OpenSearch ready: http://127.0.0.1:9200"; \
			echo "  export DE_OPENSEARCH_URL=http://127.0.0.1:9200"; \
			exit 0; \
		fi; \
		sleep 3; \
	done; \
	echo "OpenSearch not healthy yet; check: docker logs qzda-opensearch"; exit 1

compose-up-policy compose-up-qzda-policy compose-up-audit compose-up-qzda-audit compose-up-apps compose-up-split:
	@echo "retired compose profile: coarse qzda-sys still absorbs policy/audit."
	@echo "optional binaries: make run-policy (:8104) / make run-audit (:8105); set DE_CROSSCUTTING_SPLIT=1 on qzda-sys to drop those routes."
	@exit 1

# Staging: coarse + oidc + opa + search + obs
compose-up-staging: docker-engine
	@$(MAKE) compose-up
	@set -a; \
	if [ -f deploy/.env.staging ]; then . ./deploy/.env.staging; fi; \
	set +a; \
	$(COMPOSE) --profile coarse --profile oidc --profile opa --profile search --profile obs up -d --build
	@echo "staging: BAN_MOCK=1 FORCE_OIDC=1 — Dex :5556 · OPA · OpenSearch · Obs · gateway:8089"
	@echo "env file: deploy/.env.staging (override before make if needed)"

compose-down:
	$(COMPOSE) --profile full --profile temporal --profile oidc --profile authentik --profile kafka --profile mtls --profile spiffe --profile coarse --profile milvus --profile opa --profile search --profile obs --profile replica down

buf-generate:
	@command -v buf >/dev/null || { echo "install buf CLI into PATH"; exit 1; }
	@command -v protoc-gen-go >/dev/null || $(GO) install google.golang.org/protobuf/cmd/protoc-gen-go@v1.35.2
	@command -v protoc-gen-connect-go >/dev/null || $(GO) install connectrpc.com/connect/cmd/protoc-gen-connect-go@v1.17.0
	PATH="$(HOME)/go/bin:$(PATH)" buf generate

buf-lint:
	@command -v buf >/dev/null || { echo "install buf CLI into PATH"; exit 1; }
	buf lint

certs:
	@bash deploy/certs/generate.sh

certs-rotate:
	@bash deploy/certs/rotate.sh 1

worker qzda-workflow:
	$(GO) run ./cmd/qzda-workflow

compose-ps:
	$(COMPOSE) ps

compose-logs:
	$(COMPOSE) logs --tail=100

infra-env:
	@test -f deploy/.env || cp deploy/.env.example deploy/.env
	@bash ../scripts/dev-stack/ensure-docker-postgres.sh
	@echo "using DE_DATABASE_URL=$(DE_DATABASE_URL)"
	@echo "using DE_REDIS_URL=$(DE_REDIS_URL)"

runtime:
	pip install -q -r services/qzda-agent-runtime/requirements.txt
	cd services/qzda-agent-runtime && python3 -m uvicorn app.main:app --host $${DE_BIND_HOST:-127.0.0.1} --port $${DE_BIND_PORT:-8091}

rag:
	@echo "RAG backend: $${DE_MILVUS_URI:-vector-memory}"
	pip install -q -r services/qzda-rag/requirements.txt
	cd services/qzda-rag && python3 -m uvicorn app.main:app --host $${DE_BIND_HOST:-127.0.0.1} --port $${DE_BIND_PORT:-8092}

skill:
	pip install -q -r services/qzda-skill-runtime/requirements.txt
	cd services/qzda-skill-runtime && DE_SKILL_REQUIRE_ISOLATION=$${DE_SKILL_REQUIRE_ISOLATION:-0} python3 -m uvicorn app.main:app --host $${DE_BIND_HOST:-127.0.0.1} --port $${DE_BIND_PORT:-8093}

sync-builtin-skills:
	@bash ../scripts/sync-builtin-skills.sh
	@chmod +x builtin/skills/runtime/bin/* 2>/dev/null || true

install-external-skill-bins:
	@bash ../scripts/install-external-skill-bins.sh

BASE ?= http://127.0.0.1:8089

smoke smoke-monolith:
	@curl -sf $(BASE)/healthz >/dev/null && echo "healthz ok" || (echo "start monolith stack first: make compose-up-monolith" && exit 1)
	@TOKEN=$$(curl -sf -X POST $(BASE)/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@acme.com","password":"x"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])') && \
	curl -sf -H "Authorization: Bearer $$TOKEN" $(BASE)/api/workspaces >/dev/null && echo "workspaces ok" && \
	curl -sf -H "Authorization: Bearer $$TOKEN" $(BASE)/api/skills >/dev/null && echo "skills ok" && \
	curl -sf -H "Authorization: Bearer $$TOKEN" $(BASE)/api/sessions >/dev/null && echo "sessions ok" && \
	curl -sf -X POST -H "Authorization: Bearer $$TOKEN" -H 'Content-Type: application/json' -d '{"resource":"workflow","action":"publish"}' $(BASE)/api/zero-trust/evaluate >/dev/null && echo "evaluate ok"

smoke-coarse:
	@curl -sf $(BASE)/healthz >/dev/null && echo "healthz ok" || (echo "start coarse stack first: make compose-up-coarse" && exit 1)
	@TOKEN=$$(curl -sf -X POST $(BASE)/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@acme.com","password":"x"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])') && \
	curl -sf -H "Authorization: Bearer $$TOKEN" $(BASE)/api/workspaces >/dev/null && echo "workspaces ok" && \
	curl -sf -X POST -H "Authorization: Bearer $$TOKEN" -H 'Content-Type: application/json' -d '{"resource":"workflow","action":"publish"}' $(BASE)/api/zero-trust/evaluate >/dev/null && echo "evaluate ok" && \
	curl -sf -H "Authorization: Bearer $$TOKEN" http://127.0.0.1:8102/api/channel/deployments >/dev/null && echo "cap channel ok"

test-python:
	python3 runtimes/de_rag/test_vector.py
	python3 runtimes/de_skill_runtime/test_runtoken.py
	python3 runtimes/de_agent_runtime/test_run.py

# W1-D3 · Skill 签名校验 CI gate。校验 builtin/skills/manifest.json
# 中所有 skill 的 Ed25519 签名 + 每个文件 SHA256。CI 必跑：失败即阻断
# 发布。失败时输出第一个 bad skill 的 keyID + 文件路径，便于定位。
verify-builtins:
	@echo "==> verifying all builtins against $(PWD)/builtin/skills/manifest.json"
	@$(GO) run ./cmd/verify-skill --manifest $(PWD)/builtin/skills/manifest.json $(PWD)/builtin/skills

# W1-D3 · Skill 内容静态扫描 CI gate。扫描 builtin + 用户上传 skill
# 的 destructive / egress / credential / escalation / persistence 5 类
# 危险模式。失败即阻断。CLI 走 verify-skill --vet=strict，避免维护
# 第二条 skill 列举清单。
vet-builtins:
	@echo "==> vetting core builtins against dangerous-pattern scanner"
	@$(GO) run ./cmd/verify-skill --vet=strict --manifest $(PWD)/builtin/skills/manifest.json $(PWD)/builtin/skills

# W1-D3 · Skill 安全全链路 CI gate。覆盖 vetter + signer 双闸门。
# 任何 builtin 内容 / 签名变化必须通过本 target 才能合并。
skill-gate: vet-builtins verify-builtins
	@echo "==> skill-gate: PASS"

.PHONY: verify-builtins vet-builtins skill-gate
