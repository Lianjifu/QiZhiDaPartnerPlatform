package auth

import (
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"strings"
)

const defaultTrustDomain = "qzda.local"

// SPIFFETrustDomain returns QZDA_SPIFFE_TRUST_DOMAIN or de.local.
func SPIFFETrustDomain() string {
	if v := strings.TrimSpace(os.Getenv("QZDA_SPIFFE_TRUST_DOMAIN")); v != "" {
		return v
	}
	return defaultTrustDomain
}

// SPIFFEID builds spiffe://<td>/ns/default/sa/<service>.
func SPIFFEID(service string) string {
	svc := strings.TrimSpace(service)
	if svc == "" {
		svc = "qzda-core"
	}
	return fmt.Sprintf("spiffe://%s/ns/default/sa/%s", SPIFFETrustDomain(), svc)
}

// ParseSPIFFEURIs extracts spiffe:// URI SANs from a PEM certificate.
func ParseSPIFFEURIs(pemBytes []byte) ([]string, error) {
	var out []string
	rest := pemBytes
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		if block.Type != "CERTIFICATE" {
			continue
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			return nil, err
		}
		for _, u := range cert.URIs {
			if u != nil && strings.HasPrefix(u.String(), "spiffe://") {
				out = append(out, u.String())
			}
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no SPIFFE URI SAN found")
	}
	return out, nil
}

// HasSPIFFEID reports whether pem cert contains the expected SPIFFE ID.
func HasSPIFFEID(pemBytes []byte, want string) bool {
	ids, err := ParseSPIFFEURIs(pemBytes)
	if err != nil {
		return false
	}
	for _, id := range ids {
		if id == want {
			return true
		}
	}
	return false
}
