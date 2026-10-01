package operations

// liveTeamMembersLocked returns the deduplicated team member list for a
// workspace, sourced from Store.Members[ws] (not HomeExtra — that one is
// just a fallback seed for the demo render). The dedup is keyed on
// member id so a member listed twice across two rosters only shows up
// once on the Home UI.
//
// Pure helper so it stays trivially testable; receives the Handler
// only to reach Store.Members — same access pattern as the legacy
// server.liveTeamMembersLocked.
func liveTeamMembersLocked(h *Handler, ws string) []map[string]any {
	seen := map[string]bool{}
	var out []map[string]any
	for _, m := range h.Store.Members[ws] {
		id := str(m["id"])
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		online, _ := m["online"].(bool)
		out = append(out, map[string]any{
			"id": id, "name": str(m["name"]), "role": str(m["role"]), "online": online,
		})
	}
	return out
}
