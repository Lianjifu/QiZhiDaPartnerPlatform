package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/modelprov"
)

// de-local-llm: OpenAI-compatible chat completions for local Copilot / Cap wiring.
// Default listen: 127.0.0.1:18080 (matches seed "Local Mock LLM").

func main() {
	addr := strings.TrimSpace(os.Getenv("DE_LOCAL_LLM_ADDR"))
	if addr == "" {
		addr = "127.0.0.1:18080"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]any{"status": "ok", "service": "de-local-llm", "model": "local-chat"})
	})
	mux.HandleFunc("/v1/models", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]any{
			"object": "list",
			"data": []map[string]any{
				{"id": "local-chat", "object": "model", "owned_by": "digital-employee"},
				{"id": "mock-chat", "object": "model", "owned_by": "digital-employee"},
			},
		})
	})
	mux.HandleFunc("/v1/chat/completions", handleChat)
	mux.HandleFunc("/chat/completions", handleChat)

	log.Printf("de-local-llm listening on http://%s (OpenAI-compatible)", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}

type chatReq struct {
	Model    string `json:"model"`
	Stream   bool   `json:"stream"`
	Messages []struct {
		Role    string `json:"role"`
		Content any    `json:"content"`
	} `json:"messages"`
}

func handleChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var req chatReq
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	system, user := "", ""
	for _, m := range req.Messages {
		content := messageContent(m.Content)
		switch m.Role {
		case "system":
			if system == "" {
				system = content
			} else {
				system += "\n" + content
			}
		case "user":
			user = content
		}
	}
	reply := modelprov.BuildLocalChatReply(system, user)
	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = "local-chat"
	}
	if req.Stream {
		streamReply(w, model, reply)
		return
	}
	writeJSON(w, map[string]any{
		"id":      fmt.Sprintf("chatcmpl-local-%d", time.Now().UnixNano()),
		"object":  "chat.completion",
		"created": time.Now().Unix(),
		"model":   model,
		"choices": []map[string]any{{
			"index": 0,
			"message": map[string]any{
				"role":    "assistant",
				"content": reply,
			},
			"finish_reason": "stop",
		}},
	})
}

func streamReply(w http.ResponseWriter, model, reply string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "stream unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	id := fmt.Sprintf("chatcmpl-local-%d", time.Now().UnixNano())
	bw := bufio.NewWriter(w)
	writeChunk := func(delta string, finish string) {
		payload := map[string]any{
			"id": id, "object": "chat.completion.chunk", "created": time.Now().Unix(), "model": model,
			"choices": []map[string]any{{
				"index": 0,
				"delta": map[string]any{"content": delta},
				"finish_reason": func() any {
					if finish == "" {
						return nil
					}
					return finish
				}(),
			}},
		}
		b, _ := json.Marshal(payload)
		_, _ = bw.WriteString("data: ")
		_, _ = bw.Write(b)
		_, _ = bw.WriteString("\n\n")
		_ = bw.Flush()
		flusher.Flush()
	}
	runes := []rune(reply)
	const size = 24
	for i := 0; i < len(runes); i += size {
		j := i + size
		if j > len(runes) {
			j = len(runes)
		}
		writeChunk(string(runes[i:j]), "")
	}
	writeChunk("", "stop")
	_, _ = bw.WriteString("data: [DONE]\n\n")
	_ = bw.Flush()
	flusher.Flush()
}

func messageContent(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case []any:
		var b strings.Builder
		for _, part := range t {
			m, _ := part.(map[string]any)
			if m == nil {
				continue
			}
			if s, ok := m["text"].(string); ok {
				b.WriteString(s)
			}
		}
		return b.String()
	default:
		return fmt.Sprint(v)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
