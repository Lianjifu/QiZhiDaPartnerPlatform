package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	collabv1 "github.com/qizhida-partner-platform/backend/gen/qzda/collab/v1"
	"github.com/qizhida-partner-platform/backend/pkg/contract"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

type connectTurnWriter struct {
	header  http.Header
	status  int
	stream  *connect.ServerStream[collabv1.StreamTurnEvent]
	buf     bytes.Buffer
	lastErr error
	wrote   bool
}

func newConnectTurnWriter(stream *connect.ServerStream[collabv1.StreamTurnEvent]) *connectTurnWriter {
	return &connectTurnWriter{header: make(http.Header), stream: stream, status: 200}
}

func (w *connectTurnWriter) Header() http.Header { return w.header }

func (w *connectTurnWriter) WriteHeader(code int) {
	if w.wrote {
		return
	}
	w.status = code
}

func (w *connectTurnWriter) Write(p []byte) (int, error) {
	w.wrote = true
	if w.status == 0 {
		w.status = 200
	}
	n, _ := w.buf.Write(p)
	w.flushSSE()
	return n, w.lastErr
}

func (w *connectTurnWriter) Flush() { w.flushSSE() }

func (w *connectTurnWriter) flushSSE() {
	raw := w.buf.String()
	for {
		idx := strings.Index(raw, "\n\n")
		if idx < 0 {
			w.buf.Reset()
			w.buf.WriteString(raw)
			return
		}
		block := raw[:idx]
		raw = raw[idx+2:]
		w.emitSSEBlock(block)
		if w.lastErr != nil {
			return
		}
	}
}

func (w *connectTurnWriter) emitSSEBlock(block string) {
	eventName := ""
	var data strings.Builder
	for _, line := range strings.Split(block, "\n") {
		line = strings.TrimRight(line, "\r")
		switch {
		case strings.HasPrefix(line, "event:"):
			eventName = strings.TrimSpace(line[6:])
		case strings.HasPrefix(line, "data:"):
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.WriteString(strings.TrimSpace(line[5:]))
		}
	}
	payloadRaw := strings.TrimSpace(data.String())
	if payloadRaw == "" {
		return
	}
	var payload map[string]any
	if json.Unmarshal([]byte(payloadRaw), &payload) != nil {
		payload = map[string]any{"type": eventName, "text": payloadRaw}
	}
	typ := coalesce(str(payload["type"]), eventName)
	ev := &collabv1.StreamTurnEvent{
		Type:           typ,
		EventType:      contract.StreamEventTypeToProto(typ),
		Stage:          str(payload["stage"]),
		Text:           coalesce(str(payload["text"]), str(payload["message"])),
		CorrelationId:  str(payload["correlationId"]),
		SnapshotId:     str(payload["snapshotId"]),
		RagHits:        int32(intFrom(payload["ragHits"])),
		MemoryHits:     int32(intFrom(payload["memoryHits"])),
		PolicyDecision: contract.PolicyDecisionToProto(str(payload["decision"])),
		Meta:           map[string]string{"source": "harness"},
	}
	if m := str(payload["runtimeMode"]); m != "" {
		ev.Meta["runtimeMode"] = m
	}
	if m := str(payload["modelId"]); m != "" {
		ev.Meta["modelId"] = m
	}
	if m := str(payload["mode"]); m != "" {
		ev.Meta["mode"] = m
	}
	if w.stream != nil {
		w.lastErr = w.stream.Send(ev)
	}
}

func connectErrorFromWriter(w *connectTurnWriter) error {
	if w == nil {
		return nil
	}
	if w.status >= 400 {
		msg := strings.TrimSpace(w.buf.String())
		code := connect.CodeInternal
		switch {
		case w.status == 401:
			code = connect.CodeUnauthenticated
		case w.status == 403:
			code = connect.CodePermissionDenied
		case w.status == 404:
			code = connect.CodeNotFound
		case w.status == 400:
			code = connect.CodeInvalidArgument
		case w.status == 429:
			code = connect.CodeResourceExhausted
		case w.status == 503:
			code = connect.CodeUnavailable
		}
		if msg == "" {
			msg = http.StatusText(w.status)
		}
		return connect.NewError(code, apperr.New(apperr.Unknown, w.status, msg))
	}
	return w.lastErr
}
