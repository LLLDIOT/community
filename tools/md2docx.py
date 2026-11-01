"""把 Markdown 技术文档转换为排版规范的 DOCX。

用法：
    python tools/md2docx.py docs/ML_TECHNICAL.md docs/ML_TECHNICAL.docx

设计要点：
  1. 只针对本项目技术文档的 Markdown 子集（标题、段落、表格、代码块、列表、
     分隔线、行内粗体/代码/公式/链接），不做通用 Markdown 解析。
  2. LaTeX 公式以 Unicode 数学符号还原为纯文本（python-docx 不渲染公式）。
     独立公式与行内公式各有显式映射；未覆盖的走通用化简。
  3. **构建完成后统一规范化 OOXML 子元素顺序**。python-docx 的追加式 API 会把
     w:pBdr / w:shd / w:tblBorders 放到 pPr / tblPr 末尾，违反 CT_PPr / CT_TblPr
     的 schema 顺序，部分渲染器（LibreOffice）会因此错误解释段落属性。
  4. 表格使用固定布局：显式写 tblW(dxa) + tblLayout(fixed) + gridCol 宽度，
     避免长路径字符串把表格撑出页面。
"""

import io
import re
import sys

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Emu, Pt, RGBColor

# ────────────────────────────── 字体与配色 ──────────────────────────────
CJK_BODY = "宋体"
CJK_HEAD = "黑体"
LATIN_BODY = "Times New Roman"
LATIN_MONO = "Consolas"

COLOR_HEAD1 = RGBColor(0x1F, 0x38, 0x64)
COLOR_HEAD2 = RGBColor(0x2E, 0x54, 0x96)
COLOR_HEAD3 = RGBColor(0x33, 0x33, 0x33)
COLOR_CODE = RGBColor(0x1A, 0x1A, 0x1A)
COLOR_MUTED = RGBColor(0x59, 0x59, 0x59)
COLOR_MATH = RGBColor(0x1F, 0x38, 0x64)

SHADE_CODE = "F4F5F7"
SHADE_TH = "E8EDF4"
SHADE_ROW_ALT = "FAFBFC"
SHADE_INLINE = "F0F1F3"

BODY_SIZE = Pt(10.5)
CODE_SIZE = Pt(9)
TABLE_SIZE = Pt(9)
TABLE_SIZE_WIDE = Pt(8.5)

TEXT_WIDTH_CM = 16.4  # 21.0 - 2.3 - 2.3

# ────────────────────────────── 公式映射 ──────────────────────────────
MATH_DISPLAY = {
    r"\cos(\mathbf{a},\mathbf{b}) = \frac{\mathbf{a}\cdot\mathbf{b}}"
    r"{\|\mathbf{a}\|\,\|\mathbf{b}\|} = \frac{\mathbf{a}\cdot\mathbf{b}}"
    r"{1 \times 1} = \mathbf{a}\cdot\mathbf{b}": [
        "cos(a, b) = (a · b) / (‖a‖ · ‖b‖) = (a · b) / (1 × 1) = a · b"
    ],
    r"\cos(\mathbf{a},\mathbf{b}) = \frac{\sum_{i=1}^{n} a_i b_i}"
    r"{\sqrt{\sum_{i=1}^{n} a_i^2}\sqrt{\sum_{i=1}^{n} b_i^2}}": [
        "cos(a, b) = Σ(i=1..n) aᵢbᵢ / [ √(Σ(i=1..n) aᵢ²) · √(Σ(i=1..n) bᵢ²) ]"
    ],
    r"\text{score} = \mathrm{clamp}\left(\frac{\cos - 0.46}{0.75 - 0.46},"
    r"\; 0,\; 1\right) \times 100": [
        "score = clamp( (cos − 0.46) / (0.75 − 0.46), 0, 1 ) × 100"
    ],
    r"\text{score} = 0.6 \times \text{semantic} + 0.4 \times 100 \times "
    r"\dfrac{|\text{hit}|}{|\text{required}|}, & |\text{required}| > 0 \\[6pt] "
    r"\text{semantic}, & |\text{required}| = 0": [
        "score = 0.6 × semantic + 0.4 × 100 × |hit| / |required|    （当 |required| > 0）",
        "score = semantic                                          （当 |required| = 0）",
    ],
    r"\text{精确率} = \frac{TP}{TP + FP}, \qquad \text{召回率} = \frac{TP}{TP + FN}": [
        "精确率 = TP / (TP + FP)              召回率 = TP / (TP + FN)"
    ],
    r"\|\mathbf{a}-\mathbf{b}\|^2 = \|\mathbf{a}\|^2 + \|\mathbf{b}\|^2 "
    r"- 2\,\mathbf{a}\cdot\mathbf{b} = 2 - 2\cos(\mathbf{a},\mathbf{b})": [
        "‖a − b‖² = ‖a‖² + ‖b‖² − 2a · b = 2 − 2cos(a, b)"
    ],
    r"a(i) = \text{样本 } i \text{ 到同簇其他样本的平均距离}": [
        "a(i) = 样本 i 到同簇其他样本的平均距离"
    ],
    r"b(i) = \text{样本 } i \text{ 到最近其他簇中全部样本的平均距离}": [
        "b(i) = 样本 i 到最近其他簇中全部样本的平均距离"
    ],
    r"s(i) = \frac{b(i) - a(i)}{\max\{a(i), b(i)\}}": [
        "s(i) = ( b(i) − a(i) ) / max{ a(i), b(i) }"
    ],
}

