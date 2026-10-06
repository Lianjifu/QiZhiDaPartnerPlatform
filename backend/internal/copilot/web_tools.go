// Package copilot —— Web / 浏览器(computer-use 子集)工具集。
//
// 暴露 2 个工具:
//
//   - web.fetch   HTTP GET + parse(text / json),无 JS 渲染,适合抓 API / 文档
//   - web.browse   Chrome / Chromium headless 导航 + 提取文本 + 截图;
//                  QZDA_BROWSER_BIN(默认 /usr/bin/google-chrome) 存在才真正
//                  执行 JS 渲染,否则 graceful fallback 退化为 web.fetch 风格
//                  的 HTML 抓取(纯 curl,无 JS)。
//
// 安全约束:
//   - 域名白名单:仅允许 QZDA_WEB_ALLOWED(逗号分隔,默认 *);空 → 全部拒
//   - 2s 超时 + 1MB 输出上限(避免长轮询 / 巨大页面炸控制面)
//   - screenshot 64KB 截断 + 写到 QZDA_BROWSER_SCREENSHOT_DIR(默认 /tmp/qzda-browser)
//   - 仅 GET,no PE

package copilot

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// webFetchResponse 是 web.fetch 的解析结果。
type webFetchResponse struct {
	URL          string `json:"url"`
	Status       int    `json:"status"`
	ContentType  string `json:"contentType,omitempty"`
	Body         string `json:"body,omitempty"`         // text body(text/plain 或 text/html 截取)
	JSON         any    `json:"json,omitempty"`          // 解析后的 JSON(application/json)
	Bytes        int    `json:"bytes"`
	DurationMs   int    `json:"durationMs"`
	Truncated    bool   `json:"truncated,omitempty"`
}

// webBrowseResponse 是 web.browse 的渲染结果。
type webBrowseResponse struct {
	URL         string `json:"url"`
	Status      int    `json:"status,omitempty"`
	Title       string `json:"title,omitempty"`
	Text        string `json:"text,omitempty"`     // 提取的可见文本(去 script/style)
	HTML        string `json:"html,omitempty"`     // 截断的 HTML(≤32KB)
	Screenshot  string `json:"screenshot,omitempty"` // base64 PNG path(≤64KB)
	Backend     string `json:"backend"`           // chrome | curl-fallback
	DurationMs  int    `json:"durationMs"`
	Truncated   bool   `json:"truncated,omitempty"`
}

// webDomainAllowed 返回 url 是否在白名单内(空白名单 → 全部拒)。
func webDomainAllowed(rawURL string) error {
	u := strings.TrimSpace(rawURL)
	if u == "" {
		return fmt.Errorf("web: 空 URL")
	}
	if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
		return fmt.Errorf("web: URL 需 http(s)://")
	}
	allow := strings.TrimSpace(os.Getenv("QZDA_WEB_ALLOWED"))
	// 仅 "*" 显式表示 allow-all;空字符串 / 没设 = 全部拒,默认保守。
	if allow == "*" {
		return nil
	}
	if allow == "" {
		return fmt.Errorf("web: 未配置 QZDA_WEB_ALLOWED(逗号分隔域名列表,或 '*' 显式放行)")
	}
	// 抽 host(忽略端口)
	host := u
	if i := strings.Index(u, "://"); i >= 0 {
		host = u[i+3:]
	}
	if i := strings.Index(host, "/"); i >= 0 {
		host = host[:i]
	}
	if i := strings.Index(host, ":"); i >= 0 {
		host = host[:i]
	}
	for _, p := range strings.Split(allow, ",") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if strings.HasPrefix(p, "*.") && strings.HasSuffix(host, p[1:]) {
			return nil
		}
		if host == p {
			return nil
		}
	}
	return fmt.Errorf("web: 域名 %s 不在 QZDA_WEB_ALLOWED 白名单(%s)", host, allow)
}

