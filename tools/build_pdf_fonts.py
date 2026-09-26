"""
Build the two fonts a PDF statement is written in.

The app sets its text in Inter (@fontsource-variable/inter). A PDF has to
carry its own font, and the fourteen a PDF reader always has cannot draw the
peso sign, so the statement embeds Inter itself: Regular and Bold, cut down
to the characters a statement uses.

Three things are done to each:

  1. The variable font is fixed at one weight (400 and 700).
  2. The digits are swapped for Inter's tabular ones (its `tnum` feature), so
     every figure in a money column is the same width and the decimal points
     line up. A PDF writer does no shaping, so the swap is made in the font.
  3. The peso sign, which fontsource ships in its latin-ext file rather than
     its latin one, is copied across.

Writes app/src/pdf/fonts.ts (generated: do not edit by hand). Inter is under
the SIL Open Font License 1.1, which allows embedding and subsetting.

Usage (needs `pip install fonttools brotli`):
  python tools/build_pdf_fonts.py
"""

from __future__ import annotations

import base64
import io
from pathlib import Path

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
FILES = ROOT / "app" / "node_modules" / "@fontsource-variable" / "inter" / "files"
OUT = ROOT / "app" / "src" / "pdf" / "fonts.ts"

PESO = 0x20B1

# Printable ASCII, Latin-1, the punctuation people type (curly quotes, bullet,
# ellipsis, dashes that arrive in pasted text), the minus sign money uses,
# and the peso sign.
CODEPOINTS = (
    list(range(0x20, 0x7F))
    + list(range(0xA0, 0x100))
    + [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D,
       0x2022, 0x2026, 0x2039, 0x203A, 0x20AC, 0x2122, 0x2212, PESO]
)


def instance(path: Path, weight: int) -> TTFont:
    font = TTFont(path)
    return instantiateVariableFont(font, {"wght": weight}, inplace=False)


def tabular_digits(font: TTFont) -> None:
    """Point 0 to 9 at the glyphs Inter's `tnum` feature would substitute."""
    gsub = font["GSUB"].table
    lookups = {
        i
        for rec in gsub.FeatureList.FeatureRecord
        if rec.FeatureTag == "tnum"
        for i in rec.Feature.LookupListIndex
    }
    swap: dict[str, str] = {}
    for i in lookups:
        for sub in gsub.LookupList.Lookup[i].SubTable:
            mapping = getattr(sub, "mapping", None)
            if mapping is None and hasattr(sub, "ExtSubTable"):
                mapping = getattr(sub.ExtSubTable, "mapping", None)
            if mapping:
                swap.update(mapping)
    for table in font["cmap"].tables:
        for cp in range(0x30, 0x3A):
            name = table.cmap.get(cp)
            if name in swap:
                table.cmap[cp] = swap[name]


def copy_glyph(src: TTFont, dst: TTFont, codepoint: int) -> None:
    """Copy one glyph, decomposed to plain outlines, and map it."""
    name = src.getBestCmap()[codepoint]
    glyph_set = src.getGlyphSet()
    rec = DecomposingRecordingPen(glyph_set)
    glyph_set[name].draw(rec)
    pen = TTGlyphPen(None)
    rec.replay(pen)

    new = f"uni{codepoint:04X}"
    order = dst.getGlyphOrder()
    if new not in order:
        dst.setGlyphOrder(order + [new])
    dst["glyf"].glyphs[new] = pen.glyph()
    dst["glyf"].glyphOrder = dst.getGlyphOrder()
    dst["hmtx"].metrics[new] = src["hmtx"].metrics[name]
    for table in dst["cmap"].tables:
        if table.isUnicode():
            table.cmap[codepoint] = new
    dst["maxp"].numGlyphs = len(dst.getGlyphOrder())


def build(weight: int) -> bytes:
    latin = instance(FILES / "inter-latin-wght-normal.woff2", weight)
    ext = instance(FILES / "inter-latin-ext-wght-normal.woff2", weight)
    tabular_digits(latin)
    copy_glyph(ext, latin, PESO)

    # Round-trip so the added glyph is part of the font's own tables.
    buf = io.BytesIO()
    latin.flavor = None
    latin.save(buf)
    font = TTFont(io.BytesIO(buf.getvalue()))

    opts = Options()
    opts.layout_features = []          # no shaping in a PDF: the digits are already swapped
    opts.drop_tables += ["GSUB", "GPOS", "GDEF", "STAT", "MVAR", "HVAR", "gasp", "prep"]
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6]
    opts.notdef_outline = True
    opts.recalc_bounds = True
    sub = Subsetter(opts)
    sub.populate(unicodes=[cp for cp in CODEPOINTS if cp in font.getBestCmap()])
    sub.subset(font)

    out = io.BytesIO()
    font.flavor = None
    font.save(out)
    data = out.getvalue()
    check = TTFont(io.BytesIO(data))
    assert PESO in check.getBestCmap(), "the peso sign did not survive"
    widths = {check["hmtx"].metrics[check.getBestCmap()[cp]][0] for cp in range(0x30, 0x3A)}
    assert len(widths) == 1, f"digits are not one width: {widths}"
    return data


def main() -> None:
    regular = build(400)
    bold = build(700)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "/**\n"
        " * Inter Regular and Bold, for PDF statements. GENERATED by\n"
        " * tools/build_pdf_fonts.py: do not edit by hand.\n"
        " *\n"
        " * Cut down to the characters a statement uses, with tabular digits and\n"
        " * the peso sign. Inter is Copyright 2016 The Inter Project Authors\n"
        " * (https://github.com/rsms/inter), under the SIL Open Font License 1.1.\n"
        " *\n"
        " * Loaded only when a PDF is made, so it costs nothing until then.\n"
        " */\n\n"
        f'export const INTER_REGULAR = "{base64.b64encode(regular).decode()}";\n\n'
        f'export const INTER_BOLD = "{base64.b64encode(bold).decode()}";\n',
        encoding="utf-8",
    )
    print(f"wrote {OUT.relative_to(ROOT)}: regular {len(regular):,} bytes, bold {len(bold):,} bytes")


if __name__ == "__main__":
    main()
