#!/usr/bin/env python3
"""Generate a simple A4 PDF from title + markdown-ish body.

Prefers ReportLab (CJK via system fonts). Falls back to a minimal PDF
writer that embeds text as UTF-16 (works in Preview/Acrobat for basic text
when a CID font is available; Latin always works).
"""
from __future__ import annotations

import argparse
import re
import zlib
from pathlib import Path


def normalize_title(raw: str) -> str:
    s = (raw or "").strip().strip("《》「」『』\"'`")
    s = re.sub(r"(?i)^skill[_-]?pdf[_-]*", "", s)
    s = re.sub(r"(?i)\.pdf$", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return (s or "生成文档")[:48]


def parse_lines(content: str) -> list[str]:
    lines: list[str] = []
    for raw in (content or "").splitlines():
        trim = raw.strip()
        if not trim:
            lines.append("")
            continue
        trim = re.sub(r"^#+\s*", "", trim)
        trim = re.sub(r"^[-*•]\s+", "• ", trim)
        lines.append(trim[:200])
    if not lines:
        lines = ["（正文待补充）"]
    return lines[:120]


def _try_reportlab(out: Path, title: str, lines: list[str]) -> bool:
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
    except ImportError:
        return False

    font = "Helvetica"
    for name, path, idx in [
        ("DEPdfCJK", "/System/Library/Fonts/PingFang.ttc", 0),
        ("DEPdfCJK", "/System/Library/Fonts/STHeiti Light.ttc", 0),
        ("DEPdfCJK", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 0),
        ("DEPdfCJK", "C:/Windows/Fonts/msyh.ttc", 0),
    ]:
        p = Path(path)
        if not p.is_file():
            continue
        try:
            kwargs = {} if idx is None else {"subfontIndex": idx}
            pdfmetrics.registerFont(TTFont(name, str(p), **kwargs))
            font = name
            break
        except Exception:
            continue

    doc = SimpleDocTemplate(
        str(out),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=title,
        author="Digital Employee",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "DETitle",
        parent=styles["Heading1"],
        fontName=font,
        fontSize=18,
        leading=24,
        spaceAfter=14,
    )
    body_style = ParagraphStyle(
        "DEBody",
        parent=styles["Normal"],
        fontName=font,
        fontSize=11,
        leading=16,
        spaceAfter=6,
    )
    story = [Paragraph(_escape_xml(title), title_style), Spacer(1, 6)]
    for line in lines:
        if not line:
            story.append(Spacer(1, 8))
            continue
        story.append(Paragraph(_escape_xml(line), body_style))
    doc.build(story)
    return True


def _escape_xml(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _pdf_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _fallback_pdf(out: Path, title: str, lines: list[str]) -> None:
    """Minimal PDF-1.4 with Helvetica; non-ASCII replaced with '?' for openability."""
    page_w, page_h = 595, 842
    y = page_h - 72
    content_cmds = [
        "BT",
        "/F1 18 Tf",
        f"72 {y} Td",
        f"({_pdf_escape(_latinize(title))}) Tj",
        "0 -28 Td",
        "/F1 11 Tf",
    ]
    y_step = 16
    for line in lines:
        if not line:
            content_cmds.append(f"0 -{y_step} Td")
            continue
        content_cmds.append(f"({_pdf_escape(_latinize(line))}) Tj")
        content_cmds.append(f"0 -{y_step} Td")
    content_cmds.append("ET")
    stream = "\n".join(content_cmds).encode("latin-1", errors="replace")
    compressed = zlib.compress(stream)

    objs: list[bytes] = []
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objs.append(
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_w} {page_h}] "
        f"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>".encode()
    )
    objs.append(f"<< /Length {len(compressed)} /Filter /FlateDecode >>\nstream\n".encode() + compressed + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("wb") as f:
        f.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = [0]
        for i, obj in enumerate(objs, start=1):
            offsets.append(f.tell())
            f.write(f"{i} 0 obj\n".encode())
            f.write(obj)
            f.write(b"\nendobj\n")
        xref = f.tell()
        f.write(f"xref\n0 {len(objs) + 1}\n".encode())
        f.write(b"0000000000 65535 f \n")
        for off in offsets[1:]:
            f.write(f"{off:010d} 00000 n \n".encode())
        f.write(b"trailer\n")
        f.write(f"<< /Size {len(objs) + 1} /Root 1 0 R >>\n".encode())
        f.write(b"startxref\n")
        f.write(f"{xref}\n".encode())
        f.write(b"%%EOF\n")


def _latinize(s: str) -> str:
    # Keep ASCII; map common CJK punctuation; drop other non-latin for Helvetica fallback.
    table = str.maketrans({"，": ",", "。": ".", "：": ":", "；": ";", "（": "(", "）": ")", "、": ",", "—": "-", "–": "-"})
    s = s.translate(table)
    return "".join(ch if ord(ch) < 128 else "?" for ch in s)


def generate_pdf(out: Path, title: str, content: str) -> Path:
    title = normalize_title(title)
    lines = parse_lines(content)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if not _try_reportlab(out, title, lines):
        _fallback_pdf(out, title, lines)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="生成文档")
    ap.add_argument("--content", default="")
    ap.add_argument("--content-file", default="")
    args = ap.parse_args()
    content = args.content
    if args.content_file:
        content = Path(args.content_file).read_text(encoding="utf-8")
    generate_pdf(Path(args.out), args.title, content)
    print(f"OK {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
