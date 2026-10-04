package copilot

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

const (
	MsgKeyParentMessageID = "parentMessageId"
	MsgKeyBranchIndex     = "branchIndex"
	MsgKeyIsActive        = "isActive"
	MsgKeyVariantsGroupID = "variantsGroupId"
	MsgKeyAuditEventID    = "auditEventId"
	MsgKeyActiveVariantID = "activeVariantId"
)

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

func belongsToGroup(m map[string]any, groupID string) bool {
	if str(m["id"]) == groupID {
		return true
	}
	return str(m[MsgKeyParentMessageID]) == groupID
}

func previewOf(m map[string]any) string {
	c := str(m["content"])
	if len(c) > 80 {
		return c[:80] + "…"
	}
	return c
}

func coalesceStr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
