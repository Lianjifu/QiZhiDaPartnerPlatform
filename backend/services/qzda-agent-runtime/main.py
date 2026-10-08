#!/usr/bin/env python3
"""Launcher for qzda-agent-runtime FastAPI service.

Run from the service root (services/qzda-agent-runtime/) so the
relative import `app.main:app` resolves; mirrors the Dockerfile's
`uvicorn app.main:app` command.
"""
"""qzda-agent-runtime FastAPI 服务的本地启动脚本。

镜像 Dockerfile 中的 `uvicorn app.main:app` 命令,便于开发期直接 `python main.py` 起服务;
必须在服务根目录(services/qzda-agent-runtime/)下运行,使相对导入 `app.main:app` 能解析。
"""
from __future__ import annotations
import uvicorn
import os

if __name__ == "__main__":

    # 监听地址:默认 127.0.0.1(仅本机回环);容器化部署时应改为 0.0.0.0 以接收外部流量
    host = os.environ.get("QZDA_BIND_HOST", "127.0.0.1")
    # 监听端口:默认 8091,与前端 / 上游网关的约定保持一致
    port = int(os.environ.get("QZDA_BIND_PORT", "8091") or "8091")
    # 打印启动横幅,方便 docker logs / 本地终端一眼确认绑定地址
    print(f"qzda-agent-runtime on http://{host}:{port}")
    # reload=False:关闭热重载,容器重建由 docker/k8s 负责,避免双 worker 状态漂移
    uvicorn.run("app.main:app", host=host, port=port, reload=False)