// Package copilot —— assistant 消息的"变体(variants)"管理模块。
//
// 职责：把 assistant 消息按"原始 + 多次 regenerate 副本"组织成 variant group，
// 通过 /api/copilot/conversations/{cid}/messages/{mid}/branch-active 切换可见变体，
// 不再覆盖原消息。所有变体元数据都以 map[string]any key 的形式存在 Store.Messages 上。
package copilot

// copilot_variants.go — 答案变体:同一回合并行生成 N 个候选,前端可切换对比;
// 不写回主状态,仅作为探索选项供用户选用。所有变体元数据以 map[string]any 形式存 Store.Messages。

// Message variant bookkeeping for the M02 redesign.
//
// Each assistant message in a Copilot conversation carries optional
// variant metadata so that "regenerate" no longer overwrites the
// original in place — it appends a sibling, and the front-end can switch
// which sibling is the active (visible) variant via
// /api/copilot/conversations/{cid}/messages/{mid}/branch-active.
//
// Stored as `map[string]any` keys on the per-conversation message slice
// (Store.Messages[cid]). The wire format mirrors what the front-end
// reads today via MessageRow.

// variant 元数据键常量：parent/branchIndex/isActive/groupId/auditEventId/activeVariantId。
const (
	MsgKeyParentMessageID = "parentMessageId"
	MsgKeyBranchIndex     = "branchIndex"
	MsgKeyIsActive        = "isActive"
	MsgKeyVariantsGroupID = "variantsGroupId"
	MsgKeyAuditEventID    = "auditEventId"
	MsgKeyActiveVariantID = "activeVariantId"
)

// StampVariantRoot 把 msg 标记为新 variant group 的根消息。
// StampVariantRoot marks msg as the root of a new variant group.
// BranchIndex is forced to 0 and IsActive=true. parentID == "" is the
// normal case for the very first assistant turn in a conversation.
func StampVariantRoot(msg map[string]any, parentID string) map[string]any {
	if msg == nil {
		return msg
	}
	if parentID != "" {
		msg[MsgKeyParentMessageID] = parentID
	}
	msg[MsgKeyBranchIndex] = 0
	msg[MsgKeyIsActive] = true
	msg[MsgKeyVariantsGroupID] = coalesceStr(parentID, str(msg["id"]))
	return msg
}

// StampVariantSibling 在已有 variant group 下追加一个新的兄弟变体。
// StampVariantSibling appends a new sibling under the same group root
// (parentID). siblingCount is the number of siblings already present
// including the parent — i.e. the index this new sibling should claim.
func StampVariantSibling(msg map[string]any, parentID string, siblingCount int) map[string]any {
	if msg == nil || parentID == "" {
		return msg
	}
	msg[MsgKeyParentMessageID] = parentID
	msg[MsgKeyBranchIndex] = siblingCount
	msg[MsgKeyIsActive] = true
	msg[MsgKeyVariantsGroupID] = parentID
	return msg
}

// SwitchActiveVariant 在某 variant group 内切换"哪个变体是当前可见的"标志位。
// SwitchActiveVariant flips IsActive across every sibling in the group
// identified by groupID (the parent message ID). Returns the count of
// messages touched and the ID of the previously-active variant, if any.
// Safe to call on a nil snapshot (no-op).
func SwitchActiveVariant(messages []map[string]any, groupID, newActiveID string) (touched int, previousID string) {
	if len(messages) == 0 || groupID == "" || newActiveID == "" {
		return 0, ""
	}
	for _, m := range messages {
		if m == nil {
			continue
		}
		if !belongsToGroup(m, groupID) {
			continue
		}
		switch str(m["id"]) {
		case newActiveID:
			if m[MsgKeyIsActive] != true {
				touched++
			}
			m[MsgKeyIsActive] = true
		default:
			if m[MsgKeyIsActive] == true {
				previousID = str(m["id"])
				m[MsgKeyIsActive] = false
				touched++
			}
		}
	}
	return touched, previousID
}

// ListVariants 返回 msg 所在 variant group 的有序兄弟变体列表（首条是根）。
// ListVariants returns the ordered sibling list for the variant group
// that msg belongs to. The first entry is the root (parent or self if
// no parent). Caller is responsible for rendering. Pass nil-safe.
func ListVariants(messages []map[string]any, msg map[string]any) []map[string]any {
	if msg == nil || len(messages) == 0 {
		return nil
	}
	groupID := VariantGroupID(msg)
	if groupID == "" {
		return nil
	}
	out := make([]map[string]any, 0, 2)
	for _, m := range messages {
		if m == nil {
			continue
		}
		if !belongsToGroup(m, groupID) {
			continue
		}
		out = append(out, map[string]any{
			"id":          str(m["id"]),
			"branchIndex": intFrom(m[MsgKeyBranchIndex]),
			"isActive":    m[MsgKeyIsActive] == true,
			"role":        coalesceStr(str(m["role"]), "assistant"),
			"preview":     previewOf(m),
			"createdAt":   m["createdAt"],
		})
	}
	return out
}

// VariantGroupID 返回 msg 的 variant group 根 ID（自身或 parentMessageId）。
// VariantGroupID returns the group root ID for msg. The group root is
// either msg's own id (no parent — original turn) or its
// parentMessageId (a regenerated sibling).
func VariantGroupID(msg map[string]any) string {
	if msg == nil {
		return ""
	}
	if p := str(msg[MsgKeyParentMessageID]); p != "" {
		return p
	}
	return str(msg["id"])
}

// ActiveVariantID 返回 msg 所在 group 内 IsActive=true 的变体 ID；都没有时回退到自身 id。
// ActiveVariantID returns the id of the sibling that has IsActive=true
// inside msg's group, falling back to msg's own id if nothing is marked
// active (e.g. legacy messages from before the redesign).
func ActiveVariantID(messages []map[string]any, msg map[string]any) string {
	groupID := VariantGroupID(msg)
	if groupID == "" {
		return ""
	}
	for _, m := range messages {
		if m == nil || !belongsToGroup(m, groupID) {
			continue
		}
		if m[MsgKeyIsActive] == true {
			return str(m["id"])
		}
	}
	return str(msg["id"])
}

// belongsToGroup 判断消息 m 是否属于 groupID 这个 variant group（自身或 parentMessageId 命中）。
func belongsToGroup(m map[string]any, groupID string) bool {
	if str(m["id"]) == groupID {
		return true
	}
	return str(m[MsgKeyParentMessageID]) == groupID
}

// previewOf 取出消息正文前 80 字符作为前端 preview 字段；超过则加省略号。
func previewOf(m map[string]any) string {
	c := str(m["content"])
	if len(c) > 80 {
		return c[:80] + "…"
	}
	return c
}

// coalesceStr 在 a 非空时返回 a，否则返回 b；和 coalesce 等价但参数顺序固定 a,b。
func coalesceStr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
