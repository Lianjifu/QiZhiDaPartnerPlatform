-- Full ACME / NewDemo seed purge for local联调 DB.
-- KEEPS: user-created employees (de-3…), real model providers (mp-31+),
--        conversation/session memory with memory-N ids, builtin skills,
--        workspaces, and live sessions sess-69 / conv-13.
-- Usage: psql "$QZDA_DATABASE_URL" -f backend/scripts/purge-demo-seed-ids.sql

BEGIN;

-- ========== Kernel: drop ACME / orphan demo collab rows ==========
DELETE FROM collab.messages
WHERE conversation_id IN ('s1', 'conv-1', 'sess-1', 'conv-3')
   OR id IN ('msg-s1-1', 'msg-s1-2', 'msg-1', 'msg-2');

DELETE FROM collab.context_snapshots
WHERE conversation_id IN ('s1', 'conv-1', 'sess-1', 'conv-3', 'conv-19', 'conv-43')
   OR id IN ('s1', 'conv-1', 'sess-1');

DELETE FROM collab.sessions
WHERE id IN ('s1', 'sess-1', 'sess-4')
   OR conversation_id IN ('s1', 'conv-1', 'conv-3');

-- ========== Legacy kv copies of sessions/conversations/messages ==========
DELETE FROM platform.kv_documents
WHERE collection IN ('sessions', 'conversations', 'messages', 'context_snapshots')
  AND id IN ('s1', 'sess-1', 'sess-4', 'conv-1', 'conv-3', 'conv-68', 'msg-s1-1', 'msg-s1-2', 'msg-1', 'msg-2');

-- ========== ACME seed entities ==========
DELETE FROM platform.kv_documents
WHERE collection = 'employees'
  AND id IN ('de-1', 'de-2', 'de-hr', 'de-general', 'de-sre', 'de-alert-ops', 'de-capacity');

DELETE FROM platform.kv_documents
WHERE collection = 'actions'
  AND id IN ('msg-s1-2');

DELETE FROM platform.kv_documents
WHERE collection = 'backups'
  AND id IN ('bk-1');

DELETE FROM platform.kv_documents
WHERE collection = 'channel_audit'
  AND id IN ('ca-1', 'ca-2', 'ca-3');

DELETE FROM platform.kv_documents
WHERE collection = 'channel_blacklist'
  AND id IN ('b1', 'b2');

DELETE FROM platform.kv_documents
WHERE collection = 'channel_deploys'
  AND id IN ('delivery-email', 'delivery-feishu', 'delivery-wecom', 'delivery-dingtalk');

DELETE FROM platform.kv_documents
WHERE collection = 'channel_dlq'
  AND id IN ('da-demo-1');

DELETE FROM platform.kv_documents
WHERE collection = 'channel_templates'
  AND id IN ('card1', 'card2', 'card3');

DELETE FROM platform.kv_documents
WHERE collection = 'delivery_policies'
  AND id IN ('delivery-policy-p0');

DELETE FROM platform.kv_documents
WHERE collection = 'delivery_policy_versions';

DELETE FROM platform.kv_documents
WHERE collection = 'knowledge_docs'
  AND id IN ('kd-1', 'kd-2');

DELETE FROM platform.kv_documents
WHERE collection = 'knowledge_extra'
  AND id IN ('knowledge_extra');

DELETE FROM platform.kv_documents
WHERE collection = 'memory_records'
  AND id IN ('mem-short-1', 'mem-work-1', 'mem-long-1', 'mem-long-2', 'mem-long-pending');

DELETE FROM platform.kv_documents
WHERE collection = 'memory_candidates'
  AND id IN ('mc-1');

DELETE FROM platform.kv_documents
WHERE collection = 'memory_audits'
  AND id IN ('ma-1', 'ma-2', 'ma-3');

DELETE FROM platform.kv_documents
WHERE collection = 'memory_policies';

DELETE FROM platform.kv_documents
WHERE collection = 'model_providers'
  AND id IN ('mp-1', 'mp-2', 'mp-9');

DELETE FROM platform.kv_documents
WHERE collection = 'model_secrets'
  AND id LIKE 'vault://model-providers/mp-1/%'
     OR id LIKE 'vault://model-providers/mp-2/%'
     OR id LIKE 'vault://model-providers/mp-9/%';

DELETE FROM platform.kv_documents
WHERE collection = 'model_audit'
  AND id IN ('ma-1');

DELETE FROM platform.kv_documents
WHERE collection = 'routing_policies'
  AND id IN ('rp-p0', 'rp-p1', 'rp-p3', 'rp-draft', 'rp-default', 'mr-p0');

DELETE FROM platform.kv_documents
WHERE collection = 'policy_versions'
  AND id IN ('rpv-1');

DELETE FROM platform.kv_documents
WHERE collection = 'tasks'
  AND (
    id IN ('task-1', 'task-2', 'task-8')
    OR COALESCE(payload->>'title', '') LIKE '%Redis OOM%'
  );

DELETE FROM platform.kv_documents
WHERE collection = 'release_approvals'
  AND id IN ('approval-agent-21');

DELETE FROM platform.kv_documents
WHERE collection = 'access_grants'
  AND id IN ('grant-admin', 'grant-user', 'grant-auditor');

DELETE FROM platform.kv_documents
WHERE collection = 'temp_auths'
  AND id IN ('zta-1');

DELETE FROM platform.kv_documents
WHERE collection = 'workflows'
  AND id IN ('wf1');

