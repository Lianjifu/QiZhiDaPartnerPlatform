#!/usr/bin/env bash
# Generate a local CA + server/client certs with SPIFFE URI SANs (dev only).
# Usage: ./generate.sh [ttl_days]
#   ttl_days default 825; for short-lived rotation use: ./generate.sh 1
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

TTL_DAYS="${1:-825}"
TRUST_DOMAIN="${DE_SPIFFE_TRUST_DOMAIN:-qzda.local}"

# Keep CA if rotating leaf certs only
if [[ ! -f ca.crt || ! -f ca.key ]]; then
  openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 3650 \
    -subj "/CN=qzda-local-ca"
fi

# Gateway / Envoy server identity
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr \
  -subj "/CN=qzda-gateway"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days "$TTL_DAYS" -extfile <(printf '%s\n' \
    "subjectAltName=DNS:localhost,DNS:qzda-envoy,DNS:qzda-gateway,IP:127.0.0.1,URI:spiffe://${TRUST_DOMAIN}/ns/default/sa/qzda-gateway")

# Workload client (qzda-core and future microservices share CA; distinct SPIFFE IDs)
issue_workload() {
  local name="$1" spiffe_path="$2"
  openssl req -newkey rsa:2048 -nodes -keyout "${name}.key" -out "${name}.csr" \
    -subj "/CN=${name}"
  openssl x509 -req -in "${name}.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out "${name}.crt" -days "$TTL_DAYS" -extfile <(printf '%s\n' \
      "subjectAltName=DNS:${name},DNS:localhost,URI:spiffe://${TRUST_DOMAIN}/ns/default/sa/${spiffe_path}")
  rm -f "${name}.csr"
}

issue_workload client qzda-core
# Aliases expected by older docs / curl examples
cp -f client.crt qzda-core.crt
cp -f client.key qzda-core.key

for svc in qzda-platform qzda-policy qzda-audit qzda-collab qzda-employee qzda-sandbox; do
  issue_workload "$svc" "$svc"
done

rm -f server.csr ca.srl
chmod 600 *.key 2>/dev/null || true
echo "wrote CA + SPIFFE leaf certs under $DIR (ttl=${TTL_DAYS}d trust_domain=${TRUST_DOMAIN})"
echo "  gateway: spiffe://${TRUST_DOMAIN}/ns/default/sa/qzda-gateway"
echo "  client:  spiffe://${TRUST_DOMAIN}/ns/default/sa/qzda-core"
