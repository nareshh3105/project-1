"""
Render a Markdown document to a professionally typeset PDF.

    python scripts/md2pdf.py docs/SRS.md docs/SRS.pdf

Supports the Markdown subset used in this project's documents: ATX headings,
GFM tables, bullet and ordered lists, blockquotes, fenced code, horizontal
rules, and inline bold/italic/code.

Windows TrueType fonts are registered rather than relying on ReportLab's
built-in Type 1 faces, whose WinAnsi encoding lacks glyphs this document needs
(math relations, box-drawing) and would render them as solid black boxes.
"""

import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, CondPageBreak, Frame, HRFlowable, KeepTogether,
    NextPageTemplate, PageBreak, PageTemplate, Paragraph, Preformatted,
    Spacer, Table, TableStyle,
)

# ── Palette ────────────────────────────────────────────────────────────────

INK        = colors.HexColor('#1a1a1a')
MUTED      = colors.HexColor('#666666')
ACCENT     = colors.HexColor('#1f4e79')
RULE       = colors.HexColor('#cfd6dd')
HEAD_BG    = colors.HexColor('#1f4e79')
ROW_ALT    = colors.HexColor('#f4f6f8')
CODE_BG    = colors.HexColor('#f4f6f8')

PAGE_W, PAGE_H = A4
MARGIN_X = 20 * mm
MARGIN_T = 22 * mm
MARGIN_B = 20 * mm
CONTENT_W = PAGE_W - 2 * MARGIN_X


def register_fonts():
    """Register Windows TrueType faces; fall back to built-ins if absent."""
    faces = {
        'Doc':      'calibri.ttf',
        'Doc-Bold': 'calibrib.ttf',
        'Doc-It':   'calibrii.ttf',
        'Mono':     'consola.ttf',
        'Mono-Bold':'consolab.ttf',
    }
    root = Path('C:/Windows/Fonts')
    ok = True
    for name, filename in faces.items():
        path = root / filename
        if not path.exists():
            ok = False
            break
        pdfmetrics.registerFont(TTFont(name, str(path)))
    if ok:
        pdfmetrics.registerFontFamily(
            'Doc', normal='Doc', bold='Doc-Bold', italic='Doc-It', boldItalic='Doc-Bold')
        return 'Doc', 'Doc-Bold', 'Doc-It', 'Mono'
    return 'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Courier'


BODY, BOLD, ITALIC, MONO = register_fonts()

# ── Styles ─────────────────────────────────────────────────────────────────

_ss = getSampleStyleSheet()

S = {
    'body': ParagraphStyle(
        'body', parent=_ss['Normal'], fontName=BODY, fontSize=9.5, leading=14,
        textColor=INK, spaceAfter=6, alignment=TA_LEFT),
    'h1': ParagraphStyle(
        'h1', fontName=BOLD, fontSize=19, leading=24, textColor=ACCENT,
        spaceBefore=0, spaceAfter=10),
    'h2': ParagraphStyle(
        'h2', fontName=BOLD, fontSize=14, leading=19, textColor=ACCENT,
        spaceBefore=15, spaceAfter=7),
    'h3': ParagraphStyle(
        'h3', fontName=BOLD, fontSize=11.5, leading=16, textColor=INK,
        spaceBefore=12, spaceAfter=5),
    'h4': ParagraphStyle(
        'h4', fontName=BOLD, fontSize=10, leading=14, textColor=INK,
        spaceBefore=9, spaceAfter=4),
    'bullet': ParagraphStyle(
        'bullet', fontName=BODY, fontSize=9.5, leading=14, textColor=INK,
        leftIndent=12, bulletIndent=3, spaceAfter=3),
    'quote': ParagraphStyle(
        'quote', fontName=ITALIC, fontSize=9, leading=13.5, textColor=MUTED,
        leftIndent=10, rightIndent=8, spaceBefore=5, spaceAfter=7,
        borderPadding=(0, 0, 0, 6)),
    'cell': ParagraphStyle(
        'cell', fontName=BODY, fontSize=8.3, leading=11.5, textColor=INK),
    'cellhead': ParagraphStyle(
        'cellhead', fontName=BOLD, fontSize=8.3, leading=11.5,
        textColor=colors.white),
    'title': ParagraphStyle(
        'title', fontName=BOLD, fontSize=27, leading=33, textColor=ACCENT,
        alignment=TA_CENTER, spaceAfter=6),
    'subtitle': ParagraphStyle(
        'subtitle', fontName=BODY, fontSize=13.5, leading=19, textColor=INK,
        alignment=TA_CENTER, spaceAfter=4),
    'tagline': ParagraphStyle(
        'tagline', fontName=ITALIC, fontSize=10, leading=15, textColor=MUTED,
        alignment=TA_CENTER),
}