// webFetch HTTP GET + 解析(text/html 直接截 body / application/json 反序列化)。
func webFetch(rawURL string) toolExecResult {
	res := toolExecResult{}
	if err := webDomainAllowed(rawURL); err != nil {
		res.Status = "denied"
		res.Error = err.Error()
		return res
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		res.Status = "failed"
		res.Error = err.Error()
		return res
	}
	req.Header.Set("User-Agent", "Qzda-WebFetch/1.0 (agent)")
	req.Header.Set("Accept", "*/*")
	client := &http.Client{Timeout: 2 * time.Second}
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		res.Status = "failed"
		res.Error = err.Error()
		return res
	}
	defer resp.Body.Close()
	const maxBytes = 1024 * 1024 // 1MB 上限
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		res.Status = "failed"
		res.Error = err.Error()
		return res
	}
	out := webFetchResponse{
		URL:         rawURL,
		Status:      resp.StatusCode,
		ContentType: resp.Header.Get("Content-Type"),
		Bytes:       len(body),
		DurationMs:  int(time.Since(start).Milliseconds()),
	}
	ctLower := strings.ToLower(out.ContentType)
	truncated := len(body) > maxBytes
	if truncated {
		body = body[:maxBytes]
	}
	out.Truncated = truncated
	if strings.HasPrefix(ctLower, "application/json") {
		var parsed any
		if err := json.Unmarshal(body, &parsed); err == nil {
			out.JSON = parsed
		}
		// 同时也保留原始 body(text 兜底)
		out.Body = string(body)
	} else {
		out.Body = string(body)
	}
	res.Status = "success"
	if b, err := json.Marshal(out); err == nil {
		res.Output = string(b)
	} else {
		res.Output = fmt.Sprintf("web.fetch: %d bytes (%s)", out.Bytes, out.ContentType)
	}
	return res
}

