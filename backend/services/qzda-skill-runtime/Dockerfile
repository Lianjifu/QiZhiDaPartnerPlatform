# syntax=docker/dockerfile:1.6
# gVisor-aware image for qzda-skill-runtime.
#
# 启动时由 entrypoint 检测实际运行时（runc / runsc-kvm / runsc-ptrace），
# 设置 DE_SKILL_SANDBOX 与 DE_SKILL_RUNTIME_DETECTED，应用代码据此声明能力。
#
# 构建后增加 runsc：make image-skill-runtime 会从
# https://github.com/google/gvisor/releases 下载 runsc 二进制到 /usr/local/bin。

FROM python:3.12-slim AS base

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    DE_BIND_HOST=0.0.0.0 \
    DE_BIND_PORT=8093 \
    DE_SKILL_REQUIRE_ISOLATION=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8093

# tini 做 PID 1，正确转发信号；entrypoint 探测真实 runtime。
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8093"]