# ── Inline markup ──────────────────────────────────────────────────────────

def inline(text: str) -> str:
    """Convert inline Markdown to ReportLab markup, escaping XML first."""
    text = (text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))
    # Inline code first so its contents are not further transformed.
    text = re.sub(r'`([^`]+)`',
                  rf'<font face="{MONO}" size="8.5" backColor="#eef1f4"> \1 </font>',
                  text)
    text = re.sub(r'\*\*\*(.+?)\*\*\*', r'<b><i>\1</i></b>', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)', r'<i>\1</i>', text)
    # Links: keep the label, drop the target (printed document).
    text = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text)
    return text


def strip_md(text: str) -> str:
    """Plain text with markup removed — for measuring column widths."""
    text = re.sub(r'`([^`]+)`', r'\1', text)
    text = re.sub(r'\*\*\*(.+?)\*\*\*', r'\1', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'\*(.+?)\*', r'\1', text)
    text = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text)
    return text

# ── Table construction ─────────────────────────────────────────────────────

def split_row(line: str):
    return [c.strip() for c in line.strip().strip('|').split('|')]


def is_divider(line: str) -> bool:
    return bool(re.fullmatch(r'\|?[\s:|-]+\|?', line.strip())) and '-' in line


def build_table(header, rows):
    ncols = len(header)

    # Width proportional to the longest natural word-wrapped content, so that
    # narrow ID columns stay narrow instead of every column being equal.
    weights = []
    for c in range(ncols):
        texts = [strip_md(header[c])] + [strip_md(r[c]) for r in rows if c < len(r)]
        longest_word = max((max((len(w) for w in t.split()), default=1) for t in texts), default=1)
        avg = sum(len(t) for t in texts) / max(len(texts), 1)
        weights.append(max(longest_word, min(avg, 46), 6))

    total = sum(weights)
    widths = [CONTENT_W * w / total for w in weights]

    data = [[Paragraph(inline(h), S['cellhead']) for h in header]]
    for r in rows:
        cells = list(r) + [''] * (ncols - len(r))
        data.append([Paragraph(inline(c), S['cell']) for c in cells[:ncols]])

    style = [
        ('BACKGROUND',    (0, 0), (-1, 0), HEAD_BG),
        ('TEXTCOLOR',     (0, 0), (-1, 0), colors.white),
        ('VALIGN',        (0, 0), (-1, -1), 'TOP'),
        ('GRID',          (0, 0), (-1, -1), 0.4, RULE),
        ('LINEBELOW',     (0, 0), (-1, 0), 0.9, HEAD_BG),
        ('TOPPADDING',    (0, 0), (-1, -1), 4.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4.5),
        ('LEFTPADDING',   (0, 0), (-1, -1), 5),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 5),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.append(('BACKGROUND', (0, i), (-1, i), ROW_ALT))

    t = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle(style))
    return t

# ── Document parsing ───────────────────────────────────────────────────────

