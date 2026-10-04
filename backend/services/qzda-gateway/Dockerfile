# qzda-gateway: monolith Python proxy.
#
# Dev entrypoint (matches the launcher in main.py):
#   DE_BIND_HOST=127.0.0.1 DE_BIND_PORT=8089 DE_BACKEND_PORT=8100 \
#     python3 services/qzda-gateway/main.py
#
# Production deploys that need Envoy-level TLS / SPIFFE / rate limiting
# use deploy/envoy/envoy.{monolith,mtls,spiffe}.yaml directly.
#
# Build: docker build -f services/qzda-gateway/Dockerfile -t qzda-gateway:local .
FROM python:3.12-slim
WORKDIR /app
COPY main.py /app/main.py
EXPOSE 8089
ENV DE_BIND_HOST=0.0.0.0 \
    DE_BIND_PORT=8089 \
    DE_BACKEND_PORT=8100
CMD ["python3", "/app/main.py"]
