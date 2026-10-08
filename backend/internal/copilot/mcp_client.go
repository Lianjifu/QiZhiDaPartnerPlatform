// Package copilot —— MCP (Model Context Protocol) server 客户端(最小实现)。
//
// 让数字伙伴可以挂载外部 MCP server 暴露的工具(Notion / Slack / Linear /
// GitHub 等的官方 MCP server 都符合该协议)。本实现覆盖 MCP JSON-RPC 2.0
// over stdio / http 两类传输 + tools/list / tools/call 两类核心方法,
// 不覆盖 Streamable HTTP / SSE / sampling 等高级特性 — 后续按需补。
//
// 配置:环境变量 QZDA_MCP_SERVERS(逗号分隔):
//   stdio:/path/to/mcp-server arg1,arg2         启动子进程,JSON-RPC over stdio
//   http://host:port/mcp                        HTTP POST + content-type negotiation
//
// 暴露 2 个 copilot 工具(挂在 tool: 命名):
//   - mcp.list_servers   列出已配置 server 池
//   - mcp.call_tool      server <name>:tools/call <tool>  args = {...}
package copilot

// mcp_client.go — MCP(Model Context Protocol)客户端实现:JSON-RPC 通信、
// 能力协商、tool call。与 discover_server 配套,把 MCP server 暴露的工具
// 接入到 copilot_tools 的统一编排中。

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// mcpTransportKind stdio / http
type mcpTransportKind string

const (
	mcpKindStdio mcpTransportKind = "stdio"
	mcpKindHTTP  mcpTransportKind = "http"
)

// mcpServer 是一个挂载的 MCP server (一个进程 or 一个 HTTP endpoint)。
type mcpServer struct {
	Name     string
	Kind     mcpTransportKind
	Command  string          // stdio: 完整命令行(含 args)
	Endpoint string          // http: URL
	Tools    []mcpTool       // tools/list 缓存

	// stdio 会话(Kind=stdio 时非 nil)
	stdin  io.WriteCloser
	stdout *bufio.Scanner
	idSeq  int

	mu sync.Mutex
}

// mcpTool 是 MCP server 上注册的远端工具。
type mcpTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	InputSchema json.RawMessage `json:"inputSchema,omitempty"`
}

// mcpRegistry 是进程内单例(server 池);冷启动时由 init() 解析 QZDA_MCP_SERVERS。
var (
	mcpRegistryOnce sync.Once
	mcpRegistry     []*mcpServer
	mcpRegistryErr  error
)

// mcpInit 解析 QZDA_MCP_SERVERS 并启动 stdio 子进程(mcpRegistryOnce 守护)。
func mcpInit() error {
	mcpRegistryOnce.Do(func() {
		cfg := strings.TrimSpace(os.Getenv("QZDA_MCP_SERVERS"))
		if cfg == "" {
			mcpRegistry = nil
			mcpRegistryErr = nil
			return
		}
		for _, entry := range strings.Split(cfg, ",") {
			entry = strings.TrimSpace(entry)
			if entry == "" {
				continue
			}
			s, err := parseAndStartMCPServer(entry)
			if err != nil {
				mcpRegistryErr = fmt.Errorf("mcp: 启动 %q 失败: %w", entry, err)
				continue
			}
			mcpRegistry = append(mcpRegistry, s)
		}
	})
	return mcpRegistryErr
}

// parseAndStartMCPServer 把一条 "stdio:/path args" 或 "http://..." 配置
// 转成 mcpServer(对 stdio 启动子进程并缓存)。
func parseAndStartMCPServer(entry string) (*mcpServer, error) {
	if strings.HasPrefix(entry, "stdio:") {
		rest := strings.TrimPrefix(entry, "stdio:")
		parts := strings.Fields(rest)
		if len(parts) == 0 {
			return nil, fmt.Errorf("stdio URL 缺命令")
		}
		s := &mcpServer{Name: parts[0], Kind: mcpKindStdio, Command: rest}
		if err := s.startStdio(); err != nil {
			return nil, err
		}
		return s, nil
	}
	if strings.HasPrefix(entry, "http://") || strings.HasPrefix(entry, "https://") {
		return &mcpServer{Name: entry, Kind: mcpKindHTTP, Endpoint: entry}, nil
	}
	return nil, fmt.Errorf("MCP server spec 需 stdio: 或 http(s):// 前缀: %s", entry)
}

// startStdio 启动 stdio MCP 子进程 + spawn stdout scanner。
func (s *mcpServer) startStdio() error {
	cmd := exec.Command("/bin/sh", "-c", s.Command)
	cmd.Env = append(os.Environ(), "QZDA_MCP_CHILD=1")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return err
	}
	s.stdin = stdin
	s.stdout = bufio.NewScanner(stdout)
	s.stdout.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	return nil
}

// callStdio 走 stdio JSON-RPC 2.0 call(写一行请求 + 读一行响应)。
func (s *mcpServer) callStdio(method string, params any) (json.RawMessage, error) {
	if s.stdin == nil {
		return nil, fmt.Errorf("mcp stdio 未启动")
	}
	s.mu.Lock()
	s.idSeq++
	id := s.idSeq
	s.mu.Unlock()

	req := map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}
	body, _ := json.Marshal(req)
	body = append(body, '\n')
	if _, err := s.stdin.Write(body); err != nil {
		return nil, fmt.Errorf("mcp stdio 写失败: %w", err)
	}
	if !s.stdout.Scan() {
		return nil, fmt.Errorf("mcp stdio EOF")
	}
	var resp struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(s.stdout.Bytes(), &resp); err != nil {
		return nil, fmt.Errorf("mcp stdio 响应解析失败: %w", err)
	}
	if resp.Error != nil {
		return nil, fmt.Errorf("mcp %s: %s", method, resp.Error.Message)
	}
	return resp.Result, nil
}

