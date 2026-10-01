# syntax=docker/dockerfile:1.6
# gVisor-aware image for qzda-sandbox.
#
# 启动时由 entrypoint 检测实际运行时(runc / runsc-kvm / runsc-ptrace),
# 设置 DE_SANDBOX_SANDBOX 与 DE_SANDBOX_RUNTIME_DETECTED,应用代码据此声明能力。
#
# 构建后增加 runsc:`make image-sandbox` 会从
# https://github.com/google/gvisor/releases 下载 runsc 二进制到 /usr/local/bin。

# 阶段 4 #1:libqzda_egress.so 用 gcc builder stage 编译,然后 COPY 到 base。
# 它把子进程所有非环回 IPv4 connect 重定向到 127.0.0.1:8080,让 curl/wget/node fetch
# 等不走 Python stdlib 的客户端也能被 egress policy 覆盖。sandbox.py 在子进程
# env 里加 LD_PRELOAD=/app/lib/libqzda_egress.so 启用。
FROM python:3.12-slim AS builder

RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY services/qzda-sandbox/libqzda_egress.c .
RUN gcc -O2 -fPIC -shared \
        -o /build/libqzda_egress.so libqzda_egress.c \
 && ls -la /build/libqzda_egress.so

FROM python:3.12-slim AS base

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    DE_BIND_HOST=0.0.0.0 \
    DE_BIND_PORT=8093 \
    DE_SANDBOX_REQUIRE_ISOLATION=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/qzda-sandbox/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/qzda-sandbox/app/ ./app/
COPY services/qzda-sandbox/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 阶段 4 #1:把编译好的 .so 落到 /app/lib/;子进程 env LD_PRELOAD=/app/lib/libqzda_egress.so 启用
COPY --from=builder /build/libqzda_egress.so /app/lib/libqzda_egress.so

# 阶段 4 #2:Docker secrets mount 目标目录(默认 /etc/qzda/skill-run-secret)
RUN mkdir -p /etc/qzda && chmod 755 /etc/qzda

# backend/scripts/ 是 ``from generate_docx import ...`` 的目标;docx_gen 用
# 向上搜索 (``_find_scripts_root``) 找到 /app/scripts/,所以这里必须落到 /app/scripts/。
COPY scripts/ /app/scripts/

EXPOSE 8093

# tini 做 PID 1，正确转发信号；entrypoint 探测真实 runtime。
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8093"]