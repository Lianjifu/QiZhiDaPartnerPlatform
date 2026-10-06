package copilot

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestWebDomainAllowed 验证白名单 + 通配 + 越界拒绝。
func TestWebDomainAllowed(t *testing.T) {
	t.Setenv("QZDA_WEB_ALLOWED", "api.example.com,*.internal.com")
	cases := []struct {
		url string
		ok  bool
	}{
		{"https://api.example.com/v1/users", true},
		{"http://api.example.com:8080/x", true},
		{"https://api.internal.com/foo", true},
		{"https://web.internal.com/bar", true},
		{"https://evil.com/x", false},
		{"not-a-url", false},
		{"", false},
	}
	for _, c := range cases {
		err := webDomainAllowed(c.url)
		if c.ok && err != nil {
			t.Errorf("%s should be allowed: %v", c.url, err)
		}
		if !c.ok && err == nil {
			t.Errorf("%s should be denied", c.url)
		}
	}

	t.Setenv("QZDA_WEB_ALLOWED", "*")
	if err := webDomainAllowed("https://anywhere.example.com"); err != nil {
		t.Errorf("* should allow all: %v", err)
	}
	t.Setenv("QZDA_WEB_ALLOWED", "")
	if err := webDomainAllowed("https://anywhere.example.com"); err == nil {
		t.Errorf("empty whitelist must deny all")
	}
}

// TestWebBrowseChromePath 验证默认 chrome 路径探测 + QZDA_BROWSER_BIN 覆盖。
func TestWebBrowseChromePath(t *testing.T) {
	if p := webComputerUsePath(); !strings.HasSuffix(p, "scripts/qzda-browser.mjs") {
		t.Errorf("expected default path under scripts/, got %q", p)
	}
	t.Setenv("QZDA_BROWSER_SCRIPT", "/custom/path.mjs")
	if p := webComputerUsePath(); p != "/custom/path.mjs" {
		t.Errorf("QZDA_BROWSER_SCRIPT not honored: %q", p)
	}
}

// TestWebComputerUseMissing 脚本不存在时 unavailable(非 crashed)。
func TestWebComputerUseMissing(t *testing.T) {
	t.Setenv("QZDA_WEB_ALLOWED", "*") // 域名全放行,关注"脚本缺失"路径
	t.Setenv("QZDA_BROWSER_SCRIPT", filepath.Join(t.TempDir(), "nonexistent.mjs"))
	r := webComputerUse(webComputerUsePayload{Cmd: "navigate", URL: "https://example.com"}, "https://example.com")
	if r.Status != "unavailable" {
		t.Errorf("expected unavailable, got %s: %s", r.Status, r.Error)
	}
	if !strings.Contains(r.Error, "找不到脚本") {
		t.Errorf("expected hint, got %q", r.Error)
	}
}

// TestWebFetchDomainDenied 域名白名单拒(不真发请求)。
func TestWebFetchDomainDenied(t *testing.T) {
	t.Setenv("QZDA_WEB_ALLOWED", "allowed.com")
	we := webComputerUse(webComputerUsePayload{Cmd: "navigate", URL: "https://blocked.com/x"}, "https://blocked.com/x")
	if we.Status != "denied" {
		t.Errorf("expected denied, got %s", we.Status)
	}
	_ = os.Getenv
}