MATH_INLINE = {
    r"(\mathbf{a}\cdot\mathbf{b})/(\|\mathbf{a}\|\|\mathbf{b}\|)": "(a · b) / (‖a‖ · ‖b‖)",
    r"P(\text{录用} \mid \text{特征})": "P(录用 | 特征)",
    r"a(i)": "a(i)",
    r"b(i)": "b(i)",
    r"s(i)": "s(i)",
}


def normalize_key(s):
    return re.sub(r"\s+", " ", s).strip()


def latex_to_plain(src):
    s = src
    s = s.replace(r"\|", "‖")
    s = re.sub(r"\\left|\\right", "", s)
    s = re.sub(r"\\[,;:!]", " ", s)
    s = re.sub(r"\\qquad|\\quad", "   ", s)
    s = re.sub(r"\\dfrac|\\frac", "FRAC", s)
    for _ in range(6):
        new = re.sub(r"FRAC\{([^{}]*)\}\{([^{}]*)\}", r"(\1)/(\2)", s)
        if new == s:
            break
        s = new
    s = s.replace("FRAC", "frac")
    s = re.sub(r"\\sqrt\{([^{}]*)\}", r"√(\1)", s)
    s = re.sub(r"\\sum_\{([^{}]*)\}\^\{([^{}]*)\}", r"Σ(\1..\2)", s)
    s = re.sub(r"\\mathbf\{([^{}]*)\}", r"\1", s)
    s = re.sub(r"\\mathrm\{([^{}]*)\}", r"\1", s)
    s = re.sub(r"\\text\{([^{}]*)\}", r"\1", s)
    s = s.replace(r"\cdot", "·").replace(r"\times", "×").replace(r"\mid", "|")
    s = s.replace(r"\max", "max").replace(r"\cos", "cos")
    s = re.sub(r"\^\{?2\}?", "²", s)
    s = re.sub(r"_\{?i\}?", "ᵢ", s)
    s = s.replace("{", "").replace("}", "")
    return re.sub(r"\s+", " ", s).strip()


def display_lines(latex):
    key = normalize_key(latex)
    if key in MATH_DISPLAY:
        return MATH_DISPLAY[key]
    return [latex_to_plain(key)]


def inline_render(text):
    def repl(m):
        k = normalize_key(m.group(1))
        return MATH_INLINE.get(k, latex_to_plain(k))

    return re.sub(r"(?<!\$)\$([^$\n]+?)\$(?!\$)", repl, text)