def parse(md: str):
    lines = md.split('\n')
    flow = []
    i = 0
    n = len(lines)
    first_h1_seen = False

    while i < n:
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        # Fenced code
        if stripped.startswith('```'):
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith('```'):
                buf.append(lines[i])
                i += 1
            i += 1
            code = '\n'.join(buf)
            pre = Preformatted(
                code,
                ParagraphStyle('code', fontName=MONO, fontSize=7.6, leading=10.2,
                               textColor=INK, backColor=CODE_BG,
                               borderPadding=(6, 6, 6, 6), borderWidth=0.4,
                               borderColor=RULE))
            flow += [Spacer(1, 4), pre, Spacer(1, 8)]
            continue

        # Table
        if stripped.startswith('|') and i + 1 < n and is_divider(lines[i + 1]):
            header = split_row(stripped)
            i += 2
            rows = []
            while i < n and lines[i].strip().startswith('|'):
                rows.append(split_row(lines[i].strip()))
                i += 1
            flow += [Spacer(1, 3), build_table(header, rows), Spacer(1, 10)]
            continue

        # Horizontal rule
        if re.fullmatch(r'(-{3,}|\*{3,}|_{3,})', stripped):
            flow += [Spacer(1, 5),
                     HRFlowable(width='100%', thickness=0.6, color=RULE),
                     Spacer(1, 9)]
            i += 1
            continue

        # Headings
        m = re.match(r'^(#{1,6})\s+(.*)', stripped)
        if m:
            level = len(m.group(1))
            text = m.group(2).strip()
            if level == 1:
                # Each top-level section starts a fresh page.
                if first_h1_seen:
                    flow.append(PageBreak())
                first_h1_seen = True
                flow.append(Paragraph(inline(text), S['h1']))
                flow.append(HRFlowable(width='100%', thickness=1.1, color=ACCENT,
                                       spaceBefore=1, spaceAfter=10))
            else:
                key = {2: 'h2', 3: 'h3'}.get(level, 'h4')
                flow.append(CondPageBreak(26 * mm))
                flow.append(Paragraph(inline(text), S[key]))
            i += 1
            continue

        # Blockquote
        if stripped.startswith('>'):
            buf = []
            while i < n and lines[i].strip().startswith('>'):
                buf.append(lines[i].strip().lstrip('>').strip())
                i += 1
            flow.append(Paragraph(inline(' '.join(buf)), S['quote']))
            continue

        # Ordered list
        m = re.match(r'^(\d+)\.\s+(.*)', stripped)
        if m:
            items = []
            while i < n:
                mm_ = re.match(r'^(\d+)\.\s+(.*)', lines[i].strip())
                if not mm_:
                    break
                items.append(Paragraph(inline(mm_.group(2)), S['bullet'],
                                       bulletText=f'{mm_.group(1)}.'))
                i += 1
            flow += items + [Spacer(1, 5)]
            continue

        # Bullet list
        if re.match(r'^[-*+]\s+', stripped):
            items = []
            while i < n and re.match(r'^[-*+]\s+', lines[i].strip()):
                text = re.sub(r'^[-*+]\s+', '', lines[i].strip())
                items.append(Paragraph(inline(text), S['bullet'], bulletText='\u2022'))
                i += 1
            flow += items + [Spacer(1, 5)]
            continue

        # Paragraph
        buf = []
        while i < n and lines[i].strip() and not re.match(
                r'^(#{1,6}\s|\||>|```|[-*+]\s|\d+\.\s)', lines[i].strip()) \
                and not re.fullmatch(r'(-{3,}|\*{3,}|_{3,})', lines[i].strip()):
            buf.append(lines[i].strip())
            i += 1
        if buf:
            flow.append(Paragraph(inline(' '.join(buf)), S['body']))
        else:
            i += 1

    return flow

# ── Page furniture ─────────────────────────────────────────────────────────

