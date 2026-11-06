// copilot_offload.go —— P4 上下文卸载(context offload)。
//
// 问题:一次工具调用可能带回几十 KB 内容(全量检索命中、长报告、技能日志)。
//
//	这些内容整段灌进模型上下文,几个回合就把预算吃光,真正的约束
//	(最初的任务目标、边界条件)反而被挤掉。
//
// 做法:超过阈值的工具输出落到 agent_artifacts 集合,上下文里只留一条
//
//	引用(artifact id + 摘要 + 行数);模型需要细节时用 artifact.read
//	工具按需取回。
//
// 关键约束:卸载只影响"进上下文的部分",原文仍完整落库、可审计、可回放。
package copilot

import (
	"fmt"
	"strings"
)

// artifactOffloadMaxRunes 是触发卸载的输出长度阈值。
const artifactOffloadMaxRunes = 4000

// ArtifactInput 是卸载一次工具输出的入参。
type ArtifactInput struct {
	WorkspaceID    string
	ConversationID string
	CorrelationID  string
	DigitalPartner string
	ToolName       string
	Content        string
}

// ArtifactRef 是上下文里留下的引用信息。
type ArtifactRef struct {
	ID       string
	ToolName string
	Runes    int
	Preview  string
}

// offloadToolOutput 在输出过大时把正文卸载成 artifact,返回引用。
//
// 没有 OffloadArtifactFn(未接线)时返回 nil —— 调用点保持原样,不做截断。
func (s *Service) offloadToolOutput(in ArtifactInput) *ArtifactRef {
	if s == nil || s.Deps.Tools.OffloadArtifactFn == nil {
		return nil
	}
	content := in.Content
	if len([]rune(content)) <= artifactOffloadMaxRunes {
		return nil
	}
	out, err := s.Deps.Tools.OffloadArtifactFn(in)
	if err != nil || out == nil {
		return nil
	}
	id := strings.TrimSpace(str(out["id"]))
	if id == "" {
		return nil
	}
	preview := truncateRunes(content, 400)
	return &ArtifactRef{
		ID:       id,
		ToolName: in.ToolName,
		Runes:    len([]rune(content)),
		Preview:  preview,
	}
}

// artifactReferenceText 渲染上下文里的引用文本。
func artifactReferenceText(ref *ArtifactRef) string {
	if ref == nil {
		return ""
	}
	return fmt.Sprintf(
		"【大结果已卸载】工具「%s」返回 %d 字,已存为产物 %s。\n摘要前 400 字：\n%s\n如需全文请调用 artifact.read(id=%s)。",
		ref.ToolName, ref.Runes, ref.ID, ref.Preview, ref.ID,
	)
}

// applyArtifactOffload 在工具执行后处理超大输出。
//
// 返回 (给模型看的观察文本, 是否发生了卸载)。
func (s *Service) applyArtifactOffload(in ArtifactInput, observation string) (string, bool) {
	ref := s.offloadToolOutput(in)
	if ref == nil {
		return observation, false
	}
	return artifactReferenceText(ref), true
}
