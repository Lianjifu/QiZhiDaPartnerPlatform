# qzda-gateway: monolith Python 反向代理,8089 → qzda-app:8100。
#
# 单进程 Docker 部署中网关层(Python BaseHTTPRequestHandler / stdlib,无 Envoy
# 无 mTLS 中间件),仅用于流式响应转发 + 头过滤。
#
# Build: docker build -f services/qzda-gateway/Dockerfile -t qzda-gateway:local .
FROM python:3.12-slim
WORKDIR /app
COPY main.py /app/main.py
EXPOSE 8089
ENV QZDA_BIND_HOST=0.0.0.0 \
    QZDA_BIND_PORT=8089 \
    QZDA_BACKEND_PORT=8100
CMD ["python3", "/app/main.py"]
