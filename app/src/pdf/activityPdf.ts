/**
 * The activity trail as a PDF.
 *
 * The owner, 26 October 2026: "i can export it as pdf with all details also
 * make the ui cleaner in pdf". It is drawn the way the statement is, which
 * the owner shaped over three rounds (`statementPdf.ts`): the title in a
 * green band with the details beside it, the counts in boxes under it, a
 * green heading row, text left and figures right, rules only between rows,
 * nothing above the title and the system's name only in the small print.
 *
 * Each change is one row: its time, what happened, who, and the amount. Under
 * what happened, small and grey: what kind of change, how it came in, the
 * entry it was about, and, for an edit, each field from what it was to what
 * it became. A day starts with a tinted line naming it, so a long trail is
 * read day by day.
 */

import type { ActivityEvent } from "../domain/activity";
import { changesOf, dayInFull, eventDay, kindOf, timeOfDay, trailSummary, VIA_WORDS, type TrailSummary } from "../domain/activityExport";
import { readRow } from "../domain/activityRead";
import { MONTH_NAMES, MONTH_NAMES_SHORT } from "../domain/dates";
import { formatAmount, parseAmount } from "../domain/money";
import { INTER_BOLD, INTER_REGULAR } from "./fonts";
import {
  CONTENT_W,
  FOOTER,
  GREEN,
  GREEN_SOFT,
  INK,
  INK_2,
  INK_3,
  issuedLabel,
  MARGIN,
  PAGE_H,
  PAGE_W,
  RULE,
  SYSTEM_NAME,
  TINT,
  WHITE,
  wrap,
} from "./statementPdf";
import { fromBase64, parseTtf, PdfDocument, type PdfPage } from "./writer";

const BODY = 8;
const META = 6.8;
const LINE = 10;
const META_LINE = 9;
const PAD_Y = 4.5;
const INSET = 8;

const TIME_W = 52;
const WHO_W = 58;
const AMOUNT_W = 70;

export interface ActivityPdfOptions {
  /** Newest first, already filtered as the screen shows them. */
  readonly events: readonly ActivityEvent[];
  /** What the filters hold, in words: "Everyone, all changes". */
  readonly showing: string;
  readonly issuedTo: string;
  readonly issuedAt: Date;
  /** Tests read the page contents; a download is always compressed. */
  readonly compress?: boolean;
}

/** "October 20 to 26, 2026", "September 30 to October 26, 2026". */
export function spanWords(s: TrailSummary): string {
  if (!s.from || !s.to) return "No changes";
  const [fy, fm, fd] = s.from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = s.to.split("-").map(Number) as [number, number, number];
  const f = `${MONTH_NAMES[fm - 1]} ${fd}`;
  if (s.from === s.to) return `${f}, ${fy}`;
  if (fy !== ty) return `${f}, ${fy} to ${MONTH_NAMES[tm - 1]} ${td}, ${ty}`;
  return fm === tm ? `${f} to ${td}, ${ty}` : `${f} to ${MONTH_NAMES[tm - 1]} ${td}, ${ty}`;
}

/** "Sep 20, 2026". */
function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return y && m && d ? `${MONTH_NAMES_SHORT[m - 1] ?? ""} ${d}, ${y}` : iso;
}

/** The figure a change was about: the entry's amount, or the event's own. */
function amountOf(e: ActivityEvent): number | null {
  const facts = readRow(e.after ?? e.before);
  const said = facts?.amount ? parseAmount(facts.amount.replace(/^PHP\s*/, "")) : null;
  return said ?? e.amount ?? null;
}

/** The grey lines under what happened. Words, not arrows: Inter as shipped has no arrow glyph. */
function metaLines(e: ActivityEvent): string[] {
  const facts = readRow(e.after ?? e.before);
  const entry = facts
    ? [
        e.recordNumber !== undefined ? `#${String(e.recordNumber).padStart(4, "0")}` : "",
        facts.type,
        facts.item,
        facts.from && facts.to ? `${facts.from} to ${facts.to}` : facts.from ? `from ${facts.from}` : facts.to ? `into ${facts.to}` : "",
        facts.date ? `for ${facts.date.split(" to ").map((d) => shortDay(d.trim())).join(" to ")}` : "",
        facts.fee ? `fee ${facts.fee.replace(/^PHP\s*/, "₱")}` : "",
        facts.status,
      ]
        .filter(Boolean)
        .join("  ·  ")
    : "";
  const how = [kindOf(e.action), VIA_WORDS[e.via] ?? e.via, e.model ?? ""].filter(Boolean).join("  ·  ");
  const edits = changesOf(e).map((c) => `${c.label}: ${(c.before || "blank").replace(/^PHP\s*/, "₱")} to ${(c.after || "blank").replace(/^PHP\s*/, "₱")}`);
  return [how, entry, ...edits].filter(Boolean);
}

