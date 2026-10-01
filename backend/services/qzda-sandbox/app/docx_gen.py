"""Word (.docx) 制品生成模块。

特点:**不经子进程**,直接用 ``python-docx`` 在进程内生成。
这是为了保证 DOCX 生成:
1. 不消耗沙箱的解释器配额(``subprocess`` 资源紧张)。
2. 不受 ``run_package_script`` 的白名单路径约束(``scripts/`` 之外)。
3. 仍走 RunToken 鉴权 + 控制面隔离,只是执行路径在 FastAPI 进程内完成。
"""
from __future__ import annotations

import os
import re
import sys
import uuid
from pathlib import Path

# 允许直接 ``from generate_docx import ...`` 导入 backend/scripts/generate_docx.py。
# 沿父目录向上搜索 ``scripts/generate_docx.py``,兼容:
# - 本地:backend/services/qzda-sandbox/app/docx_gen.py → parents[3] = backend
# - 镜像:/app/app/docx_gen.py（Dockerfile 把 app/ 拷到 /app/app/ 下）
def _find_scripts_root(start: Path) -> Path | None:
    for parent in start.resolve().parents:
        candidate = parent / "scripts" / "generate_docx.py"
        if candidate.is_file():
            return parent / "scripts"
    return None


_SCRIPTS = _find_scripts_root(Path(__file__))
if _SCRIPTS and str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from generate_docx import generate_docx, normalize_title  # noqa: E402

# 各类净化正则:
# - ``skill_docx_xxx`` / ``skill-docx-xxx`` 前缀剥离(常见 skillId 命名)
# - ``_docx`` / ``.docx`` 末尾后缀剥离(避免文件名出现两次扩展名)
# - ``_NON_NAME``:文件名非法字符白名单(允许字母/数字/中文/中点/连字符)
_SKILL_DOCX_PREFIX = re.compile(r"(?i)^skill[_-]?docx[_-]*")
_DOCX_SUFFIX = re.compile(r"(?i)(_docx|\.docx)$")
_NON_NAME = re.compile(r"[^\w一-鿿·-]+", re.UNICODE)


def artifact_dir() -> Path:
    """返回(必要时创建)制品下载目录。

    路径来源:
    - ``DE_SANDBOX_ARTIFACT_DIR`` 环境变量(覆盖);
    - 默认 ``/tmp/qzda-stack/artifacts``(与 artifact_harvest.py 共用)。
    """
    raw = os.environ.get("DE_SANDBOX_ARTIFACT_DIR") or "/tmp/qzda-stack/artifacts"
    path = Path(raw)
    path.mkdir(parents=True, exist_ok=True)
    return path


def looks_like_code_as_docx_body(content: str) -> bool:
    """正文防呆:检测 content 是否像「Python 生成 DOCX 的脚本」。

    LLM 在某些场景下会把「我要生成的代码」直接当成正文回传,会导致
    DOCX 里出现 Python 代码而不是人话正文。本函数强信号(包含关键字)
    + 弱信号(连续两行 ``import``/``def``/``class``)双重判定,命中即拒绝。
    """
    s = (content or "").strip()
    if not s:
        return False
    lower = s.lower()
    strong = (
        "from docx import",
        "import docx",
        "document()",
        "qn('w:eastasia')",
        "wd_align_paragraph",
        "python-docx",
        "```python",
        "add_heading(",
        "add_paragraph(",
    )
    if any(sig in lower for sig in strong):
        return True
    code_lines = 0
    for line in s.split("\n"):
        trim = line.strip()
        if not trim:
            continue
        if trim.startswith(("import ", "from ", "def ", "class ")):
            code_lines += 1
    return code_lines >= 2


def looks_like_placeholder_as_docx_body(content: str) -> bool:
    """正文防呆:检测 content 是否像「未填充的占位符」。

    典型情形:
    - ``title=招聘模板, content=按检索结果整理的可编辑招聘模板正文``
      (LLM 把字段名当模板写进去了)。
    - 太短(``<80`` 字)且不含章节标题(``一、``/``岗位职责``/``##``)。
    - 短正文(``<160`` 字)含「可编辑」「摘要」「按检索」「整理的正文」等关键字。

    命中后由调用方返回「占位/摘要」类错误,提示用户传入完整正文。
    """
    s = (content or "").strip()
    if not s:
        return False
    if re.match(r"(?i)^\s*title\s*=\s*.+\s*,\s*content\s*=", s):
        return True
    lower = s.lower()
    if len(s) < 160:
        for hint in ("可编辑", "摘要", "按检索", "整理的正文", "整理的可编辑", "模板正文"):
            if hint in lower:
                return True
    if len(s) < 80 and not any(m in s for m in ("一、", "岗位职责", "任职要求", "##")):
        return True
    return False


