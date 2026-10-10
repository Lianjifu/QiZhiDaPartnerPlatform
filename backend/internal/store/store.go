package store

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/memory/provenance"
)

// Store is an in-memory control-plane state (Phase A–C default; PG later).
type Store struct {
	mu  sync.RWMutex
	seq atomic.Uint64

	Workspaces       []map[string]any
	SwitchHistory    []map[string]any
	Members          map[string][]map[string]any
	Quotas           map[string]map[string]any
	Bindings         []map[string]any
	Environments     []map[string]any
	WorkspacePolicy  map[string]map[string]any
	Audits           []map[string]any
	ZTPolicies       []map[string]any
	ZTEvents         []map[string]any
	TempAuths        []map[string]any
	AccessGrants     []map[string]any
	AccessReviews    []map[string]any
	SodRules         []map[string]any
	ReleaseApprovals []map[string]any

	Employees         []map[string]any
	EmployeeTemplates []map[string]any
	TemplateAdoptions []map[string]any
	CapabilityCatalog map[string]any
	ConfigVersions    []map[string]any
	ConfigDrafts      map[string]map[string]any
	Tasks             []map[string]any
	ScheduledTasks    []map[string]any
	ScheduledRuns     []map[string]any

	ModelProviders  []map[string]any
	RoutingPolicies []map[string]any
	PolicyVersions  []map[string]any
	ModelAudit      []map[string]any
	ModelRoutes     []map[string]any
	ModelBudgets    []map[string]any
	UsageMeters     []map[string]any
	// ModelSecrets maps credentialRef → plaintext for local durability when Vault is unset.
	// Never expose via HTTP list APIs.
	ModelSecrets   map[string]string
	KnowledgeDocs  []map[string]any
	KBList         []map[string]any
	KnowledgeExtra map[string]any // packages, sources, governance, …
	Conversations  []map[string]any
	Messages       map[string][]map[string]any
	Sessions       []map[string]any
	SlashCommands  []map[string]any
	Actions        map[string]map[string]any

	Workflows             []map[string]any
	WorkflowSkills        []map[string]any
	WorkflowRuns          []map[string]any
	WorkflowVersions      map[string][]map[string]any
	WorkflowGens          []map[string]any
	OrchestrationSessions []map[string]any
	WorkflowTpls          []map[string]any
	Skills                []map[string]any
	SkillCatalog          []map[string]any
	SkillGovernance       map[string]any
	SkillHealth           []map[string]any
	SkillIntegrations     []map[string]any
	SkillExtra            map[string]any // policies, runtimes, permissions, versions, bindings, incidents, events
	// W2-D1 · workspace publisher keypairs (per-workspace Ed25519 trust anchor).
	// Flatted shape: each (workspaceId, keyId) is one entry; multiple keys
	// per workspace represent rotation history (`status="rotated"` /
	// `"revoked"`). There is at most ONE entry per workspace with
	// status="active" — enforced by the mutation endpoints.
	WorkspacePublisherKeys map[string]map[string]any
	MemoryRecords          []map[string]any
	MemoryCands            []map[string]any
	EvolveCands            []map[string]any // Self-Evolution candidates (Phase 4)
	MemoryPolicies         map[string]map[string]any
	MemoryAudits           []map[string]any
	MemoryExtra            map[string]any // identity profiles, provenance migration stamp, layer policies
	Channels               []map[string]any
	ChannelDeploys         []map[string]any
	DeliveryPolicies       []map[string]any
	DeliveryPolicyVersions []map[string]any
	ChannelTemplates       []map[string]any
	ChannelBlacklist       []map[string]any
	ChannelAudit           []map[string]any
	ChannelDLQ             []map[string]any
	ChannelHealth          map[string]map[string]any
	ChannelInbound         []map[string]any // Feishu/Lark inbound events (normalized)
	ContextSnapshots       []map[string]any // Agent OS ContextSnapshot + replay events (ADR-013)
	// ExpertInbox is the W3-D1 inbox for human review of items that the
	// automation pipeline can't resolve on its own (escalations from
	// copilot turns, ambiguous agent outputs, sensitive skill runs).
	// Each item carries: id, workspaceId, source ("copilot" / "skill" /
	// "channel" / "manual"), severity ("info" / "warn" / "block"),
	// status ("pending" / "approved" / "rejected" / "dismissed"),
	// createdAt, createdBy, payload, reviewedAt?, reviewer?, decision?,
	// note?. Lifecycle in ADR-023.
	ExpertInbox []map[string]any

	HomeKPIs             map[string]any
	HomeExtra            map[string]any
	HomeAlerts           []map[string]any
	Billing              map[string]any
	Backups              []map[string]any
	OpsOverview          map[string]any
	NotificationChannels []map[string]any
	APIKeys              []map[string]any
	WebhooksConfig       []map[string]any
	TenantProfile        map[string]any
	// ActorExtraWorkspaces tracks workspaces granted after login (e.g. create).
	ActorExtraWorkspaces map[string][]string
	CopilotIdempotency   map[string]map[string]any // cid|clientMsgId → assistant message replay

	// Optional hook for durable audit sink (Postgres via Docker).
	auditHook func(map[string]any)
	// Optional durable collection snapshot (platform.kv_documents).
	persistHook PersistFunc
	deleteHook  DeleteFunc
	// Optional sync handler replacing the fire-and-forget goroutine in
	// PersistCollection for collections needing strict ordering (e.g.
	// "employees" where concurrent DELETE-all+INSERT races otherwise
	// resurrect deleted rows).
	serialHook func(collection string, items []map[string]any)
	writeDomain Domain

	// closed is set by Close() to make it idempotent. atomic.Bool so callers
	// don't need to take mu just to short-circuit a second Close().
	closed atomic.Bool
}

func New() *Store {
	// Compatible default for unit tests: demo seed in memory.
	return NewDemo()
}

// NewDemo builds an in-memory store with ACME demonstration seed (演示环境).
func NewDemo() *Store {
	s := newStoreShell()
	s.seed()
	return s
}

// NewEmpty builds a store with no demonstration seed (production data mode).
func NewEmpty() *Store {
	return newStoreShell()
}

func newStoreShell() *Store {
	return &Store{
		Members:              map[string][]map[string]any{},
		Quotas:               map[string]map[string]any{},
		WorkspacePolicy:      map[string]map[string]any{},
		ConfigDrafts:         map[string]map[string]any{},
		Messages:             map[string][]map[string]any{},
		Actions:              map[string]map[string]any{},
		ModelSecrets:         map[string]string{},
		MemoryPolicies:       map[string]map[string]any{},
		WorkflowVersions:     map[string][]map[string]any{},
		KnowledgeExtra:       map[string]any{},
		MemoryExtra:          map[string]any{},
		ChannelHealth:        map[string]map[string]any{},
		ActorExtraWorkspaces: map[string][]string{},
		CopilotIdempotency:   map[string]map[string]any{},
		TenantProfile: map[string]any{
			"name": "ACME Corp", "tenantId": "tenant-acme", "region": "cn-east-1",
			"createdAt": "2024-03-12", "status": "active",
		},
		SkillGovernance:        map[string]any{},
		WorkspacePublisherKeys: map[string]map[string]any{}, // W2-D1
	}
}

func (s *Store) Lock()    { s.mu.Lock() }
func (s *Store) Unlock()  { s.mu.Unlock() }
func (s *Store) RLock()   { s.mu.RLock() }
func (s *Store) RUnlock() { s.mu.RUnlock() }

func (s *Store) ID(prefix string) string {
	n := s.seq.Add(1)
	return fmt.Sprintf("%s-%d", prefix, n)
}

// BumpSeqFromPrefixedIDs advances the ID counter past existing "{prefix}-N" values (post-hydrate).
func (s *Store) BumpSeqFromPrefixedIDs(prefix string) {
	s.bumpSeqFromMaps(prefix, s.Skills)
}

