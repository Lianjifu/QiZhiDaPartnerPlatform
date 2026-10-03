package server

// M09 P2: platform-settings handlers (getBilling, getBillingQuota, listBackups,
// requestBackup, backupAction) were extracted to backend/internal/settings/.
// Home/ops live-aggregate wrappers (homeKPIsLive / homeExtraLive /
// homeEvents / homeTeam / homeAlerts / ackAlert / opsOverviewLive) moved
// to backend/internal/operations/ as part of M01 P2 (commit f1e14b0).
// This file now only hosts the ratio/asFloat helpers used by
// handlers_contract.go and session_panel.go.

func ratio(used, limit any) float64 {
	u, ok1 := asFloat(used)
	l, ok2 := asFloat(limit)
	if !ok1 || !ok2 || l == 0 {
		return 0
	}
	return u / l
}

func asFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	default:
		return 0, false
	}
}
