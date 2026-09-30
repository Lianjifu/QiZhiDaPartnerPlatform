"""把刚生成的 Office 制品采集到 ``DE_SKILL_ARTIFACT_DIR``。

脚本执行成功后,沙箱会在包根目录下写入 .pptx/.docx/.pdf 等制品文件。
本模块负责:
1. 递归扫描包目录(``max_age_sec`` 内的新文件)。
2. 过滤掉 ``node_modules``/``.git`` 等噪声目录。
3. 选最近改动的文件作为「最优候选」。
4. 重命名为 ``<artifact_id>-<stem>.<ext>`` 拷贝到制品目录。
5. 对 .pptx 做软校验:必须包含 ``ppt/`` 内部文件,否则丢弃。

最终返回 ``downloadPath=/api/skill-artifacts/<filename>`` 给前端拼链接。
"""
from __future__ import annotations

import os
import shutil
import time
import uuid
from pathlib import Path


def artifact_dir() -> Path:
    """返回(必要时创建)制品下载目录。

    路径来源:
    - ``DE_SKILL_ARTIFACT_DIR`` 环境变量(覆盖);
    - 默认 ``/tmp/qzda-stack/artifacts``(与 docx_gen.py 共用)。
    """
    raw = os.environ.get("DE_SKILL_ARTIFACT_DIR") or "/tmp/qzda-stack/artifacts"
    path = Path(raw)
    path.mkdir(parents=True, exist_ok=True)
    return path


def harvest_office_artifact(package_path: str, max_age_sec: float = 900) -> dict | None:
    """扫描包目录,把最近改动的 Office 制品采集到 ``artifact_dir()``。

    参数:
    - ``package_path``:技能包根目录绝对路径。
    - ``max_age_sec``:只采集 ``max_age_sec`` 秒内的新文件(默认 900s=15 分钟,
      防历史残留文件误采集)。

    流程:
    1. ``root.rglob("*")`` 递归遍历,跳过目录。
    2. 扩展名必须是 .pptx / .docx / .pdf 之一。
    3. 路径中含 ``node_modules`` / ``.git`` 直接跳过(依赖/版本库噪声)。
    4. 文件 mtime 在窗口内才纳入候选。
    5. 选 mtime 最大的文件作为 ``best``。
    6. 把 ``stem`` 去掉前导 6–12 位 hex id(常见的 ``abc1234-xxx.pptx`` 命名)。
    7. 拷贝到 ``<artifact_id>-<stem>.<ext>``。
    8. .pptx 用 zipfile 软校验是否含 ``ppt/`` 内部文件,否则丢弃并 unlink。
    9. 返回 ``downloadPath`` 等元信息;无候选返回 ``None``。
    """
    root = Path(package_path)
    if not root.is_dir():
        return None
    now = time.time()
    candidates: list[Path] = []
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        low = p.name.lower()
        if not (low.endswith(".pptx") or low.endswith(".docx") or low.endswith(".pdf")):
            continue
        parts = {x.lower() for x in p.parts}
        if "node_modules" in parts or ".git" in parts:
            continue
        try:
            age = now - p.stat().st_mtime
        except OSError:
            continue
        if age > max_age_sec:
            continue
        candidates.append(p)
    if not candidates:
        return None
    best = max(candidates, key=lambda p: p.stat().st_mtime)
    ext = best.suffix.lower()
    stem = best.stem
    # 剥离前导 hex id(常见命名如 ``abc1234-report.pptx`` → ``report.pptx``)
    if "-" in stem and len(stem.split("-", 1)[0]) in range(6, 13):
        stem = stem.split("-", 1)[1]
    artifact_id = uuid.uuid4().hex[:12]
    filename = f"{artifact_id}-{stem}{ext}"
    dest = artifact_dir() / filename
    try:
        shutil.copy2(best, dest)
    except OSError:
        return None
    if ext == ".pptx":
        # 软校验:必须是合法的 PPTX(内部包含 ``ppt/`` 目录);
        # 不严格校验所有 part,允许 pptxgen 等生成器使用不同的 master 命名。
        try:
            import zipfile

            with zipfile.ZipFile(dest) as zf:
                names = set(zf.namelist())
            need = {
                "ppt/theme/theme1.xml",
                "ppt/slideMasters/slideMaster1.xml",
                "ppt/slideLayouts/slideLayout1.xml",
            }
            if not need.issubset(names) and "ppt/slides/slide1.xml" in names:
                # 允许 pptxgen 生成的 deck 使用不同 master 命名;
                # 仅在完全没有 ``ppt/`` 目录时才拒绝。
                pass
            if not any(n.startswith("ppt/") for n in names):
                dest.unlink(missing_ok=True)
                return None
        except Exception:
            dest.unlink(missing_ok=True)
            return None
    download = f"/api/skill-artifacts/{filename}"
    return {
        "ok": True,
        "downloadPath": download,
        "filename": filename,
        "artifactPath": str(dest),
        "sourcePath": str(best),
    }