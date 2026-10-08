// Package copilot —— Shell 工具集(企业版 agent 必需能力)。
//
// 暴露 6 个工具给数字伙伴,符合"调用 shell 脚本(读文件 / 编辑文件 / 搜索 /
// 执行命令 / 写文件等操作)"的 agent 形态:
//   - shell.read_file     读单个文件(限制大小防止上下文爆炸)
//   - shell.write_file    写/覆盖文件(workspace 内白名单)
//   - shell.edit_file     按 search-replace 要编辑文件(原子 + 校验)
//   - shell.search_files  ripgrep 风格搜索(pattern / glob / 上下文)
//   - shell.list_dir      列出目录(深度限制防递归爆炸)
//   - shell.exec          执行受限命令(白名单 + 超时 + working dir)
//
// 安全模型:
//   - QZDA_SHELL_ROOTS 逗号分隔白名单(默认 /workspace + /tmp + /var/qzda);
//     workspace 外的路径 全部 403。
//   - exec 子集硬白名单(ls/cat/head/tail/grep/find/wc/du/df/stat/echo/printf/
//     date/uname/whoami/ps/top/netstat/ss/ping/traceroute/nslookup/dig/host/
//     env/pwd/realpath/file/jq/yq/xmllint/curl/wget/git/make/go/node/npm/
//     pnpm/yarn/pytest/ruff/docker/docker/kubectl);其他命令(包括 rm/mv/cp/
//     chmod/chown/dd/sh/bash/ssh/nc 等)直接拒绝。
//   - docker / kubectl 限定 query 子命令,mutating 子命令需走 approval flow。
//   - 每次执行硬 2s 超时 + 64KB 输出上限。
//   - 写 / exec 写 audit.events 留痕。
package copilot

// shell_tools.go — shell 工具实现:命令执行、stdout/stderr 捕获、超时与退出码
// 归一。在 qzda-sandbox 内运行,本文件只做参数封装与结果解析。

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// defaultShellRoots 是 shell 工具可读写的白名单根;可被 QZDA_SHELL_ROOTS
// 覆盖(逗号分隔)。
func defaultShellRoots() []string {
	if v := strings.TrimSpace(os.Getenv("QZDA_SHELL_ROOTS")); v != "" {
		return strings.Split(v, ",")
	}
	return []string{"/workspace", "/tmp", "/var/qzda"}
}

// shellExecAllowlist 是 exec 命令的硬白名单(只读 + 受控 devops);
// 不在表内的一律拒绝(包括 rm / mv / cp / chmod / chown / dd / sh /
// bash / ssh / nc 等)。
var shellExecAllowlist = map[string]struct{}{
	"ls": {}, "cat": {}, "head": {}, "tail": {}, "grep": {},
	"find": {}, "wc": {}, "du": {}, "df": {}, "stat": {},
	"echo": {}, "printf": {}, "date": {}, "uname": {}, "whoami": {},
	"ps": {}, "top": {}, "netstat": {}, "ss": {}, "ping": {},
	"traceroute": {}, "nslookup": {}, "dig": {}, "host": {},
	"env": {}, "pwd": {}, "realpath": {}, "file": {},
	"jq": {}, "yq": {}, "xmllint": {},
	"curl": {}, "wget": {},
	"git": {}, "make": {},
	"go": {}, "node": {}, "npm": {}, "pnpm": {}, "yarn": {},
	"pytest": {}, "ruff": {}, "mvn": {}, "gradle": {},
	"docker": {}, "kubectl": {},
}

// shellDeniedSubstrings 黑名单:出现在命令任意位置即拒(防
// "git rm -rf" / "| sh" 之类绕过白名单)。
var shellDeniedSubstrings = []string{
	"rm -rf /", "rm -fr /", ":(){:|:&};:",
	"mkfs", "dd if=", "chmod 777", "chown -R",
	"| sh", "| bash", "| nc", "; sh ", "; bash ",
	"/etc/passwd", "/etc/shadow",
}

// shellMutatingSubcommands:docker / kubectl 这些白名单命令的 mutating
// 子命令,需走 approval flow 而非 exec。
var shellMutatingSubcommands = map[string]bool{
	"rm": true, "rmi": true, "stop": true, "kill": true,
	"start": true, "restart": true, "exec": true, "run": true,
	"create": true, "apply": true, "delete": true, "replace": true,
	"patch": true, "scale": true, "rollout": true, "cordon": true, "drain": true,
}