# ──────────────────── OOXML 子元素顺序规范化 ────────────────────
PPR_ORDER = [
    "pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl",
    "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens",
    "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE",
    "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind",
    "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection",
    "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr",
    "sectPr", "pPrChange",
]
RPR_ORDER = [
    "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike",
    "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid",
    "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz",
    "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign",
    "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath",
]
TCPR_ORDER = [
    "cnfStyle", "tcW", "gridSpan", "hMerge", "vMerge", "tcBorders", "shd",
    "noWrap", "tcMar", "textDirection", "tcFitText", "vAlign", "hideMark",
    "headers", "cellIns", "cellDel", "cellMerge", "tcPrChange",
]
TBLPR_ORDER = [
    "tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize",
    "tblStyleColBandSize", "tblW", "jc", "tblCellSpacing", "tblInd", "tblBorders",
    "shd", "tblLayout", "tblCellMar", "tblLook", "tblCaption", "tblDescription",
    "tblPrChange",
]
TRPR_ORDER = [
    "cnfStyle", "divId", "gridBefore", "gridAfter", "wBefore", "wAfter",
    "cantSplit", "trHeight", "tblHeader", "tblCellSpacing", "jc", "hidden",
    "ins", "del", "trPrChange",
]
ORDER_MAP = {
    "pPr": PPR_ORDER,
    "rPr": RPR_ORDER,
    "tcPr": TCPR_ORDER,
    "tblPr": TBLPR_ORDER,
    "trPr": TRPR_ORDER,
}


def _local(tag):
    return tag.split("}")[-1] if "}" in tag else tag


def normalize_order(root):
    """按 schema 顺序重排 pPr/rPr/tcPr/tblPr/trPr 的子元素。"""
    for tagname, order in ORDER_MAP.items():
        idx = {name: i for i, name in enumerate(order)}
        for el in root.iter():
            if _local(el.tag) != tagname:
                continue
            children = list(el)
            if len(children) < 2:
                continue
            decorated = []
            for pos, child in enumerate(children):
                name = _local(child.tag)
                decorated.append((idx.get(name, len(order) + pos), pos, child))
            decorated.sort()
            for child in children:
                el.remove(child)
            for _, _, child in decorated:
                el.append(child)


def normalize_document(doc):
    normalize_order(doc.element.body)
    for section in doc.sections:
        for part in (section.header, section.footer):
            try:
                normalize_order(part._element)
            except Exception:
                pass


# ────────────────────────────── 排版工具 ──────────────────────────────
def set_run_font(run, cjk=CJK_BODY, latin=LATIN_BODY, size=None, bold=None,
                 color=None, mono=False):
    if mono:
        latin = LATIN_MONO
    run.font.name = latin
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    rfonts.set(qn("w:ascii"), latin)
    rfonts.set(qn("w:hAnsi"), latin)
    rfonts.set(qn("w:eastAsia"), cjk)
    rfonts.set(qn("w:cs"), latin)
    if size is not None:
        run.font.size = size
    if bold is not None:
        run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color


def make_shd(hex_fill):
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    return shd


def shade_paragraph(paragraph, hex_fill):
    paragraph._element.get_or_add_pPr().append(make_shd(hex_fill))


def shade_cell(cell, hex_fill):
    cell._element.get_or_add_tcPr().append(make_shd(hex_fill))


def bottom_border(paragraph, color="D0D4DA", size="6"):
    ppr = paragraph._element.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), size)
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), color)
    borders.append(bottom)
    ppr.append(borders)


def add_page_number_footer(section):
    p = section.footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run()
    set_run_font(run, size=Pt(9), color=COLOR_MUTED)
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._element.append(begin)
    run._element.append(instr)
    run._element.append(end)


def add_header_text(section, text):
    p = section.header.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = p.add_run(text)
    set_run_font(run, size=Pt(8.5), color=COLOR_MUTED)
    bottom_border(p, color="D0D4DA", size="4")


