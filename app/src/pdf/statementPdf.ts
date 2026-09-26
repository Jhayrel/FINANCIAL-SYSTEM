/**
 * A statement as a PDF, laid out the way the owner's Excel printed one.
 *
 * ── The layout asked for, 26 September 2026 ──────────────────────────────
 *
 * A green band across the top with ACCOUNT STATEMENT in it, the period and
 * the date issued on the left, who it is issued to on the right. Then a table
 * with a green heading row: Date, Description, Type, Wallet from, Wallet to,
 * then the money columns, then a balance. The peso sign sits at the left of
 * each money cell and the figure at the right, a dash where there is none,
 * and "**Nothing Follows**" closes it.
 *
 * Asked for on top of that: a name typed in for who it is issued to and who
 * issued it, and the system's logo and name on the page. "Issued from" in the
 * Excel named the workbook file, which the owner struck through as a mistake:
 * here it is the system itself.
 *
 * Paper has no dark theme, so the colours are fixed here rather than read
 * from `tokens.css`: a statement printed at night must look like one printed
 * at noon.
 */

import { formatShort, MONTH_NAMES } from "../domain/dates";
import { formatAmount, type Centavos } from "../domain/money";
import type { SheetLine, StatementSheet } from "../domain/statementSheet";
import { INTER_BOLD, INTER_REGULAR } from "./fonts";
import { fromBase64, parseTtf, PdfDocument, type FontName, type PdfPage, type Rgb } from "./writer";

export const SYSTEM_NAME = "Financial Management System";

const GREEN: Rgb = [0.184, 0.42, 0.129];
const GREEN_SOFT: Rgb = [0.82, 0.9, 0.8];
const WHITE: Rgb = [1, 1, 1];
const INK: Rgb = [0.1, 0.11, 0.1];
const INK_2: Rgb = [0.33, 0.35, 0.33];
const INK_3: Rgb = [0.52, 0.54, 0.52];
const RULE: Rgb = [0.82, 0.84, 0.82];
const ZEBRA: Rgb = [0.955, 0.965, 0.95];

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 28;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER = 26;

const BODY = 7.6;
const LINE = 9.4;
const PAD = 4;

export interface StatementPdfOptions {
  readonly sheet: StatementSheet;
  readonly issuedTo: string;
  readonly issuedBy: string;
  readonly issuedAt: Date;
  /** Tests read the page contents; a download is always compressed. */
  readonly compress?: boolean;
}

interface Column {
  readonly key: "date" | "description" | "kind" | "from" | "to" | "in" | "out" | "balance";
  readonly label: string;
  readonly width: number;
  readonly money?: boolean;
}