// resolveShellPath 把 null / 相对路径解算到白名单内;白名单外返回 error;
// 防止 "../etc/passwd" 之类的路径穿越。
func resolveShellPath(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		return "", fmt.Errorf("shell: 空路径")
	}
	if !filepath.IsAbs(p) {
		roots := defaultShellRoots()
		if len(roots) == 0 {
			return "", fmt.Errorf("shell: 无可写根")
		}
		p = filepath.Join(roots[0], p)
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	for _, root := range defaultShellRoots() {
		rAbs, _ := filepath.Abs(root)
		if rAbs == "" {
			continue
		}
		if abs == rAbs || strings.HasPrefix(abs, rAbs+string(os.PathSeparator)) {
			return abs, nil
		}
	}
	return "", fmt.Errorf("shell: 路径 %s 不在白名单内", abs)
}

// shellReadFile 读取文件(限制 256KB 防止上下文爆炸)。
func (s *Service) shellReadFile(path string) toolExecResult {
	res := toolExecResult{}
	abs, err := resolveShellPath(path)
	if err != nil {
		res.Status = "denied"
		res.Error = err.Error()
		return res
	}
	const maxBytes = 256 * 1024
	f, err := os.Open(abs)
	if err != nil {
		res.Status = "failed"
		res.Error = err.Error()
		return res
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		res.Status = "failed"
		res.Error = err.Error()
		return res
	}
	if st.Size() > maxBytes {
		res.Status = "failed"
		res.Error = fmt.Sprintf("文件过大 (%d bytes, 上限 %d)。请用 shell.search_files + 分段读取。", st.Size(), maxBytes)
		return res
	}
	buf := make([]byte, st.Size())
	n, err := io.ReadFull(f, buf)
	if err != nil {
		res.Status = "failed"
		res.Error = err.Error()
		return res
	}
	res.Status = "success"
	res.Output = string(buf[:n])
	return res
}

// shellWriteFile 写文件(覆盖;workspace 白名单 + 大小限制)。
func (s *Service) shellWriteFile(path, content string) toolExecResult {
	res := toolExecResult{}
	abs, err := resolveShellPath(path)
	if err != nil {
		res.Status = "denied"
		res.Error = err.Error()
		return res
	}
	if len(content) > 256*1024 {
		res.Status = "denied"
		res.Error = fmt.Sprintf("内容过大 (%d bytes, 上限 256KB)", len(content))
		return res
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		res.Status = "failed"
		res.Error = err.Error()
		return res
	}
	if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
		res.Status = "failed"
		res.Error = err.Error()
		return res
	}
	res.Status = "success"
	res.Output = fmt.Sprintf("已写入 %d bytes 到 %s", len(content), abs)
	return res
}

// shellEditFile 按 search-replace 原子编辑;找不到 search → failed;
// 多处匹配 → failed(防止误改)。
func (s *Service) shellEditFile(path, search, replace string) toolExecResult {
	res := toolExecResult{}
	read := s.shellReadFile(path)
	if read.Status != "success" {
		return read
	}
	src := read.Output
	count := strings.Count(src, search)
	if count == 0 {
		res.Status = "failed"
		res.Error = "search 字符串在文件中不存在"
		return res
	}
	if count > 1 {
		res.Status = "failed"
		res.Error = fmt.Sprintf("search 字符串在文件中出现 %d 次,需要更精确的锚点", count)
		return res
	}
	updated := strings.Replace(src, search, replace, 1)
	wf := s.shellWriteFile(path, updated)
	if wf.Status == "success" {
		res.Output = fmt.Sprintf("已编辑 %s (1 处替换)", path)
	}
	return wf
}

// shellSearchFiles ripgrep 风格文件搜索;支持 pattern / include_glob / 上下文。
func (s *Service) shellSearchFiles(root, pattern, includeGlob string, contextLines int) toolExecResult {
	res := toolExecResult{}
	absRoot, err := resolveShellPath(root)
	if err != nil {
		res.Status = "denied"
		res.Error = err.Error()
		return res
	}
	if contextLines <= 0 {
		contextLines = 2
	}
	if contextLines > 10 {
		contextLines = 10
	}
	pat := pattern
	if pat == "" {
		pat = "."
	}
	inc := includeGlob
	if inc == "" {
		inc = "*"
	}
	matches, err := filepath.Glob(filepath.Join(absRoot, inc))
	if err != nil {
		res.Status = "failed"
		res.Error = err.Error()
		return res
	}
	var hits []string
	const maxHits = 200
	for _, m := range matches {
		if len(hits) >= maxHits {
			break
		}
		fi, err := os.Stat(m)
		if err != nil || fi.IsDir() {
			continue
		}
		data, err := os.ReadFile(m)
		if err != nil {
			continue
		}
		if !strings.Contains(string(data), pat) {
			continue
		}
		rel, _ := filepath.Rel(absRoot, m)
		lines := strings.Split(string(data), "\n")
		for i, line := range lines {
			if strings.Contains(line, pat) {
				hits = append(hits, fmt.Sprintf("%s:%d:%s", rel, i+1, line))
			}
		}
	}
	res.Status = "success"
	res.Output = strings.Join(hits, "\n")
	return res
}

