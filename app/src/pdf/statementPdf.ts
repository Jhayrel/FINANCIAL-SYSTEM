/**
 * A statement as a PDF.
 *
 * ── What the owner asked for, 26 September 2026 ──────────────────────────
 *
 * First: the Excel's layout. A green band with ACCOUNT STATEMENT in it, the
 * period and the date issued, who it is issued to, a green heading row over
 * the table, the system's logo and name, and "**Nothing Follows**" at the end.
 *
 * Then, on seeing that built as a copy of the Excel's grid: "this is so ugly
 * ... make it work cleaner looks". The grid was the problem: a peso sign and
 * a dash in every empty cell, a rule between every column, every cell
 * centred, and five columns of text squeezed until descriptions ran to three
 * lines. So the band, the green heading row, the logo, the name and the
 * closing line stay, and the table is a statement's rather than a sheet's:
 *
 *   - Date, Details, then the money. Details is the description with what
 *     kind of entry it was and which wallets it moved between set small and
 *     grey under it, so a row reads in one glance and rarely wraps.
 *   - Text left, money right, rules only between rows.
 *   - An empty money cell is empty. The currency is said once, not 900 times.
 *   - A summary under the band: where it started, what came in, what went
 *     out, where it ended.
 *
 * Paper has no dark theme, so the colours are fixed here rather than read
 * from `tokens.css` (style guide 3.15).
 */

import { MONTH_NAMES, MONTH_NAMES_SHORT, getDay, getMonth } from "../domain/dates";
import { formatAmount, formatMoney, type Centavos } from "../domain/money";
import type { SheetLine, StatementSheet } from "../domain/statementSheet";
import { INTER_BOLD, INTER_REGULAR } from "./fonts";
import { fromBase64, parseTtf, PdfDocument, type FontName, type PdfPage, type Rgb } from "./writer";

export const SYSTEM_NAME = "Financial Management System";

const GREEN: Rgb = [0.184, 0.42, 0.129];
const GREEN_SOFT: Rgb = [0.8, 0.88, 0.78];
const TINT: Rgb = [0.945, 0.96, 0.94];
const WHITE: Rgb = [1, 1, 1];
const INK: Rgb = [0.1, 0.11, 0.1];
const INK_2: Rgb = [0.36, 0.38, 0.36];
const INK_3: Rgb = [0.56, 0.58, 0.56];
const RULE: Rgb = [0.87, 0.89, 0.87];
const RED: Rgb = [0.72, 0.13, 0.11];

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER = 30;

const BODY = 8;
const META = 6.8;
const LINE = 10;
const META_LINE = 9;
const PAD_Y = 4.5;
/** Text inside the table sits this far in from the green heading row's edges. */
const INSET = 8;

const DATE_W = 50;
const MONEY_W = 74;
const BALANCE_W = 80;