# ────────────────────────────── 行内富文本 ──────────────────────────────
TOKEN_RE = re.compile(r"(\*\*.+?\*\*|`[^`]+?`)")
LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")


def strip_links(text):
    return LINK_RE.sub(r"\1", text)


def softbreak_long_tokens(text):
    """给长路径类字符串插入零宽空格，使其能在窄单元格内折行。"""
    def repl(m):
        token = m.group(0)
        if "/" not in token and "_" not in token and "." not in token:
            return token
        return re.sub(r"([/_.])", "\\1\u200b", token)

    return re.sub(r"[A-Za-z0-9_./\\-]{18,}", repl, text)


def add_rich_text(paragraph, text, size=BODY_SIZE, color=None, base_bold=False,
                  mono_all=False):
    text = strip_links(inline_render(text))
    pos = 0
    for m in TOKEN_RE.finditer(text):
        if m.start() > pos:
            r = paragraph.add_run(text[pos:m.start()])
            set_run_font(r, size=size, color=color, bold=base_bold, mono=mono_all)
        tok = m.group(0)
        if tok.startswith("**"):
            r = paragraph.add_run(tok[2:-2])
            set_run_font(r, size=size, color=color, bold=True, mono=mono_all)
        else:
            r = paragraph.add_run(tok[1:-1])
            set_run_font(r, size=size, color=COLOR_CODE, bold=base_bold, mono=True)
            r._element.get_or_add_rPr().append(make_shd(SHADE_INLINE))
        pos = m.end()
    if pos < len(text):
        r = paragraph.add_run(text[pos:])
        set_run_font(r, size=size, color=color, bold=base_bold, mono=mono_all)


# ────────────────────────────── 块级渲染 ──────────────────────────────
def add_heading(doc, level, text):
    text = strip_links(text)
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Cm(0)
    pf.right_indent = Cm(0)
    pf.first_line_indent = Cm(0)
    if level == 1:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        pf.space_before = Pt(0)
        pf.space_after = Pt(14)
        size, color, font = Pt(20), COLOR_HEAD1, CJK_HEAD
        bottom_border(p, color="1F3864", size="12")
    elif level == 2:
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        pf.space_before = Pt(16)
        pf.space_after = Pt(8)
        size, color, font = Pt(15), COLOR_HEAD1, CJK_HEAD
        bottom_border(p, color="B4C6DE", size="6")
    elif level == 3:
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        pf.space_before = Pt(12)
        pf.space_after = Pt(6)
        size, color, font = Pt(12), COLOR_HEAD2, CJK_HEAD
    else:
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        pf.space_before = Pt(10)
        pf.space_after = Pt(4)
        size, color, font = Pt(11), COLOR_HEAD3, CJK_HEAD
    pf.keep_with_next = True
    pf.line_spacing_rule = WD_LINE_SPACING.SINGLE
    run = p.add_run(text)
    set_run_font(run, cjk=font, size=size, bold=True, color=color)


def add_body(doc, text):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Cm(0)
    pf.first_line_indent = Cm(0)
    pf.space_before = Pt(0)
    pf.space_after = Pt(6)
    pf.line_spacing = 1.45
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    add_rich_text(p, text)


def add_list_item(doc, marker, text, indent_level, compact=False):
    """列表项采用块缩进（不做悬挂缩进 + 制表位）。

    原因：制表位的基准点在不同渲染器下解释不一致（相对左边距或相对左缩进），
    会导致换行后的续行与首行文字对不齐。块缩进在 Word 与 LibreOffice 下表现一致。
    """
    p = doc.add_paragraph()
    pf = p.paragraph_format
    body_indent = 0.8 + 0.7 * indent_level
    pf.left_indent = Cm(body_indent)
    pf.first_line_indent = Cm(0)
    pf.right_indent = Cm(0)
    pf.space_before = Pt(0)
    pf.space_after = Pt(1 if compact else 3)
    pf.line_spacing = 1.25 if compact else 1.4
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    r = p.add_run(marker + "  ")
    set_run_font(r, size=BODY_SIZE)
    add_rich_text(p, text)