export async function activityPdf(o: ActivityPdfOptions): Promise<Uint8Array> {
  const summary = trailSummary(o.events);
  const period = spanWords(summary);
  const doc = new PdfDocument(
    {
      regular: parseTtf(fromBase64(INTER_REGULAR), "Inter-Regular"),
      bold: parseTtf(fromBase64(INTER_BOLD), "Inter-Bold"),
    },
    { title: `Activity trail, ${period}`, author: o.issuedTo || undefined, producer: SYSTEM_NAME },
  );

  const whatW = CONTENT_W - TIME_W - WHO_W - AMOUNT_W;
  const x = {
    time: MARGIN + INSET,
    what: MARGIN + TIME_W,
    who: MARGIN + TIME_W + whatW + 6,
    amount: MARGIN + CONTENT_W - INSET,
  };
  const bottom = PAGE_H - MARGIN - FOOTER;

  let page = doc.addPage(PAGE_W, PAGE_H);
  let y = header(page, doc, o, summary, period);
  y = boxes(page, summary, y);
  y = tableHead(page, x, y);

  const newPage = (): void => {
    page = doc.addPage(PAGE_W, PAGE_H);
    page.text(MARGIN, MARGIN + 10.5, "Activity trail", { font: "bold", size: 8.5, color: INK });
    page.text(MARGIN + CONTENT_W, MARGIN + 10.5, `${period} (continued)`, { size: 8, color: INK_2, align: "right" });
    y = tableHead(page, x, MARGIN + 22);
  };

  if (o.events.length === 0) {
    const h = LINE + PAD_Y * 2;
    page.text(x.what, y + PAD_Y + LINE - 2.4, "No changes in what is shown.", { size: BODY, color: INK_2 });
    y += h;
    page.line(MARGIN, y, MARGIN + CONTENT_W, y, RULE, 0.5);
  }

  let day = "";
  for (const e of o.events) {
    const today = eventDay(e.at);
    if (today !== day) {
      day = today;
      const count = o.events.filter((x2) => eventDay(x2.at) === today).length;
      const h = LINE + PAD_Y * 2;
      // A day's line never sits alone at the foot of a page.
      if (y + h + LINE * 2 + PAD_Y * 2 > bottom) newPage();
      page.rect(MARGIN, y, CONTENT_W, h, TINT);
      const base = y + PAD_Y + LINE - 2.4;
      page.text(x.time, base, dayInFull(today), { size: BODY, font: "bold", color: INK });
      page.text(x.amount, base, `${count} ${count === 1 ? "change" : "changes"}`, { size: META, color: INK_2, align: "right" });
      y += h;
      page.line(MARGIN, y, MARGIN + CONTENT_W, y, RULE, 0.5);
    }

    const what = wrap(doc, e.summary, "regular", BODY, whatW - 12, 12);
    const meta = metaLines(e).flatMap((m) => wrap(doc, m, "regular", META, whatW - 12, 4));
    const h = PAD_Y * 2 + what.length * LINE + meta.length * META_LINE;
    if (y + h > bottom) newPage();
    const first = y + PAD_Y + LINE - 2.4;
    page.text(x.time, first, timeOfDay(e.at), { size: BODY, color: INK_2 });
    what.forEach((l, i) => page.text(x.what, first + i * LINE, l, { size: BODY, color: INK }));
    meta.forEach((m, i) => page.text(x.what, first + what.length * LINE - 0.5 + i * META_LINE, m, { size: META, color: INK_3 }));
    page.text(x.who, first, e.actor === "ai" ? "Assistant" : "You", { size: BODY, color: INK_2 });
    const amount = amountOf(e);
    if (amount !== null) page.text(x.amount, first, formatAmount(amount), { size: BODY, color: INK, align: "right" });
    y += h;
    page.line(MARGIN, y, MARGIN + CONTENT_W, y, RULE, 0.5);
  }

  const notes = [
    "Amounts are in pesos (₱). Times are on the clock of the device that made this file.",
    "The trail is append only: nothing in it can be edited or deleted. Under each change: what kind it was, how it came in, the entry it was about, and for an edit each field from what it was to what it became.",
    `Showing: ${o.showing}.`,
  ].flatMap((n) => wrap(doc, n, "regular", 7, CONTENT_W, 6));
  if (y + 16 + notes.length * 9.5 + 34 > bottom) {
    newPage();
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

  doc.pages.forEach((p, i) => {
    const base = PAGE_H - MARGIN - 6;
    p.line(MARGIN, base - 12, MARGIN + CONTENT_W, base - 12, RULE, 0.5);
    p.text(MARGIN, base, SYSTEM_NAME, { size: 7, color: INK_3 });
    p.text(PAGE_W / 2, base, `Activity trail · ${period}`, { size: 7, color: INK_3, align: "center" });
    p.text(MARGIN + CONTENT_W, base, `Page ${i + 1} of ${doc.pages.length}`, { size: 7, color: INK_3, align: "right" });
  });

  return doc.bytes(o.issuedAt, { compress: o.compress !== false });
}

/** The green band: the title, what is shown, and the details beside them. */
function header(page: PdfPage, doc: PdfDocument, o: ActivityPdfOptions, s: TrailSummary, period: string): number {
  const details: [string, string][] = [
    ["Period", period],
    ["Date issued", issuedLabel(o.issuedAt)],
    ...(o.issuedTo.trim() ? ([["Issued to", o.issuedTo.trim()]] as [string, string][]) : []),
    ["Changes", s.total.toLocaleString("en-US")],
  ];
  const pad = 16;
  const blockW = 212;
  const bx = MARGIN + CONTENT_W - pad - blockW;
  const row = 14;
  const title = "ACTIVITY TRAIL";
  const room = bx - (MARGIN + pad) - 18;
  const size = Math.min(22, (22 * room) / Math.max(1, doc.width(title, "bold", 22)));
  const titleBlock = size * 0.75 + 18;
  const detailsBlock = (details.length - 1) * row + 8;
  const inner = Math.max(titleBlock, detailsBlock);
  const height = inner + pad * 2;
  page.rect(MARGIN, MARGIN, CONTENT_W, height, GREEN);
  const titleTop = MARGIN + pad + (inner - titleBlock) / 2;
  page.text(MARGIN + pad, titleTop + size * 0.75, title, { font: "bold", size, color: WHITE });
  page.text(MARGIN + pad, titleTop + size * 0.75 + 16, wrap(doc, o.showing, "bold", 10.5, room, 1)[0] ?? "", { font: "bold", size: 10.5, color: GREEN_SOFT });
  const detailsTop = MARGIN + pad + (inner - detailsBlock) / 2;
  details.forEach(([label, value], i) => {
    const base = detailsTop + 7 + i * row;
    page.text(bx, base, label, { size: 7.5, color: GREEN_SOFT });
    page.text(bx + 64, base, wrap(doc, value, "bold", 8.5, blockW - 64, 1)[0] ?? "", { size: 8.5, font: "bold", color: WHITE });
  });
  return MARGIN + height + 12;
}

/** The counts under the band, the whole trail shown in the last, green one. */
function boxes(page: PdfPage, s: TrailSummary, top: number): number {
  const items: [string, number][] = [
    ["Added", s.added],
    ["Edited", s.edited],
    ["Binned or restored", s.binnedOrRestored],
    ["Budget and settings", s.budgetOrSettings],
    ["By the assistant", s.byAssistant],
    ["All changes", s.total],
  ];
  const gap = 8;
  const w = (CONTENT_W - gap * (items.length - 1)) / items.length;
  const h = 40;
  items.forEach(([label, value], i) => {
    const left = MARGIN + i * (w + gap);
    const last = i === items.length - 1;
    page.rect(left, top, w, h, last ? GREEN : TINT);
    page.text(left + 9, top + 14, label, { size: 6.6, color: last ? GREEN_SOFT : INK_2 });
    page.text(left + 9, top + 31, value.toLocaleString("en-US"), { size: 12.5, font: "bold", color: last ? WHITE : INK });
  });
  return top + h + 16;
}

function tableHead(page: PdfPage, x: { time: number; what: number; who: number; amount: number }, top: number): number {
  const h = 20;
  page.rect(MARGIN, top, CONTENT_W, h, GREEN);
  const base = top + 13;
  const o = { font: "bold" as const, size: 7.5, color: WHITE };
  page.text(x.time, base, "Time", o);
  page.text(x.what, base, "What happened", o);
  page.text(x.who, base, "Who", o);
  page.text(x.amount, base, "Amount", { ...o, align: "right" });
  return top + h;
}
