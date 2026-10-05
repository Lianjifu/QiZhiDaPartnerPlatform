package server_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"
	auditv1 "github.com/qizhida-partner-platform/backend/gen/qzda/audit/v1"
	"github.com/qizhida-partner-platform/backend/gen/qzda/audit/v1/auditv1connect"
	collabv1 "github.com/qizhida-partner-platform/backend/gen/qzda/collab/v1"
	"github.com/qizhida-partner-platform/backend/gen/qzda/collab/v1/collabv1connect"
	commonv1 "github.com/qizhida-partner-platform/backend/gen/qzda/common/v1"
	platformv1 "github.com/qizhida-partner-platform/backend/gen/qzda/platform/v1"
	"github.com/qizhida-partner-platform/backend/gen/qzda/platform/v1/platformv1connect"
	policyv1 "github.com/qizhida-partner-platform/backend/gen/qzda/policy/v1"
	"github.com/qizhida-partner-platform/backend/gen/qzda/policy/v1/policyv1connect"
	ragv1 "github.com/qizhida-partner-platform/backend/gen/qzda/rag/v1"
	"github.com/qizhida-partner-platform/backend/gen/qzda/rag/v1/ragv1connect"
	runtimev1 "github.com/qizhida-partner-platform/backend/gen/qzda/runtime/v1"
	"github.com/qizhida-partner-platform/backend/gen/qzda/runtime/v1/runtimev1connect"
	"github.com/qizhida-partner-platform/backend/internal/server"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

func TestConnectRPCRagRetrieve(t *testing.T) {
	h := server.New(store.New()).Handler()
	client := ragv1connect.NewRagServiceClient(&http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		req.Header.Set("Authorization", "Bearer mock-admin-token")
		req.Header.Set("x-workspace-id", "w1")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		return rr.Result(), nil
	})}, "http://test")

	res, err := client.Retrieve(context.Background(), connect.NewRequest(&ragv1.RetrieveRequest{
		Query: "缓存", CorrelationId: "corr-rpc-1", PublishedOnly: true,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.GetCorrelationId() != "corr-rpc-1" {
		t.Fatalf("corr %s", res.Msg.GetCorrelationId())
	}
}

func TestConnectRPCCreateConversation(t *testing.T) {
	h := server.New(store.New()).Handler()
	client := collabv1connect.NewCollabServiceClient(&http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		req.Header.Set("Authorization", "Bearer mock-admin-token")
		req.Header.Set("x-workspace-id", "w1")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		return rr.Result(), nil
	})}, "http://test")

	res, err := client.CreateConversation(context.Background(), connect.NewRequest(&collabv1.CreateConversationRequest{
		Title: "RPC 会话", DigitalPartnerId: "de-1",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.GetId() == "" || res.Msg.GetTitle() != "RPC 会话" {
		t.Fatalf("got %#v", res.Msg)
	}
}

func TestConnectJSONGatewayStillWorks(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/connect/qzda.runtime.v1.RuntimeService/Invoke",
		bytes.NewBufferString(`{"input":"hi"}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
}

func TestConnectJSONGatewayPlatformListWorkspaces(t *testing.T) {
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/connect/qzda.platform.v1.PlatformService/ListWorkspaces",
		bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"ok":true`) {
		t.Fatalf("gateway envelope: %s", rr.Body.String())
	}
}

func TestConnectRPCStreamTurnUsesHarness(t *testing.T) {
	t.Setenv("QZDA_RUNTIME_MODE", "local")
	h := server.New(store.New()).Handler()
	client := collabv1connect.NewCollabServiceClient(&http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		req.Header.Set("Authorization", "Bearer mock-admin-token")
		req.Header.Set("x-workspace-id", "w1")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		return rr.Result(), nil
	})}, "http://test")

	corr := "corr-streamturn-1"
	stream, err := client.StreamTurn(context.Background(), connect.NewRequest(&collabv1.StreamTurnRequest{
		ConversationId: "conv-1", Content: "hello connect harness", CorrelationId: corr,
	}))
	if err != nil {
		t.Fatal(err)
	}
	stages := map[string]bool{}
	gotDone := false
	snap := ""
	for stream.Receive() {
		msg := stream.Msg()
		if msg.GetStage() != "" {
			stages[msg.GetStage()] = true
		}
		if msg.GetType() == "done" {
			gotDone = true
			snap = msg.GetSnapshotId()
			if msg.GetCorrelationId() != corr {
				t.Fatalf("corr %s", msg.GetCorrelationId())
			}
		}
	}
	if err := stream.Err(); err != nil {
		t.Fatal(err)
	}
	if !gotDone {
		t.Fatal("missing done")
	}
	if snap == "" {
		t.Fatal("missing snapshotId")
	}
	for _, st := range []string{"policy", "employee", "runtime"} {
		if !stages[st] {
			t.Fatalf("missing stage %s in %#v", st, stages)
		}
	}
}

