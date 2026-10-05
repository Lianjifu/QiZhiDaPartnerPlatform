package modelprov

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
)

// AllowPrivateEndpoints enables loopback/private IP targets (e.g. internal ollama).
func AllowPrivateEndpoints() bool {
	v := strings.TrimSpace(os.Getenv("QZDA_MODEL_ALLOW_PRIVATE"))
	return v == "1" || strings.EqualFold(v, "true")
}

// ValidateBaseURL checks scheme and blocks SSRF to private/link-local hosts unless allowed.
func ValidateBaseURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fmt.Errorf("empty baseUrl")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return fmt.Errorf("invalid baseUrl")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("baseUrl must be http or https")
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("invalid host")
	}
	if AllowPrivateEndpoints() {
		return nil
	}
	if strings.EqualFold(host, "localhost") || host == "0.0.0.0" {
		return fmt.Errorf("private host blocked")
	}
	ips, err := net.LookupIP(host)
	if err != nil {
		// DNS failure: still allow hostname (probe will fail later); block obvious IPs.
		if ip := net.ParseIP(host); ip != nil && isPrivateIP(ip) {
			return fmt.Errorf("private host blocked")
		}
		return nil
	}
	for _, ip := range ips {
		if isPrivateIP(ip) {
			return fmt.Errorf("private host blocked")
		}
	}
	return nil
}

func isPrivateIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsPrivate() || ip.IsUnspecified() {
		return true
	}
	return false
}