class Doc(BaseDocTemplate):
    def __init__(self, path, title, subtitle, **kw):
        super().__init__(path, pagesize=A4,
                         leftMargin=MARGIN_X, rightMargin=MARGIN_X,
                         topMargin=MARGIN_T, bottomMargin=MARGIN_B,
                         title=title, author=subtitle, **kw)
        self.doc_title = title
        frame_cover = Frame(MARGIN_X, MARGIN_B, CONTENT_W,
                            PAGE_H - MARGIN_T - MARGIN_B, id='cover')
        frame_body = Frame(MARGIN_X, MARGIN_B, CONTENT_W,
                           PAGE_H - MARGIN_T - MARGIN_B, id='body')
        self.addPageTemplates([
            PageTemplate(id='Cover', frames=[frame_cover]),
            PageTemplate(id='Body', frames=[frame_body],
                         onPage=self._furniture),
        ])

    def _furniture(self, canvas, doc):
        canvas.saveState()
        # Running header
        canvas.setFont(BODY, 7.6)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN_X, PAGE_H - MARGIN_T + 9, self.doc_title)
        canvas.drawRightString(PAGE_W - MARGIN_X, PAGE_H - MARGIN_T + 9,
                               'Confidential')
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.4)
        canvas.line(MARGIN_X, PAGE_H - MARGIN_T + 5,
                    PAGE_W - MARGIN_X, PAGE_H - MARGIN_T + 5)
        # Footer
        canvas.line(MARGIN_X, MARGIN_B - 7, PAGE_W - MARGIN_X, MARGIN_B - 7)
        canvas.drawCentredString(PAGE_W / 2, MARGIN_B - 15,
                                 f'Page {canvas.getPageNumber() - 1}')
        canvas.restoreState()


def cover(title, subtitle, meta_rows):
    flow = [Spacer(1, 52 * mm),
            Paragraph(title, S['title']),
            Spacer(1, 3),
            Paragraph(subtitle, S['subtitle']),
            Spacer(1, 7),
            HRFlowable(width='42%', thickness=1.6, color=ACCENT,
                       hAlign='CENTER'),
            Spacer(1, 24)]

    data = [[Paragraph(f'<b>{k}</b>', S['cell']), Paragraph(v, S['cell'])]
            for k, v in meta_rows]
    t = Table(data, colWidths=[42 * mm, 62 * mm], hAlign='CENTER')
    t.setStyle(TableStyle([
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING',    (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LINEBELOW',     (0, 0), (-1, -2), 0.4, RULE),
        ('LEFTPADDING',   (0, 0), (-1, -1), 8),
    ]))
    flow += [t, Spacer(1, 30),
             Paragraph('This document contains confidential and proprietary '
                       'information. Distribution is restricted to authorised '
                       'recipients.', S['tagline'])]
    return flow


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else 'docs/SRS.md')
    out = Path(sys.argv[2] if len(sys.argv) > 2 else src.with_suffix('.pdf'))

    md = src.read_text(encoding='utf-8')

    # Pull the metadata table out of the source so it can form the cover page,
    # and drop the Markdown TOC, which is meaningless without hyperlinks.
    meta_rows = []
    for m in re.finditer(r'^\|\s*\*\*(.+?)\*\*\s*\|\s*(.+?)\s*\|$', md, re.M):
        meta_rows.append((m.group(1), strip_md(m.group(2))))
        if len(meta_rows) >= 5:
            break

    body = md
    body = re.sub(r'^# Software Requirements Specification\s*$', '', body, flags=re.M)
    body = re.sub(r'^## CodeBuilders.*$', '', body, count=1, flags=re.M)
    body = re.sub(r'\|\s*\|\s*\|\n\|[-\s|]+\|\n(\|\s*\*\*.+?\n)+', '', body, count=1)
    body = re.sub(r'^## Table of Contents.*?(?=^---)', '', body,
                  count=1, flags=re.M | re.S)
    body = body.lstrip('-\n ')

    story = cover(
        'Software Requirements Specification',
        'CodeBuilders — Desktop Screen Recording &amp; Live Streaming Studio',
        meta_rows or [('Version', '1.0')])
    story.append(NextPageTemplate('Body'))
    story.append(PageBreak())
    story += parse(body)

    doc = Doc(str(out), 'Software Requirements Specification — CodeBuilders',
              'Development Team')
    doc.build(story)
    print(f'Wrote {out}')


if __name__ == '__main__':
    main()