def is_docx_request(data: dict, skill_id: str | None) -> bool:
    """判断请求是否走「DOCX 内置生成」路径。

    仅当 ``action`` 显式为 ``generate_docx`` 或 ``docx`` 时返回 True。
    其他 ``action``(包括 ``run``、空)都走通用脚本执行路径。
    """
    action = str(data.get("action") or "").strip().lower()
    return action in {"generate_docx", "docx"}


def safe_download_basename(title: str) -> str:
    """生成面向用户的下载文件名(中文友好)。

    步骤:
    1. ``normalize_title`` 去零宽/前后空白;
    2. 剥离 ``skill_docx_`` / ``.docx`` 等冗余前后缀;
    3. ``_NON_NAME`` 删除非法字符(保留中英文/数字/中点/连字符);
    4. 截断到 32 字符,空则兜底为「生成文档」。
    """
    base = normalize_title(title)
    base = _SKILL_DOCX_PREFIX.sub("", base)
    base = _DOCX_SUFFIX.sub("", base)
    base = _NON_NAME.sub("", base.replace(" ", ""))
    base = base.strip(".-_") or "生成文档"
    base = base[:32]
    return f"{base}.docx"


def build_docx_artifact(data: dict, skill_id: str | None) -> dict:
    """生成 DOCX 制品并返回下载响应。

    输入字段(任意一个命中即可):
    - ``title``/``filename``:文档标题;
    - ``content``/``input``/``command``/``body``:正文(多字段兼容);
    - ``action``:必须为 ``generate_docx`` 或 ``docx``(由 ``is_docx_request`` 兜底)。

    失败模式:
    - 正文像代码 → ``ok=False, error="...不能是 Python 生成脚本..."``。
    - 正文像占位符 → ``ok=False, error="...不能是摘要或 title=content= 占位符..."``。

    成功模式:写文件到 ``artifact_dir()/<filename>``,返回 ``downloadPath``、
    ``filename``、``downloadName``、``artifactId``、``artifactPath`` 等字段,
    并附中文化的 ``stdout`` 提示前端展示。
    """
    raw_title = str(data.get("title") or data.get("filename") or "生成文档").strip() or "生成文档"
    title = normalize_title(raw_title)
    content = str(
        data.get("content")
        or data.get("input")
        or data.get("command")
        or data.get("body")
        or ""
    )
    if looks_like_code_as_docx_body(content):
        return {
            "ok": False,
            "runtime": "docx-local",
            "skillId": skill_id,
            "error": "docx 正文无效:不能是 Python 生成脚本,请传入人话正文",
            "stdout": "",
            "durationMs": 0,
        }
    if looks_like_placeholder_as_docx_body(content):
        return {
            "ok": False,
            "runtime": "docx-local",
            "skillId": skill_id,
            "error": "docx 正文无效:不能是摘要或 title=content= 占位符,请传入完整模板正文",
            "stdout": "",
            "durationMs": 0,
        }
    artifact_id = uuid.uuid4().hex[:12]
    download_name = safe_download_basename(title)
    filename = f"{artifact_id}-{download_name}"
    path = artifact_dir() / filename
    generate_docx(path, title, content)
    download = f"/api/skill-artifacts/{filename}"
    return {
        "ok": True,
        "runtime": "docx-local",
        "skillId": skill_id,
        "filename": filename,
        "downloadName": download_name,
        "title": title,
        "artifactId": artifact_id,
        "artifactPath": str(path),
        "downloadPath": download,
        "stdout": (
            f"已生成 Word 文档「{title}」\n"
            f"文件名:{download_name}\n"
            f"下载链接:{download}\n"
            "请把下载链接发给用户,不要改写文件名或链接。"
        ),
        "error": None,
        "durationMs": 40,
        "runTokenAccepted": True,
        "denyControlPlane": True,
    }