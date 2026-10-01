#!/usr/bin/env python3
"""Generate a PowerPoint-openable .pptx from title + outline (stdlib only).

Produces a complete minimal OOXML package:
theme + slideMaster + slideLayout + per-slide relationships.
Slide shapes use absolute geometry (no orphan placeholders).
"""
from __future__ import annotations

import argparse
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

MD_H2 = re.compile(r"^##\s+")
MD_H1 = re.compile(r"^#\s+")
BULLET_RE = re.compile(r"^[-*•]\s+")
NUMBERED_RE = re.compile(r"^(\d+)[\.、．]\s+")

# EMUs: 16:9 widescreen
SLIDE_CX = 12192000
SLIDE_CY = 6858000


def normalize_title(raw: str) -> str:
    s = (raw or "").strip().strip("《》「」『』\"'`")
    s = re.sub(r"(?i)^skill[_-]?pptx[_-]*", "", s)
    s = re.sub(r"(?i)(\.pptx|_pptx)$", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    if not s or s.lower() in {"pptx", "ppt", "生成ppt", "生成演示"}:
        return "演示文稿"
    return s[:48]


def parse_slides(title: str, content: str) -> list[dict]:
    """Return [{title, bullets: [str], body: [str]}]."""
    text = (content or "").strip()
    if not text:
        return [
            {
                "title": title,
                "bullets": [],
                "body": ["汇报材料（模板）", "请补充：汇报人 / 周期 / 日期"],
            },
            {"title": "目录", "bullets": ["考评维度与权重", "评分标准", "团队表现", "改进建议"], "body": []},
            {"title": "考评维度与权重", "bullets": ["业绩达成 40%", "工作质量 20%", "协作贡献 20%", "成长学习 20%"], "body": []},
            {"title": "下一步", "bullets": ["按模板填写本季度数据", "组织复核与确认"], "body": []},
        ]

    blocks: list[dict] = []
    cur: dict | None = None

    def ensure(slide_title: str) -> dict:
        nonlocal cur
        cur = {"title": slide_title, "bullets": [], "body": []}
        blocks.append(cur)
        return cur

    for raw in text.splitlines():
        line = raw.rstrip()
        trim = line.strip()
        if not trim or trim == "---":
            if trim == "---":
                cur = None
            continue
        if MD_H1.match(trim):
            ensure(MD_H1.sub("", trim).strip() or title)
            continue
        if MD_H2.match(trim):
            ensure(MD_H2.sub("", trim).strip() or "内容")
            continue
        if cur is None:
            ensure(title)
        assert cur is not None
        if BULLET_RE.match(trim):
            cur["bullets"].append(BULLET_RE.sub("", trim).strip())
        elif NUMBERED_RE.match(trim):
            cur["bullets"].append(NUMBERED_RE.sub("", trim).strip())
        else:
            cur["body"].append(trim)

    if not blocks:
        ensure(title)
    # Quality gate: cover / empty slides always get readable subtitle lines.
    for i, slide in enumerate(blocks):
        if slide.get("bullets") or slide.get("body"):
            continue
        if i == 0:
            slide["body"] = ["汇报材料（模板）", "请补充：汇报人 / 周期 / 日期"]
        else:
            slide["body"] = ["（本页要点待补充）"]
    return blocks[:20]


def _shape(sp_id: int, name: str, x: int, y: int, cx: int, cy: int, paras: str) -> str:
    return f"""
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="{sp_id}" name="{escape(name)}"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="{x}" y="{y}"/>
            <a:ext cx="{cx}" cy="{cy}"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" rtlCol="0" anchor="t"/>
          <a:lstStyle/>
          {paras}
        </p:txBody>
      </p:sp>"""


def _para(text: str, *, size: int = 1800, bold: bool = False, bullet: bool = False) -> str:
    t = escape(text if text else " ")
    b_attr = ' b="1"' if bold else ""
    if bullet:
        return (
            f'<a:p>'
            f'<a:pPr marL="342900" indent="-342900">'
            f'<a:buFont typeface="Arial"/><a:buChar char="•"/>'
            f"</a:pPr>"
            f'<a:r><a:rPr lang="zh-CN" altLang="en-US" sz="{size}"{b_attr}/><a:t>{t}</a:t></a:r>'
            f"</a:p>"
        )
    return (
        f'<a:p><a:r><a:rPr lang="zh-CN" altLang="en-US" sz="{size}"{b_attr}/>'
        f"<a:t>{t}</a:t></a:r></a:p>"
    )


def _slide_xml(idx: int, slide: dict) -> str:
    title = slide.get("title") or f"幻灯片 {idx}"
    title_paras = _para(title, size=3200, bold=True)
    body_paras: list[str] = []
    for line in (slide.get("body") or [])[:12]:
        body_paras.append(_para(line, size=1800))
    for b in (slide.get("bullets") or [])[:14]:
        body_paras.append(_para(b, size=1800, bullet=True))
    if not body_paras:
        body_paras = [_para(" ", size=1800)]

    title_shape = _shape(2, "Title", 457200, 274320, 11277600, 1143000, title_paras)
    body_shape = _shape(3, "Content", 457200, 1600200, 11277600, 4572000, "".join(body_paras))

    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
        <a:effectLst/>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      {title_shape}
      {body_shape}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>
"""


THEME_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F2937"/></a:dk2>
      <a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>
      <a:accent1><a:srgbClr val="4F46E5"/></a:accent1>
      <a:accent2><a:srgbClr val="0EA5E9"/></a:accent2>
      <a:accent3><a:srgbClr val="10B981"/></a:accent3>
      <a:accent4><a:srgbClr val="F59E0B"/></a:accent4>
      <a:accent5><a:srgbClr val="EF4444"/></a:accent5>
      <a:accent6><a:srgbClr val="8B5CF6"/></a:accent6>
      <a:hlink><a:srgbClr val="2563EB"/></a:hlink>
      <a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont>
        <a:latin typeface="Calibri Light"/>
        <a:ea typeface="微软雅黑"/>
        <a:cs typeface=""/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="Calibri"/>
        <a:ea typeface="微软雅黑"/>
        <a:cs typeface=""/>
      </a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>
"""

SLIDE_LAYOUT_XML = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
 type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>
"""

SLIDE_MASTER_XML = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgRef idx="1001">
        <a:schemeClr val="bg1"/>
      </p:bgRef>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"
            accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6"
            hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
</p:sldMaster>
"""

SLIDE_MASTER_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>
"""

SLIDE_LAYOUT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>
"""

RELS_ROOT = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"""


def _core_xml(title: str) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>{escape(title)}</dc:title>
  <dc:creator>Digital Employee</dc:creator>
  <cp:lastModifiedBy>Digital Employee</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>
"""


def _app_xml(slide_count: int) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Digital Employee</Application>
  <PresentationFormat>Widescreen</PresentationFormat>
  <Slides>{slide_count}</Slides>
  <Notes>0</Notes>
  <HiddenSlides>0</HiddenSlides>
  <ScaleCrop>false</ScaleCrop>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>1.0</AppVersion>
</Properties>
"""


def generate_pptx(out: Path, title: str, content: str) -> Path:
    title = normalize_title(title)
    slides = parse_slides(title, content)
    out.parent.mkdir(parents=True, exist_ok=True)

    n = len(slides)
    overrides = [
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    ]
    sld_ids: list[str] = []
    pres_rels: list[str] = [
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>',
    ]
    files: dict[str, str] = {
        "ppt/theme/theme1.xml": THEME_XML,
        "ppt/slideMasters/slideMaster1.xml": SLIDE_MASTER_XML,
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": SLIDE_MASTER_RELS,
        "ppt/slideLayouts/slideLayout1.xml": SLIDE_LAYOUT_XML,
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": SLIDE_LAYOUT_RELS,
        "docProps/core.xml": _core_xml(title),
        "docProps/app.xml": _app_xml(n),
        "_rels/.rels": RELS_ROOT,
    }

    for i, slide in enumerate(slides, start=1):
        part = f"/ppt/slides/slide{i}.xml"
        overrides.append(
            f'<Override PartName="{part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        )
        rid = f"rId{i + 1}"  # rId1 reserved for slideMaster
        sld_ids.append(f'<p:sldId id="{255 + i}" r:id="{rid}"/>')
        pres_rels.append(
            f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i}.xml"/>'
        )
        files[f"ppt/slides/slide{i}.xml"] = _slide_xml(i, slide)
        files[f"ppt/slides/_rels/slide{i}.xml.rels"] = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>
"""

    content_types = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  {chr(10).join("  " + o for o in overrides)}
</Types>
"""
    files["[Content_Types].xml"] = content_types
    files["ppt/presentation.xml"] = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
 saveSubsetFonts="1">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    {chr(10).join("    " + s for s in sld_ids)}
  </p:sldIdLst>
  <p:sldSz cx="{SLIDE_CX}" cy="{SLIDE_CY}"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>
"""
    files["ppt/_rels/presentation.xml.rels"] = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  {chr(10).join("  " + r for r in pres_rels)}
</Relationships>
"""

    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name in sorted(files.keys(), key=lambda n: (n != "[Content_Types].xml", n)):
            zf.writestr(name, files[name].encode("utf-8"))

    # Gate: refuse incomplete packages (PowerPoint would reject them).
    required = (
        "ppt/theme/theme1.xml",
        "ppt/slideMasters/slideMaster1.xml",
        "ppt/slideLayouts/slideLayout1.xml",
        "ppt/slides/_rels/slide1.xml.rels",
        "docProps/core.xml",
    )
    with zipfile.ZipFile(out, "r") as zf:
        names = set(zf.namelist())
        missing = [p for p in required if p not in names]
        if missing:
            out.unlink(missing_ok=True)
            raise RuntimeError(f"pptx OOXML incomplete: missing {missing}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="演示文稿")
    ap.add_argument("--content-file", default="")
    ap.add_argument("--content", default="")
    args = ap.parse_args()
    content = args.content
    if args.content_file:
        content = Path(args.content_file).read_text(encoding="utf-8")
    generate_pptx(Path(args.out), args.title, content)
    print(f"OK {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
