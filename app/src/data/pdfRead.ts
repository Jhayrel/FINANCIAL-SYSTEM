/**
 * A PDF's text, taken out on this device (`domain/pdfText.ts` reads the text
 * drawing; this finds the pages, their fonts and their streams).
 *
 * The streams are unpacked with the browser's own DecompressionStream, so
 * nothing is added to the app and nothing leaves the device. A PDF that is
 * locked, or that is pictures of pages (a scan), has no text to give: the
 * result says which, so the chat can say what to send instead.
 */
import { contentText, readCMap, readable, type FontMap } from "../domain/pdfText";

export type PdfText =
  | { readonly ok: true; readonly text: string; readonly pages: number }
  | { readonly ok: false; readonly reason: "locked" | "scanned" | "broken" };

interface PdfObject {
  readonly dict: string;
  /** The stream's bytes, unpacked when it was packed with Flate. */
  readonly stream?: Uint8Array | undefined;
}

/** Bytes as a string of the same length, one character a byte, so offsets agree. */
function binary(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  try {
    const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return undefined;
  }
}

const ref = (text: string, key: string): number | null => {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(text);
  return m?.[1] ? Number(m[1]) : null;
};

/** Every object in the file, packed object streams opened too. */
async function objectsOf(raw: string, bytes: Uint8Array): Promise<Map<number, PdfObject>> {
  const objects = new Map<number, PdfObject>();
  const found = /(\d+)\s+\d+\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = found.exec(raw))) {
    const id = Number(m[1]);
    const start = m.index + m[0].length;
    const end = raw.indexOf("endobj", start);
    if (end < 0) break;
    const body = raw.slice(start, end);
    const at = body.search(/\bstream\r?\n/);
    if (at < 0) {
      objects.set(id, { dict: body });
      found.lastIndex = end;
      continue;
    }
    const dict = body.slice(0, at);
    const from = start + at + (body.slice(at).startsWith("stream\r\n") ? 8 : 7);
    const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict)?.[1];
    let to = length ? from + Number(length) : raw.indexOf("endstream", from);
    if (to < from || to > raw.length) to = raw.indexOf("endstream", from);
    const packed = bytes.subarray(from, to);
    const flate = /\/FlateDecode/.test(dict);
    const stream = flate ? await inflate(packed) : /\/Filter/.test(dict) ? undefined : packed;
    objects.set(id, { dict, stream });
    found.lastIndex = Math.max(end, to);
  }
  // Packed objects: a number and an offset each, then the objects themselves.
  for (const o of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict) || !o.stream) continue;
    const text = binary(o.stream);
    const first = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1] ?? 0);
    const head = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k + 1 < head.length; k += 2) {
      const id = head[k]!;
      const begin = first + head[k + 1]!;
      const finish = k + 3 < head.length ? first + head[k + 3]! : text.length;
      if (!objects.has(id)) objects.set(id, { dict: text.slice(begin, finish) });
    }
  }
  return objects;
}

/** A font's letters, from its ToUnicode table; two bytes a letter for a composite font. */
function fontOf(objects: Map<number, PdfObject>, id: number): FontMap | undefined {
  const font = objects.get(id);
  if (!font) return undefined;
  const table = ref(font.dict, "ToUnicode");
  const stream = table !== null ? objects.get(table)?.stream : undefined;
  const map = stream ? readCMap(binary(stream)) : { codes: new Map<number, string>(), bytes: 1 as const };
  return /\/Subtype\s*\/Type0/.test(font.dict) ? { codes: map.codes, bytes: 2 } : map;
}

/** The fonts a page's resources name: `/F1 12 0 R`. */
function fontsIn(objects: Map<number, PdfObject>, resources: string): Map<string, FontMap> {
  const out = new Map<string, FontMap>();
  let dict = /\/Font\s*<<([\s\S]*?)>>/.exec(resources)?.[1];
  if (dict === undefined) {
    const at = ref(resources, "Font");
    dict = at !== null ? objects.get(at)?.dict : undefined;
  }
  for (const m of (dict ?? "").matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const font = fontOf(objects, Number(m[2]));
    if (font) out.set(`/${m[1]}`, font);
  }
  return out;
}

/** The page's resources: its own, else its parent's, as a page inherits them. */
function resourcesOf(objects: Map<number, PdfObject>, dict: string, depth = 0): string {
  const inline = /\/Resources\s*(<<[\s\S]*>>)/.exec(dict)?.[1];
  if (inline) return inline;
  const at = ref(dict, "Resources");
  if (at !== null) return objects.get(at)?.dict ?? "";
  const parent = ref(dict, "Parent");
  return parent !== null && depth < 8 ? resourcesOf(objects, objects.get(parent)?.dict ?? "", depth + 1) : "";
}

/** The pages in reading order, through the page tree, else in the order they were written. */
function pagesOf(objects: Map<number, PdfObject>): number[] {
  const isPage = (id: number): boolean => /\/Type\s*\/Page(?!s)/.test(objects.get(id)?.dict ?? "");
  const root = [...objects.entries()].find(([, o]) => /\/Type\s*\/Pages/.test(o.dict) && !/\/Parent\s+\d/.test(o.dict))?.[0];
  const out: number[] = [];
  const walk = (id: number, depth: number): void => {
    if (depth > 20) return;
    if (isPage(id)) {
      out.push(id);
      return;
    }
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(objects.get(id)?.dict ?? "")?.[1] ?? "";
    for (const k of kids.matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(k[1]), depth + 1);
  };
  if (root !== undefined) walk(root, 0);
  return out.length > 0 ? out : [...objects.keys()].filter(isPage);
}

export async function pdfText(buffer: ArrayBuffer): Promise<PdfText> {
  const bytes = new Uint8Array(buffer);
  const raw = binary(bytes);
  if (!raw.startsWith("%PDF")) return { ok: false, reason: "broken" };
  if (/\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(raw)) return { ok: false, reason: "locked" };
  const objects = await objectsOf(raw, bytes);
  const pages = pagesOf(objects);
  const texts: string[] = [];
  for (const id of pages) {
    const page = objects.get(id);
    if (!page) continue;
    const fonts = fontsIn(objects, resourcesOf(objects, page.dict));
    const contents = /\/Contents\s*\[([^\]]*)\]/.exec(page.dict)?.[1] ?? /\/Contents\s+(\d+\s+\d+\s+R)/.exec(page.dict)?.[1] ?? "";
    const streams = [...contents.matchAll(/(\d+)\s+\d+\s+R/g)].map((c) => objects.get(Number(c[1]))?.stream).filter((s): s is Uint8Array => s !== undefined);
    const text = contentText(streams.map(binary).join("\n"), fonts);
    if (text.trim()) texts.push(text);
  }
  const all = texts.join("\n\n");
  if (!readable(all)) return { ok: false, reason: pages.length > 0 ? "scanned" : "broken" };
  return { ok: true, text: all, pages: pages.length };
}
