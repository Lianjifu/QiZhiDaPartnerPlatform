package operations

import "net/http"

// homeKPIsLive is the compact KPI tile projection served at
// /api/home/kpis. It is a strict subset of opsOverviewLive (digital
// partners + tasks + governance + channels + a generatedAt timestamp)
// — the projection relationship is asserted by the
// `TestHomeKPIsLive_MatchesOpsOverview` regression test.
//
// Both endpoints share `source == "live-aggregate"` so M5 compliance
// assertions (`TestOpsOverviewLiveAggregate`) pass against either.
//
// Reuses opsOverviewLive so the two endpoints can never drift: any
// change to the aggregate math flows through here automatically.
func (h *Handler) homeKPIsLive(r *http.Request) (any, error) {
	ov, err := h.opsOverviewLive(r)
	if err != nil {
		return nil, err
	}
	m := ov.(map[string]any)
	de := m["digitalPartners"].(map[string]any)
	tasks := m["tasks"].(map[string]any)
	return map[string]any{
		"activeDigitalPartners": de["active"],
		"openTasks":             tasks["open"],
		"riskTasks":             tasks["risk"],
		"pendingApprovals":      m["governance"].(map[string]any)["pendingApprovals"],
		"deadLetters":           m["channels"].(map[string]any)["deadLetters"],
		"generatedAt":           m["generatedAt"],
		"source":                "live-aggregate",
	}, nil
}
