/**
 * A shop receipt, checked by its own arithmetic.
 *
 * ── Why a receipt needs checking at all ───────────────────────────────────
 *
 * A receipt prints the amount paid once and five other figures around it,
 * and most of them are larger or look more final. The owner's receipt of
 * 28 September 2026 printed 109.00 as the total, with 200.00 cash handed
 * over, 91.00 change, 97.32 VATable sales and 11.68 VAT. Read on the phone,
 * the photo's curl put each figure on the line above its label ("Total
 * 200.00", "CASH 91.00"), and one reading turned 97.32 into 91.32. A reader
 * that trusts labels, or the largest figure, gets that receipt wrong, and so
 * does a model handed the same text.
 *
 * What a receipt cannot fake is its arithmetic. The cash less the change is
 * the total. VATable sales plus VAT is the total, and the VAT is twelve
 * parts in 112 of it. The items add up to it. A subtotal less its discounts
 * plus its service charge is it. So every figure on the receipt is tried as
 * the total, and the one the most of those checks agree on wins. Labels
 * count, but they break ties rather than decide, because the labels are
 * exactly what a curled photo misplaces.
 *
 * Layouts this is written for (see `receipt.test.ts`, one case each):
 * supermarket and convenience store tapes, fast food, a pharmacy with a
 * senior citizen's discount, a restaurant bill with a service charge, a
 * fuel receipt, a delivery app and an online order, BIR official receipts
 * and sales invoices, and a card or e-wallet payment with no change.
 *
 * Pure, on text, so it runs the same on the device and in a test.
 */

import { approvalIn } from "./cardSlip";
import type { Centavos } from "./money";
import type { IsoDate } from "./types";

/** What a figure on a receipt is, going by the words beside it. */
type Role =
  | "total"
  | "subtotal"
  | "tendered"
  | "change"
  | "vatable"
  | "vat"
  | "exempt"
  | "discount"
  | "service"
  | "delivery"
  | "count"
  | "id";

/** One figure, where it sits, and what the words around it say it is. */
interface Figure {
  readonly value: Centavos;
  readonly line: number;
  /** The label on its own line. */
  readonly role: Role | null;
  /** A label on a line next to it that has no figure of its own: a curled photo's misplaced label. */
  readonly near: readonly Role[];
  /** Printed after a peso sign or PHP. */
  readonly marked: boolean;
  /** Printed as a minus or in brackets: a discount or a refund. */
  readonly negative: boolean;
  /** Before the first subtotal, total or tax line, on a line with no label: a bought item. */
  readonly item: boolean;
  /** The last figure on its line, which on an item line is the line's own total. */
  readonly last: boolean;
  /** On an item line, what was bought, as read: its own words, or the line above when it has none. */
  readonly name: string;
}

export interface ReceiptCheck {
  /** The amount paid. */
  readonly total: Centavos;
  readonly confidence: "high" | "medium" | "low";
  /** Each check that agreed, in the owner's words, for the card and the model. */
  readonly evidence: readonly string[];
  /** The cash handed over, when a payment and its change were found. */
  readonly tendered?: Centavos;
  readonly change?: Centavos;
  readonly vatable?: Centavos;
  readonly vat?: Centavos;
  readonly subtotal?: Centavos;
  /**
   * Figures printed on the receipt that are not what was spent: the cash
   * handed over, the change, the tax parts. A reading that lands on one of
   * these is the commonest way a receipt goes wrong.
   */
  readonly notTheTotal: readonly Centavos[];
  /** How it was paid, going by the payment line. */
  readonly paidWith?: "cash" | "gcash" | "maya" | "card";
  /** A card payment's approval code, which the terminal's slip prints too (`cardSlip.ts`). */
  readonly approval?: string;
  /** The printed date, when one was found. */
  readonly date?: IsoDate;
  /** True when the date could be read two ways (09/08: month first is used, as on Philippine receipts). */
  readonly dateAmbiguous?: boolean;
  readonly time?: string;
  /**
   * What was bought, as the device read it, misread letters and all
   * ("bY lt FUSER HOMI oun WOOD AND ANTAL" for a reed diffuser, oud wood and
   * santal). The model is told to read through the misreadings.
   */
  readonly bought: readonly string[];
}