func TestConnectRPCReplayTurnNotFound(t *testing.T) {
	h := server.New(store.New()).Handler()
	client := collabv1connect.NewCollabServiceClient(&http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		req.Header.Set("Authorization", "Bearer mock-admin-token")
		req.Header.Set("x-workspace-id", "w1")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		return rr.Result(), nil
	})}, "http://test")

	_, err := client.ReplayTurn(context.Background(), connect.NewRequest(&collabv1.ReplayTurnRequest{
		ConversationId: "missing", CorrelationId: "corr-replay-1",
	}))
	if err == nil {
		t.Fatal("expected not found")
	}
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code %v %v", connect.CodeOf(err), err)
	}
	if !strings.Contains(err.Error(), "E_REPLAY_NOT_FOUND") {
		t.Fatalf("want E_REPLAY_NOT_FOUND in %v", err)
	}
}

func TestConnectRPCRuntimeRun(t *testing.T) {
	t.Setenv("QZDA_RUNTIME_MODE", "local")
	h := server.New(store.New()).Handler()
	client := runtimev1connect.NewRuntimeServiceClient(&http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		req.Header.Set("Authorization", "Bearer mock-admin-token")
		req.Header.Set("x-workspace-id", "w1")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		return rr.Result(), nil
	})}, "http://test")

	stream, err := client.Run(context.Background(), connect.NewRequest(&runtimev1.RunRequest{
		Input:    "hi",
		Envelope: &commonv1.Envelope{CorrelationId: "corr-run-1"},
		Snapshot: &commonv1.ContextSnapshot{Id: "snap-1", CorrelationId: "corr-run-1"},
	}))
	if err != nil {
		t.Fatal(err)
	}
	gotDone := false
	for stream.Receive() {
		msg := stream.Msg()
		if msg.GetType() == commonv1.StreamEventType_STREAM_EVENT_TYPE_DONE {
			gotDone = true
			if msg.GetCorrelationId() != "corr-run-1" {
				t.Fatalf("corr %s", msg.GetCorrelationId())
			}
			if msg.GetSnapshotId() != "snap-1" {
				t.Fatalf("snapshot %s", msg.GetSnapshotId())
			}
		}
	}
	if err := stream.Err(); err != nil {
		t.Fatal(err)
	}
	if !gotDone {
		t.Fatal("missing done")
	}
}

func TestConnectJSONGatewayRuntimeRun(t *testing.T) {
	t.Setenv("QZDA_RUNTIME_MODE", "local")
	h := server.New(store.New()).Handler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/connect/qzda.runtime.v1.RuntimeService/Run",
		bytes.NewBufferString(`{"input":"hello run","correlationId":"corr-json-run-1","snapshot":{"id":"snap-json-1"}}`))
	req.Header.Set("Authorization", "Bearer mock-admin-token")
	req.Header.Set("X-Workspace-Id", "w1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, `"ok":true`) {
		t.Fatalf("want ok: %s", body)
	}
	if !strings.Contains(body, "snap-json-1") {
		t.Fatalf("want snapshot id: %s", body)
	}
	if !strings.Contains(body, `"runtimeMode":"local"`) {
		t.Fatalf("want local runtimeMode: %s", body)
	}
}

func TestConnectRPCPolicyEvaluate(t *testing.T) {
	h := server.New(store.New()).Handler()
	client := policyv1connect.NewPolicyServiceClient(&http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		req.Header.Set("Authorization", "Bearer mock-admin-token")
		req.Header.Set("x-workspace-id", "w1")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		return rr.Result(), nil
	})}, "http://test")

	gov, err := client.GetAccessGovernance(context.Background(), connect.NewRequest(&policyv1.GetAccessGovernanceRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(gov.Msg.GetGrants()) == 0 {
		t.Fatal("expected seeded grants")
	}

	res, err := client.EvaluateZeroTrust(context.Background(), connect.NewRequest(&policyv1.EvaluateZeroTrustRequest{
		Resource: "session", Action: "read", CorrelationId: "corr-pol-1",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg.GetDecision() != "allow" || res.Msg.GetCorrelationId() != "corr-pol-1" {
		t.Fatalf("got %#v", res.Msg)
	}
}

func TestConnectRPCAuditList(t *testing.T) {
	h := server.New(store.New()).Handler()
	client := auditv1connect.NewAuditServiceClient(&http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		req.Header.Set("Authorization", "Bearer mock-admin-token")
		req.Header.Set("x-workspace-id", "w1")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		return rr.Result(), nil
	})}, "http://test")

	res, err := client.ListAuditCenter(context.Background(), connect.NewRequest(&auditv1.ListAuditCenterRequest{WorkspaceId: "w1"}))
	if err != nil {
		t.Fatal(err)
	}
	if res.Msg == nil {
		t.Fatal("nil list")
	}
}

func TestConnectRPCPlatformListWorkspaces(t *testing.T) {
	h := server.New(store.New()).Handler()
	client := platformv1connect.NewPlatformServiceClient(&http.Client{Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		req.Header.Set("Authorization", "Bearer mock-admin-token")
		req.Header.Set("x-workspace-id", "w1")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		return rr.Result(), nil
	})}, "http://test")

	res, err := client.ListWorkspaces(context.Background(), connect.NewRequest(&platformv1.ListWorkspacesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Msg.GetItems()) == 0 {
		t.Fatal("expected workspaces")
	}
	if res.Msg.GetItems()[0].GetId() == "" {
		t.Fatalf("%#v", res.Msg.GetItems()[0])
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
