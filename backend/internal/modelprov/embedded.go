package modelprov

import (
	"context"
	"os"
	"strings"
)

// EmbeddedChatEnabled is the last-resort local chat when no remote provider works.
// Disable with DE_EMBEDDED_CHAT=0 (production with mandatory external LLM).
func EmbeddedChatEnabled() bool {
	v := strings.TrimSpace(os.Getenv("DE_EMBEDDED_CHAT"))
	if v == "" {
		return true
	}
	return v != "0" && !strings.EqualFold(v, "false")
}

// EmbeddedChatRequest builds an in-process chat request (no network).
func EmbeddedChatRequest(userMsg, system string) ChatRequest {
	sys := strings.TrimSpace(system)
	if sys == "" {
		sys = "你是企业企智搭 · 数字伙伴平台的内置对话助手。请用中文简洁、可执行地回答，并遵守岗位边界。"
	}
	return ChatRequest{
		Protocol: "embedded",
		BaseURL:  "embedded://local",
		Model:    "local-chat",
		System:   sys,
		Messages: []ChatMessage{{Role: "user", Content: userMsg}},
	}
}

func streamEmbedded(_ context.Context, req ChatRequest, out chan<- ChatChunk) {
	user := ""
	system := req.System
	var prior []string
	for _, m := range req.Messages {
		switch m.Role {
		case "system":
			if system == "" {
				system = m.Content
			}
		case "user":
			if user != "" {
				prior = append(prior, "用户："+truncateLocal(user, 200))
			}
			user = m.Content
		case "assistant":
			prior = append(prior, "助手："+truncateLocal(m.Content, 200))
		}
	}
	if len(prior) > 0 {
		var b strings.Builder
		b.WriteString("对话上文：\n")
		// Keep last few prior lines to bound prompt size for local heuristic.
		start := 0
		if len(prior) > 6 {
			start = len(prior) - 6
		}
		for _, line := range prior[start:] {
			b.WriteString(line)
			b.WriteString("\n")
		}
		b.WriteString("当前用户：")
		b.WriteString(user)
		user = b.String()
	}
	text := BuildLocalChatReply(system, user)
	runes := []rune(text)
	const size = 18
	for i := 0; i < len(runes); i += size {
		j := i + size
		if j > len(runes) {
			j = len(runes)
		}
		out <- ChatChunk{Text: string(runes[i:j])}
	}
	out <- ChatChunk{Done: true}
}

func truncateLocal(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if n <= 0 || len(r) <= n {
		return string(r)
	}
	return string(r[:n]) + "…"
}