/**
 * A figure with its two decimals. Never inside a longer number or a date:
 * 28.09.2026 is a day, not twenty eight pesos.
 */
const FIGURE = /(-|\()?\s*(₱\s*)?(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)[.,](\d{2})(?![\d,]|\.\d)\)?/g;

/**
 * Labels, tolerant of the letters a thermal printer and a phone camera
 * lose: 0 for O, 1 or I for L, a dropped letter here and there. Each was
 * seen in a real reading ("EXEWPT SALED", "JERD RATED", "VAT AMT11.68").
 */
const LABELS: readonly (readonly [Role, RegExp])[] = [
  ["change", /\bchan[gq]e\b|\bchng\b|\bsukli\b/],
  ["subtotal", /\bsub[\s-]?t[o0]ta[l1i]\b|\bsubtt?l\b/],
  ["exempt", /ex[e3][mw]pt|z[e3]r[o0][\s-]?rated|rated\s*sal/],
  // A thermal printer's V is read as U as often as not: "UATable Sales", "UAT Amount" (29 September 2026).
  ["vatable", /\b[vu]at[\s-]?able\b|\b[vu]at(?:able)?\s*sal[e3]s?\b|\bnet\s*of\s*[vu]at\b|\b[vu]at\s*exclusive\b/],
  ["discount", /disc|\bless\b|\bsenior\b|\bpwd\b|\bvoucher\b|\bpromo\b|\bcoupon\b|\bsavings?\b|\brebate\b/],
  ["total", /\bgrand\s*t[o0]ta[l1i]\b|\bamount\s*due\b|\bamt\s*due\b|\bt[o0]ta[l1i]\b(?!\s*(?:qty|quantity|items?|disc|savings?|vat|tax|no\b))|\bnet\s*amount\b|\bamount\s*payable\b|\bbalance\s*due\b/],
  ["vat", /\b[vu]at\b|\b12\s*%|\bv\.a\.t\b|\btax\b/],
  ["service", /\bservice\s*(?:charge|chg)\b|\bsvc\b|\bs\/c\b|\bfees?\b/],
  ["delivery", /\bdeliver|\bshipping\b|\bship\s*fee\b/],
  ["tendered", /\bcash\b|\btender|\bpayment\b|\bamount\s*paid\b|\bpaid\b|\breceived\b|\bg-?cash\b|\bmaya\b|\bpaymaya\b|\bcard\b|\bvisa\b|\bmaster\s*card\b|\bdebit\b|\bcredit\b|\bqr\s*ph\b|\be-?wallet\b/],
  ["count", /\bitem\(?s?\)?\b|\bqty\b|\bquantity\b|\bno\.?\s*of\b|\bpcs\b/],
  ["id", /\btin\b|\binvoice\b|\binv\b|\bo\.?r\.?\s*(?:no|#)|\bs\.?i\.?\s*(?:no|#)|\bref\b|\btrans|\btxn\b|\bterminal\b|\bmin\b|\bserial\b|\bpermit\b|\bacct?\b|\bphone\b|\btel\b|\bcontact\b|\bptu\b|\bacc\b|\bsn\b/],
];

/** The label a line carries, first match in the order above. */
function roleOf(words: string): Role | null {
  for (const [role, pattern] of LABELS) if (pattern.test(words)) return role;
  return null;
}

/** A line's words, without its figures. "CASH200.00" is CASH, "VAT AMT11.68" is VAT AMT. */
function wordsOf(line: string): string {
  return line
    .toLowerCase()
    .replace(FIGURE, " ")
    .replace(/[^a-z0-9%/.#()\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const hasLetters = (words: string): boolean => /[a-z]{3,}/.test(words);

/** A line's words as printed, without its figures, codes or stray marks. */
function plainWords(line: string): string {
  return line
    .replace(FIGURE, " ")
    .replace(/\b\d{5,}\b/g, " ")
    .replace(/[^A-Za-z0-9&%/.' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** Every figure in the text, with what the words around it say. */
function figuresOf(text: string): Figure[] {
  const lines = text.split(/\r?\n/);
  const words = lines.map(wordsOf);
  const roles = words.map(roleOf);
  const counts = lines.map((l) => [...l.matchAll(FIGURE)].length);

  // The first line that closes the item list: after it, a figure is never a bought item.
  const closes = roles.findIndex((r) => r === "subtotal" || r === "total" || r === "vatable" || r === "vat" || r === "tendered");
  const end = closes < 0 ? lines.length : closes;

  const out: Figure[] = [];
  lines.forEach((line, i) => {
    const found = [...line.matchAll(FIGURE)];
    /*
     * A label on a line with no figure lends itself to the figure next to
     * it, above or below: the curl of a receipt photo moves one or the other
     * by a line, and which way depends on how it was held.
     */
    const near = [i - 1, i + 1].flatMap((j) => {
      const r = roles[j];
      return r && (counts[j] ?? 0) === 0 ? [r] : [];
    });
    const role = roles[i] ?? null;
    found.forEach((m, k) => {
      const pesos = Number((m[3] ?? "0").replace(/,/g, ""));
      out.push({
        value: pesos * 100 + Number(m[4] ?? "0"),
        line: i,
        role,
        near,
        // "PHP 109.00", "pHP 109.00" and "P109.00" all read as a peso sign.
        marked: Boolean(m[2]) || /\b(?:php|p)\s*$/i.test(line.slice(0, m.index ?? 0)),
        negative: Boolean(m[1]),
        item: i < end && role === null && (hasLetters(words[i] ?? "") || hasLetters(words[i - 1] ?? "")),
        last: k === found.length - 1,
        name: plainWords(hasLetters(words[i] ?? "") ? line : (lines[i - 1] ?? "")),
      });
    });
  });
  return out;
}

const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1;

/** How a receipt printed its payment, if it did. */
function paidWithOf(text: string): ReceiptCheck["paidWith"] {
  const lower = text.toLowerCase();
  /*
   * A card first: "PAYMAYA CREDIT CARD 2,082.00" names the company whose
   * terminal took the card, not the account it came out of. Any bank's card
   * on a Maya terminal prints the same line (29 September 2026).
   */
  if (/\b(?:credit|debit)\s*card\b|\bvisa\b|\bmaster\s*card\b/.test(lower)) return "card";
  if (/\bg-?cash\b/.test(lower)) return "gcash";
  if (/\b(?:pay)?maya\b/.test(lower)) return "maya";
  if (/\b(?:visa|master\s*card|debit|credit\s*card|card)\b/.test(lower)) return "card";
  // CASHIER is not a payment; CASH on its own line, or before a figure, is.
  if (/(?:^|\n)\W*cash\b(?!ier)/i.test(text) || /\bcash\s*(?:tendered|received|payment)\b/.test(lower)) return "cash";
  return undefined;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The date a receipt was printed, month first where the two readings differ, as Philippine receipts print it. */
function dateOf(text: string, asOf: IsoDate): { date: IsoDate; ambiguous: boolean } | null {
  const valid = (y: number, m: number, d: number): IsoDate | null => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const at = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(at.getTime()) || at.getUTCDate() !== d) return null;
    // A receipt is from the past, and rarely more than a year of it.
    const days = (Date.parse(`${asOf}T00:00:00Z`) - at.getTime()) / 86_400_000;
    return days >= -1 && days <= 400 ? iso : null;
  };
  const year = (y: string): number => (y.length === 2 ? 2000 + Number(y) : Number(y));

  for (const m of text.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    const iso = valid(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) return { date: iso, ambiguous: false };
  }
  const month = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
  for (const m of text.toLowerCase().matchAll(new RegExp(`\\b(\\d{1,2})[\\s-]*${month}[\\s,-]*(\\d{2,4})\\b`, "g"))) {
    const iso = valid(year(m[3] ?? ""), MONTHS.indexOf(m[2] ?? "") + 1, Number(m[1]));
    if (iso) return { date: iso, ambiguous: false };
  }
  for (const m of text.toLowerCase().matchAll(new RegExp(`\\b${month}\\s*(\\d{1,2}),?\\s*(\\d{4})\\b`, "g"))) {
    const iso = valid(Number(m[3]), MONTHS.indexOf(m[1] ?? "") + 1, Number(m[2]));
    if (iso) return { date: iso, ambiguous: false };
  }
  for (const m of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = year(m[3] ?? "");
    const monthFirst = valid(y, a, b);
    const dayFirst = valid(y, b, a);
    if (monthFirst) return { date: monthFirst, ambiguous: Boolean(dayFirst) && a !== b };
    if (dayFirst) return { date: dayFirst, ambiguous: false };
  }
  return null;
}

function timeOf(text: string): string | undefined {
  const m = /\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\s*(am|pm)?\b/i.exec(text);
  if (!m) return undefined;
  let hour = Number(m[1]);
  const half = (m[3] ?? "").toLowerCase();
  if (half === "pm" && hour < 12) hour += 12;
  if (half === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${m[2]}`;
}

const show = (c: Centavos): string =>
  (c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The receipt in one or more readings of the same picture, or null when the
 * text is not a shop receipt.
 *
 * Every reading's figures are pooled: one reading can hold the 97.32 that
 * another turned into 91.32, and the checks find the one that adds up.
 */
export function readReceipt(readings: readonly string[], asOf: IsoDate): ReceiptCheck | null {
  const texts = readings.filter((t) => t.trim());
  if (texts.length === 0) return null;
  const every = texts.flatMap(figuresOf);
  const all = every.filter((f) => f.value > 0);
  if (all.length === 0) return null;

  const has = (f: Figure, role: Role): boolean => f.role === role || (f.role === null && f.near.includes(role));
  /** Its own label, or a neighbour's even over its own: the reading of a curled photo, where every label slid a line. */
  const loosely = (f: Figure, role: Role): boolean => f.role === role || f.near.includes(role);
  const withRole = (role: Role): Figure[] => all.filter((f) => has(f, role));
  const values = (list: readonly Figure[]): Centavos[] => [...new Set(list.map((f) => f.value))];

  /*
   * A shop receipt, and not a wallet's list or a transfer confirmation.
   * Those have their own rules in the extract instruction, and a check that
   * fired on them could move a row's amount. A shop receipt prints tax,
   * change, a subtotal or a cash line; a GCash send confirmation and a
   * wallet's history print none of them, however often they say GCash.
   */
  const joined = texts.join("\n");
  const cashLine = /(?:^|\n)\W*cash\b(?!ier)|\bcash\s*(?:tendered|received|payment)\b/i.test(joined);
  const shop =
    withRole("vat").length + withRole("vatable").length + withRole("exempt").length > 0 ||
    every.some((f) => has(f, "change")) ||
    withRole("subtotal").length > 0 ||
    cashLine;
  const markers = [
    shop,
    /\b(?:cashier|receipt|invoice|o\.?r\.?\s*(?:no|#)|tin\b|thank\s*you|vat\s*reg)/i.test(joined),
    withRole("total").length > 0,
    every.some((f) => has(f, "change")) && withRole("tendered").length > 0,
  ].filter(Boolean).length;
  if (!shop || markers < 2) return null;

  const tenders = values(withRole("tendered"));
  const changes = values(withRole("change"));
  const loose = (role: Role): Centavos[] => values(all.filter((f) => loosely(f, role)));
  const tendersLoose = loose("tendered");
  const changesLoose = loose("change");
  const noChange = every.some((f) => has(f, "change") && f.value === 0);
  const vatables = values(withRole("vatable"));
  const vats = values(withRole("vat"));
  const subtotals = values(withRole("subtotal"));
  const discounts = values(withRole("discount"));
  const extras = values([...withRole("service"), ...withRole("delivery")]);
  const everything = values(all);

  // An item line's own total is its last figure; the unit price before it is not a second item.
  const itemSums: Centavos[] = texts.map((t) =>
    figuresOf(t)
      .filter((f) => f.item && f.last && !f.negative && f.value > 0)
      .reduce((s, f) => s + f.value, 0),
  );

  interface Scored {
    readonly total: Centavos;
    readonly score: number;
    readonly checks: number;
    readonly evidence: string[];
    tendered?: Centavos;
    change?: Centavos;
    vatable?: Centavos;
    vat?: Centavos;
  }

  const scored: Scored[] = everything.map((total) => {
    const evidence: string[] = [];
    let score = 0;
    let checks = 0;
    const at = all.filter((f) => f.value === total);
    const result: Scored = { total, score: 0, checks: 0, evidence };

    if (at.some((f) => f.role === "total")) {
      score += 3;
      evidence.push(`printed as the total`);
    } else if (at.some((f) => f.role === null && f.near.includes("total"))) {
      score += 1.5;
      evidence.push(`printed next to the total's label`);
    }
    if (at.some((f) => f.marked)) score += 1;

    /*
     * The cash less the change. A label on at least one side is required,
     * so that two item prices a total apart are not taken for a payment;
     * a neighbour's label counts for less than the figure's own.
     */
    let bestPay = 0;
    for (const paid of everything) {
      for (const back of everything) {
        if (back <= 0 || paid <= back || paid - back !== total) continue;
        const paidRole = tenders.includes(paid) ? 1 : tendersLoose.includes(paid) ? 0.5 : 0;
        const backRole = changes.includes(back) ? 1 : changesLoose.includes(back) ? 0.5 : 0;
        if (paidRole + backRole === 0) continue;
        const s = 2 + paidRole + backRole;
        if (s > bestPay) {
          bestPay = s;
          result.tendered = paid;
          result.change = back;
        }
      }
    }
    if (bestPay > 0) {
      score += bestPay;
      checks += 1;
      evidence.push(`${show(result.tendered ?? 0)} paid less ${show(result.change ?? 0)} change is ${show(total)}`);
    } else if (tenders.includes(total) && (changes.length === 0 || noChange)) {
      // Paid exactly: a card, an e-wallet, or the right cash with no change.
      score += 1.5;
      checks += 1;
      result.tendered = total;
      evidence.push(`paid exactly ${show(total)}, no change`);
    }

    // VATable sales plus VAT, or VAT at twelve parts in 112.
    const vatPair = vatables.flatMap((v) => vats.filter((a) => same(v + a, total)).map((a) => [v, a] as const))[0];
    const twelfth = Math.round((total * 12) / 112);
    if (vatPair) {
      score += 3;
      checks += 1;
      result.vatable = vatPair[0];
      result.vat = vatPair[1];
      evidence.push(`VATable ${show(vatPair[0])} plus VAT ${show(vatPair[1])} is ${show(total)}`);
    } else {
      const vat = vats.find((a) => same(a, twelfth) && a > 0);
      if (vat) {
        score += 2;
        checks += 1;
        result.vat = vat;
        evidence.push(`VAT ${show(vat)} is the 12% VAT inside ${show(total)}`);
      }
      const vatable = vatables.find((v) => same(v, total - twelfth) && v > 0);
      if (vatable) {
        score += vat ? 0.5 : 1.5;
        result.vatable = vatable;
      }
    }

    // The items, added up.
    if (itemSums.some((s) => s === total)) {
      const items = all.filter((f) => f.item && f.last).length;
      score += items > 1 ? 2 : 1;
      checks += 1;
      evidence.push(items > 1 ? `the items add up to ${show(total)}` : `the one item is ${show(total)}`);
    }

    // A subtotal, less what came off it, plus what was added to it.
    for (const sub of subtotals) {
      if (sub === total) {
        if (discounts.length === 0 && extras.length === 0) score += 0.5;
        continue;
      }
      const off = discounts.reduce((s, d) => s + d, 0);
      const on = extras.reduce((s, e) => s + e, 0);
      const pieces = [
        sub - off + on,
        ...discounts.map((d) => sub - d),
        ...extras.map((e) => sub + e),
        ...discounts.flatMap((d) => extras.map((e) => sub - d + e)),
      ];
      if (pieces.some((p) => same(p, total))) {
        score += 2;
        checks += 1;
        evidence.push(`the subtotal ${show(sub)} with its discounts and charges is ${show(total)}`);
        break;
      }
    }

    /*
     * A figure only ever printed as something else is not the total: the
     * change, a tax line, a discount. The cash handed over is the total when
     * no change came back, so it is only marked down when change did.
     */
    const elsewhere = (f: Figure): boolean =>
      f.role !== null && f.role !== "total" && (f.role !== "tendered" || changes.some((c) => c > 0));
    if (at.every(elsewhere)) score -= 3;

    return { ...result, score, checks, evidence };
  });

  const best = [...scored].sort((a, b) => b.score - a.score || b.checks - a.checks || b.total - a.total)[0];
  if (!best || best.score < 3) return null;
  // A second figure as well supported leaves the receipt undecided, which is worse than no answer.
  const runnerUp = scored.filter((s) => s !== best).sort((a, b) => b.score - a.score)[0];
  if (runnerUp && runnerUp.score >= best.score) return null;

  const confidence = best.checks >= 2 ? "high" : best.checks === 1 && best.score >= 4 ? "medium" : "low";

  const notTheTotal = new Set<Centavos>();
  for (const v of [best.tendered, best.change, best.vatable, best.vat]) if (v !== undefined && v !== best.total) notTheTotal.add(v);
  for (const v of [...changes, ...vats, ...vatables]) if (v !== best.total) notTheTotal.add(v);
  if (discounts.length > 0 || extras.length > 0) for (const v of subtotals) if (v !== best.total) notTheTotal.add(v);
  // A tendered figure that is not the total, with change given, is the cash handed over.
  if (changes.some((c) => c > 0)) for (const v of tenders) if (v !== best.total) notTheTotal.add(v);

  /*
   * What was bought: each item line once. Two readings garble one line in
   * different places ("DIFFUSER ... OUD" in one, "FUSER ... WOOD" in the
   * other), so they are paired by where the line sits rather than by its
   * words, and both go to the model, which reads through them better
   * together than either alone.
   */
  /*
   * A lone letter after an item's price is the shop's tax mark (V vatable,
   * X or E exempt, Z zero rated, N not taxed), not part of its name:
   * "NatureSpngPuriDW1L 25.00V" came through as "... U" (29 September 2026).
   */
  const taxMark = (name: string): string => name.replace(/\s+[VUXZEN]\s*$/, "").trim();
  const lists = texts
    .map((t) => figuresOf(t).filter((f) => f.item && f.last && f.value > 0 && /[A-Za-z]{3,}/.test(f.name)).map((f) => taxMark(f.name)))
    .filter((l) => l.length > 0)
    .sort((a, b) => b.length - a.length);
  const bought = (lists[0] ?? []).map((name, k) => {
    const readings = [name];
    for (const other of lists.slice(1)) {
      const alt = other.length === lists[0]?.length ? other[k] : undefined;
      if (alt && !readings.some((r) => r.toLowerCase() === alt.toLowerCase())) readings.push(alt);
    }
    return readings.join(" / ");
  });

  const dated = dateOf(joined, asOf);
  const time = timeOf(joined);
  const paidWith = paidWithOf(joined);
  const approval = paidWith === "card" ? approvalIn(joined) : undefined;
  const subtotal = subtotals.find((s) => s !== best.total) ?? subtotals[0];

  return {
    total: best.total,
    confidence,
    evidence: best.evidence,
    ...(best.tendered !== undefined && best.tendered !== best.total ? { tendered: best.tendered } : {}),
    ...(best.change !== undefined ? { change: best.change } : {}),
    ...(best.vatable !== undefined ? { vatable: best.vatable } : {}),
    ...(best.vat !== undefined ? { vat: best.vat } : {}),
    ...(subtotal !== undefined ? { subtotal } : {}),
    notTheTotal: [...notTheTotal].sort((a, b) => a - b),
    ...(paidWith ? { paidWith } : {}),
    ...(approval ? { approval } : {}),
    ...(dated ? { date: dated.date, ...(dated.ambiguous ? { dateAmbiguous: true } : {}) } : {}),
    ...(time ? { time } : {}),
    bought: bought.slice(0, 6),
  };
}

const PAID_WITH: Record<NonNullable<ReceiptCheck["paidWith"]>, string> = {
  cash: "in cash, so fromWallet is their cash wallet",
  gcash: "with GCash, so fromWallet is their GCash wallet",
  maya: "with Maya, so fromWallet is their Maya wallet",
  card: "by card, and the receipt does not say which account, so leave fromWallet empty: the app fills it from where their card payments come from. A card payment is spending on what was bought, never borrowing, whatever the terminal calls the card",
};

/**
 * What the check found, written for the model, to go with the reading.
 *
 * Said as a finding, with its working, so the model can see why and the
 * owner can see it in the record. The card is checked against the same
 * finding afterwards (`checkReceipts`), so a model that ignores it is put
 * right rather than believed.
 */
export function receiptNote(check: ReceiptCheck): string {
  const parts = [
    `This is a shop receipt, and its arithmetic was checked on this device: the amount paid is ${show(check.total)} (${check.evidence.join("; ")}).`,
  ];
  const wrong: string[] = [];
  if (check.tendered !== undefined) wrong.push(`${show(check.tendered)} is the money handed over`);
  if (check.change !== undefined) wrong.push(`${show(check.change)} is the change given back`);
  if (check.vatable !== undefined) wrong.push(`${show(check.vatable)} is the VATable sales`);
  if (check.vat !== undefined) wrong.push(`${show(check.vat)} is the VAT`);
  if (wrong.length > 0) {
    parts.push(`${wrong.join(", ")}: none of them is what was spent, and the tax lines are parts of the total, never rows of their own.`);
  }
  parts.push(`One receipt is one purchase: one proposal with amountPesos ${check.total / 100}, the store or what was bought in description, unless they asked for the items separately.`);
  if (check.paidWith) parts.push(`It was paid ${PAID_WITH[check.paidWith]}.`);
  if (check.date) {
    parts.push(
      check.dateAmbiguous
        ? `The printed date reads as ${check.date} (month first, as Philippine receipts print it).`
        : `The printed date is ${check.date}.`,
    );
  }
  if (check.time) parts.push(`The printed time is ${check.time}.`);
  if (check.bought.length > 0) {
    parts.push(
      `What was bought, one line per item as the device read it, with letters it may have misread (a slash separates two readings of the same line): ${check.bought.map((b) => `"${b}"`).join(", ")}. Read through the misreadings as a person reading a smudged receipt would (FUSER or DIIFUSER is diffuser, SANTAL is sandalwood), and through a shop's shortened names (NatureSpngPuriDW1L is Nature Spring purified drinking water, 1 litre), then choose item from their list by what that thing is, and write it plainly in description. A receipt says what was bought, so leave item empty only when nothing on their list is that kind of thing.`,
    );
  }
  return parts.join(" ");
}
