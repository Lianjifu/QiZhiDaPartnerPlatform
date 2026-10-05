package server

import (
	"os"
	"strings"
)

// replicaStandby is the phase-4 multi-active min slice: a standby instance
// rejects mutating requests (writes go to the active replica).
func replicaStandby() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("QZDA_REPLICA_MODE")))
	return v == "standby" || v == "readonly" || v == "passive"
}

func (s *Server) isStandby() bool {
	if s != nil && s.ReplicaForced {
		return true
	}
	return replicaStandby()
}

func (s *Server) replicaRole() string {
	if s.isStandby() {
		return "standby"
	}
	return "active"
}

func instanceID() string {
	if v := strings.TrimSpace(os.Getenv("QZDA_INSTANCE_ID")); v != "" {
		return v
	}
	h, _ := os.Hostname()
	if strings.TrimSpace(h) == "" {
		return "local"
	}
	return h
}

func replicaWriteAllowedMethod(method string) bool {
	switch strings.ToUpper(strings.TrimSpace(method)) {
	case "GET", "HEAD", "OPTIONS":
		return true
	default:
		return false
	}
}