// MigrateProvenance stamps a Provenance on every MemoryRecord that lacks one
// (Mem7). Idempotent — re-running on already-stamped records is a no-op.
// Returns the number of records newly stamped.
func (s *Store) MigrateProvenance() int {
	if s == nil {
		return 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.fillProvenanceLocked()
}

func (s *Store) fillProvenanceLocked() int {
	n := 0
	for _, m := range s.MemoryRecords {
		if _, ok := m["provenance"]; ok {
			continue
		}
		title, _ := m["title"].(string)
		content, _ := m["content"].(string)
		createdAt, _ := m["createdAt"].(string)
		p := provenance.StampLegacy(title + "\n" + content)
		if createdAt != "" {
			p.CreatedAt = createdAt
		}
		m["provenance"] = p
		n++
	}
	if n > 0 {
		s.MemoryExtra["provenanceMigrationStamp"] = time.Now().UTC().Format(time.RFC3339)
		s.MemoryExtra["provenanceMigrationCount"] = n
	}
	return n
}

func (s *Store) bumpSeqFromMaps(prefix string, items []map[string]any) {
	prefixDash := prefix + "-"
	var max uint64
	if cur := s.seq.Load(); cur > max {
		max = cur
	}
	for _, item := range items {
		id := str(item["id"])
		if !strings.HasPrefix(id, prefixDash) {
			continue
		}
		n, err := strconv.ParseUint(strings.TrimPrefix(id, prefixDash), 10, 64)
		if err == nil && n > max {
			max = n
		}
	}
	if max > 0 {
		s.seq.Store(max)
	}
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

func controlledTask(id, ws, code, title, priority, status, stage, ownerID, deID, source string) map[string]any {
	return map[string]any{
		"id": id, "workspaceId": ws, "code": code, "title": title, "priority": priority,
		"status": status, "lifecycleStage": stage, "ownerId": ownerID, "ownerName": ownerID,
		"digitalPartnerId": deID, "digitalPartnerName": "数字伙伴", "assignee": ownerID, "source": source,
		"progress": map[string]any{"done": 1, "total": 3}, "tags": []string{},
		"sla":        map[string]any{"remainingMin": 45, "risk": "none", "escalated": false},
		"execution":  map[string]any{"retryCount": 0, "paused": false, "currentStep": "执行中"},
		"governance": map[string]any{"approvalRequired": false, "approvalStatus": "not_required"},
		"links":      map[string]any{}, "auditEvents": []map[string]any{}, "version": 1,
		"createdAt": "2026-07-22T01:00:00Z", "updatedAt": "2026-07-22T08:00:00Z",
		"environment": "sandbox", "classification": "internal", "createdBy": ownerID,
	}
}

func (s *Store) SetAuditHook(fn func(map[string]any)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.auditHook = fn
}

// Close releases the hooks owned by this Store so any subsequent
// SetPersistHook / SetDeleteHook / SetAuditHook call re-arms them fresh
// against a replacement backend. Close does not own the underlying
// database / cache handles — those belong to Server (and are closed via
// RegisterCloseFunc in apprun.runDurable). This method is:
//
//   - nil-safe: calling Close on a nil *Store returns nil
//   - idempotent: the second and later calls return nil without
//     re-running the drain, so double Close can't double-free
//
// Returns the first non-nil error from any sub-close. Today every drain
// step is a simple field nil-out (no I/O), so the error is always nil;
// the signature is preserved so future hooks that need to flush buffers
// or signal downstream services can return real ones.
func (s *Store) Close() error {
	if s == nil {
		return nil
	}
	if !s.closed.CompareAndSwap(false, true) {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Hooks are function references held by Set{...}Hook. The Store does not
	// own the resources behind them (pgxpool, redis client, SQLite handle),
	// so Close just severs our references. After Close, callers that still
	// hit PersistCollection / AppendAudit / PersistDelete observe nil hooks
	// and skip the I/O — see PersistCollection / AppendAudit / PersistDelete
	// for the nil-hook guards.
	s.auditHook = nil
	s.persistHook = nil
	s.deleteHook = nil
	return nil
}

func (s *Store) AppendAudit(workspaceID, actor, action, target string, result string, reason string) map[string]any {
	ev := map[string]any{
		"id": s.ID("audit"), "workspaceId": workspaceID, "time": now(),
		"actor": actor, "action": action, "target": target,
		"result": result, "reason": reason, "correlationId": s.ID("corr"),
	}
	s.Audits = append([]map[string]any{ev}, s.Audits...)
	if s.auditHook != nil {
		s.auditHook(ev)
	}
	return ev
}

func (s *Store) seed() {
	s.Workspaces = []map[string]any{
		{"id": "w1", "tenantId": "tenant-acme", "ownerId": "u1", "status": "active", "name": "ACME 生产", "region": "cn-east-1", "plan": "enterprise_plus", "memberCount": 18, "complianceScore": 98, "createdAt": "2024-03-12T00:00:00Z"},
		{"id": "w2", "tenantId": "tenant-acme", "ownerId": "u1", "status": "active", "name": "ACME 预发", "region": "cn-east-1", "plan": "enterprise", "memberCount": 6, "complianceScore": 92, "createdAt": "2024-05-08T00:00:00Z"},
		{"id": "w3", "tenantId": "tenant-acme", "ownerId": "u1", "status": "active", "name": "ACME 安全", "region": "cn-east-1", "plan": "enterprise_plus", "memberCount": 4, "complianceScore": 100, "createdAt": "2024-06-01T00:00:00Z"},
		{"id": "w4", "tenantId": "tenant-acme", "ownerId": "u1", "status": "active", "name": "外协沙箱", "region": "cn-south-1", "plan": "standard", "memberCount": 2, "complianceScore": 85, "createdAt": "2025-01-15T00:00:00Z"},
	}
	s.SwitchHistory = []map[string]any{
		{"id": "sw1", "workspaceId": "w1", "workspaceName": "ACME 生产", "switchedAt": "2026-07-22T08:00:00Z", "actor": "平台管理员"},
		{"id": "sw2", "workspaceId": "w2", "workspaceName": "ACME 预发", "switchedAt": "2026-07-21T10:00:00Z", "actor": "业务构建者"},
	}
	s.Members["w1"] = []map[string]any{
		{"id": "m1", "userId": "u1", "workspaceId": "w1", "name": "平台管理员", "email": "admin@acme.com", "role": "admin", "title": "平台管理员", "mfa": true, "lastActive": "刚刚"},
		{"id": "m2", "userId": "u2", "workspaceId": "w1", "name": "业务构建者", "email": "user@acme.com", "role": "builder", "title": "运营负责人", "mfa": true, "lastActive": "5 分钟前"},
		{"id": "m3", "userId": "u3", "workspaceId": "w1", "name": "合规审计员", "email": "audit@acme.com", "role": "auditor", "title": "合规审计", "mfa": true, "lastActive": "1 小时前"},
	}
	s.Quotas["w1"] = map[string]any{
		"workspaceId": "w1",
		"seats":       map[string]any{"used": 3, "limit": 50},
		"agents":      map[string]any{"used": 2, "limit": 20},
		"concurrency": map[string]any{"used": 0, "limit": 20},
		// Overview cost must come from UsageMeters; keep quota counters honest (no demo 1240/3000).
		"tokens":    map[string]any{"used": 0, "limit": 5000000},
		"budgetUsd": map[string]any{"used": 0, "limit": 0},
	}
	s.Bindings = []map[string]any{
		{"id": "wb1", "workspaceId": "w1", "environment": "production", "kind": "agent", "name": "故障自愈", "status": "active"},
		{"id": "wb2", "workspaceId": "w1", "environment": "production", "kind": "model", "name": "P0 路由策略", "status": "active"},
	}
	for _, kind := range []string{"sandbox", "staging", "production"} {
		canary := 100
		if kind == "production" {
			canary = 10
		}
		s.Environments = append(s.Environments, map[string]any{
			"id": "w1-" + kind, "workspaceId": "w1", "kind": kind,
			"approvalRequired": kind == "production", "canaryPercent": canary, "status": "ready",
		})
	}
	s.WorkspacePolicy["w1"] = map[string]any{
		"workspaceId": "w1", "dataClassification": "restricted", "egressAllowed": false,
		"toolAllowlist": []string{"read_file", "web_fetch"}, "retentionDays": 365, "exceptionStatus": "none",
	}

	s.ZTPolicies = []map[string]any{
		{"id": "zt-user-production", "name": "普通用户生产变更门禁", "resource": "workflow", "action": "publish", "scope": "production", "condition": "角色为普通用户", "decision": "approval_required", "enabled": true, "baseline": true, "version": 3, "updatedAt": "2026-07-22T00:00:00Z", "updatedBy": "平台管理员"},
		{"id": "zt-restricted-egress", "name": "受限数据禁止外部出口", "resource": "model", "action": "run", "scope": "external_egress", "condition": "数据分类为受限", "decision": "deny", "enabled": true, "baseline": true, "version": 5, "updatedAt": "2026-07-22T00:00:00Z", "updatedBy": "安全管理员"},
		{"id": "zt-memory-governance", "name": "记忆治理管理员专属", "resource": "memory", "action": "write", "scope": "workspace", "condition": "修改保留、提炼或审核策略", "decision": "deny", "enabled": true, "baseline": true, "version": 2, "updatedAt": "2026-07-22T00:00:00Z", "updatedBy": "平台管理员"},
		{"id": "zt-tool-approval", "name": "高风险工具调用复核", "resource": "skill", "action": "run", "scope": "production", "condition": "高风险或写操作工具", "decision": "approval_required", "enabled": true, "baseline": true, "version": 4, "updatedAt": "2026-07-22T00:00:00Z", "updatedBy": "安全管理员"},
		{"id": "zt-auditor-readonly", "name": "审计角色只读", "resource": "export", "action": "write", "scope": "tenant", "condition": "角色为审计用户", "decision": "deny", "enabled": true, "baseline": true, "version": 1, "updatedAt": "2026-07-22T00:00:00Z", "updatedBy": "平台管理员"},
	}
	s.ZTEvents = []map[string]any{
		{"id": "zt-event-1", "time": "2026-07-22T08:12:00Z", "tenantId": "tenant-acme", "workspaceId": "w1", "actor": "业务构建者", "resource": "memory", "action": "write", "classification": "internal", "decision": "deny", "policyId": "zt-memory-governance", "reason": "普通用户不能修改记忆治理策略", "correlationId": "corr-zt-memory-1"},
	}
	s.TempAuths = []map[string]any{
		{"id": "zta-1", "subjectId": "u2", "subjectName": "业务构建者", "workspaceId": "w2", "environment": "staging", "resource": "workflow", "action": "run", "reason": "预发回归验证", "status": "active", "expiresAt": "2026-12-24T18:00:00Z", "approvedBy": "平台管理员"},
	}
	s.AccessGrants = []map[string]any{
		{"id": "grant-admin", "subjectId": "u1", "subjectName": "平台管理员", "role": "admin", "tenantId": "tenant-acme", "workspaceIds": []string{"w1", "w2", "w3", "w4"}, "environmentScopes": []string{"sandbox", "staging", "production"}, "status": "active", "grantedBy": "系统初始化", "createdAt": "2026-07-01T08:00:00Z"},
		{"id": "grant-user", "subjectId": "u2", "subjectName": "业务构建者", "role": "user", "tenantId": "tenant-acme", "workspaceIds": []string{"w1", "w2"}, "environmentScopes": []string{"sandbox", "staging"}, "status": "active", "grantedBy": "平台管理员", "createdAt": "2026-07-02T08:00:00Z"},
		{"id": "grant-auditor", "subjectId": "u3", "subjectName": "合规审计员", "role": "auditor", "tenantId": "tenant-acme", "workspaceIds": []string{"w1", "w2", "w3"}, "environmentScopes": []string{"sandbox", "staging", "production"}, "status": "active", "grantedBy": "平台管理员", "createdAt": "2026-07-03T08:00:00Z"},
	}
	s.AccessReviews = []map[string]any{
		{"id": "review-q3", "title": "第三季度生产环境访问复核", "scope": "生产环境 · 3 个工作区", "dueAt": "2026-07-31T23:59:59Z", "status": "open", "owner": "平台管理员", "reviewed": 12, "total": 18},
	}
	s.SodRules = []map[string]any{
		{"id": "sod-self-approval", "title": "创建者不可审批自己的生产发布", "description": "生产环境变更必须由另一名管理员审批。", "scope": "production", "enabled": true, "violations": 0},
		{"id": "sod-audit-readonly", "title": "审计用户只读", "description": "审计用户不得拥有资源编辑、权限配置或发布动作。", "scope": "tenant", "enabled": true, "violations": 0},
	}
	s.ReleaseApprovals = []map[string]any{
		{"id": "approval-agent-21", "workspaceId": "w1", "environment": "production", "resourceType": "agent", "resourceName": "客服质检助手 v2.1", "submittedBy": "业务构建者", "submittedById": "u2", "submittedAt": "2026-07-21T02:30:00Z", "status": "pending", "risk": "medium", "correlationId": "corr-release-agent-21"},
	}
	s.AppendAudit("w1", "系统", "初始化审计", "qzda-core", "success", "seed")

	s.CapabilityCatalog = map[string]any{
		"models":    []map[string]any{{"id": "mdl-gpt4", "name": "gpt-4o", "meta": "Azure OpenAI CN · cn-east"}},
		"knowledge": []map[string]any{{"id": "pkg-ops", "name": "运维知识库", "meta": "运维 · v3.1.0"}},
		"skills":    []map[string]any{{"id": "sk-docx", "name": "docx", "meta": "技能 · 1.0.0"}},
		"tools":     []map[string]any{},
		"workflows": []map[string]any{{"id": "wfs-1", "name": "故障自愈技能", "meta": "流程技能 · 1.2.0"}},
		"channels":  []map[string]any{{"id": "ch-1", "name": "企业微信通知", "meta": "渠道 · wecom"}},
	}
	s.EmployeeTemplates = []map[string]any{
		{"id": "tpl-sre", "name": "SRE 值班数字伙伴", "role": "SRE", "department": "信息技术部", "scope": "organization", "status": "certified", "source": "platform", "sourceName": "平台模板", "description": "故障响应与变更护栏", "serviceObject": "运维团队", "version": "1.0.0", "risk": "medium", "responsibilities": []string{"故障响应", "变更护栏"}, "prohibitedActions": []string{"生产直接写库"}, "capabilities": map[string]any{"model": "gpt-4o", "knowledge": []string{"运维知识库"}, "skills": []string{"docx", "summarize"}, "tools": []string{}, "workflows": []string{"故障自愈技能"}, "channels": []string{"Web"}}, "memoryPolicy": map[string]any{"shortTermHours": 24, "workingDays": 7, "longTermCadence": "daily", "knowledgePromotion": "approval_required"}, "applicableEnvironments": []string{"sandbox", "staging", "production"}, "adoptionCount": 1, "tags": []string{"sre"}, "publishedAt": "2026-07-01T00:00:00Z", "updatedAt": "2026-07-01T00:00:00Z"},
	}
	s.TemplateAdoptions = []map[string]any{
		{"id": "adopt-1", "templateId": "tpl-sre", "templateVersion": "1.0.0", "partnerId": "de-1", "workspaceId": "w1", "adoptedBy": "平台管理员", "status": "active", "createdAt": "2026-07-01T00:00:00Z"},
	}
	s.Employees = []map[string]any{
		{
			"id": "de-1", "workspaceId": "w1", "name": "故障自愈助手", "role": "SRE", "department": "信息技术部",
			"description": "生产故障自愈与护栏", "owner": "平台管理员", "ownerId": "u1", "escalationOwner": "值班经理", "serviceObject": "运维团队",
			"version": "1.0.0", "environment": "production", "lifecycle": "active", "risk": "medium",
			"responsibilities": []string{"故障响应", "变更护栏"}, "prohibitedActions": []string{"生产直接写库"},
			"capabilities": map[string]any{"model": "gpt-4o", "knowledge": []string{"运维知识库"}, "skills": []string{"docx", "summarize"}, "tools": []string{}, "workflows": []string{"故障自愈技能"}, "channels": []string{"Web"}},
			"memoryPolicy": map[string]any{"shortTermHours": 24, "workingDays": 7, "longTermCadence": "daily", "knowledgePromotion": "approval_required"},
			"runtime":      map[string]any{"calls24h": 120, "successRate": 0.98, "p95Ms": 420, "costToday": 12.5, "handoffs24h": 2, "anomalies": 0},
			"evaluation":   map[string]any{"status": "passed", "score": 94.2, "lastRunAt": "2026-07-20T00:00:00Z"},
			"release":      map[string]any{"status": "released", "releasedAt": "2026-07-15T00:00:00Z", "requestedBy": "业务构建者", "requestedById": "u2", "approver": "平台管理员", "approverId": "u1"},
			"templateId":   "tpl-sre", "templateVersion": "1.0.0", "updatedAt": "2026-07-20T00:00:00Z",
		},
		{
			"id": "de-hr", "workspaceId": "w1", "name": "听风", "role": "人事专员", "department": "人事部",
			"description": "入职办理、假期政策与人事制度问答", "owner": "郑人", "ownerId": "u2", "escalationOwner": "人事负责人", "serviceObject": "在职与入职员工",
			"version": "1.0.0", "environment": "production", "lifecycle": "active", "risk": "low",
			"responsibilities": []string{"入职办理", "假期政策解答", "人事制度问答"}, "prohibitedActions": []string{"不得承诺未审批编制", "不得泄露员工隐私"},
			"capabilities": map[string]any{"model": "gpt-4o", "knowledge": []string{"人事制度库"}, "skills": []string{"政策问答", "docx"}, "tools": []string{"HRIS"}, "workflows": []string{"人事服务协同流"}, "channels": []string{"Web"}},
			"memoryPolicy": map[string]any{"shortTermHours": 8, "workingDays": 14, "longTermCadence": "weekly", "knowledgePromotion": "approval_required"},
			"runtime":      map[string]any{"calls24h": 48, "successRate": 0.99, "p95Ms": 380, "costToday": 3.2, "handoffs24h": 1, "anomalies": 0},
			"evaluation":   map[string]any{"status": "passed", "score": 95.0, "lastRunAt": "2026-07-21T00:00:00Z"},
			"release":      map[string]any{"status": "released", "releasedAt": "2026-07-10T00:00:00Z", "requestedBy": "业务构建者", "requestedById": "u2", "approver": "平台管理员", "approverId": "u1"},
			"updatedAt":    "2026-07-21T00:00:00Z",
		},
		{
			"id": "de-2", "workspaceId": "w1", "name": "客服质检助手", "role": "QA", "department": "运营部",
			"description": "会话质检", "owner": "业务构建者", "ownerId": "u2", "escalationOwner": "运营负责人", "serviceObject": "客服团队",
			"version": "2.1.0", "environment": "sandbox", "lifecycle": "pending_approval", "risk": "low",
			"responsibilities": []string{"质检评分"}, "prohibitedActions": []string{"直接对客回复"},
			"capabilities": map[string]any{"model": "gpt-4o", "knowledge": []string{"运维知识库"}, "skills": []string{}, "tools": []string{}, "workflows": []string{}, "channels": []string{"Web"}},
			"memoryPolicy": map[string]any{"shortTermHours": 24, "workingDays": 7, "longTermCadence": "daily", "knowledgePromotion": "approval_required"},
			"runtime":      map[string]any{"calls24h": 0, "successRate": 0, "p95Ms": 0, "costToday": 0, "handoffs24h": 0, "anomalies": 0},
			"evaluation":   map[string]any{"status": "passed", "score": 92.0, "lastRunAt": "2026-07-21T00:00:00Z"},
			"release":      map[string]any{"status": "pending_approval", "requestedBy": "业务构建者", "requestedById": "u2"},
			"updatedAt":    "2026-07-21T00:00:00Z",
		},
	}
	s.ConfigVersions = []map[string]any{
		{"id": "cfg-1", "partnerId": "de-1", "version": "配置 v1", "status": "current", "changeSummary": "初始配置", "changedFields": []string{"岗位档案"}, "updatedBy": "平台管理员", "updatedById": "u1", "updatedAt": "2026-07-15T00:00:00Z"},
	}

	s.Tasks = []map[string]any{
		controlledTask("task-1", "w1", "T-1001", "排查缓存延迟", "P1", "in_progress", "running", "u2", "de-1", "alert"),
		controlledTask("task-2", "w1", "T-1002", "复核发布申请", "P2", "review", "human_action", "u1", "de-2", "manual"),
	}
	s.ScheduledTasks = []map[string]any{
		{
			"id": "sch-1", "workspaceId": "w1", "code": "SCH-1001", "title": "每日缓存巡检",
			"description": "工作日 09:00 触发数字伙伴巡检 Redis 命中率。",
			"cadence":     "daily", "hour": 9, "minute": 0, "timezone": "Asia/Shanghai",
			"nextRunAt": "2099-01-01T01:00:00Z", "enabled": true, "status": "active",
			"digitalPartnerId": "de-1", "digitalPartnerName": "SRE 故障处置专员",
			"owner": "平台管理员", "createdBy": "u1", "runCount": 12, "failCount": 0,
			"lastRunAt": "2026-07-22T01:00:00Z", "lastStatus": "success",
			"createdAt": "2026-07-01T00:00:00Z", "updatedAt": "2026-07-22T01:00:00Z",
		},
		{
			"id": "sch-2", "workspaceId": "w1", "code": "SCH-1002", "title": "每周容量盘点",
			"description": "每周一 10:00 汇总集群容量并创建团队协助待办。",
			"cadence":     "weekly", "hour": 10, "minute": 0, "weekday": 1, "timezone": "Asia/Shanghai",
			"nextRunAt": "2099-01-06T02:00:00Z", "enabled": true, "status": "active",
			"digitalPartnerId": "de-2", "digitalPartnerName": "变更协同专员",
			"owner": "平台管理员", "createdBy": "u1", "runCount": 4, "failCount": 1,
			"lastRunAt": "2026-07-21T02:00:00Z", "lastStatus": "success",
			"createdAt": "2026-06-02T00:00:00Z", "updatedAt": "2026-07-21T02:00:00Z",
		},
	}
	s.ScheduledRuns = []map[string]any{
		{"id": "schr-1", "scheduleId": "sch-1", "workspaceId": "w1", "startedAt": "2026-07-22T01:00:00Z", "finishedAt": "2026-07-22T01:00:08Z", "status": "success", "message": "已创建团队协助 T-1001", "taskId": "task-1", "taskCode": "T-1001"},
	}

	s.ModelProviders = []map[string]any{
		{"id": "mp-1", "workspaceId": "w1", "name": "Azure OpenAI CN", "tier": "official", "protocol": "azure_openai", "baseUrl": "https://example.openai.azure.com", "cloudRegion": "cn-east", "dataResidency": "cn", "status": "active", "credentialRef": "vault://model-providers/mp-1/credential", "credentialMasked": "••••abcd", "lastVerifiedAt": "2026-07-20T00:00:00Z", "lastProbeLatencyMs": 420, "models": []map[string]any{
			{"id": "mdl-gpt4", "providerId": "mp-1", "name": "gpt-4o", "cloudRegion": "cn-east", "dataResidency": "cn", "capabilities": []string{"chat", "reasoning"}, "status": "available", "contextWindow": 128000},
			{"id": "mdl-mini", "providerId": "mp-1", "name": "gpt-4o-mini", "cloudRegion": "cn-east", "dataResidency": "cn", "capabilities": []string{"chat"}, "status": "available", "contextWindow": 128000},
		}},
		{"id": "mp-2", "workspaceId": "w1", "name": "本地 Embedding", "tier": "self_hosted", "protocol": "ollama", "baseUrl": "http://127.0.0.1:11434", "cloudRegion": "cn-east", "dataResidency": "cn", "status": "standby", "credentialRef": "vault://model-providers/mp-2/credential", "credentialMasked": "••••••••", "models": []map[string]any{{"id": "mdl-emb", "providerId": "mp-2", "name": "bge-m3", "cloudRegion": "cn-east", "dataResidency": "cn", "capabilities": []string{"embedding"}, "status": "available", "contextWindow": 8192}}},
		{"id": "mp-9", "workspaceId": "w2", "name": "隔离工作区供应商", "tier": "self_hosted", "protocol": "custom", "baseUrl": "http://isolated-llm.internal/v1", "cloudRegion": "cn-east", "dataResidency": "cn", "status": "active", "credentialRef": "vault://model-providers/mp-9/credential", "credentialMasked": "••••••••", "models": []map[string]any{{"id": "mdl-w2", "providerId": "mp-9", "name": "local-chat", "cloudRegion": "cn-east", "dataResidency": "cn", "capabilities": []string{"chat"}, "status": "available", "contextWindow": 32000}}},
	}
	s.RoutingPolicies = []map[string]any{
		{"id": "rp-p0", "workspaceId": "w1", "level": "P0", "primaryModelId": "mdl-gpt4", "fallbackModelIds": []string{"mdl-mini"}, "dataScope": "internal", "egressAllowed": false, "budgetLimitUsd": 500, "status": "published", "validationIssues": []string{}},
		{"id": "rp-p1", "workspaceId": "w1", "level": "P1", "primaryModelId": "mdl-gpt4", "fallbackModelIds": []string{"mdl-mini"}, "dataScope": "internal", "egressAllowed": false, "budgetLimitUsd": 200, "status": "published", "validationIssues": []string{}},
		{"id": "rp-p3", "workspaceId": "w1", "level": "P3", "primaryModelId": "mdl-mini", "fallbackModelIds": []string{"mdl-gpt4"}, "dataScope": "internal", "egressAllowed": false, "budgetLimitUsd": 50, "status": "published", "validationIssues": []string{}},
		{"id": "rp-draft", "workspaceId": "w1", "level": "P2", "primaryModelId": "mdl-gpt4", "fallbackModelIds": []string{}, "dataScope": "internal", "egressAllowed": false, "budgetLimitUsd": 100, "status": "draft", "validationIssues": []string{}},
	}
	s.PolicyVersions = []map[string]any{
		{"id": "rpv-1", "policyId": "rp-p0", "version": 1, "snapshot": map[string]any{
			"id": "rp-p0", "workspaceId": "w1", "level": "P0", "primaryModelId": "mdl-gpt4",
			"fallbackModelIds": []string{"mdl-emb"}, "dataScope": "internal", "egressAllowed": false,
			"budgetLimitUsd": 500, "status": "published", "validationIssues": []string{},
		}, "publishedAt": "2026-07-18T00:00:00Z", "publishedBy": "平台管理员"},
	}
	s.ModelAudit = []map[string]any{
		{"id": "ma-1", "time": "2026-07-18T00:00:00Z", "workspaceId": "w1", "actor": "平台管理员", "action": "发布路由策略", "target": "P0", "result": "success", "correlationId": "corr-model-1"},
	}
	s.ModelRoutes = []map[string]any{
		{"id": "mr-p0", "workspaceId": "w1", "name": "企业通用路由 v2", "level": "P0", "primaryModelId": "mdl-gpt4", "fallbackModelIds": []string{"mdl-emb"}, "budgetLimitUsd": 500, "dataScope": "internal", "egressAllowed": false, "status": "published"},
	}
	s.ModelBudgets = []map[string]any{
		{"workspaceId": "w1", "month": "2026-07", "usedUsd": 124.5, "limitUsd": 500},
	}
	s.KnowledgeDocs = []map[string]any{
		{"id": "kd-1", "workspaceId": "w1", "packageId": "pkg-ops", "title": "故障手册-缓存", "source": "Runbook", "status": "ready", "ownerId": "u1", "sizeKb": 86, "chunks": 24, "citeCount": 12, "snippet": "Redis 缓存故障处置步骤与扩容建议。", "updatedAt": "2026-07-18T00:00:00Z", "quality": map[string]any{"completeness": 90, "freshness": 85, "citationAccuracy": 92}},
		{"id": "kd-2", "workspaceId": "w1", "packageId": "pkg-ops", "title": "发布检查清单", "source": "变更管理", "status": "indexing", "ownerId": "u2", "sizeKb": 32, "chunks": 9, "citeCount": 3, "snippet": "生产发布前检查项。", "updatedAt": "2026-07-19T00:00:00Z", "quality": map[string]any{"completeness": 70, "freshness": 90, "citationAccuracy": 80}},
	}
	s.KBList = []map[string]any{
		{"id": "kb-ops", "workspaceId": "w1", "name": "运维知识库", "docCount": 2, "status": "ready"},
	}

	s.Conversations = []map[string]any{
		{"id": "s1", "workspaceId": "w1", "title": "Redis OOM 处理", "digitalPartnerId": "de-1", "updatedAt": "2026-07-22T12:53:42Z", "messages": []map[string]any{}},
		{"id": "conv-1", "workspaceId": "w1", "title": "缓存延迟排查", "digitalPartnerId": "de-1", "updatedAt": "2026-07-22T08:00:00Z", "messages": []map[string]any{}},
	}
	s.Messages["s1"] = []map[string]any{
		{"id": "msg-s1-1", "role": "user", "content": "prod-redis-01 内存打满了，怎么扩容？", "createdAt": "2026-07-22T12:47:00Z"},
		{
			"id": "msg-s1-2", "role": "assistant",
			"content":   "建议先确认 maxmemory 与 eviction policy，再评估是否扩容到 16GB。高危变更需双重审批。",
			"createdAt": "2026-07-22T12:53:42Z",
			"approvalRequest": map[string]any{
				"action": "CONFIG SET maxmemory 16GB", "resource": "prod-redis-01",
				"reason": "等保 3 · 高危配置变更", "ticketId": "CHG-2026-0198",
				"required": 2, "signed": 1, "decision": "pending", "policyHash": "pol_redis_oom_s1",
				"signers": []map[string]any{
					{"userId": "u2", "name": "王昊", "role": "operator", "signed": true, "signedAt": "2026-07-22T12:48:20Z", "signatureHash": "sig_m3_u2_op"},
					{"userId": "u1", "name": "平台管理员", "role": "approver", "signed": false},
				},
			},
		},
	}
	s.Messages["conv-1"] = []map[string]any{
		{"id": "msg-1", "role": "user", "content": "缓存命中率下降怎么排查？", "createdAt": "2026-07-22T08:00:00Z"},
		{"id": "msg-2", "role": "assistant", "content": "建议先检查 Redis 慢查询与热点 key。", "createdAt": "2026-07-22T08:00:05Z"},
	}
	s.Sessions = []map[string]any{
		{
			"id": "s1", "workspaceId": "w1", "ownerId": "u1", "title": "Redis OOM 处理",
			"preview": "建议先确认 maxmemory 与 eviction policy，再评估是否扩容到 16GB。", "agent": "SRE 故障处置专员",
			"digitalPartnerId": "de-1", "digitalPartnerName": "SRE 故障处置专员",
			"conversationId": "s1", "status": "active",
			"createdAt": "2026-07-22T12:47:00Z", "updatedAt": "2026-07-22T12:53:42Z",
			"lastMessageAt": "2026-07-22T12:53:42Z", "pinned": true,
		},
		{
			"id": "sess-1", "workspaceId": "w1", "ownerId": "u1", "title": "缓存延迟排查",
			"preview": "建议先检查 Redis 慢查询与热点 key。", "agent": "SRE 故障处置专员",
			"digitalPartnerId": "de-1", "digitalPartnerName": "SRE 故障处置专员",
			"conversationId": "conv-1", "status": "active",
			"createdAt": "2026-07-22T08:00:00Z", "updatedAt": "2026-07-22T08:00:05Z",
			"lastMessageAt": "2026-07-22T08:00:05Z",
		},
	}
	s.SlashCommands = []map[string]any{
		{"cmd": "/expert", "desc": "切换岗位专家", "icon": "Bot", "category": "agent", "id": "cmd-expert", "name": "expert"},
		{"cmd": "/search", "desc": "检索知识库", "icon": "Search", "category": "kb", "id": "cmd-search", "name": "search"},
		{"cmd": "/task", "desc": "创建任务", "icon": "ListChecks", "category": "task", "id": "cmd-task", "name": "task"},
		{"cmd": "/skill", "desc": "调用技能", "icon": "Wrench", "category": "tool", "id": "cmd-skill", "name": "skill"},
		{"cmd": "/workflow", "desc": "触发已装配流程技能", "icon": "Workflow", "category": "tool", "id": "cmd-workflow", "name": "workflow"},
		{"cmd": "/model", "desc": "切换模型", "icon": "Cpu", "category": "tool", "id": "cmd-model", "name": "model"},
		{"cmd": "/doc", "desc": "查询文档", "icon": "FileText", "category": "kb", "id": "cmd-doc", "name": "doc"},
		{"cmd": "/member", "desc": "@ 提及成员", "icon": "Users", "category": "collab", "id": "cmd-member", "name": "member"},
		{"cmd": "/clear", "desc": "清空会话", "icon": "X", "category": "tool", "id": "cmd-clear", "name": "clear"},
		{"cmd": "/export", "desc": "导出对话", "icon": "Download", "category": "tool", "id": "cmd-export", "name": "export"},
		{"cmd": "/help", "desc": "显示所有命令", "icon": "Sparkles", "category": "tool", "id": "cmd-help", "name": "help"},
		{"cmd": "/summary", "desc": "生成会话摘要", "icon": "FileText", "category": "kb", "id": "cmd-summary", "name": "summary"},
	}

	s.Workflows = []map[string]any{
		{"id": "wf1", "workspaceId": "w1", "name": "故障自愈", "status": "active", "lifecycleStatus": "published", "version": "1.2.0", "ownerId": "u1", "environment": "production", "updatedAt": "2026-07-19T12:00:00Z", "nodes": []map[string]any{{"id": "n1", "kind": "trigger", "label": "Webhook 触发", "type": "start"}, {"id": "n2", "kind": "execute", "label": "受控处置", "type": "action"}}, "edges": []map[string]any{{"id": "e1", "source": "n1", "target": "n2"}}},
	}
	s.WorkflowVersions["wf1"] = []map[string]any{
		{
			"id": "wfv-1", "workflowId": "wf1", "version": "1.2.0", "label": "v1.2.0",
			"status": "published", "desc": "当前已发布版本", "time": "2026-07-19 12:00",
			"createdAt": "2026-07-19T12:00:00Z", "publishedAt": "2026-07-19T12:00:00Z",
			"nodes":     []map[string]any{{"id": "n1", "kind": "trigger", "label": "开始", "type": "start"}, {"id": "n2", "kind": "execute", "label": "处置动作", "type": "action"}},
			"edges":     []map[string]any{{"id": "e1", "source": "n1", "target": "n2"}},
			"nodeCount": 2, "edgeCount": 1, "evidenceMode": "recorded",
		},
	}
	s.WorkflowGens = []map[string]any{}
	s.OrchestrationSessions = []map[string]any{}
	s.WorkflowTpls = []map[string]any{} // 出厂包由 EnsureBuiltinWorkflowsReady 从 builtin/workflows 装载
	s.WorkflowSkills = []map[string]any{
		{
			"id": "wfs-1", "workspaceId": "w1", "workflowId": "wf1", "sourceWorkflowId": "wf1", "sourceVersionId": "v1.2.0",
			"name": "故障自愈技能", "description": "标准告警关联、定位建议与受控恢复步骤。",
			"status": "published", "version": "1.2.0", "riskLevel": "high", "approvalRequired": true, "rollbackSupported": true,
		},
	}
	s.WorkflowRuns = []map[string]any{
		{"id": "run-1", "workspaceId": "w1", "workflowId": "wf1", "status": "succeeded", "startedAt": "2026-07-22T07:00:00Z", "finishedAt": "2026-07-22T07:05:00Z"},
	}
	s.Skills = []map[string]any{
		{
			"id": "sk-docx", "workspaceId": "w1", "ownerId": "u1", "owner": "平台管理员", "team": "文档能力组",
			"name": "docx", "kind": "skill", "description": "根据文本内容生成 Word（.docx）文档并返回下载链接",
			"lifecycleStatus": "enabled", "status": "installed", "runtime": "docx-local", "version": "1.0.0",
			"riskLevel": "low", "rating": 4.8, "installCount": 96, "cacheable": true, "source": "builtin", "signed": true,
			"publisher":   "企业能力商店",
			"environment": "production", "classification": "internal", "lastVerifiedAt": "刚刚",
		},
		{
			"id": "sk-sandbox", "workspaceId": "w1", "ownerId": "u1", "owner": "平台管理员", "team": "沙箱验证组",
			"name": "sandbox-echo", "kind": "skill", "description": "沙箱 echo 验证（治理/限流测试用）",
			"lifecycleStatus": "enabled", "status": "installed", "version": "1.0.0",
			"riskLevel": "low", "rating": 4.5, "installCount": 12, "cacheable": false, "source": "import", "signed": false,
			"environment": "sandbox", "classification": "internal", "lastVerifiedAt": "刚刚",
		},
	}
	s.SkillCatalog = []map[string]any{
		{
			"id": "sc-demo", "workspaceId": "w1", "name": "api-health-check", "kind": "skill", "version": "1.0.0",
			"description": "HTTP 健康检查", "status": "available", "rating": 4.5, "installCount": 100,
			"riskLevel": "low", "cacheable": true, "publisher": "企业能力商店", "signed": true,
			"dependencies": []string{}, "license": "MIT", "lastScannedAt": "刚刚", "vulnerabilityCount": 0,
			"supportedEnvironments": []string{"测试", "生产"}, "environment": "production", "classification": "internal",
			"channel": "builtin", "syncedAt": "种子目录", "visibilityScope": "global", "releaseChannel": "stable",
		},
		{
			"id": "sc-high", "workspaceId": "w1", "name": "jenkins-mcp", "kind": "mcp", "version": "1.0.0",
			"description": "Jenkins 构建触发", "status": "available", "rating": 4.2, "installCount": 400,
			"riskLevel": "high", "cacheable": false, "publisher": "企业能力商店", "signed": true,
			"dependencies": []string{"jenkins-mcp"}, "license": "商业授权", "lastScannedAt": "刚刚", "vulnerabilityCount": 0,
			"supportedEnvironments": []string{"隔离环境"}, "environment": "sandbox", "classification": "restricted",
			"channel": "builtin", "syncedAt": "种子目录", "visibilityScope": "workspace", "releaseChannel": "beta",
		},
		{
			"id": "sc-unsigned", "workspaceId": "w1", "name": "community-shell", "kind": "skill", "version": "0.3.0",
			"description": "社区未签名 Shell 工具（仅演示供应链门禁）", "status": "available", "rating": 3.1, "installCount": 40,
			"riskLevel": "high", "cacheable": false, "publisher": "未知社区", "signed": false,
			"dependencies": []string{}, "license": "未知", "lastScannedAt": "刚刚", "vulnerabilityCount": 0,
			"supportedEnvironments": []string{"隔离环境"}, "environment": "sandbox", "classification": "restricted",
			"channel": "builtin", "syncedAt": "种子目录", "visibilityScope": "workspace", "releaseChannel": "beta",
		},
		{
			"id": "sc-vuln", "workspaceId": "w1", "name": "legacy-ftp-tool", "kind": "tool", "version": "0.1.0",
			"description": "含已知漏洞的 FTP 工具（演示漏洞门禁）", "status": "available", "rating": 2.8, "installCount": 12,
			"riskLevel": "mid", "cacheable": false, "publisher": "企业能力商店", "signed": true,
			"dependencies": []string{}, "license": "MIT", "lastScannedAt": "刚刚", "vulnerabilityCount": 4,
			"supportedEnvironments": []string{"隔离环境"}, "environment": "sandbox", "classification": "restricted",
			"channel": "builtin", "syncedAt": "种子目录", "visibilityScope": "workspace", "releaseChannel": "beta",
		},
	}
	s.SkillGovernance = map[string]any{
		"calls24h": 0, "successRate": 100, "p95Ms": 0, "abnormalSkills": 0, "pendingActions": 0,
	}
	s.SkillHealth = []map[string]any{
		{"id": "sh-sk-docx", "skillId": "sk-docx", "name": "docx", "kind": "skill", "environment": "production", "status": "healthy", "calls24h": 48, "successRate": 99.2, "p95Ms": 220, "errorRate": 0.8, "riskLevel": "low", "owner": "平台管理员", "references": 2, "updatedAt": "12 分钟前"},
	}
	s.SkillIntegrations = []map[string]any{}
	s.SkillExtra = map[string]any{
		"policies":    map[string]any{},
		"runtimes":    map[string]any{},
		"permissions": map[string]any{},
		"versions":    map[string]any{},
		"bindings": []map[string]any{
			{"id": "cap-de1-docx", "workspaceId": "w1", "targetType": "agent", "targetId": "de-1", "targetName": "故障自愈助手", "capabilityKind": "skill", "capabilityId": "sk-docx", "pinnedVersion": "1.0.0", "status": "active", "createdBy": "系统", "createdAt": "2026-07-19T09:40:00Z", "auditId": "audit-cap-1"},
			{"id": "cap-wf1-docx", "workspaceId": "w1", "targetType": "workflow", "targetId": "wf1", "targetName": "故障自愈", "capabilityKind": "skill", "capabilityId": "sk-docx", "pinnedVersion": "1.0.0", "status": "active", "createdBy": "系统", "createdAt": "2026-07-19T09:45:00Z", "auditId": "audit-cap-2"},
		},
		"incidents": []map[string]any{},
		"events":    []map[string]any{},
	}
	s.MemoryRecords = []map[string]any{
		{
			"id": "mem-short-1", "workspaceId": "w1", "ownerId": "u1", "digitalPartnerId": "de-sre",
			"layer": "short_term", "scope": "user", "title": "Redis OOM 会话上下文",
			"content":        "当前会话已确认 prod-redis-01 的 maxmemory 风险，等待双重审批执行。",
			"classification": "internal", "sourceType": "conversation", "sourceId": "cv1",
			"correlationId": "corr_conversation_cv1", "confidence": 0.92, "status": "active",
			"expiresAt": "2026-07-22T08:00:00.000Z", "createdAt": "2026-07-21T08:12:00.000Z", "updatedAt": "2026-07-21T08:24:00.000Z",
		},
		{
			"id": "mem-work-1", "workspaceId": "w1", "ownerId": "u1", "digitalPartnerId": "de-sre",
			"layer": "working", "scope": "team", "title": "TSK-20260713-001 处置上下文",
			"content":        "已完成内存趋势验证与大 Key 识别；人工接管前需保留执行证据。",
			"classification": "internal", "sourceType": "task", "sourceId": "t1",
			"correlationId": "corr_task_t1", "confidence": 0.96, "status": "active",
			"expiresAt": "2026-08-20T00:00:00.000Z", "createdAt": "2026-07-13T08:24:00.000Z", "updatedAt": "2026-07-21T08:24:00.000Z",
		},
		{
			"id": "mem-long-1", "workspaceId": "w1", "ownerId": "u1", "digitalPartnerId": "de-sre",
			"layer": "long_term", "scope": "workspace", "title": "Redis OOM 处置偏好",
			"content":        "生产 Redis OOM 优先检索已发布 Runbook；涉及配置写入必须由 SRE 与管理员完成双重审批。",
			"classification": "restricted", "sourceType": "workflow", "sourceId": "wf1",
			"correlationId": "corr_task_t1", "confidence": 0.91, "status": "active",
			"createdAt": "2026-07-18T09:00:00.000Z", "updatedAt": "2026-07-21T08:24:00.000Z",
		},
		{
			"id": "mem-long-pending", "workspaceId": "w1", "ownerId": "u1", "digitalPartnerId": "de-alert-ops",
			"layer": "long_term", "scope": "workspace", "title": "告警静默窗口经验",
			"content":        "重大活动窗口内对已知抖动告警可建议静默，但不得自动关闭 P1；需值班经理确认后执行。",
			"classification": "confidential", "sourceType": "task", "sourceId": "t2",
			"correlationId": "corr_task_t2", "confidence": 0.89, "status": "pending_review",
			"createdAt": "2026-07-20T10:00:00.000Z", "updatedAt": "2026-07-21T09:00:00.000Z",
		},
		{
			"id": "mem-long-2", "workspaceId": "w2", "ownerId": "u2", "digitalPartnerId": "de-capacity",
			"layer": "long_term", "scope": "workspace", "title": "预发扩容验收规则",
			"content":        "预发扩容先完成 10% 灰度与回滚演练，再提交生产发布审批。",
			"classification": "internal", "sourceType": "task", "sourceId": "t6",
			"correlationId": "corr_task_t6", "confidence": 0.88, "status": "active",
			"createdAt": "2026-07-17T09:00:00.000Z", "updatedAt": "2026-07-20T08:00:00.000Z",
		},
	}
	s.MemoryCands = []map[string]any{
		{
			"id": "mc-1", "workspaceId": "w1", "memoryId": "mem-long-pending",
			"title":          "告警静默窗口经验",
			"summary":        "重大活动窗口内对已知抖动告警可建议静默，但不得自动关闭 P1；需值班经理确认后执行。",
			"classification": "confidential", "sourceCorrelationId": "corr_task_t2",
			"status": "pending_review", "submittedAt": "2026-07-21T09:00:00.000Z",
		},
	}
	s.EvolveCands = []map[string]any{}
	s.MemoryPolicies["w1"] = map[string]any{
		"workspaceId": "w1", "shortTermTtlHours": 24, "workingMemoryTtlDays": 30, "dailyRefinementTime": "02:00",
		"shortToWorkingEnabled": true, "workingToLongEnabled": true, "longToKnowledgeEnabled": true,
		"minimumConfidence": 0.85, "longTermWriteApproval": true, "sensitiveDataMasking": true,
		"longTermCapacity": 5000, "usedCapacity": 1,
	}
	s.MemoryAudits = []map[string]any{
		{"id": "ma-1", "workspaceId": "w1", "time": "2026-07-21T09:00:00.000Z", "actor": "观星", "action": "提炼知识候选", "target": "告警静默窗口经验", "result": "success", "correlationId": "corr_task_t2"},
		{"id": "ma-2", "workspaceId": "w1", "time": "2026-07-21T08:24:00.000Z", "actor": "夜航", "action": "写入记忆", "target": "Redis OOM 会话上下文", "result": "success", "correlationId": "corr_conversation_cv1"},
	}
	s.Channels = []map[string]any{
		{"id": "ch-web", "workspaceId": "w1", "name": "Web", "kind": "web", "enabled": true, "monthlySent": 0, "successRate": 1},
		{"id": "ch-feishu", "workspaceId": "w1", "name": "飞书", "kind": "feishu", "enabled": true, "monthlySent": 820, "successRate": 0.998},
	}
	s.ChannelDeploys = []map[string]any{
		{
			"id": "delivery-feishu", "workspaceId": "w1", "name": "飞书生产投递", "kind": "feishu",
			"environment": "production", "status": "active",
			"credentialRef":    "vault://channel-deployments/delivery-feishu/credential",
			"credentialMasked": "app-…prod", "owner": "消息平台组",
			"lastVerifiedAt": "2026-07-19T12:00:00.000Z",
		},
	}
	s.DeliveryPolicies = []map[string]any{
		{
			"id": "delivery-policy-p0", "workspaceId": "w1", "eventType": "P0 紧急告警",
			"primaryDeploymentId": "delivery-feishu", "fallbackDeploymentIds": []string{},
			"audience": "SRE 值班组", "dataClassification": "internal", "status": "draft", "validationIssues": []string{},
		},
	}
	s.DeliveryPolicyVersions = []map[string]any{}
	s.ChannelTemplates = []map[string]any{
		{"id": "card1", "workspaceId": "w1", "name": "告警卡片", "kind": "feishu", "locale": "zh-CN", "status": "published", "tone": "error", "desc": "P0/P1 紧急事件 · 含一键跳转", "preview": "[P0] Redis OOM\n集群: prod-redis-01\n[查看详情 →]", "updatedAt": "2026-07-18T08:00:00.000Z"},
		{"id": "card2", "workspaceId": "w1", "name": "审批卡片", "kind": "feishu", "locale": "zh-CN", "status": "published", "tone": "warn", "desc": "双重审批 · 同意/拒绝按钮", "preview": "变更审批\n[批准] [拒绝]", "updatedAt": "2026-07-17T09:30:00.000Z"},
		{"id": "card3", "workspaceId": "w1", "name": "交接摘要", "kind": "feishu", "locale": "zh-CN", "status": "draft", "tone": "info", "desc": "人工接管摘要 · 脱敏任务上下文", "preview": "交接：夜航 → 值班经理\n任务 TSK-*** 待审批", "updatedAt": "2026-07-21T07:10:00.000Z"},
	}
	s.ChannelBlacklist = []map[string]any{
		{"id": "b1", "workspaceId": "w1", "type": "用户", "value": "test-spammer@external.com", "reason": "高频无效告警", "addedBy": "系统", "expires": "2026-08-01"},
		{"id": "b2", "workspaceId": "w1", "type": "群组", "value": "ext-noise-room", "reason": "外部噪音群，禁止投递生产告警", "addedBy": "消息平台组", "expires": "永久"},
	}
	s.ChannelAudit = []map[string]any{
		{"id": "ca-1", "workspaceId": "w1", "time": "2026-07-21T09:40:00.000Z", "actor": "消息平台组", "action": "验证渠道部署", "target": "飞书生产投递", "result": "success", "correlationId": "corr_channel_verify_1"},
		{"id": "ca-2", "workspaceId": "w1", "time": "2026-07-20T16:20:00.000Z", "actor": "平台管理员", "action": "创建渠道部署", "target": "飞书生产投递", "result": "success", "correlationId": "corr_channel_create_1"},
		{"id": "ca-3", "workspaceId": "w1", "time": "2026-07-19T12:00:00.000Z", "actor": "消息平台组", "action": "保存投递策略草稿", "target": "P0 紧急告警", "result": "success", "correlationId": "corr_channel_policy_1"},
	}
	s.ChannelDLQ = []map[string]any{
		{
			"id": "da-demo-1", "workspaceId": "w1", "policyId": "delivery-policy-p0", "deploymentId": "delivery-feishu",
			"targetMasked": "SRE ****", "payloadSummary": "[P0] **** OOM ****", "status": "dead_letter",
			"attempts": 3, "correlationId": "corr_delivery_demo_1", "createdAt": "2026-07-21T10:12:00.000Z",
		},
	}
	s.ChannelHealth = map[string]map[string]any{
		"delivery-feishu": {"deploymentId": "delivery-feishu", "successRate": 99.8, "p95Ms": 120, "errorCount24h": 2, "status": "healthy"},
	}
	s.KnowledgeExtra = map[string]any{
		"packages": []map[string]any{{
			"id": "pkg-ops", "workspaceId": "w1", "name": "运维知识库", "description": "运维运行手册与变更检查",
			"domain": "运维", "status": "published", "classification": "internal", "owner": "平台管理员", "ownerId": "u1",
			"documentCount": 2, "documentIds": []string{"kd-1", "kd-2"}, "consumers": 1,
			"currentVersion": map[string]any{"id": "kpv-ops-1", "version": "3.1.0", "status": "published", "indexVersion": "idx-310", "publishedAt": "2026-07-18T00:00:00Z", "qualityScore": 88, "changeSummary": "纳入缓存手册"},
			"versions":       []map[string]any{{"id": "kpv-ops-1", "version": "3.1.0", "status": "published", "indexVersion": "idx-310", "publishedAt": "2026-07-18T00:00:00Z", "qualityScore": 88, "changeSummary": "纳入缓存手册"}},
		}},
		"sources":        []map[string]any{{"id": "ks-1", "workspaceId": "w1", "name": "Confluence", "kind": "Git / Markdown", "schedule": "daily", "status": "healthy", "documents": 2, "lastSync": "2026-07-20T00:00:00Z"}},
		"governance":     map[string]any{"workspaceId": "w1", "versionRetention": true, "piiMasking": true, "sensitiveDataDetection": true, "retentionDays": 365, "highRiskChangeApproval": true},
		"audit":          []map[string]any{{"id": "ka-1", "workspaceId": "w1", "time": "2026-07-18T00:00:00Z", "actor": "平台管理员", "action": "发布知识包", "target": "运维知识库", "result": "success"}},
		"processingJobs": []map[string]any{{"id": "kj-1", "workspaceId": "w1", "packageId": "pkg-ops", "source": "故障手册-缓存", "strategy": "semantic", "status": "succeeded", "documentCount": 1, "chunkCount": 24, "indexVersion": "idx-310", "startedAt": "2026-07-18T00:00:00Z"}},
		"retrievalProfiles": []map[string]any{{
			"id": "rp-default", "workspaceId": "w1", "packageId": "pkg-ops", "name": "默认检索",
			"retrievalModes": []string{"keyword", "vector"}, "topK": 5, "rerankEnabled": true, "noResultPolicy": "handoff",
		}},
		"evaluations": []map[string]any{{
			"id": "kev-1", "workspaceId": "w1", "packageId": "pkg-ops", "profileId": "rp-default",
			"baselineVersion": "3.0.0", "evaluatedVersion": "3.1.0",
			"status": "passed", "recallAtK": 0.82, "mrr": 0.76, "ndcg": 0.81,
			"citationAccuracy": 0.9, "p95LatencyMs": 210, "evaluatedAt": "2026-07-19T00:00:00Z",
		}},
		"graphEntities": []map[string]any{
			{"id": "kge-redis", "workspaceId": "w1", "name": "redis-prod-01", "type": "asset", "confidence": 0.99, "sourceDocId": "kd-1", "sourceVersion": "v3.1"},
			{"id": "kge-runbook", "workspaceId": "w1", "name": "故障手册-缓存", "type": "runbook", "confidence": 0.98, "sourceDocId": "kd-1", "sourceVersion": "v3.1"},
			{"id": "kge-owner", "workspaceId": "w1", "name": "SRE 值班组", "type": "owner", "confidence": 0.99, "sourceDocId": "kd-1", "sourceVersion": "v3.1"},
		},
		"graphRelations": []map[string]any{
			{"id": "kgr-01", "workspaceId": "w1", "fromId": "kge-redis", "toId": "kge-runbook", "type": "handled_by", "confidence": 0.98, "sourceDocId": "kd-1", "sourceVersion": "v3.1"},
			{"id": "kgr-02", "workspaceId": "w1", "fromId": "kge-runbook", "toId": "kge-owner", "type": "owned_by", "confidence": 0.99, "sourceDocId": "kd-1", "sourceVersion": "v3.1"},
		},
		"bindings": []map[string]any{{
			"id": "kb-bind-1", "workspaceId": "w1", "packageId": "pkg-ops", "packageName": "运维知识库", "packageVersion": "v3.1.0",
			"consumerType": "agent", "consumerId": "de-1", "consumerName": "SRE 故障处置专员",
			"environment": "production", "profileId": "rp-default", "noResultPolicy": "handoff",
		}},
		"citationTrace": []map[string]any{{
			"id": "ct-1", "workspaceId": "w1", "docId": "kd-1", "title": "故障手册-缓存",
			"citeCount": 12, "lastUsed": "2026-07-22", "usedBy": []string{"SRE 故障处置专员"},
		}},
		"eval": map[string]any{"workspaceId": "w1", "recall": 82, "precision": 90, "p95Latency": 210, "hitRate": 32, "recallAtK": 0.82, "citationAccuracy": 0.9},
		"chunksTop": []map[string]any{
			{"idx": 1, "source": "Runbook", "score": 0.91, "docId": "kd-1", "text": "Redis 缓存故障处置步骤与扩容建议。"},
			{"idx": 2, "source": "变更管理", "score": 0.84, "docId": "kd-2", "text": "生产发布前检查项。"},
		},
	}

	// Fallback only; live handlers recompute from Employees/Tasks.
	s.HomeKPIs = map[string]any{
		"activeTasks": 0, "healthScore": 0, "aiCalls24h": 0, "tokenUsage": "0", "apiP95": nil, "slaBreaches": 0,
	}
	s.HomeAlerts = []map[string]any{}
	s.HomeExtra = map[string]any{
		"recentActivities": []map[string]any{},
		"teamMembers": []map[string]any{
			{"id": "u1", "name": "平台管理员", "role": "admin", "online": true},
			{"id": "u2", "name": "业务构建者", "role": "user", "online": true},
		},
		"slaAlerts":        []map[string]any{},
		"taskCompletion":   map[string]any{"done": 0, "doing": 0, "review": 0, "todo": 0},
		"agentCallSummary": map[string]any{"total": 0, "healthy": 0, "warning": 0, "offline": 0},
		"notifications":    []map[string]any{},
		"operationalMetrics": map[string]any{
			"taskSuccessRate": nil, "activeAgents": 0, "healthScore": 0, "apiP95": nil, "taskRate": 0,
			"tokenUsage": map[string]any{"total": "—", "input": "—", "output": "—"},
			"trend24h":   []map[string]any{},
		},
		"costMonth": map[string]any{"used": 0, "budget": 0, "daily": []int{}, "source": "none"},
		"quickLinks": []map[string]any{
			{"label": "数字伙伴", "to": "/partners", "icon": "bot"},
			{"label": "协作", "to": "/copilot", "icon": "message"},
		},
	}
	// Billing seed is structural only; overview cost must come from UsageMeters (see homeExtraLive).
	s.Billing = map[string]any{
		"workspaceId": "w1", "plan": "enterprise_plus", "period": "2026-07",
		"usage":    map[string]any{"tokens": 0, "usd": 0},
		"quota":    map[string]any{"tokens": 5000000, "usd": 0},
		"invoices": []map[string]any{},
	}
	s.Backups = []map[string]any{
		{"id": "bk-1", "workspaceId": "w1", "status": "pending_approval", "requestedBy": "平台管理员", "requestedAt": "2026-07-22T06:00:00Z", "scope": "full"},
	}
	// Fallback only; opsOverviewLive derives pending/health from tasks & employees.
	s.OpsOverview = map[string]any{
		"services": []map[string]any{
			{"name": "qzda-core", "status": "up"},
			{"name": "agent-runtime", "status": "up"},
			{"name": "rag", "status": "up"},
		},
		"incidentsOpen": 0, "mttrMinutes": 0,
		"pending": []map[string]any{},
		"health":  map[string]any{"activeAgents": 0, "score": 0},
	}
	s.NotificationChannels = []map[string]any{
		{"id": "nc-1", "name": "飞书值班", "kind": "feishu", "enabled": true},
	}
	s.APIKeys = []map[string]any{
		{"id": "key-1", "name": "控制台集成", "masked": "de_****abcd", "createdAt": "2026-07-01T00:00:00Z"},
	}
	s.WebhooksConfig = []map[string]any{
		{"id": "wh-1", "url": "https://example.com/hooks/de", "events": []string{"task.completed"}, "enabled": true},
	}
	s.ensureEmployeesReplyModeDefaultsLocked()
}

// EnsureDocxSkillReady installs the builtin docx skill and binds it to HR employee when missing
// (covers already-hydrated Postgres workspaces that predate the seed).
func (s *Store) EnsureDocxSkillReady() {
	s.Lock()
	defer s.Unlock()
	if s.skillSuppressedLocked("w1", "docx") || s.skillSuppressedLocked("w1", "sk-docx") {
		return
	}
	hasDocx := false
	for _, sk := range s.Skills {
		if str(sk["id"]) == "sk-docx" || strings.EqualFold(str(sk["name"]), "docx") {
			hasDocx = true
			sk["lifecycleStatus"] = "enabled"
			sk["status"] = "installed"
			break
		}
	}
	if !hasDocx {
		s.Skills = append([]map[string]any{{
			"id": "sk-docx", "workspaceId": "w1", "ownerId": "u1", "owner": "平台管理员", "team": "文档能力组",
			"name": "docx", "kind": "skill", "description": "根据文本内容生成 Word（.docx）文档并返回下载链接",
			"lifecycleStatus": "enabled", "status": "installed", "runtime": "docx-local", "version": "1.0.0",
			"riskLevel": "low", "rating": 4.8, "installCount": 96, "cacheable": true, "source": "builtin",
			"environment": "production", "classification": "internal", "lastVerifiedAt": "刚刚",
			"producesArtifacts": true, "readOnly": false, "entrypoints": []string{"__builtin_generate_docx"},
		}}, s.Skills...)
	}
	for _, emp := range s.Employees {
		// Seed id de-hr, or live HR role (e.g. de-5「听风」).
		isHR := str(emp["id"]) == "de-hr" ||
			strings.Contains(str(emp["role"]), "人事") ||
			str(emp["name"]) == "听风"
		if !isHR {
			continue
		}
		caps, _ := emp["capabilities"].(map[string]any)
		if caps == nil {
			caps = map[string]any{}
			emp["capabilities"] = caps
		}
		skills := anyStringSlice(caps["skills"])
		found := false
		for _, name := range skills {
			if strings.EqualFold(name, "docx") {
				found = true
				break
			}
		}
		if !found {
			caps["skills"] = append(skills, "docx")
		}
		bp, _ := emp["boundaryPolicy"].(map[string]any)
		if bp == nil {
			bp = map[string]any{}
			emp["boundaryPolicy"] = bp
		}
		modes := anyMapSlice(bp["capabilityModes"])
		hasMode := false
		for _, m := range modes {
			if str(m["capabilityType"]) == "skill" && strings.EqualFold(str(m["capabilityName"]), "docx") {
				hasMode = true
				m["mode"] = "execute"
				break
			}
		}
		if !hasMode {
			modes = append(modes, map[string]any{
				"capabilityType": "skill", "capabilityName": "docx", "mode": "execute",
			})
			bp["capabilityModes"] = modes
		}
	}
}

func anyStringSlice(v any) []string {
	switch t := v.(type) {
	case []string:
		return append([]string{}, t...)
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if s := str(x); s != "" {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

func anyMapSlice(v any) []map[string]any {
	switch t := v.(type) {
	case []map[string]any:
		return append([]map[string]any{}, t...)
	case []any:
		out := make([]map[string]any, 0, len(t))
		for _, x := range t {
			if m, ok := x.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}
