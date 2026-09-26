/**
 * A small PDF writer: pages, filled and stroked shapes, and text in an
 * embedded TrueType font.
 *
 * ── Why not a library ─────────────────────────────────────────────────────
 *
 * A statement needs rectangles, lines and text. The libraries that do that
 * are 300 to 500 KB, and the fourteen fonts every PDF reader carries cannot
 * draw the peso sign, so a library would still need a font embedded. This
 * does exactly what a statement needs and nothing else, in the app's own
 * typeface.
 *
 * ── How text is written ───────────────────────────────────────────────────
 *
 * Each font is a Type 0 font over a CIDFontType2 with Identity-H encoding and
 * an identity CID-to-glyph map, so a character is written as its glyph id in
 * the font file. A ToUnicode map says which character each glyph is, so text
 * copied out of the PDF, or searched for in it, is the text that was written.
 * Widths come from the font's own `hmtx`, and nothing is shaped: no kerning,
 * no ligatures, which a table of figures does not want anyway.
 *
 * Coordinates given to a page are in points from the TOP left, the way a
 * layout is thought about. The page turns them into PDF's bottom-left space.
 */

// ── TrueType ───────────────────────────────────────────────────────────────

export interface TtfFont {
  readonly bytes: Uint8Array;
  readonly postScriptName: string;
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
  readonly bbox: readonly [number, number, number, number];
  readonly advances: readonly number[];
  /** Unicode code point to glyph id. */
  readonly cmap: ReadonlyMap<number, number>;
}

export function parseTtf(bytes: Uint8Array, postScriptName: string): TtfFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = view.getUint16(4);
  const tables = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
    tables.set(tag, view.getUint32(at + 8));
  }
  const table = (tag: string): number => {
    const at = tables.get(tag);
    if (at === undefined) throw new Error(`Font has no ${tag} table`);
    return at;
  };

  const head = table("head");
  const unitsPerEm = view.getUint16(head + 18);
  const bbox = [view.getInt16(head + 36), view.getInt16(head + 38), view.getInt16(head + 40), view.getInt16(head + 42)] as const;

  const hhea = table("hhea");
  const ascent = view.getInt16(hhea + 4);
  const descent = view.getInt16(hhea + 6);
  const metrics = view.getUint16(hhea + 34);

  const numGlyphs = view.getUint16(table("maxp") + 4);
  const hmtx = table("hmtx");
  const advances: number[] = [];
  for (let g = 0; g < numGlyphs; g++) {
    advances.push(g < metrics ? view.getUint16(hmtx + g * 4) : advances[metrics - 1]!);
  }

  let capHeight = Math.round(ascent * 0.7);
  if (tables.has("OS/2")) {
    const os2 = table("OS/2");
    if (view.getUint16(os2) >= 2) capHeight = view.getInt16(os2 + 88);
  }

  const cmap = new Map<number, number>();
  const cmapAt = table("cmap");
  const subtables = view.getUint16(cmapAt + 2);
  let format4 = -1;
  let format12 = -1;
  for (let i = 0; i < subtables; i++) {
    const platform = view.getUint16(cmapAt + 4 + i * 8);
    const encoding = view.getUint16(cmapAt + 6 + i * 8);
    const offset = cmapAt + view.getUint32(cmapAt + 8 + i * 8);
    const format = view.getUint16(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    if (format === 12) format12 = offset;
    if (format === 4) format4 = offset;
  }
  if (format12 >= 0) {
    const groups = view.getUint32(format12 + 12);
    for (let i = 0; i < groups; i++) {
      const at = format12 + 16 + i * 12;
      const start = view.getUint32(at);
      const end = view.getUint32(at + 4);
      const glyph = view.getUint32(at + 8);
      for (let c = start; c <= end; c++) cmap.set(c, glyph + (c - start));
    }
  } else if (format4 >= 0) {
    const segs = view.getUint16(format4 + 6) / 2;
    const ends = format4 + 14;
    const starts = ends + segs * 2 + 2;
    const deltas = starts + segs * 2;
    const ranges = deltas + segs * 2;
    for (let s = 0; s < segs; s++) {
      const end = view.getUint16(ends + s * 2);
      const start = view.getUint16(starts + s * 2);
      const delta = view.getInt16(deltas + s * 2);
      const rangeAt = ranges + s * 2;
      const range = view.getUint16(rangeAt);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph: number;
        if (range === 0) glyph = (c + delta) & 0xffff;
        else {
          const g = view.getUint16(rangeAt + range + (c - start) * 2);
          glyph = g === 0 ? 0 : (g + delta) & 0xffff;
        }
        if (glyph) cmap.set(c, glyph);
      }
    }
  } else {
    throw new Error("Font has no Unicode cmap");
  }

  return { bytes, postScriptName, unitsPerEm, ascent, descent, capHeight, bbox, advances, cmap };
}