def add_code_block(doc, lines):
    for i, line in enumerate(lines):
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.left_indent = Cm(0.6)
        pf.right_indent = Cm(0.3)
        pf.first_line_indent = Cm(0)
        pf.space_before = Pt(5 if i == 0 else 0)
        pf.space_after = Pt(5 if i == len(lines) - 1 else 0)
        pf.line_spacing_rule = WD_LINE_SPACING.SINGLE
        pf.keep_together = True
        run = p.add_run(line if line else "\u00a0")
        set_run_font(run, size=CODE_SIZE, color=COLOR_CODE, mono=True)
        shade_paragraph(p, SHADE_CODE)
    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_before = Pt(0)
    spacer.paragraph_format.space_after = Pt(0)
    spacer.paragraph_format.line_spacing = Pt(6)


def add_display_math(doc, lines):
    for line in lines:
        p = doc.add_paragraph()
        pf = p.paragraph_format
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        pf.left_indent = Cm(0.5)
        pf.right_indent = Cm(0.5)
        pf.first_line_indent = Cm(0)
        pf.space_before = Pt(6)
        pf.space_after = Pt(6)
        pf.line_spacing = 1.2
        run = p.add_run(line)
        set_run_font(run, size=Pt(10.5), color=COLOR_MATH, mono=True)


def add_divider(doc):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.line_spacing = Pt(2)
    bottom_border(p, color="C9CED6", size="6")


def set_table_borders(table):
    tblPr = table._element.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement("w:" + edge)
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "4")
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), "BFC5CE")
        borders.append(el)
    tblPr.append(borders)


def add_table(doc, rows):
    header = [c.strip() for c in rows[0]]
    body = [[c.strip() for c in r] for r in rows[1:]]
    ncol = len(header)
    table = doc.add_table(rows=1 + len(body), cols=ncol)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    set_table_borders(table)

    # 列宽按内容长度分配（有下限与上限），总宽固定为正文宽度
    weights = []
    for c in range(ncol):
        lens = [len(header[c])] + [len(r[c]) for r in body if c < len(r)]
        weights.append(max(6, min(34, max(lens) if lens else 8)))
    total_w = sum(weights)
    avail = Cm(TEXT_WIDTH_CM)
    widths = [Emu(int(avail * (w / total_w))) for w in weights]

    # 固定布局 + 显式总宽
    tblPr = table._element.tblPr
    tblW = tblPr.find(qn("w:tblW"))
    if tblW is None:
        tblW = OxmlElement("w:tblW")
        tblPr.append(tblW)
    total_twips = int(sum(widths) / 635)  # 1 twip = 635 EMU
    tblW.set(qn("w:type"), "dxa")
    tblW.set(qn("w:w"), str(total_twips))
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tblPr.append(layout)

    for ci, w in enumerate(widths):
        table.columns[ci].width = w

    font_size = TABLE_SIZE_WIDE if ncol >= 5 else TABLE_SIZE

    for ri in range(1 + len(body)):
        row = table.rows[ri]
        for ci in range(ncol):
            cell = row.cells[ci]
            cell.width = widths[ci]
            p = cell.paragraphs[0]
            pf = p.paragraph_format
            pf.space_before = Pt(2)
            pf.space_after = Pt(2)
            pf.line_spacing = 1.12
            if ri == 0:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                add_rich_text(p, softbreak_long_tokens(header[ci]),
                              size=font_size, base_bold=True)
                shade_cell(cell, SHADE_TH)
            else:
                value = body[ri - 1][ci] if ci < len(body[ri - 1]) else ""
                p.alignment = WD_ALIGN_PARAGRAPH.LEFT
                add_rich_text(p, softbreak_long_tokens(value), size=font_size)
                if ri % 2 == 0:
                    shade_cell(cell, SHADE_ROW_ALT)

    trPr = table.rows[0]._tr.get_or_add_trPr()
    tblHeader = OxmlElement("w:tblHeader")
    tblHeader.set(qn("w:val"), "true")
    trPr.append(tblHeader)

    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_before = Pt(0)
    spacer.paragraph_format.space_after = Pt(0)
    spacer.paragraph_format.line_spacing = Pt(8)