DELETE FROM platform.kv_documents
WHERE collection = 'workflow_skills'
  AND id IN ('wfs-1');

DELETE FROM platform.kv_documents
WHERE collection = 'workflow_runs'
  AND id IN ('run-1');

DELETE FROM platform.kv_documents
WHERE collection = 'skill_catalog'
  AND id IN ('sc-demo', 'sc-high', 'sc-unsigned', 'sc-vuln');

-- Seed skill installs (not builtin packs, not user sk-62+)
DELETE FROM platform.kv_documents
WHERE collection = 'skills'
  AND id IN (
    'sk-docx', 'sk-sandbox', 'sk-30',
    'sk-1', 'sk-2', 'sk-3', 'sk-4', 'sk-5', 'sk-6', 'sk-7', 'sk-8', 'sk-9',
    'sk-10', 'sk-11', 'sk-12', 'sk-13', 'sk-14', 'sk-15', 'sk-16', 'sk-17', 'sk-18', 'sk-19',
    'sk-20', 'sk-21', 'sk-22', 'sk-23', 'sk-24', 'sk-25', 'sk-26', 'sk-27', 'sk-28', 'sk-29',
    'sk-31', 'sk-32', 'sk-33', 'sk-34', 'sk-35', 'sk-36'
  );

DELETE FROM platform.kv_documents
WHERE collection = 'skill_health'
  AND (
    id IN (
      'sh-sk-docx', 'sh-sk-sandbox', 'sh-sk-30',
      'sh-sk-1', 'sh-sk-2', 'sh-sk-3', 'sh-sk-4', 'sh-sk-5', 'sh-sk-6', 'sh-sk-7', 'sh-sk-8', 'sh-sk-9',
      'sh-sk-10', 'sh-sk-11', 'sh-sk-12', 'sh-sk-13', 'sh-sk-14', 'sh-sk-15', 'sh-sk-16', 'sh-sk-17', 'sh-sk-18', 'sh-sk-19',
      'sh-sk-20', 'sh-sk-21', 'sh-sk-22', 'sh-sk-23', 'sh-sk-24', 'sh-sk-25', 'sh-sk-26', 'sh-sk-27', 'sh-sk-28', 'sh-sk-29',
      'sh-sk-31', 'sh-sk-32', 'sh-sk-33', 'sh-sk-34', 'sh-sk-35', 'sh-sk-36',
      'sh-sk-57', 'sh-sk-58', 'sh-sk-59', 'sh-sk-60', 'sh-sk-61'
    )
    OR (id LIKE 'sh-sk-%' AND id NOT LIKE 'sh-sk-builtin-%' AND id NOT IN ('sh-sk-62', 'sh-sk-docx'))
  );

-- Reset skill_extra seed bindings blob (will be rebuilt lightly on boot)
DELETE FROM platform.kv_documents
WHERE collection = 'skill_extra'
  AND id IN ('skill_extra');

DELETE FROM platform.kv_documents
WHERE collection = 'template_adoptions'
  AND id IN ('adopt-1');

DELETE FROM platform.kv_documents
WHERE collection = 'employee_templates'
  AND id IN ('tpl-sre');

DELETE FROM platform.kv_documents
WHERE collection = 'employee_configs'
  AND id IN ('cfg-1');

-- Neutralize ACME branding on seed workspace shells (keep ids for FK continuity).
UPDATE platform.kv_documents
SET payload = jsonb_set(jsonb_set(payload, '{tenantId}', '"tenant-local"'), '{name}',
  CASE id
    WHEN 'w1' THEN '"工作区 1"'
    WHEN 'w2' THEN '"工作区 2"'
    WHEN 'w3' THEN '"工作区 3"'
    ELSE to_jsonb(COALESCE(payload->>'name', id))
  END)
WHERE collection = 'workspaces'
  AND id IN ('w1', 'w2', 'w3', 'w4')
  AND (
    payload->>'tenantId' = 'tenant-acme'
    OR payload->>'name' LIKE 'ACME%'
  );

-- ========== Phase 2: wipe all联调 residue (keep model providers + workspaces + builtins) ==========
TRUNCATE collab.messages, collab.context_snapshots, collab.sessions;
TRUNCATE cap.channel_inbound;

DELETE FROM platform.kv_documents WHERE collection IN (
  'employees', 'sessions', 'conversations', 'messages', 'context_snapshots',
  'memory_records', 'memory_audits', 'memory_candidates', 'memory_policies',
  'evolve_candidates', 'model_audit', 'actions', 'tasks', 'backups',
  'release_approvals', 'workflow_runs', 'workflows', 'workflow_skills',
  'channel_audit', 'channel_blacklist', 'channel_deploys', 'channel_dlq',
  'channel_templates', 'channel_inbound', 'delivery_policies', 'delivery_policy_versions',
  'knowledge_docs', 'knowledge_extra', 'policy_versions', 'routing_policies',
  'access_grants', 'temp_auths', 'template_adoptions', 'employee_configs', 'employee_templates'
);

DELETE FROM platform.kv_documents
WHERE collection = 'skills' AND id NOT LIKE 'sk-builtin-%';

DELETE FROM platform.kv_documents
WHERE collection = 'skill_health' AND id NOT LIKE 'sh-sk-builtin-%';

DELETE FROM platform.kv_documents
WHERE collection = 'skill_catalog' AND id NOT LIKE 'sc-builtin-%';

DELETE FROM platform.kv_documents WHERE collection = 'skill_extra';

COMMIT;
