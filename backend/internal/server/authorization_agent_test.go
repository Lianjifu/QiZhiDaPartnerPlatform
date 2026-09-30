package server

import (
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestCreatePendingAuthorization_AgentRequester(t *testing.T) {
	st := store.New()
	st.Employees = []map[string]any{{
		"id": "de-hr", "name": "人事专员", "role": "人事", "escalationOwner": "admin",
	}}
	s := &Server{Store: st}
	viewer := &auth.Identity{ID: "admin", Name: "平台管理员", Role: "admin"}
	tool := &registeredTool{Name: "pptx", Key: "skill:pptx", Kind: "skill"}
	s.Store.Lock()
	_, authReq := s.createPendingAuthorizationLocked(
		"w1", "conv-1", "de-hr", tool,
		toolCallRequest{Name: "pptx", Args: map[string]any{"action": "run", "command": "scripts/a.py"}},
		viewer, "medium", "corr-1",
	)
	s.Store.Unlock()
	if str(authReq["requesterKind"]) != "agent" {
		t.Fatalf("requesterKind=%v", authReq["requesterKind"])
	}
	if str(authReq["requesterId"]) != "de-hr" {
		t.Fatalf("requesterId=%v", authReq["requesterId"])
	}
	if str(authReq["requesterName"]) != "人事专员" {
		t.Fatalf("requesterName=%v", authReq["requesterName"])
	}
	if str(authReq["triggeredByUserId"]) != "admin" {
		t.Fatalf("triggeredBy=%v", authReq["triggeredByUserId"])
	}
	cands := stringSlice(authReq["approverCandidateIds"])
	if len(cands) == 0 || cands[0] != "u1" {
		t.Fatalf("approverCandidateIds=%v want u1", cands)
	}
	ok, msg := s.canApproveActionLocked(viewer, authReq, "w1")
	if !ok {
		t.Fatalf("admin should approve agent request, got %s", msg)
	}
}

func TestCanApproveAction_UserSelfDenied(t *testing.T) {
	s := &Server{}
	user := &auth.Identity{ID: "u1", Name: "张三", Role: "user"}
	authReq := map[string]any{
		"requesterKind": "user", "requesterId": "u1", "approverRoleHint": "admin",
	}
	ok, msg := s.canApproveActionLocked(user, authReq, "w1")
	if ok || msg == "" {
		t.Fatalf("expected self-deny, ok=%v msg=%q", ok, msg)
	}
}

func TestResolveApproverCandidates_EscalationOwnerTitle(t *testing.T) {
	st := store.New()
	s := &Server{Store: st}
	ids, names := s.resolveApproverCandidatesLocked("w1", "运营负责人")
	if len(ids) == 0 || ids[0] != "u2" {
		t.Fatalf("ids=%v names=%v", ids, names)
	}
	user := &auth.Identity{ID: "u2", Name: "业务构建者", Role: "user"}
	authReq := map[string]any{
		"requesterKind": "agent", "requesterId": "de-1",
		"approverRoleHint": "运营负责人", "approverCandidateIds": ids, "approverCandidateNames": names,
	}
	ok, msg := s.canApproveActionLocked(user, authReq, "w1")
	if !ok {
		t.Fatalf("escalation owner should approve: %s", msg)
	}
}