# ────────────────────────────── 解析主流程 ──────────────────────────────
def parse_table_row(line):
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    s = s.replace("\\|", "\x00")
    return [c.replace("\x00", "|") for c in s.split("|")]


def is_separator_row(line):
    s = line.strip().strip("|")
    if not s:
        return False
    return all(re.fullmatch(r":?-{2,}:?", c.strip()) for c in s.split("|"))


def convert(src_path, dst_path):
    raw = io.open(src_path, encoding="utf-8").read().replace("\r\n", "\n")
    lines = raw.split("\n")

    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name = LATIN_BODY
    normal.font.size = BODY_SIZE
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), CJK_BODY)

    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.left_margin = Cm(2.3)
    section.right_margin = Cm(2.3)
    section.top_margin = Cm(2.4)
    section.bottom_margin = Cm(2.2)
    add_page_number_footer(section)
    add_header_text(section, "机器学习层技术说明")

    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        # 跳过 Markdown 里的 HTML 锚点（<a id="s1"></a>），它是给网页用的，Word 里不应出现
        if re.fullmatch(r'<a\s+id="[^"]*"\s*>\s*</a>', stripped):
            i += 1
            continue

        if stripped.startswith("```"):
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith("```"):
                buf.append(lines[i].rstrip())
                i += 1
            i += 1
            add_code_block(doc, buf)
            continue

        if stripped.startswith("$$"):
            buf = []
            if stripped.endswith("$$") and len(stripped) > 4:
                buf = [stripped[2:-2]]
                i += 1
            else:
                buf = [stripped[2:]]
                i += 1
                while i < n and not lines[i].strip().endswith("$$"):
                    buf.append(lines[i].strip())
                    i += 1
                if i < n:
                    buf.append(lines[i].strip()[:-2])
                    i += 1
            add_display_math(doc, display_lines(" ".join(buf)))
            continue

        if re.fullmatch(r"-{3,}", stripped):
            add_divider(doc)
            i += 1
            continue

        m = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if m:
            add_heading(doc, len(m.group(1)), m.group(2).strip())
            i += 1
            continue

        if stripped.startswith("|") and i + 1 < n and is_separator_row(lines[i + 1]):
            rows = [parse_table_row(stripped)]
            i += 2
            while i < n and lines[i].strip().startswith("|"):
                rows.append(parse_table_row(lines[i].strip()))
                i += 1
            add_table(doc, rows)
            continue

        m = re.match(r"^(\s*)(\d+[a-z]?\.)\s+(.*)$", line)
        if m:
            indent = min(2, len(m.group(1).replace("\t", "  ")) // 2)
            compact = "](#" in m.group(3)
            add_list_item(doc, m.group(2), m.group(3).strip(), indent, compact)
            i += 1
            continue

        m = re.match(r"^(\s*)[-*]\s+(.*)$", line)
        if m:
            indent = min(2, len(m.group(1).replace("\t", "  ")) // 2)
            add_list_item(doc, "·", m.group(2).strip(), indent)
            i += 1
            continue

        buf = [stripped]
        i += 1
        while i < n:
            nxt = lines[i].strip()
            if (not nxt or nxt.startswith("#") or nxt.startswith("```")
                    or nxt.startswith("|") or nxt.startswith("$$")
                    or re.fullmatch(r"-{3,}", nxt)
                    or re.match(r"^(\s*)(\d+[a-z]?\.|[-*])\s+", lines[i])):
                break
            buf.append(nxt)
            i += 1
        add_body(doc, " ".join(buf))

    normalize_document(doc)
    doc.save(dst_path)
    return dst_path


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "docs/ML_TECHNICAL.md"
    dst = sys.argv[2] if len(sys.argv) > 2 else "docs/ML_TECHNICAL.docx"
    print("saved:", convert(src, dst))