export interface StatementPdfOptions {
  readonly sheet: StatementSheet;
  readonly issuedTo: string;
  readonly issuedBy: string;
  readonly issuedAt: Date;
  /** Tests read the page contents; a download is always compressed. */
  readonly compress?: boolean;
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

/** "Jan 4": the year is the statement's. */
const shortDate = (iso: string): string => `${MONTH_NAMES_SHORT[getMonth(iso) - 1]} ${getDay(iso)}`;

/**
 * The grey line under a description: what it was, and where the money went.
 * Words, not an arrow: Inter as fontsource ships it has no arrow glyphs, and
 * a PDF prints a glyph it lacks as a question mark.
 */
function metaOf(line: SheetLine): string {
  const path =
    line.fromWallet && line.toWallet
      ? `${line.fromWallet} to ${line.toWallet}`
      : line.toWallet
        ? `into ${line.toWallet}`
        : line.fromWallet
          ? `from ${line.fromWallet}`
          : "";
  return [line.kind, path].filter(Boolean).join("  ·  ");
}

const heading = (sheet: StatementSheet): string => `${sheet.title}${sheet.subject ? `, ${sheet.subject}` : ""}`;

interface Columns {
  readonly date: number;
  readonly details: number;
  readonly in: number;
  readonly out: number;
  readonly balance: number;
}

export async function statementPdf(o: StatementPdfOptions): Promise<Uint8Array> {
  const { sheet } = o;
  const doc = new PdfDocument(
    {
      regular: parseTtf(fromBase64(INTER_REGULAR), "Inter-Regular"),
      bold: parseTtf(fromBase64(INTER_BOLD), "Inter-Bold"),
    },
    {
      title: `${heading(sheet)}, ${sheet.period}`,
      author: o.issuedBy || undefined,
      producer: SYSTEM_NAME,
    },
  );

  const showIn = !!sheet.headings.moneyIn;
  const showOut = !!sheet.headings.moneyOut;
  const detailsW = CONTENT_W - DATE_W - BALANCE_W - (showIn ? MONEY_W : 0) - (showOut ? MONEY_W : 0);
  // The right edge of each money column, less a gutter before the next.
  const x: Columns = {
    date: MARGIN + INSET,
    details: MARGIN + DATE_W,
    in: MARGIN + DATE_W + detailsW + MONEY_W - 10,
    out: MARGIN + DATE_W + detailsW + (showIn ? MONEY_W : 0) + MONEY_W - 10,
    balance: MARGIN + CONTENT_W - INSET,
  };
  const bottom = PAGE_H - MARGIN - FOOTER;

  let page = doc.addPage(PAGE_W, PAGE_H);
  let y = header(page, doc, o);
  y = summary(page, sheet, y);
  y = tableHead(page, sheet, x, y);

  const newPage = (): void => {
    page = doc.addPage(PAGE_W, PAGE_H);
    y = continuation(page, sheet);
    y = tableHead(page, sheet, x, y);
  };

  const money = (value: Centavos, right: number, base: number, font: FontName, blankZero: boolean): void => {
    if (value === 0 && blankZero) return;
    page.text(right, base, formatAmount(value), { size: BODY, font, align: "right", color: value < 0 ? RED : INK });
  };

  // Where the running figure starts.
  if (sheet.broughtForward !== null) {
    const h = LINE + PAD_Y * 2;
    if (y + h > bottom) newPage();
    page.rect(MARGIN, y, CONTENT_W, h, TINT);
    const base = y + PAD_Y + LINE - 2.4;
    page.text(x.date, base, shortDate(sheet.from), { size: BODY, color: INK_2 });
    page.text(x.details, base, "Balance brought forward", { size: BODY, font: "bold", color: INK });
    money(sheet.broughtForward, x.balance, base, "bold", false);
    y += h;
    page.line(MARGIN, y, MARGIN + CONTENT_W, y, RULE, 0.5);
  }

  if (sheet.lines.length === 0) {
    const h = LINE + PAD_Y * 2;
    page.text(x.details, y + PAD_Y + LINE - 2.4, "No entries in this period.", { size: BODY, color: INK_2 });
    y += h;
    page.line(MARGIN, y, MARGIN + CONTENT_W, y, RULE, 0.5);
  }

  for (const line of sheet.lines) {
    const desc = wrap(doc, line.description, "regular", BODY, detailsW - 12, 2);
    const meta = metaOf(line);
    const metaText = meta ? (wrap(doc, meta, "regular", META, detailsW - 12, 1)[0] ?? "") : "";
    const h = PAD_Y * 2 + desc.length * LINE + (metaText ? META_LINE : 0);
    if (y + h > bottom) newPage();

    const first = y + PAD_Y + LINE - 2.4;
    page.text(x.date, first, shortDate(line.date), { size: BODY, color: INK_2 });
    desc.forEach((l, i) => page.text(x.details, first + i * LINE, l, { size: BODY, color: INK }));
    if (metaText) page.text(x.details, first + desc.length * LINE - 0.5, metaText, { size: META, color: INK_3 });
    if (showIn) money(line.moneyIn, x.in, first, "regular", true);
    if (showOut) money(line.moneyOut, x.out, first, "regular", true);
    if (line.balance !== null) money(line.balance, x.balance, first, "regular", false);

    y += h;
    page.line(MARGIN, y, MARGIN + CONTENT_W, y, RULE, 0.5);
  }

  // Totals, between two firm rules.
  {
    const h = LINE + PAD_Y * 2 + 2;
    if (y + h > bottom) newPage();
    page.line(MARGIN, y, MARGIN + CONTENT_W, y, INK, 0.9);
    const base = y + PAD_Y + LINE - 1;
    page.text(x.details, base, "Totals", { size: BODY, font: "bold", color: INK });
    if (showIn) money(sheet.totalIn, x.in, base, "bold", false);
    if (showOut) money(sheet.totalOut, x.out, base, "bold", false);
    money(sheet.closing, x.balance, base, "bold", false);
    y += h;
    page.line(MARGIN, y, MARGIN + CONTENT_W, y, INK, 0.9);
  }

  // Notes, then the closing line.
  const notes = ["Amounts are in Philippine pesos (₱). A blank money cell means nothing moved that way.", ...sheet.notes].flatMap(
    (n) => wrap(doc, n, "regular", 7, CONTENT_W, 4),
  );
  const closingHeight = 16 + notes.length * 9.5 + 34;
  if (y + closingHeight > bottom) {
    page = doc.addPage(PAGE_W, PAGE_H);
    y = continuation(page, sheet);
  }
  y += 16;
  for (const n of notes) {
    page.text(MARGIN, y, n, { size: 7, color: INK_3 });
    y += 9.5;
  }
  y += 18;
  const closing = "**Nothing Follows**";
  const w = doc.width(closing, "bold", 8.5);
  page.text(PAGE_W / 2, y, closing, { size: 8.5, font: "bold", color: INK_2, align: "center" });
  page.line(MARGIN, y - 3, PAGE_W / 2 - w / 2 - 12, y - 3, RULE, 0.6);
  page.line(PAGE_W / 2 + w / 2 + 12, y - 3, MARGIN + CONTENT_W, y - 3, RULE, 0.6);

  // Footers, now the page count is known.
  doc.pages.forEach((p, i) => footer(p, i + 1, doc.pages.length, sheet));

  return doc.bytes(o.issuedAt, { compress: o.compress !== false });
}

/** The system's mark: the app icon, drawn rather than pasted. */
function logo(page: PdfPage, left: number, top: number, size: number, square: Rgb, strokes: Rgb): void {
  const u = size / 32;
  page.roundRect(left, top, size, size, 7 * u, square);
  page.stroke(left + 11 * u, top + 9 * u, left + 22 * u, top + 9 * u, strokes, 2.6 * u);
  page.stroke(left + 11 * u, top + 15.5 * u, left + 22 * u, top + 15.5 * u, strokes, 2.6 * u);
  page.stroke(left + 11 * u, top + 22 * u, left + 17 * u, top + 22 * u, strokes, 2.6 * u);
}

/** The green band on the first page. Returns where what follows starts. */
function header(page: PdfPage, doc: PdfDocument, o: StatementPdfOptions): number {
  const { sheet } = o;
  const details: [string, string][] = [
    ["Period", sheet.period],
    ["Date issued", issuedLabel(o.issuedAt)],
    ...(o.issuedTo.trim() ? ([["Issued to", o.issuedTo.trim()]] as [string, string][]) : []),
    ...(o.issuedBy.trim() ? ([["Issued by", o.issuedBy.trim()]] as [string, string][]) : []),
  ];
  const pad = 20;
  const blockW = 212;
  const bx = MARGIN + CONTENT_W - pad - blockW;
  const left = pad + (sheet.subject ? 66 : 50);
  const right = pad + 10 + (details.length - 1) * 15 + 6;
  const height = Math.max(left, right) + pad - 4;
  page.rect(MARGIN, MARGIN, CONTENT_W, height, GREEN);

  // Left: the system, then what this is, as large as fits beside the details.
  logo(page, MARGIN + pad, MARGIN + pad - 2, 16, WHITE, GREEN);
  page.text(MARGIN + pad + 22, MARGIN + pad + 9.8, SYSTEM_NAME, { font: "bold", size: 8.5, color: WHITE });
  const title = sheet.title.toUpperCase();
  const room = bx - (MARGIN + pad) - 18;
  const size = Math.min(22, (22 * room) / Math.max(1, doc.width(title, "bold", 22)));
  page.text(MARGIN + pad, MARGIN + pad + 44, title, { font: "bold", size, color: WHITE });
  if (sheet.subject) page.text(MARGIN + pad, MARGIN + pad + 62, sheet.subject, { font: "bold", size: 11, color: GREEN_SOFT });

  // Right: when, and for whom.
  details.forEach(([label, value], i) => {
    const base = MARGIN + pad + 9.8 + i * 15;
    page.text(bx, base, label, { size: 7.5, color: GREEN_SOFT });
    const shown = wrap(doc, value, "bold", 8.5, blockW - 64, 1)[0] ?? "";
    page.text(bx + 64, base, shown, { size: 8.5, font: "bold", color: WHITE });
  });

  return MARGIN + height + 14;
}

/** Where it started, what moved, where it ended: the figures under the band. */
function summary(page: PdfPage, sheet: StatementSheet, top: number): number {
  const boxes: [string, Centavos | string][] = [];
  if (sheet.broughtForward !== null) boxes.push(["Brought forward", sheet.broughtForward]);
  else boxes.push(["Entries", sheet.lines.length.toLocaleString("en-US")]);
  if (sheet.headings.moneyIn) boxes.push([sheet.headings.moneyIn, sheet.totalIn]);
  if (sheet.headings.moneyOut) boxes.push([sheet.headings.moneyOut, sheet.totalOut]);
  // Where a running balance is carried, where it ended. On a sheet that only
  // adds up (income, bills), the running total is the total already shown.
  if (sheet.broughtForward !== null) boxes.push([`Closing ${sheet.headings.balance.toLowerCase()}`, sheet.closing]);

  const gap = 8;
  const w = (CONTENT_W - gap * (boxes.length - 1)) / boxes.length;
  const h = 40;
  boxes.forEach(([label, value], i) => {
    const left = MARGIN + i * (w + gap);
    const last = i === boxes.length - 1;
    page.rect(left, top, w, h, last ? GREEN : TINT);
    page.text(left + 10, top + 14, label, { size: 7, color: last ? GREEN_SOFT : INK_2 });
    const shown = typeof value === "number" ? formatMoney(value) : value;
    page.text(left + 10, top + 31, shown, {
      size: 12.5,
      font: "bold",
      color: last ? WHITE : typeof value === "number" && value < 0 ? RED : INK,
    });
  });
  return top + h + 16;
}

/** The top of every page after the first. */
function continuation(page: PdfPage, sheet: StatementSheet): number {
  logo(page, MARGIN, MARGIN, 14, GREEN, WHITE);
  page.text(MARGIN + 20, MARGIN + 10.5, SYSTEM_NAME, { font: "bold", size: 8, color: INK });
  page.text(MARGIN + CONTENT_W, MARGIN + 10.5, `${heading(sheet)} · ${sheet.period}`, { size: 8, color: INK_2, align: "right" });
  return MARGIN + 26;
}

function tableHead(page: PdfPage, sheet: StatementSheet, x: Columns, top: number): number {
  const h = 20;
  page.rect(MARGIN, top, CONTENT_W, h, GREEN);
  const base = top + 13;
  const o = { font: "bold" as const, size: 7.5, color: WHITE };
  page.text(x.date + 0, base, "Date", o);
  page.text(x.details, base, "Details", o);
  if (sheet.headings.moneyIn) page.text(x.in, base, sheet.headings.moneyIn, { ...o, align: "right" });
  if (sheet.headings.moneyOut) page.text(x.out, base, sheet.headings.moneyOut, { ...o, align: "right" });
  page.text(x.balance, base, sheet.headings.balance, { ...o, align: "right" });
  return top + h;
}

function footer(page: PdfPage, number: number, count: number, sheet: StatementSheet): void {
  const base = PAGE_H - MARGIN - 6;
  page.line(MARGIN, base - 12, MARGIN + CONTENT_W, base - 12, RULE, 0.5);
  logo(page, MARGIN, base - 7.5, 9, GREEN, WHITE);
  page.text(MARGIN + 13, base, SYSTEM_NAME, { size: 7, color: INK_3 });
  page.text(PAGE_W / 2, base, `${heading(sheet)} · ${sheet.period}`, { size: 7, color: INK_3, align: "center" });
  page.text(MARGIN + CONTENT_W, base, `Page ${number} of ${count}`, { size: 7, color: INK_3, align: "right" });
}