// callHTTP 走 HTTP POST JSON-RPC。
func (s *mcpServer) callHTTP(method string, params any) (json.RawMessage, error) {
	req := map[string]any{"jsonrpc": "2.0", "id": time.Now().UnixNano(), "method": method, "params": params}
	body, _ := json.Marshal(req)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, s.Endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("mcp http 失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("mcp http %d: %s", resp.StatusCode, string(raw))
	}
	var out struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("mcp http 响应解析失败: %w", err)
	}
	if out.Error != nil {
		return nil, fmt.Errorf("mcp %s: %s", method, out.Error.Message)
	}
	return out.Result, nil
}

// callToolsList 返回 server 上的 tools 列表(缓存,二次查直接用)。
func (s *mcpServer) callToolsList() ([]mcpTool, error) {
	s.mu.Lock()
	cached := s.Tools
	s.mu.Unlock()
	if len(cached) > 0 {
		return cached, nil
	}
	var raw json.RawMessage
	var err error
	switch s.Kind {
	case mcpKindStdio:
		raw, err = s.callStdio("tools/list", map[string]any{})
	case mcpKindHTTP:
		raw, err = s.callHTTP("tools/list", map[string]any{})
	default:
		return nil, fmt.Errorf("mcp: 未知传输 %s", s.Kind)
	}
	if err != nil {
		return nil, err
	}
	var out struct {
		Tools []mcpTool `json:"tools"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("mcp tools/list 响应解析失败: %w", err)
	}
	s.mu.Lock()
	s.Tools = out.Tools
	s.mu.Unlock()
	return out.Tools, nil
}

// callTool 触发 server 上指定工具 + 返回原始 result 文本。
func (s *mcpServer) callTool(name string, args map[string]any) (string, error) {
	var raw json.RawMessage
	var err error
	switch s.Kind {
	case mcpKindStdio:
		raw, err = s.callStdio("tools/call", map[string]any{"name": name, "arguments": args})
	case mcpKindHTTP:
		raw, err = s.callHTTP("tools/call", map[string]any{"name": name, "arguments": args})
	default:
		return "", fmt.Errorf("mcp: 未知传输 %s", s.Kind)
	}
	if err != nil {
		return "", err
	}
	var out struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		IsError bool `json:"isError,omitempty"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return string(raw), nil
	}
	if out.IsError {
		return "", fmt.Errorf("mcp tool %s 报告 isError=true", name)
	}
	var b strings.Builder
	for _, c := range out.Content {
		switch c.Type {
		case "text":
			b.WriteString(c.Text)
			b.WriteString("\n")
		default:
			b.WriteString(fmt.Sprintf("[%s] %s\n", c.Type, c.Text))
		}
	}
	return strings.TrimSpace(b.String()), nil
}

// mcpListServers 给 assistant 看的 server 列表(JSON 字符串)。
func mcpListServers() toolExecResult {
	res := toolExecResult{}
	if err := mcpInit(); err != nil {
		res.Status = "failed"
		res.Error = err.Error()
		return res
	}
	if len(mcpRegistry) == 0 {
		res.Status = "success"
		res.Output = "(empty) 未配置任何 MCP server。设置环境变量 QZDA_MCP_SERVERS(例:stdio:/usr/local/bin/notion-mcp 或 http://localhost:3001/mcp)"
		return res
	}
	var b strings.Builder
	for _, s := range mcpRegistry {
		fmt.Fprintf(&b, "## %s  (%s)\n", s.Name, s.Kind)
		if s.Kind == mcpKindStdio {
			fmt.Fprintf(&b, "command: %s\n", s.Command)
		} else {
			fmt.Fprintf(&b, "endpoint: %s\n", s.Endpoint)
		}
		tools, err := s.callToolsList()
		if err != nil {
			fmt.Fprintf(&b, "tools/list 失败: %v\n", err)
		} else if len(tools) == 0 {
			b.WriteString("(无注册工具)\n")
		} else {
			b.WriteString("tools:\n")
			for _, t := range tools {
				fmt.Fprintf(&b, "  - %s  %s\n", t.Name, t.Description)
			}
		}
		b.WriteString("\n")
	}
	res.Status = "success"
	res.Output = b.String()
	return res
}

// mcpCallTool 触发指定 server 上的指定工具;server / tool / args 由 copilot
// 助手按 mcp.list_servers 输出解析后给出。
func mcpCallTool(serverName, toolName string, argsJSON string) toolExecResult {
	res := toolExecResult{}
	if err := mcpInit(); err != nil {
		res.Status = "failed"
		res.Error = err.Error()
		return res
	}
	var srv *mcpServer
	for _, s := range mcpRegistry {
		if s.Name == serverName {
			srv = s
			break
		}
	}
	if srv == nil {
		res.Status = "failed"
		res.Error = fmt.Sprintf("mcp: server %q 未配置(已挂载: %d 个)", serverName, len(mcpRegistry))
		return res
	}
	var args map[string]any
	if argsJSON != "" {
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			res.Status = "failed"
			res.Error = "mcp.call_tool: args JSON 解析失败: " + err.Error()
			return res
		}
	}
	out, err := srv.callTool(toolName, args)
	if err != nil {
		res.Status = "failed"
		res.Error = err.Error()
		return res
	}
	res.Status = "success"
	res.Output = out
	return res
}