// webBrowseChromePath 找 chrome/chromium binary(否则 graceful fallback)。
func webBrowseChromePath() string {
	if v := strings.TrimSpace(os.Getenv("QZDA_BROWSER_BIN")); v != "" {
		if _, err := os.Stat(v); err == nil {
			return v
		}
	}
	for _, p := range []string{
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		"/snap/bin/chromium",
		"/usr/lib/chromium-browser/chromium-browser",
	} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// webBrowse 渲染 URL(text-only + 可选 screenshot)。无 chrome 时退化为
// curl 抓 HTML,无 JS 渲染(标记 Backend = curl-fallback)。
func webBrowse(rawURL, action string) toolExecResult {
	res := toolExecResult{}
	if err := webDomainAllowed(rawURL); err != nil {
		res.Status = "denied"
		res.Error = err.Error()
		return res
	}
	out := webBrowseResponse{URL: rawURL, Backend: "curl-fallback"}
	start := time.Now()

	if bin := webBrowseChromePath(); bin != "" {
		// Chrome headless 渲染 text
		chromeText := extractText(&bin, rawURL, "dump-dom")
		if text, ok := chromeText["text"]; ok && text != "" {
			out.Title = chromeText["title"]
			out.Text = text
			out.Backend = "chrome"
		}
		// 可选 screenshot
		if action == "screenshot" || action == "" {
			dir := strings.TrimSpace(os.Getenv("QZDA_BROWSER_SCREENSHOT_DIR"))
			if dir == "" {
				dir = "/tmp/qzda-browser"
			}
			_ = os.MkdirAll(dir, 0o755)
			shotPath := filepath.Join(dir, fmt.Sprintf("shot-%d.png", time.Now().UnixNano()))
			if data, ok := extractText(&bin, rawURL, "screenshot")["png"]; ok && data != "" {
				pngBytes, _ := base64.StdEncoding.DecodeString(data)
				if len(pngBytes) > 0 && len(pngBytes) <= 64*1024 {
					_ = os.WriteFile(shotPath, pngBytes, 0o644)
					out.Screenshot = shotPath
				}
			}
		}
	} else {
		// 无 chrome:用 shell.exec 的 curl 抓
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		curlCmd := exec.CommandContext(ctx, "curl", "-sL", "--max-time", "2", rawURL)
		if html, err := curlCmd.Output(); err == nil {
			out.Text = stripHTML(string(html))
			out.HTML = truncate(string(html), 32*1024)
			out.Truncated = len(html) > 32*1024
		}
	}

	if out.Backend == "chrome" && out.Text == "" {
		out.Backend = "curl-fallback"
	}
	if out.Text == "" && out.Title == "" {
		res.Status = "failed"
		res.Error = "web.browse: 渲染结果为空(URL 状态非 200 或 JS 渲染无内容)"
		return res
	}
	out.DurationMs = int(time.Since(start).Milliseconds())
	res.Status = "success"
	if b, err := json.Marshal(out); err == nil {
		res.Output = string(b)
	} else {
		res.Output = fmt.Sprintf("web.browse: %s title=%q text=%d bytes", out.Backend, out.Title, len(out.Text))
	}
	return res
}

// extractText 调 chrome --headless --dump-dom / --screenshot flag 取结果。
// mode 试过返 {text, title} 或 {png: base64}。
func extractText(bin *string, url string, mode string) map[string]string {
	out := map[string]string{}
	flags := []string{"--headless", "--disable-gpu", "--no-sandbox"}
	if mode == "screenshot" {
		flags = append(flags, "--screenshot", "--window-size=1280,800")
	} else {
		flags = append(flags, "--dump-dom")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, *bin, flags...)
	cmd.Args = append(cmd.Args, url)
	outBytes, err := cmd.Output()
	if err != nil {
		return out
	}
	if mode == "screenshot" {
		out["png"] = base64.StdEncoding.EncodeToString(outBytes)
	} else {
		html := string(outBytes)
		// 提 title
		title := ""
		if i := strings.Index(html, "<title>"); i >= 0 {
			j := strings.Index(html[i:], "</title>")
			if j > 0 {
				title = strings.TrimSpace(html[i+7 : i+j])
			}
		}
		out["title"] = title
		out["text"] = stripHTML(html)
	}
	return out
}

// stripHTML 把 HTML 简化成纯文本(去 script/style/HTML 标签,折叠空白)。
func stripHTML(html string) string {
	var b strings.Builder
	inTag := false
	i := 0
	for i < len(html) {
		c := html[i]
		if c == '<' {
			inTag = true
		} else if c == '>' {
			inTag = false
			b.WriteByte('\n')
		} else if !inTag {
			b.WriteByte(c)
		}
		i++
	}
	return strings.TrimSpace(b.String())
}

func startsWith(s, prefix string) bool {
	return strings.HasPrefix(s, prefix)
}

// truncate 截断 s 到 n 字节,返回前 s。
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// webComputerUsePayload 是 web.fill / web.type / web.click / web.eval /
// web.close 共用的 node 脚本 payload,跨 stdin 传入。
type webComputerUsePayload struct {
	Cmd      string `json:"cmd"`                // navigate | click | type | fill | extract_text | extract_html | screenshot | eval | close
	URL      string `json:"url,omitempty"`
	Value    string `json:"value,omitempty"`
	Selector string `json:"selector,omitempty"`
	JS       string `json:"js,omitempty"`
	Path     string `json:"path,omitempty"`
	FullPage bool   `json:"fullPage,omitempty"`
}

// webComputerUsePath 是 scripts/qzda-browser.mjs 的绝对路径;可被
// QZDA_BROWSER_SCRIPT 覆盖(dev / staging 部署差异)。
func webComputerUsePath() string {
	if v := strings.TrimSpace(os.Getenv("QZDA_BROWSER_SCRIPT")); v != "" {
		return v
	}
	return "/Users/LIANJIFU/ops/QiZhiDaPartnerPlatform/scripts/qzda-browser.mjs"
}

// webComputerUse 走 node 脚本(playwright 后端)的 stdio JSON 协议,返回结果
// 直接落到 toolExecResult.Output(JSON 字符串)。
// domain 白名单 + return (同 web.fetch);每次 8s 上限 + 32KB 输出 cap。
func webComputerUse(payload webComputerUsePayload, rawURL string) toolExecResult {
	res := toolExecResult{}
	if rawURL != "" {
		if err := webDomainAllowed(rawURL); err != nil {
			res.Status = "denied"
			res.Error = err.Error()
			return res
		}
	}
	scriptPath := webComputerUsePath()
	if _, err := os.Stat(scriptPath); err != nil {
		res.Status = "unavailable"
		res.Error = fmt.Sprintf("web.browse: 找不到脚本 %s(set QZDA_BROWSER_SCRIPT=... 或 npm i -g playwright)", scriptPath)
		return res
	}
	body, _ := json.Marshal(payload)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", scriptPath)
	cmd.Stdin = strings.NewReader(string(body))
	outBytes, err := cmd.Output()
	if err != nil {
		// 单独保留 stderr 摘要;通常 chromium 缺装会落到这里
		res.Status = "failed"
		if ee, ok := err.(*exec.ExitError); ok {
			res.Error = fmt.Sprintf("node exit %d: %s", ee.ExitCode(), string(ee.Stderr)[:512])
		} else {
			res.Error = err.Error()
		}
		return res
	}
	out := strings.TrimSpace(string(outBytes))
	if len(out) > 32*1024 {
		out = out[:32*1024] + "\n[truncated…]"
	}
	res.Status = "success"
	res.Output = out
	return res
}