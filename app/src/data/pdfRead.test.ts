/**
 * A PDF's text read on this device (owner, 27 October 2026: "allow scanning
 * of documents invoice etc"). The files are built here, the way a shop's or
 * a bank's software writes them: packed streams, a plain font, and a
 * composite font with its own letter table.
 */
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pdfText } from "./pdfRead";

const enc = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

/** A PDF from its objects, numbered from 1; a stream is `[dict, bytes]`. */
function buildPdf(objects: readonly (string | readonly [string, Uint8Array])[], trailer = ""): ArrayBuffer {
  const parts: Uint8Array[] = [enc("%PDF-1.7\n")];
  objects.forEach((o, i) => {
    if (typeof o === "string") parts.push(enc(`${i + 1} 0 obj\n${o}\nendobj\n`));
    else {
      parts.push(enc(`${i + 1} 0 obj\n${o[0].replace("LEN", String(o[1].length))}\nstream\n`), o[1], enc("\nendstream\nendobj\n"));
    }
  });
  parts.push(enc(`trailer\n<< /Root 1 0 R ${trailer}>>\n%%EOF\n`));
  const size = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out.buffer;
}

describe("a PDF's text", () => {
  it("reads an invoice in a plain font, line by line, across pages", async () => {
    const page1 = deflateSync(Buffer.from("BT /F1 12 Tf 72 720 Td (SALES INVOICE No. 00123) Tj 0 -16 Td (Globe Telecom) Tj 0 -16 Td [(Amount Due) -400 (PHP 1,299.00)] TJ ET"));
    const page2 = deflateSync(Buffer.from("BT /F1 12 Tf 1 0 0 1 72 720 Tm (Due Date: November 15, 2026) Tj 1 0 0 1 72 700 Tm (Thank you\\051) Tj ET"));
    const pdf = buildPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /Resources << /Font << /F1 5 0 R >> >> >>",
      "<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>",
      "<< /Type /Page /Parent 2 0 R /Contents 7 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      ["<< /Length LEN /Filter /FlateDecode >>", page1],
      ["<< /Length LEN /Filter /FlateDecode >>", page2],
    ]);
    const read = await pdfText(pdf);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.pages).toBe(2);
    expect(read.text.split("\n")).toEqual(["SALES INVOICE No. 00123", "Globe Telecom", "Amount Due PHP 1,299.00", "", "Due Date: November 15, 2026", "Thank you)"]);
  });

  it("reads a composite font through its letter table", async () => {
    // Codes 0001 to 0005 are "Total", 0006 a space, 0007.. digits from "1".
    const cmap = deflateSync(Buffer.from("begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0001> <0054> <0006> <0020> endbfchar 2 beginbfrange <0002> <0005> [<006F> <0074> <0061> <006C>] <0007> <000F> <0031> endbfrange endcmap"));
    const content = deflateSync(Buffer.from("BT /C0 10 Tf 50 700 Td <000100020003000400050006000800070007> Tj ET"));
    const pdf = buildPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /Resources << /Font << /C0 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /ToUnicode 6 0 R >>",
      ["<< /Length LEN /Filter /FlateDecode >>", content],
      ["<< /Length LEN /Filter /FlateDecode >>", cmap],
    ]);
    const read = await pdfText(pdf);
    expect(read.ok && read.text).toBe("Total 211");
  });

  it("says when it is locked, or a scan with no text", async () => {
    const locked = buildPdf(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [] /Count 0 >>"], "/Encrypt 9 0 R ");
    expect(await pdfText(locked)).toEqual({ ok: false, reason: "locked" });
    const scan = buildPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>",
      ["<< /Length LEN /Filter /FlateDecode >>", deflateSync(Buffer.from("q 595 0 0 842 0 0 cm /Im0 Do Q"))],
    ]);
    expect(await pdfText(scan)).toEqual({ ok: false, reason: "scanned" });
    expect(await pdfText(enc("hello").buffer as ArrayBuffer)).toEqual({ ok: false, reason: "broken" });
  });
});
