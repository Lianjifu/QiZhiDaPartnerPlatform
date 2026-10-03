package skills

import (
	"github.com/qizhida-partner-platform/backend/internal/skills/registry"
)

// defaultSkillRegistry returns a Registry pre-populated with the platform's
// built-in skills (knowledge.retrieve, memory.recall, skill.read, time.now,
// docx/pptx/xlsx, etc.). Used by New() to give every Server a populated
// v2 registry without callers having to register manually.
//
// This is intentionally separate from buildToolRegistry() — that function
// returns the legacy []registeredTool slice used by the chat loop. The
// v2 registry is the canonical source for catalog/admin endpoints, audit
// metadata, and the policy.Authorization path.
func defaultSkillRegistry() *registry.Registry {
	r := registry.NewRegistry()
	for _, s := range []registry.Spec{
		{
			Key: "builtin:knowledge.retrieve", Name: "knowledge.retrieve", Kind: "builtin",
			Description: "检索已发布知识库，返回相关片段",
			Lifecycle:   registry.LifecycleStable,
			RiskClass:   registry.RiskReadOnly,
			Approval:    registry.ApprovalAuto,
			RequiredPerms: []string{"knowledge.read"},
			Tags:        []string{"rag"},
		},
		{
			Key: "builtin:memory.recall", Name: "memory.recall", Kind: "builtin",
			Description: "检索跨会话工作/长期记忆",
			Lifecycle:   registry.LifecycleStable,
			RiskClass:   registry.RiskReadOnly,
			Approval:    registry.ApprovalAuto,
			RequiredPerms: []string{"memory.read"},
			Tags:        []string{"memory"},
		},
		{
			Key: "builtin:skill.read", Name: "skill.read", Kind: "builtin",
			Description: "加载已装配技能的 SKILL.md 全文",
			Lifecycle:   registry.LifecycleStable,
			RiskClass:   registry.RiskReadOnly,
			Approval:    registry.ApprovalAuto,
			RequiredPerms: []string{"skill.read"},
			Tags:        []string{"skill"},
		},
		{
			Key: "builtin:time.now", Name: "time.now", Kind: "builtin",
			Description: "返回当前时间（ISO8601）",
			Lifecycle:   registry.LifecycleStable,
			RiskClass:   registry.RiskReadOnly,
			Approval:    registry.ApprovalAuto,
			Tags:        []string{"util"},
		},
		{
			Key: "skill:docx", Name: "docx", Kind: "skill",
			Description: "生成 Word 文档 (.docx)",
			Lifecycle:   registry.LifecycleStable,
			RiskClass:   registry.RiskLocalIO,
			Approval:    registry.ApprovalAuto,
			RequiredPerms: []string{"skill.invoke"},
			Tags:        []string{"office", "docx"},
		},
		{
			Key: "skill:pptx", Name: "pptx", Kind: "skill",
			Description: "生成 PowerPoint 演示文稿 (.pptx)",
			Lifecycle:   registry.LifecycleStable,
			RiskClass:   registry.RiskLocalIO,
			Approval:    registry.ApprovalAuto,
			RequiredPerms: []string{"skill.invoke"},
			Tags:        []string{"office", "pptx"},
		},
		{
			Key: "skill:xlsx", Name: "xlsx", Kind: "skill",
			Description: "生成 Excel 表格 (.xlsx)",
			Lifecycle:   registry.LifecycleStable,
			RiskClass:   registry.RiskLocalIO,
			Approval:    registry.ApprovalAuto,
			RequiredPerms: []string{"skill.invoke"},
			Tags:        []string{"office", "xlsx"},
		},
	} {
		_ = r.Register(s)
	}
	return r
}