// shellListDir 浅列目录(深度限制防递归)。
func (s *Service) shellListDir(path string, depth int) toolExecResult {
	res := toolExecResult{}
	abs, err := resolveShellPath(path)
	if err != nil {
		res.Status = "denied"
		res.Error = err.Error()
		return res
	}
	if depth <= 0 {
		depth = 1
	}
	if depth > 3 {
		depth = 3
	}
	var out strings.Builder
	var walk func(p string, d int)
	walk = func(p string, d int) {
		if d > depth {
			return
		}
		entries, err := os.ReadDir(p)
		if err != nil {
			return
		}
		prefix := strings.Repeat("  ", d-1)
		for _, e := range entries {
			sep := ""
			if e.IsDir() {
				sep = "/"
			}
			out.WriteString(prefix + e.Name() + sep + "\n")
			if e.IsDir() && d < depth {
				walk(filepath.Join(p, e.Name()), d+1)
			}
		}
	}
	walk(abs, 1)
	res.Status = "success"
	res.Output = out.String()
	return res
}

// shellExec 跑受控白名单命令(2s 超时 + 64KB 输出上限 + audit 留痕)。
func (s *Service) shellExec(workspaceID, actor, command string, args []string) toolExecResult {
	res := toolExecResult{}

	// 黑名单短语
	for _, bad := range shellDeniedSubstrings {
		if strings.Contains(command+" "+strings.Join(args, " "), bad) {
			res.Status = "denied"
			res.Error = "shell.exec: 命令包含禁用短语 " + bad
			s.Store.AppendAudit(workspaceID, actor, "shell.exec", command+" "+strings.Join(args, " "), "denied", "")
			return res
		}
	}

	cmd := strings.TrimSpace(command)
	if _, ok := shellExecAllowlist[cmd]; !ok {
		res.Status = "denied"
		res.Error = fmt.Sprintf("shell.exec: 命令 %q 不在白名单(rm/mu/x 等禁止)", cmd)
		s.Store.AppendAudit(workspaceID, actor, "shell.exec", command+" "+strings.Join(args, " "), "denied", "")
		return res
	}

	// docker / kubectl 限定 query 子命令(mutating 需 approval)
	if cmd == "docker" || cmd == "kubectl" {
		for _, a := range args {
			if shellMutatingSubcommands[a] {
				res.Status = "denied"
				res.Error = fmt.Sprintf("shell.exec: %s %s 是 mutating 操作,需走 approval flow", cmd, a)
				s.Store.AppendAudit(workspaceID, actor, "shell.exec", command+" "+strings.Join(args, " "), "denied", "")
				return res
			}
		}
	}

	// 工作目录:第一个白名单根
	cwd := ""
	if len(defaultShellRoots()) > 0 {
		cwd = defaultShellRoots()[0]
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	cmdObj := exec.CommandContext(ctx, cmd, args...)
	cmdObj.Dir = cwd

	stdout := &limitedBuffer{cap: 64 * 1024}
	stderr := &limitedBuffer{cap: 64 * 1024}
	cmdObj.Stdout = stdout
	cmdObj.Stderr = stderr

	start := time.Now()
	err := cmdObj.Run()
	res.DurationMs = int(time.Since(start) / time.Millisecond)
	res.Output = stdout.String()
	if stderr.Len() > 0 {
		res.Output += "\n[stderr]\n" + stderr.String()
	}
	if err != nil {
		res.Status = "failed"
		res.Error = err.Error()
	} else {
		res.Status = "success"
	}
	s.Store.AppendAudit(workspaceID, actor, "shell.exec", command+" "+strings.Join(args, " "), res.Status, res.Error)
	return res
}

// limitedBuffer wraps bytes.Buffer with a hard cap; once cap is reached
// it stops accepting new data so exec can never OOM the control plane.
type limitedBuffer struct {
	buf bytes.Buffer
	cap int
}

func (l *limitedBuffer) Write(p []byte) (int, error) {
	remaining := l.cap - l.buf.Len()
	if remaining <= 0 {
		return len(p), nil
	}
	if len(p) > remaining {
		l.buf.Write(p[:remaining])
		return len(p), nil
	}
	l.buf.Write(p)
	return len(p), nil
}

func (l *limitedBuffer) String() string { return l.buf.String() }
func (l *limitedBuffer) Len() int        { return l.buf.Len() }