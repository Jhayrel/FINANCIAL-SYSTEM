import { describe, expect, it } from "vitest";

import { buildSheet } from "../domain/statementSheet";
import type { ReferenceLists, Transaction } from "../domain/types";
import { INTER_REGULAR } from "./fonts";
import { issuedLabel, statementPdf } from "./statementPdf";
import { fromBase64, parseTtf } from "./writer";

const reference: ReferenceLists = { wallets: ["Cash", "Maya"], savings: [], bills: [], subscriptions: [], revenueCategories: [], spendingTypes: [] };

const rows = (count: number): Transaction[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    recordNumber: i + 1,
    date: `2026-0${1 + (i % 9)}-1${i % 10}`,
    type: i % 3 === 0 ? ("Revenue" as const) : ("Spending" as const),
    fromWallet: i % 3 === 0 ? "" : "Cash",
    toWallet: i % 3 === 0 ? "Maya" : "",
    category: i % 3 === 0 ? "Revenue" : "Spending",
    item: "Food",
    description: i === 5 ? "A description long enough that it has to wrap onto a second line in the table" : `Row ${i}`,
    amount: 12345 + i,
    fee: 0,
    total: 12345 + i,
    notes: "",
    status: "",
  }));

const latin1 = new TextDecoder("latin1");
const font = parseTtf(fromBase64(INTER_REGULAR), "Inter-Regular");
const bold = parseTtf(fromBase64(await import("./fonts").then((m) => m.INTER_BOLD)), "Inter-Bold");
const hexOf = (text: string, f = font): string =>
  [...text].map((ch) => (f.cmap.get(ch.codePointAt(0)!) ?? 0).toString(16).padStart(4, "0")).join("");

async function make(count: number) {
  const sheet = buildSheet(rows(count), { type: "account", year: 2026, fromMonth: 1, toMonth: 12 }, reference);
  const bytes = await statementPdf({ sheet, issuedTo: "Ana Cruz", issuedBy: "", issuedAt: new Date(2026, 8, 26, 14, 38), compress: false });
  return { sheet, bytes, text: latin1.decode(bytes) };
}

describe("the embedded font", () => {
  it("draws the peso sign and has digits of one width", () => {
    expect(font.cmap.has(0x20b1)).toBe(true);
    const widths = new Set([..."0123456789"].map((d) => font.advances[font.cmap.get(d.codePointAt(0)!)!]));
    expect(widths.size).toBe(1);
  });
});

describe("a statement PDF", () => {
  it("is a well-formed file whose cross-reference table points at every object", async () => {
    const { bytes, text } = await make(12);
    expect(text.startsWith("%PDF-1.7")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const entries = text.slice(xrefAt).split("\n").filter((l) => / 00000 n $/.test(l));
    entries.forEach((line, i) => {
      const at = Number(line.slice(0, 10));
      expect(latin1.decode(bytes.slice(at, at + 12)).startsWith(`${i + 1} 0 obj`)).toBe(true);
    });
  });

  it("fits a short statement on one page and runs a long one over several, numbered", async () => {
    expect((await make(12)).text.match(/\/Type \/Page /g)).toHaveLength(1);
    const long = await make(160);
    const pages = long.text.match(/\/Type \/Page /g)!.length;
    expect(pages).toBeGreaterThan(3);
    expect(long.text).toContain(hexOf(`Page ${pages} of ${pages}`));
  });

  it("carries the system's name, who it is issued to, and closes with Nothing Follows", async () => {
    const { text } = await make(12);
    // Only in the small print at the foot: the owner asked for it off the top.
    const name = hexOf("Financial Management System");
    expect(text).toMatch(new RegExp(`/F1 7 Tf [^<]*<${name}>`));
    expect(text).not.toMatch(new RegExp(`/F2 [0-9.]+ Tf [^<]*<${name}>`));
    expect(text).toContain(hexOf("Ana Cruz", bold));
    expect(text).toContain(hexOf("**Nothing Follows**", bold));
    expect(text).toContain(hexOf("ACCOUNT STATEMENT", bold));
  });

  it("maps every glyph it writes back to text, so the PDF can be searched and copied", async () => {
    const { text } = await make(12);
    expect(text).toContain("beginbfchar");
    expect(text).toContain(`<${(font.cmap.get(0x20b1)!).toString(16).padStart(4, "0")}> <20b1>`);
  });

  it("says who issued it on the date it was made", () => {
    expect(issuedLabel(new Date(2026, 8, 26, 14, 38))).toBe("26 September 2026, 2:38 PM");
    expect(issuedLabel(new Date(2026, 0, 1, 0, 5))).toBe("1 January 2026, 12:05 AM");
  });

  it("is compressed when downloaded", async () => {
    const sheet = buildSheet(rows(160), { type: "account", year: 2026, fromMonth: 1, toMonth: 12 }, reference);
    const packed = await statementPdf({ sheet, issuedTo: "", issuedBy: "", issuedAt: new Date() });
    const plain = await statementPdf({ sheet, issuedTo: "", issuedBy: "", issuedAt: new Date(), compress: false });
    expect(packed.length).toBeLessThan(plain.length / 3);
  });
});
