package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/infra"
)

const usage = `usage: qzda-account <add|set-password|disable|enable> [flags]

  add           --email E --role admin|auditor|user [--name N] [--user-id ID]   (password on stdin)
  set-password  --email E                                                      (password on stdin)
  disable       --email E
  enable        --email E

Requires QZDA_DATABASE_URL. The password is read from the first line of stdin.
`

func main() {
	if len(os.Args) < 2 {
		fail(usage)
	}
	cmd := os.Args[1]
	fs := flag.NewFlagSet(cmd, flag.ExitOnError)
	email := fs.String("email", "", "login email")
	role := fs.String("role", "user", "admin | auditor | user")
	name := fs.String("name", "", "display name (defaults to email)")
	userID := fs.String("user-id", "", "stable user id (defaults to email)")
	allowWeak := fs.Bool("allow-weak-password", false, "skip the 8-character minimum (testing only)")
	_ = fs.Parse(os.Args[2:])

	addr := strings.ToLower(strings.TrimSpace(*email))
	if addr == "" {
		fail("--email is required\n" + usage)
	}

	ctx := context.Background()
	pool, err := infra.OpenPostgres(ctx)
	if err != nil {
		fail("open postgres: " + err.Error())
	}
	if pool == nil {
		fail("QZDA_DATABASE_URL is not set")
	}
	defer pool.Close()

	switch cmd {
	case "add":
		if *role != "admin" && *role != "auditor" && *role != "user" {
			fail("--role must be admin, auditor or user")
		}
		hash := hashFromStdin(*allowWeak)
		display := strings.TrimSpace(*name)
		if display == "" {
			display = addr
		}
		uid := strings.TrimSpace(*userID)
		if uid == "" {
			uid = addr
		}
		if err := infra.UpsertAuthAccount(ctx, pool, infra.AuthAccount{
			Email: addr, UserID: uid, Name: display, Role: *role, PasswordHash: hash,
		}); err != nil {
			fail("add: " + err.Error())
		}
		fmt.Printf("account %s saved (role=%s)\n", addr, *role)
	case "set-password":
		hash := hashFromStdin(*allowWeak)
		ok, err := infra.SetAuthAccountPassword(ctx, pool, addr, hash)
		exitIfMissing(ok, err, addr)
		fmt.Printf("password updated for %s\n", addr)
	case "disable", "enable":
		ok, err := infra.SetAuthAccountDisabled(ctx, pool, addr, cmd == "disable")
		exitIfMissing(ok, err, addr)
		fmt.Printf("account %s %sd\n", addr, cmd)
	default:
		fail(usage)
	}
}

func hashFromStdin(allowWeak bool) string {
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && line == "" {
		fail("password required on stdin")
	}
	pw := strings.TrimRight(line, "\r\n")
	if !allowWeak && len(pw) < 8 {
		fail("password must be at least 8 characters")
	}
	hash, err := auth.HashPassword(pw)
	if err != nil {
		fail("hash password: " + err.Error())
	}
	return hash
}

func exitIfMissing(ok bool, err error, addr string) {
	if err != nil {
		fail(err.Error())
	}
	if !ok {
		fail("no account for " + addr)
	}
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}
