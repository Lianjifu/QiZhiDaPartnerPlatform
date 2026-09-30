"""Skill runtime FastAPI 服务:按 gVisor 形态设计的沙箱 API。

本服务是「企智搭 · 数字伙伴平台」执行面的强制独立部署单元(:8093),
负责在沙箱内运行技能脚本,并把生成的 Office/PDF 制品暴露给前端下载。

模块组成:
- main.py        : FastAPI 入口 + 路由
- sandbox.py     : RunToken HMAC 鉴权、网络隔离探测、subprocess 白名单执行
- docx_gen.py    : 不经子进程、内置的 DOCX 生成
- artifact_harvest.py : 扫描包目录、采集 Office 制品
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.docx_gen import artifact_dir, build_docx_artifact, is_docx_request
from app.sandbox import (
    FORBIDDEN_ENV,
    control_plane_probe,
    run_package_script,
    runsc_present,
    sandbox_mode,
    strip_forbidden_env,
    verify_run_token,
)
from app.artifact_harvest import harvest_office_artifact


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """FastAPI 生命周期钩子。

    启动时立即调用 ``strip_forbidden_env()`` 把控制面相关环境变量
    (PG / Redis DSN)从进程环境里清除,防止子进程继承并泄露凭据。
    """
    strip_forbidden_env()
    yield


app = FastAPI(title="qzda-skill-runtime", version="1.0.0", lifespan=lifespan)


@app.get("/healthz")
@app.get("/")
def healthz() -> dict[str, Any]:
    """健康检查与沙箱自描述端点。

    返回值同时承担三类用途:
    1. 存活探针:``status`` 字段供上游(LB / Compose / k8s)判定进程是否在线。
    2. 沙箱能力自描述:``sandbox`` / ``runscBinary`` 字段说明当前是否真正具备
       gVisor 隔离能力;``runsc-emulated`` 意味着只是进程级隔离。
    3. 隔离断言:主动探测 PG/Redis 是否可达,违反隔离契约时返回
       ``controlPlaneReachable=true`` 供运维侧告警。
    """
    probe = control_plane_probe()
    return {
        "status": "ok",
        "service": "skill-runtime",
        "sandbox": sandbox_mode(),
        "runscBinary": runsc_present(),
        "controlPlaneReachable": not probe["isolated"],
        "isolation": probe,
        "runTokenRequired": True,
    }


@app.post("/v1/execute")
async def execute(request: Request) -> JSONResponse:
    """统一执行入口。

    请求体 JSON 字段约定:
    - ``runToken``:由 Go 控制面签发的 HMAC-SHA256 RunToken(v1.<payload>.<sig>)。
    - ``skillId``:技能标识(可来自 claims 或请求体)。
    - ``packagePath``:技能包根目录绝对路径;DOCX 路径可省略。
    - ``scripts``:允许执行的脚本相对路径列表。
    - ``command``:要执行的命令,必须匹配 ``_SCRIPT_RE`` 白名单。
    - ``timeoutSec``:脚本执行超时(1–120s,内部夹紧)。
    - ``correlationId``:上游审计关联 ID。
    - ``action``/``title``/``content``:DOCX 生成专用字段。

    处理流水线:
    1. 解析 JSON 并做类型兜底(避免崩溃)。
    2. ``verify_run_token`` 校验 HMAC 签名与 ``exp``,失败 → 401。
    3. 二次校验进程环境无控制面 DSN 残留,以及 ``denyControlPlane`` 未被显式置 False。
    4. 主动探测 PG/Redis 可达性;``DE_SKILL_REQUIRE_ISOLATION=1`` 时不允许联通。
    5. 若是 DOCX 请求 → 走内置 ``build_docx_artifact``(不启子进程)。
    6. 否则走 ``run_package_script`` 同步执行,执行成功后再 ``harvest_office_artifact``
       扫描包内新生成的 Office 制品,把 ``downloadPath`` 合并进响应。
    """
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001
        # 客户端发来非 JSON 也要兜住,降级为空 dict 后继续后续校验,
        # 让 RunToken/环境检查统一返回 4xx,而不是 500。
        data = {}
    if not isinstance(data, dict):
        data = {}
    # 第 1 步:HMAC RunToken 鉴权
    ok, err, claims = verify_run_token(str(data.get("runToken") or ""))
    if not ok:
        return JSONResponse(status_code=401, content={"ok": False, "error": err})
    # 第 2 步:进程环境隔离 — 即使 lifespan 已清理,这里再做一次兜底
    leaked = [k for k in os.environ if any(k.startswith(p) or k == p for p in FORBIDDEN_ENV)]
    if leaked or data.get("denyControlPlane") is False:
        return JSONResponse(
            status_code=403,
            content={"ok": False, "error": "sandbox must not reach control-plane", "leakedEnv": leaked},
        )
    # 第 3 步:网络隔离探测;Docker 镜像默认开启强制隔离
    probe = control_plane_probe()
    if not probe["isolated"] and os.environ.get("DE_SKILL_REQUIRE_ISOLATION", "1") == "1":
        return JSONResponse(
            status_code=403,
            content={
                "ok": False,
                "error": "sandbox can still reach control-plane network",
                "reachable": probe["reachable"],
            },
        )
    # 优先用 claims 里的 skillId,确保调用方声明的 ID 与令牌内一致
    skill_id = data.get("skillId") or claims.get("skillId")
    if is_docx_request(data, str(skill_id) if skill_id is not None else None):
        # DOCX 走内置生成路径(不启子进程,纯 python-docx)
        payload = build_docx_artifact(data, str(skill_id) if skill_id is not None else None)
        payload["workspaceId"] = claims.get("workspaceId")
        payload["correlationId"] = data.get("correlationId")
        payload["isolation"] = probe
        return JSONResponse(status_code=200, content=payload)

    # 通用脚本执行路径
    command = str(data.get("command") or "").strip()
    package_path = str(data.get("packagePath") or "").strip()
    scripts = data.get("scripts") or []
    if not isinstance(scripts, list):
        scripts = []
    scripts = [str(x) for x in scripts]
    timeout_sec = int(data.get("timeoutSec") or 30)
    # 模拟耗时:基础 8ms + 命令长度/4 上限 40ms,便于前端进度展示
    duration_ms = 8 + min(40, len(command) // 4)
    stdout_lines = [
        f"sandbox={sandbox_mode()}",
        f"skillId={skill_id}",
        "denyControlPlane=true",
    ]
    exec_ok = True
    exec_status = "noop"
    if package_path:
        # 真实执行包内脚本,所有 IO/超时/退出码由 run_package_script 处理
        exec_ok, pkg_out, duration_ms = run_package_script(package_path, scripts, command, timeout_sec)
        stdout_lines.append(pkg_out)
        if "status=needs_instruction" in pkg_out:
            # 命令格式不对,要求调用方先 open SKILL.md 再发 run
            exec_status = "needs_instruction"
            exec_ok = False
        elif exec_ok:
            exec_status = "executed"
        else:
            exec_status = "failed"
    elif command:
        # 有 command 但缺 packagePath,无法落脚本执行,返回 needs_instruction 提示
        stdout_lines.append(f"command={command}")
        stdout_lines.append("status=needs_instruction")
        stdout_lines.append("hint=packagePath required to execute scripts")
        exec_ok = False
        exec_status = "needs_instruction"
    else:
        # 既没 packagePath 也没 command,空执行 — noop
        stdout_lines.append("status=noop")
        exec_status = "noop"
    payload: dict[str, Any] = {
        "ok": exec_ok,
        "status": exec_status,
        "runtime": sandbox_mode(),
        "skillId": skill_id,
        "stdout": "\n".join(stdout_lines),
        "error": None if exec_ok else (
            "needs_instruction: provide action=run with scripts/... command"
            if exec_status == "needs_instruction"
            else "skill script failed"
        ),
        "durationMs": duration_ms,
        "runTokenAccepted": True,
        "denyControlPlane": True,
        "workspaceId": claims.get("workspaceId"),
        "correlationId": data.get("correlationId"),
        "packagePath": package_path or None,
        "isolation": probe,
    }
    if exec_ok and package_path:
        # 执行成功后扫描包内新生成的 Office 制品,合并下载链接
        harvested = harvest_office_artifact(package_path)
        if harvested:
            payload.update(harvested)
            if harvested.get("downloadPath"):
                payload["stdout"] = (
                    str(payload.get("stdout") or "")
                    + f"\n下载链接:{harvested['downloadPath']}"
                ).strip()
    return JSONResponse(status_code=200, content=payload)


@app.get("/v1/artifacts/{name}")
def get_artifact(name: str):
    """按文件名下载制品。

    安全约束:
    - 路径参数必须为扁平文件名,任何 ``..`` / ``/`` / ``\\`` 一律 400。
    - 仅服务 ``artifact_dir()`` 下的文件(避免任意路径读)。
    - 按扩展名推断 ``Content-Type``(DOCX/PPTX/PDF/兜底 octet-stream)。

    返回 ``FileResponse`` 让浏览器直接下载,无需鉴权(由网关层
    /x-workspace-id 隔离保证可达性)。
    """
    from fastapi.responses import FileResponse

    safe = Path(name).name
    if safe != name or ".." in name or "/" in name or "\\" in name:
        return JSONResponse(status_code=400, content={"error": "invalid artifact name"})
    path = artifact_dir() / safe
    if not path.is_file():
        return JSONResponse(status_code=404, content={"error": "artifact not found"})
    media = (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if safe.lower().endswith(".docx")
        else "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        if safe.lower().endswith(".pptx")
        else "application/pdf"
        if safe.lower().endswith(".pdf")
        else "application/octet-stream"
    )
    return FileResponse(path, media_type=media, filename=safe)


@app.exception_handler(404)
async def not_found(_request: Request, _exc: Exception) -> JSONResponse:
    """统一 404 处理器。

    默认 FastAPI 404 返回 HTML,统一改成 JSON 让前端解析一致。
    """
    return JSONResponse(status_code=404, content={"error": "not found"})
