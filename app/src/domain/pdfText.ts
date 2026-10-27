/**
 * The words in a PDF, read on this device: an invoice, a billing statement,
 * a bank's e-statement.
 *
 * The owner, 27 October 2026: "allow scanning of documents invoice etc make
 * sure my ai and system can do it". A PDF made by a bank or a shop carries
 * its text; this takes it out so the PDF goes the way a pasted statement
 * does, as text, to whichever model answers and to the readers on this
 * device. No library: the streams are unpacked by the browser
 * (`data/pdfRead.ts`) and only the text drawing is read here.
 *
 * What it reads: text drawn with Tj, TJ, ' and ", each new line where the
 * text moves down; fonts mapped to letters by their ToUnicode table where
 * they have one (one or two bytes a letter), else read as Latin-1, which is
 * what a plain font's bytes are. What it cannot read is a scan, a page that
 * is a picture: that has no text at all, and the caller says to send a photo
 * of it instead.
 */

/** A font's letters: its codes to text, and how many bytes one code takes. */
export interface FontMap {
  readonly codes: ReadonlyMap<number, string>;
  readonly bytes: 1 | 2;
}

const latin1 = (bytes: readonly number[]): string => String.fromCharCode(...bytes);

/** A PDF string's bytes: `(literal)` with its escapes, or `<hex>`. */
export function stringBytes(token: string): number[] {
  if (token.startsWith("<")) {
    const hex = token.slice(1, -1).replace(/\s+/g, "");
    const even = hex.length % 2 === 1 ? `${hex}0` : hex;
    const out: number[] = [];
    for (let i = 0; i < even.length; i += 2) out.push(parseInt(even.slice(i, i + 2), 16));
    return out;
  }
  const body = token.slice(1, -1);
  const out: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c !== "\\") {
      out.push(c.charCodeAt(0) & 0xff);
      continue;
    }
    const n = body[++i];
    if (n === undefined) break;
    if (n === "n") out.push(10);
    else if (n === "r") out.push(13);
    else if (n === "t") out.push(9);
    else if (n === "b") out.push(8);
    else if (n === "f") out.push(12);
    else if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(body[i + 1] ?? "")) oct += body[++i];
      out.push(parseInt(oct, 8) & 0xff);
    } else if (n === "\r" || n === "\n") {
      if (n === "\r" && body[i + 1] === "\n") i++;
    } else out.push(n.charCodeAt(0) & 0xff);
  }
  return out;
}

/** A ToUnicode table: `bfchar` and `bfrange` read into codes. */
export function readCMap(text: string): FontMap {
  const codes = new Map<number, string>();
  let width = 1;
  const unicode = (hex: string): string => {
    const h = hex.replace(/\s+/g, "");
    let s = "";
    for (let i = 0; i + 4 <= h.length; i += 4) s += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    return s || String.fromCharCode(parseInt(h || "0", 16));
  };
  const range = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  if (range?.[1] && /<[0-9a-f]{4}>/i.test(range[1])) width = 2;
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of (block[1] ?? "").matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) {
      if (m[1]!.length >= 4) width = 2;
      codes.set(parseInt(m[1]!, 16), unicode(m[2]!));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of (block[1] ?? "").matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(\[[^\]]*\]|<[0-9a-f]*>)/gi)) {
      const lo = parseInt(m[1]!, 16);
      const hi = parseInt(m[2]!, 16);
      if (m[1]!.length >= 4) width = 2;
      if (hi - lo > 65_535) continue;
      if (m[3]!.startsWith("[")) {
        const list = [...m[3]!.matchAll(/<([0-9a-f]*)>/gi)].map((x) => x[1]!);
        list.forEach((h, k) => codes.set(lo + k, unicode(h)));
      } else {
        const start = m[3]!.slice(1, -1).replace(/\s+/g, "");
        const first = parseInt(start.slice(-4) || "0", 16);
        const prefix = start.length > 4 ? unicode(start.slice(0, -4)) : "";
        for (let c = lo; c <= hi; c++) codes.set(c, prefix + String.fromCharCode(first + (c - lo)));
      }
    }
  }
  return { codes, bytes: width as 1 | 2 };
}

/** A string's text in a font: its table where there is one, else Latin-1. */
export function decodeIn(bytes: readonly number[], font: FontMap | undefined): string {
  if (!font || font.codes.size === 0) return latin1(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i += font.bytes) {
    const code = font.bytes === 2 ? ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0) : (bytes[i] ?? 0);
    out += font.codes.get(code) ?? (font.bytes === 1 ? String.fromCharCode(code) : "");
  }
  return out;
}

const TOKEN = /\((?:\\[\s\S]|[^\\)])*\)|<[0-9a-fA-F\s]*>|\[|\]|\/[^\s/<>[\]()]+|-?\d*\.?\d+|[A-Za-z'"*]+/g;

/**
 * The text a content stream draws, a line each time it moves down. `fonts`
 * maps the stream's font names (`/F1`) to their letters.
 */
export function contentText(stream: string, fonts: ReadonlyMap<string, FontMap>): string {
  const lines: string[] = [];
  let line = "";
  let font: FontMap | undefined;
  const stack: string[] = [];
  let lastY: number | null = null;
  const newLine = (): void => {
    if (line.trim()) lines.push(line.replace(/\s+/g, " ").trim());
    line = "";
  };
  const moveTo = (y: number | null): void => {
    if (y !== null && lastY !== null && Math.abs(y - lastY) > 1) newLine();
    else if (line && !line.endsWith(" ")) line += " ";
    if (y !== null) lastY = y;
  };
  for (const m of stream.matchAll(TOKEN)) {
    const t = m[0];
    if (t.startsWith("(") || t.startsWith("<") || t === "[" || t === "]" || t.startsWith("/") || /^-?\d*\.?\d+$/.test(t)) {
      stack.push(t);
      continue;
    }
    const args = stack.splice(0);
    switch (t) {
      case "BT":
        lastY = null;
        break;
      case "ET":
        line += " ";
        break;
      case "Tf":
        font = fonts.get(args.find((a) => a.startsWith("/")) ?? "");
        break;
      case "Td":
      case "TD": {
        const ty = Number(args[1] ?? 0);
        if (Math.abs(ty) > 1) newLine();
        else if (line && !line.endsWith(" ")) line += " ";
        break;
      }
      case "Tm":
        moveTo(Number(args[5] ?? NaN));
        break;
      case "T*":
        newLine();
        break;
      case "Tj":
      case "'":
      case '"': {
        if (t !== "Tj") newLine();
        const s = args.filter((a) => a.startsWith("(") || a.startsWith("<")).pop();
        if (s) line += decodeIn(stringBytes(s), font);
        break;
      }
      case "TJ": {
        for (const a of args) {
          if (a.startsWith("(") || a.startsWith("<")) line += decodeIn(stringBytes(a), font);
          // A wide gap between pieces is a space a font did not draw.
          else if (/^-?\d/.test(a) && Number(a) < -180 && !line.endsWith(" ")) line += " ";
        }
        break;
      }
      default:
        break;
    }
  }
  newLine();
  return lines.join("\n");
}

/** Text that reads as words, not a font's private codes: most of it letters, digits and punctuation. */
export function readable(text: string): boolean {
  const s = text.replace(/\s+/g, "");
  if (s.length < 8) return false;
  const good = s.match(/[A-Za-z0-9₱.,:;/\-()#&%'"@+]/g)?.length ?? 0;
  return good / s.length >= 0.7;
}
