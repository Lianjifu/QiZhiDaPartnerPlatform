package auth

import "testing"

func TestPasswordHashRoundTrip(t *testing.T) {
	hash, err := HashPassword("Qzda-Test-2026")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !VerifyPassword("Qzda-Test-2026", hash) {
		t.Fatal("correct password rejected")
	}
	if VerifyPassword("wrong-pass-123", hash) {
		t.Fatal("wrong password accepted")
	}
}

func TestVerifyPasswordRejectsMalformedHash(t *testing.T) {
	for _, bad := range []string{"", "plain", "pbkdf2-sha256$0$AA$AA", "md5$1$AA$AA", "pbkdf2-sha256$600000$!!$AA"} {
		if VerifyPassword("anything", bad) {
			t.Fatalf("malformed hash %q accepted", bad)
		}
	}
}