/** "26 September 2026, 2:38 PM", in the time of the device that made it. */
export function issuedLabel(d: Date): string {
  const h = d.getHours();
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}, ${hour}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Break text into at most `max` lines of `width`, ending the last in an ellipsis if it does not fit. */
export function wrap(doc: PdfDocument, text: string, font: FontName, size: number, width: number, max: number): string[] {
  const fits = (s: string): boolean => doc.width(s, font, size) <= width;
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (let i = 0; i < words.length; i++) {
    let word = words[i]!;
    const tryLine = current ? `${current} ${word}` : word;
    if (fits(tryLine)) {
      current = tryLine;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
      if (lines.length === max) break;
    }
    // A word too long for a line on its own is cut where it runs out of room.
    while (!fits(word)) {
      let cut = word.length - 1;
      while (cut > 1 && !fits(word.slice(0, cut))) cut--;
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
      if (lines.length === max) break;
    }
    if (lines.length === max) break;
    current = word;
  }
  if (current && lines.length < max) lines.push(current);

  const used = lines.join(" ").replace(/\s+/g, "").length;
  const all = words.join("").length;
  if (used < all && lines.length > 0) {
    let last = lines[lines.length - 1]!;
    while (last && !fits(`${last}…`)) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}…`;
  }
  return lines.length ? lines : [""];
}

function columnsFor(sheet: StatementSheet): Column[] {
  const money = 62;
  const fixed: Column[] = [
    { key: "date", label: "Date", width: 54 },
    { key: "description", label: "Description", width: 0 },
    { key: "kind", label: "Type", width: 58 },
    { key: "from", label: "Wallet from", width: 60 },
    { key: "to", label: "Wallet to", width: 60 },
  ];
  if (sheet.headings.moneyIn) fixed.push({ key: "in", label: sheet.headings.moneyIn, width: money, money: true });
  if (sheet.headings.moneyOut) fixed.push({ key: "out", label: sheet.headings.moneyOut, width: money, money: true });
  fixed.push({ key: "balance", label: sheet.headings.balance, width: money + 6, money: true });
  const taken = fixed.reduce((s, c) => s + c.width, 0);
  return fixed.map((c) => (c.key === "description" ? { ...c, width: CONTENT_W - taken } : c));
}

export async function statementPdf(o: StatementPdfOptions): Promise<Uint8Array> {
  const { sheet } = o;
  const doc = new PdfDocument(
    {
      regular: parseTtf(fromBase64(INTER_REGULAR), "Inter-Regular"),
      bold: parseTtf(fromBase64(INTER_BOLD), "Inter-Bold"),
    },
    {
      title: `${sheet.title}${sheet.subject ? `, ${sheet.subject}` : ""}, ${sheet.period}`,
      author: o.issuedBy || undefined,
      producer: SYSTEM_NAME,
    },
  );

  const columns = columnsFor(sheet);
  const bottom = PAGE_H - MARGIN - FOOTER;
  let page = doc.addPage(PAGE_W, PAGE_H);
  let y = header(page, doc, o);
  y = tableHead(page, columns, y);
  let zebra = false;

  const row = (cells: Partial<Record<Column["key"], string | Centavos | null>>, opts: { bold?: boolean; fill?: Rgb; rule?: boolean } = {}): void => {
    const font: FontName = opts.bold ? "bold" : "regular";
    const wrapped = new Map<Column["key"], string[]>();
    for (const c of columns) {
      if (c.money) continue;
      const v = cells[c.key];
      const text = typeof v === "string" ? v : "";
      wrapped.set(c.key, wrap(doc, text, font, BODY, c.width - PAD * 2, c.key === "date" ? 1 : 3));
    }
    const lines = Math.max(1, ...[...wrapped.values()].map((l) => l.length));
    const h = lines * LINE + 6;

    if (y + h > bottom) {
      page = doc.addPage(PAGE_W, PAGE_H);
      y = continuation(page, o);
      y = tableHead(page, columns, y);
    }

    if (opts.fill) page.rect(MARGIN, y, CONTENT_W, h, opts.fill);
    if (opts.rule) page.line(MARGIN, y, MARGIN + CONTENT_W, y, INK, 0.9);

    let x = MARGIN;
    for (const c of columns) {
      if (c.money) {
        const v = cells[c.key];
        // Level with the middle of the row, as the wrapped text around it is.
        const baseline = y + 3 + ((lines - 1) * LINE) / 2 + LINE - 2.2;
        if (typeof v === "number") {
          page.text(x + PAD, baseline, "₱", { size: BODY, color: INK_3, font });
          if (v === 0) page.text(x + c.width - PAD - 6, baseline, "-", { size: BODY, color: INK_3, align: "right", font });
          else page.text(x + c.width - PAD, baseline, formatAmount(v), { size: BODY, color: INK, align: "right", font });
        }
      } else {
        const ls = wrapped.get(c.key) ?? [""];
        const top = y + 3 + ((lines - ls.length) * LINE) / 2;
        ls.forEach((l, i) => {
          page.text(x + c.width / 2, top + (i + 1) * LINE - 2.2, l, {
            size: BODY,
            color: c.key === "description" || opts.bold ? INK : INK_2,
            align: "center",
            font,
          });
        });
      }
      x += c.width;
    }

    // Column rules, then the row's bottom hairline.
    let cx = MARGIN;
    for (let i = 0; i < columns.length - 1; i++) {
      cx += columns[i]!.width;
      page.line(cx, y, cx, y + h, RULE, 0.4);
    }
    page.line(MARGIN, y + h, MARGIN + CONTENT_W, y + h, RULE, 0.4);
    y += h;
  };

  if (sheet.broughtForward !== null) {
    row(
      { date: formatShort(sheet.from), description: "Balance brought forward", balance: sheet.broughtForward },
      { bold: true, fill: ZEBRA },
    );
  }

  if (sheet.lines.length === 0) {
    row({ description: "No entries in this period" });
  }

  for (const line of sheet.lines) {
    zebra = !zebra;
    row(cellsOf(line, sheet), zebra ? {} : { fill: ZEBRA });
  }

  row(
    {
      description: "Totals",
      ...(sheet.headings.moneyIn ? { in: sheet.totalIn } : {}),
      ...(sheet.headings.moneyOut ? { out: sheet.totalOut } : {}),
      balance: sheet.closing,
    },
    { bold: true, rule: true },
  );

  // Notes, then the closing line.
  const notes = sheet.notes.flatMap((n) => wrap(doc, n, "regular", 7, CONTENT_W, 4));
  const closingHeight = 14 + notes.length * 9 + 26;
  if (y + closingHeight > bottom) {
    page = doc.addPage(PAGE_W, PAGE_H);
    y = continuation(page, o);
  }
  y += 12;
  for (const n of notes) {
    page.text(MARGIN, y, n, { size: 7, color: INK_2 });
    y += 9;
  }
  y += 10;
  page.text(PAGE_W / 2, y, "**Nothing Follows**", { size: 8.5, font: "bold", color: INK, align: "center" });
  page.line(MARGIN, y + 6, MARGIN + CONTENT_W, y + 6, RULE, 0.5);

  // Footers, now the page count is known.
  doc.pages.forEach((p, i) => footer(p, i + 1, doc.pages.length, sheet));

  return doc.bytes(o.issuedAt, { compress: o.compress !== false });
}

function cellsOf(line: SheetLine, sheet: StatementSheet): Partial<Record<Column["key"], string | Centavos | null>> {
  return {
    date: formatShort(line.date),
    description: line.description,
    kind: line.kind,
    from: line.fromWallet,
    to: line.toWallet,
    ...(sheet.headings.moneyIn ? { in: line.moneyIn } : {}),
    ...(sheet.headings.moneyOut ? { out: line.moneyOut } : {}),
    balance: line.balance,
  };
}

/** The system's mark: the app icon, drawn rather than pasted. */
function logo(page: PdfPage, x: number, top: number, size: number, square: Rgb, strokes: Rgb): void {
  const u = size / 32;
  page.roundRect(x, top, size, size, 7 * u, square);
  page.stroke(x + 11 * u, top + 9 * u, x + 22 * u, top + 9 * u, strokes, 2.6 * u);
  page.stroke(x + 11 * u, top + 15.5 * u, x + 22 * u, top + 15.5 * u, strokes, 2.6 * u);
  page.stroke(x + 11 * u, top + 22 * u, x + 17 * u, top + 22 * u, strokes, 2.6 * u);
}

/** The green band on the first page. Returns where the table starts. */
function header(page: PdfPage, doc: PdfDocument, o: StatementPdfOptions): number {
  const { sheet } = o;
  const left: [string, string][] = [
    ["Period", sheet.period],
    ["Date issued", issuedLabel(o.issuedAt)],
  ];
  const right: [string, string][] = [
    ...(o.issuedTo.trim() ? ([["Issued to", o.issuedTo.trim()]] as [string, string][]) : []),
    ...(o.issuedBy.trim() ? ([["Issued by", o.issuedBy.trim()]] as [string, string][]) : []),
    ["Issued from", SYSTEM_NAME],
  ];
  const rows = Math.max(left.length, right.length);
  const titleTop = MARGIN + 44;
  const subject = sheet.subject ? 16 : 0;
  const detailsTop = titleTop + 14 + subject;
  const height = detailsTop - MARGIN + rows * 13 + 14;

  page.rect(MARGIN, MARGIN, CONTENT_W, height, GREEN);

  // Logo and name, top left.
  logo(page, MARGIN + 16, MARGIN + 13, 16, WHITE, GREEN);
  page.text(MARGIN + 38, MARGIN + 24.5, SYSTEM_NAME, { font: "bold", size: 8.5, color: WHITE });

  page.text(MARGIN + 16, titleTop + 6, sheet.title.toUpperCase(), { font: "bold", size: 24, color: WHITE });
  if (sheet.subject) page.text(MARGIN + 16, titleTop + 24, sheet.subject, { font: "bold", size: 11, color: GREEN_SOFT });

  const pair = (x: number, labelWidth: number, list: [string, string][], valueWidth: number): void => {
    list.forEach(([label, value], i) => {
      const baseline = detailsTop + 10 + i * 13;
      page.text(x, baseline, label, { size: 8, color: GREEN_SOFT });
      const shown = wrap(doc, value, "bold", 8.5, valueWidth, 1)[0] ?? "";
      page.text(x + labelWidth, baseline, shown, { size: 8.5, font: "bold", color: WHITE });
    });
  };
  pair(MARGIN + 16, 58, left, CONTENT_W / 2 - 90);
  pair(MARGIN + CONTENT_W / 2 + 20, 58, right, CONTENT_W / 2 - 96);

  return MARGIN + height + 12;
}

/** The top of every page after the first. */
function continuation(page: PdfPage, o: StatementPdfOptions): number {
  const { sheet } = o;
  logo(page, MARGIN, MARGIN, 14, GREEN, WHITE);
  page.text(MARGIN + 20, MARGIN + 10.5, SYSTEM_NAME, { font: "bold", size: 8, color: INK });
  const right = `${sheet.title}${sheet.subject ? `, ${sheet.subject}` : ""} · ${sheet.period} (continued)`;
  page.text(MARGIN + CONTENT_W, MARGIN + 10.5, right, { size: 8, color: INK_2, align: "right" });
  return MARGIN + 24;
}

function tableHead(page: PdfPage, columns: readonly Column[], top: number): number {
  const h = 18;
  page.rect(MARGIN, top, CONTENT_W, h, GREEN);
  let x = MARGIN;
  for (const c of columns) {
    page.text(x + c.width / 2, top + 11.8, c.label, { font: "bold", size: 7.6, color: WHITE, align: "center" });
    x += c.width;
  }
  return top + h;
}

function footer(page: PdfPage, number: number, count: number, sheet: StatementSheet): void {
  const top = PAGE_H - MARGIN - 10;
  page.line(MARGIN, top - 10, MARGIN + CONTENT_W, top - 10, RULE, 0.5);
  logo(page, MARGIN, top - 6.5, 9, GREEN, WHITE);
  page.text(MARGIN + 13, top, SYSTEM_NAME, { size: 7, color: INK_3 });
  page.text(PAGE_W / 2, top, `${sheet.title}${sheet.subject ? `, ${sheet.subject}` : ""} · ${sheet.period}`, {
    size: 7,
    color: INK_3,
    align: "center",
  });
  page.text(MARGIN + CONTENT_W, top, `Page ${number} of ${count}`, { size: 7, color: INK_3, align: "right" });
}