// ── Drawing ────────────────────────────────────────────────────────────────

/** A colour as three 0 to 1 channels. Paper has no dark theme, so these are fixed per document. */
export type Rgb = readonly [number, number, number];

export type FontName = "regular" | "bold";

export interface TextOptions {
  readonly font?: FontName;
  readonly size: number;
  readonly color?: Rgb;
  readonly align?: "left" | "center" | "right";
}

const num = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};
const rgb = (c: Rgb): string => c.map((v) => num(v)).join(" ");

/** A string in a PDF literal, for the document info: ASCII as is, anything else as UTF-16. */
function pdfString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, (m) => `\\${m}`)})`;
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  return `<${hex}>`;
}

class Font {
  readonly used = new Map<number, number>(); // glyph -> code point

  constructor(
    readonly ttf: TtfFont,
    readonly resource: string,
  ) {}

  glyph(cp: number): number {
    const g = this.ttf.cmap.get(cp) ?? this.ttf.cmap.get(0x3f) ?? 0;
    if (!this.used.has(g)) this.used.set(g, this.ttf.cmap.has(cp) ? cp : 0x3f);
    return g;
  }

  width(text: string, size: number): number {
    let units = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      const g = this.ttf.cmap.get(cp) ?? this.ttf.cmap.get(0x3f) ?? 0;
      units += this.ttf.advances[g] ?? 0;
    }
    return (units * size) / this.ttf.unitsPerEm;
  }

  encode(text: string): string {
    let hex = "";
    for (const ch of text) hex += this.glyph(ch.codePointAt(0)!).toString(16).padStart(4, "0");
    return `<${hex}>`;
  }
}

export class PdfPage {
  readonly ops: string[] = [];

  constructor(
    private readonly doc: PdfDocument,
    readonly width: number,
    readonly height: number,
  ) {}

  private y(top: number): number {
    return this.height - top;
  }

  rect(x: number, top: number, w: number, h: number, fill: Rgb): void {
    this.ops.push(`${rgb(fill)} rg ${num(x)} ${num(this.y(top + h))} ${num(w)} ${num(h)} re f`);
  }

  line(x1: number, top1: number, x2: number, top2: number, color: Rgb, width = 0.5): void {
    this.ops.push(`${rgb(color)} RG ${num(width)} w 0 J ${num(x1)} ${num(this.y(top1))} m ${num(x2)} ${num(this.y(top2))} l S`);
  }

  /** A filled rounded rectangle, for the logo. */
  roundRect(x: number, top: number, w: number, h: number, r: number, fill: Rgb): void {
    const k = 0.5523 * r;
    const b = this.y(top + h);
    const t = this.y(top);
    const p = [
      `${num(x + r)} ${num(b)} m`,
      `${num(x + w - r)} ${num(b)} l`,
      `${num(x + w - r + k)} ${num(b)} ${num(x + w)} ${num(b + r - k)} ${num(x + w)} ${num(b + r)} c`,
      `${num(x + w)} ${num(t - r)} l`,
      `${num(x + w)} ${num(t - r + k)} ${num(x + w - r + k)} ${num(t)} ${num(x + w - r)} ${num(t)} c`,
      `${num(x + r)} ${num(t)} l`,
      `${num(x + r - k)} ${num(t)} ${num(x)} ${num(t - r + k)} ${num(x)} ${num(t - r)} c`,
      `${num(x)} ${num(b + r)} l`,
      `${num(x)} ${num(b + r - k)} ${num(x + r - k)} ${num(b)} ${num(x + r)} ${num(b)} c`,
    ];
    this.ops.push(`${rgb(fill)} rg ${p.join(" ")} h f`);
  }

  /** A line with round ends, for the logo's strokes. */
  stroke(x1: number, top1: number, x2: number, top2: number, color: Rgb, width: number): void {
    this.ops.push(`${rgb(color)} RG ${num(width)} w 1 J ${num(x1)} ${num(this.y(top1))} m ${num(x2)} ${num(this.y(top2))} l S`);
  }

  /**
   * Text on one line. `top` is the line's baseline measured from the top of
   * the page. Returns the width drawn.
   */
  text(x: number, baseline: number, text: string, o: TextOptions): number {
    if (!text) return 0;
    const font = this.doc.font(o.font ?? "regular");
    const w = font.width(text, o.size);
    const left = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
    this.ops.push(
      `BT ${rgb(o.color ?? [0, 0, 0])} rg /${font.resource} ${num(o.size)} Tf 1 0 0 1 ${num(left)} ${num(this.y(baseline))} Tm ${font.encode(text)} Tj ET`,
    );
    return w;
  }
}

export class PdfDocument {
  readonly pages: PdfPage[] = [];
  private readonly fonts: Record<FontName, Font>;

  constructor(
    fonts: Record<FontName, TtfFont>,
    private readonly info: { readonly title: string; readonly author?: string | undefined; readonly producer: string },
  ) {
    this.fonts = { regular: new Font(fonts.regular, "F1"), bold: new Font(fonts.bold, "F2") };
  }

  font(name: FontName): Font {
    return this.fonts[name];
  }

  width(text: string, font: FontName, size: number): number {
    return this.fonts[font].width(text, size);
  }

  /** A4, portrait, in points. */
  addPage(width = 595.28, height = 841.89): PdfPage {
    const page = new PdfPage(this, width, height);
    this.pages.push(page);
    return page;
  }

  /**
   * The finished file. Streams are compressed where the browser can (every
   * current one can), which takes a 17 page statement from 800 KB to about
   * a tenth of that; where it cannot they are written as they are.
   */
  async bytes(now: Date = new Date(), options: { readonly compress?: boolean } = {}): Promise<Uint8Array> {
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];
    const offsets: number[] = [];
    let length = 0;
    const put = (chunk: string | Uint8Array): void => {
      const b = typeof chunk === "string" ? enc.encode(chunk) : chunk;
      parts.push(b);
      length += b.length;
    };

    // Object numbers, decided up front so objects can point at each other.
    let next = 1;
    const catalog = next++;
    const pagesId = next++;
    const infoId = next++;
    const fontIds = (["regular", "bold"] as const).map(() => ({
      type0: next++,
      cid: next++,
      descriptor: next++,
      file: next++,
      toUnicode: next++,
    }));
    const pageIds = this.pages.map(() => ({ page: next++, content: next++ }));

    const objects = new Map<number, string | { dict: string; data: Uint8Array }>();
    objects.set(catalog, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    objects.set(
      pagesId,
      `<< /Type /Pages /Kids [${pageIds.map((p) => `${p.page} 0 R`).join(" ")}] /Count ${this.pages.length} >>`,
    );
    const stamp = `D:${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}Z`;
    objects.set(
      infoId,
      `<< /Title ${pdfString(this.info.title)}${this.info.author ? ` /Author ${pdfString(this.info.author)}` : ""} /Producer ${pdfString(this.info.producer)} /Creator ${pdfString(this.info.producer)} /CreationDate (${stamp}) >>`,
    );

    const fonts = [this.fonts.regular, this.fonts.bold];
    fonts.forEach((font, i) => {
      const ids = fontIds[i]!;
      const t = font.ttf;
      const scale = 1000 / t.unitsPerEm;
      const glyphs = [...font.used.keys()].sort((a, b) => a - b);
      const widths = glyphs.map((g) => `${g} [${Math.round((t.advances[g] ?? 0) * scale)}]`).join(" ");
      const name = t.postScriptName;

      objects.set(
        ids.type0,
        `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${ids.cid} 0 R] /ToUnicode ${ids.toUnicode} 0 R >>`,
      );
      objects.set(
        ids.cid,
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${ids.descriptor} 0 R /CIDToGIDMap /Identity /DW ${Math.round((t.advances[0] ?? 0) * scale)} /W [${widths}] >>`,
      );
      objects.set(
        ids.descriptor,
        `<< /Type /FontDescriptor /FontName /${name} /Flags 32 /FontBBox [${t.bbox.map((v) => Math.round(v * scale)).join(" ")}] /ItalicAngle 0 /Ascent ${Math.round(t.ascent * scale)} /Descent ${Math.round(t.descent * scale)} /CapHeight ${Math.round(t.capHeight * scale)} /StemV ${i === 0 ? 80 : 140} /FontFile2 ${ids.file} 0 R >>`,
      );
      objects.set(ids.file, { dict: `/Length1 ${t.bytes.length}`, data: t.bytes });

      const map = glyphs
        .map((g) => {
          const cp = font.used.get(g)!;
          const utf16 =
            cp > 0xffff
              ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)]
              : [cp];
          return `<${g.toString(16).padStart(4, "0")}> <${utf16.map((u) => u.toString(16).padStart(4, "0")).join("")}>`;
        });
      const chunks: string[] = [];
      for (let k = 0; k < map.length; k += 100) {
        const slice = map.slice(k, k + 100);
        chunks.push(`${slice.length} beginbfchar\n${slice.join("\n")}\nendbfchar`);
      }
      const cmap = [
        "/CIDInit /ProcSet findresource begin",
        "12 dict begin",
        "begincmap",
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
        `/CMapName /${name}-UTF16 def`,
        "/CMapType 2 def",
        "1 begincodespacerange",
        "<0000> <ffff>",
        "endcodespacerange",
        ...chunks,
        "endcmap",
        "CMapName currentdict /CMap defineresource pop",
        "end",
        "end",
      ].join("\n");
      objects.set(ids.toUnicode, { dict: "", data: enc.encode(cmap) });
    });

    const fontResources = `/Font << /F1 ${fontIds[0]!.type0} 0 R /F2 ${fontIds[1]!.type0} 0 R >>`;
    this.pages.forEach((page, i) => {
      const ids = pageIds[i]!;
      objects.set(
        ids.page,
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << ${fontResources} >> /Contents ${ids.content} 0 R >>`,
      );
      objects.set(ids.content, { dict: "", data: enc.encode(page.ops.join("\n")) });
    });

    for (const [id, o] of objects) {
      if (typeof o === "string" || options.compress === false) continue;
      const packed = await deflate(o.data);
      if (packed) objects.set(id, { dict: `${o.dict ? `${o.dict} ` : ""}/Filter /FlateDecode`, data: packed });
    }

    // %PDF plus four bytes above 127, so a transfer never treats the file as text.
    put("%PDF-1.7\n");
    put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    for (let id = 1; id < next; id++) {
      offsets[id] = length;
      const o = objects.get(id)!;
      if (typeof o === "string") {
        put(`${id} 0 obj\n${o}\nendobj\n`);
      } else {
        put(`${id} 0 obj\n<< /Length ${o.data.length}${o.dict ? ` ${o.dict}` : ""} >>\nstream\n`);
        put(o.data);
        put("\nendstream\nendobj\n");
      }
    }
    const xref = length;
    let table = `xref\n0 ${next}\n0000000000 65535 f \n`;
    for (let id = 1; id < next; id++) table += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    put(table);
    put(`trailer\n<< /Size ${next} /Root ${catalog} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/** zlib-wrapped deflate, which is what /FlateDecode reads. Null where there is no CompressionStream. */
async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** Base64 to bytes, in a browser or in Node. */
export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
