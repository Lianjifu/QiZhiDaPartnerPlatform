"""docx_gen 模块的单元测试。

覆盖:
- ``is_docx_request``:只有显式 ``action=generate_docx`` 或 ``docx`` 才命中。
- ``build_docx_artifact``:拒绝 Python 脚本正文、拒绝占位符正文、接受纯文本正文。
"""
from docx_gen import (
    build_docx_artifact,
    is_docx_request,
    looks_like_code_as_docx_body,
    looks_like_placeholder_as_docx_body,
)


def test_is_docx_request_only_explicit_action():
    """只有 ``action`` 显式为 ``generate_docx``/``docx`` 才算 DOCX 请求。

    防止误把通用 ``run``/空请求分流到 DOCX 路径。
    """
    assert is_docx_request({"action": "generate_docx"}, "skill-docx")
    assert is_docx_request({"action": "docx"}, "skill-docx")
    assert not is_docx_request({"action": "run"}, "skill-docx")
    assert not is_docx_request({}, "skill-docx")


def test_rejects_python_script_as_body():
    """正文像 Python 脚本时应被拒绝。

    LLM 有时会输出 ``from docx import Document`` 这种「生成脚本」
    当成「文档正文」回传,必须 ``ok=False`` 且 ``error`` 含「无效」。
    """
    code = "from docx import Document\nd = Document()\n"
    assert looks_like_code_as_docx_body(code)
    result = build_docx_artifact(
        {"action": "generate_docx", "title": "测试", "content": code},
        "skill-docx",
    )
    assert result["ok"] is False
    assert "无效" in result["error"]


def test_rejects_placeholder_as_body():
    """正文像占位符(如 ``title=..., content=...`` 模板回填)时应被拒绝。

    错误信息须含「占位」或「摘要」提示用户重传。
    """
    placeholder = "title=招聘人事招聘模板, content=按检索结果整理的可编辑招聘模板正文"
    assert looks_like_placeholder_as_docx_body(placeholder)
    result = build_docx_artifact(
        {"action": "generate_docx", "title": "测试", "content": placeholder},
        "skill-docx",
    )
    assert result["ok"] is False
    assert "占位" in result["error"] or "摘要" in result["error"]


def test_accepts_plain_text_body(tmp_path, monkeypatch):
    """正文是规范的纯文本时应成功生成 DOCX。

    使用 ``tmp_path`` + ``monkeypatch`` 把制品目录指向临时目录,
    避免污染真实文件系统;``downloadName`` 应包含标题中文。
    """
    monkeypatch.setenv("DE_SANDBOX_ARTIFACT_DIR", str(tmp_path))
    result = build_docx_artifact(
        {
            "action": "generate_docx",
            "title": "招聘岗位模板",
            "content": "一、岗位职责\n1. 负责招聘",
        },
        "skill-docx",
    )
    assert result["ok"] is True
    assert "招聘岗位模板" in result["downloadName"]