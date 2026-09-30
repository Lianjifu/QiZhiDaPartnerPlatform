package server

import "time"

// captureEmployeeBinding freezes published capability versions for this turn (§10.2).
// Runtime / Replay must use this snapshot, not a later live employee publish.
func captureEmployeeBinding(emp map[string]any, memoryPolicyID string) map[string]any {
	out := map[string]any{
		"memoryPolicyId": memoryPolicyID,
		"frozen":         true,
		"frozenAt":       time.Now().UTC().Format(time.RFC3339),
	}
	if emp == nil || emp["skipped"] == true {
		return out
	}
	out["partnerId"] = str(emp["id"])
	caps, _ := emp["capabilities"].(map[string]any)
	if caps == nil {
		return out
	}
	out["modelId"] = coalesce(str(caps["modelRouteId"]), str(caps["model"]))
	out["modelRouteId"] = str(caps["modelRouteId"])
	out["knowledgeIds"] = freezeStringSlice(caps["knowledge"])
	out["skillIds"] = freezeStringSlice(caps["skills"])
	out["channelIds"] = freezeStringSlice(caps["channels"])
	return out
}

func freezeStringSlice(v any) []string {
	src := stringSlice(v)
	if src == nil {
		return nil
	}
	out := make([]string, len(src))
	copy(out, src)
	return out
}
