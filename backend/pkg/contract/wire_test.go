package contract

import (
	"strings"
	"testing"

	commonv1 "github.com/qizhida-partner-platform/backend/gen/qzda/common/v1"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func TestSessionModeWireMatchesProto(t *testing.T) {
	pairs := []struct {
		wire  string
		proto commonv1.SessionMode
	}{
		{SessionModeInvestigate, commonv1.SessionMode_SESSION_MODE_INVESTIGATE},
		{SessionModeExecute, commonv1.SessionMode_SESSION_MODE_EXECUTE},
	}
	for _, p := range pairs {
		if SessionModeFromProto(p.proto) != p.wire {
			t.Fatalf("from proto %v", p.proto)
		}
		if SessionModeToProto(p.wire) != p.proto {
			t.Fatalf("to proto %s", p.wire)
		}
	}
	if ParseSessionMode("exec") != SessionModeExecute {
		t.Fatal("exec alias")
	}
	if ParseSessionMode("") != SessionModeInvestigate {
		t.Fatal("default investigate")
	}
}

func TestPolicyDecisionWireMatchesProtoAndFrontend(t *testing.T) {
	if len(PolicyDecisions) != 4 {
		t.Fatalf("four-state policy, got %d", len(PolicyDecisions))
	}
	pairs := []struct {
		wire  string
		proto commonv1.PolicyDecision
	}{
		{PolicyAllow, commonv1.PolicyDecision_POLICY_DECISION_ALLOW},
		{PolicyMask, commonv1.PolicyDecision_POLICY_DECISION_MASK},
		{PolicyApprovalRequired, commonv1.PolicyDecision_POLICY_DECISION_APPROVAL_REQUIRED},
		{PolicyDeny, commonv1.PolicyDecision_POLICY_DECISION_DENY},
	}
	for _, p := range pairs {
		if PolicyDecisionFromProto(p.proto) != p.wire {
			t.Fatalf("from proto %v", p.proto)
		}
		if PolicyDecisionToProto(p.wire) != p.proto {
			t.Fatalf("to proto %s", p.wire)
		}
		if ParsePolicyDecision(p.wire) != p.wire {
			t.Fatalf("parse %s", p.wire)
		}
	}
	if PolicyDecisionToProto("bogus") != commonv1.PolicyDecision_POLICY_DECISION_UNSPECIFIED {
		t.Fatal("invalid stays unspecified")
	}
}

func TestRiskLevelAndChannelAndStreamRoundTrip(t *testing.T) {
	if RiskLevelFromProto(RiskLevelToProto(RiskLevelHigh)) != RiskLevelHigh {
		t.Fatal("risk")
	}
	if ChannelKindFromProto(ChannelKindToProto(ChannelFeishu)) != ChannelFeishu {
		t.Fatal("channel")
	}
	if StreamEventTypeFromProto(StreamEventTypeToProto(StreamDone)) != StreamDone {
		t.Fatal("stream")
	}
	if LoopModeFromProto(LoopModeToProto(LoopPlanExec)) != LoopPlanExec {
		t.Fatal("loop")
	}
	if MemoryLayerFromProto(MemoryLayerToProto(MemoryWorking)) != MemoryWorking {
		t.Fatal("memory")
	}
	for _, ch := range InboundChannels {
		if ChannelKindToProto(ch) == commonv1.ChannelKind_CHANNEL_KIND_UNSPECIFIED {
			t.Fatalf("unmapped channel %s", ch)
		}
	}
	for _, ev := range StreamEventTypes {
		if StreamEventTypeToProto(ev) == commonv1.StreamEventType_STREAM_EVENT_TYPE_UNSPECIFIED {
			t.Fatalf("unmapped event %s", ev)
		}
	}
}

func TestAgentOSErrorCodesAreStableEStar(t *testing.T) {
	if len(AgentOSErrorCodes) == 0 {
		t.Fatal("empty")
	}
	seen := map[apperr.Code]bool{}
	for _, c := range AgentOSErrorCodes {
		if !strings.HasPrefix(string(c), "E_") {
			t.Fatalf("not E_* : %s", c)
		}
		if seen[c] {
			t.Fatalf("dup %s", c)
		}
		seen[c] = true
	}
	for _, must := range []apperr.Code{apperr.SessionClosed, apperr.ReplayNotFound, apperr.IdentityMockForbidden, apperr.ZeroTrustDeny} {
		if !seen[must] {
			t.Fatalf("missing %s", must)
		}
	}
}
