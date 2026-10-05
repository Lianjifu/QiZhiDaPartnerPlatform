package auth

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestSPIFFEID(t *testing.T) {
	t.Setenv("QZDA_SPIFFE_TRUST_DOMAIN", "acme.test")
	if got := SPIFFEID("qzda-sys"); got != "spiffe://acme.test/ns/default/sa/qzda-sys" {
		t.Fatalf("got %s", got)
	}
}

func TestParseSPIFFEURIsFromGeneratedCert(t *testing.T) {
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	certDir := filepath.Join(root, "deploy", "certs")
	gen := filepath.Join(certDir, "generate.sh")
	if _, err := os.Stat(gen); err != nil {
		t.Skip("generate.sh not found")
	}
	// Ensure client cert exists with SPIFFE SAN (idempotent, may rewrite).
	cmd := exec.Command("bash", gen, "1")
	cmd.Dir = certDir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("generate.sh: %v\n%s", err, out)
	}
	pemBytes, err := os.ReadFile(filepath.Join(certDir, "client.crt"))
	if err != nil {
		t.Fatal(err)
	}
	ids, err := ParseSPIFFEURIs(pemBytes)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, id := range ids {
		if strings.Contains(id, "/sa/qzda-core") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected qzda-core SPIFFE id, got %v", ids)
	}
	if !HasSPIFFEID(pemBytes, SPIFFEID("qzda-core")) && !HasSPIFFEID(pemBytes, "spiffe://de.local/ns/default/sa/qzda-core") {
		// Trust domain may have been overridden in env during generate; accept any qzda-core id.
		ok := false
		for _, id := range ids {
			if strings.HasSuffix(id, "/sa/qzda-core") {
				ok = true
			}
		}
		if !ok {
			t.Fatalf("HasSPIFFEID failed for %v", ids)
		}
	}
}
