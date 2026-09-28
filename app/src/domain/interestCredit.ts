/**
 * A bank's interest credit, read and checked on the device.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The owner, 28 September 2026, with a Maya "Net boosted interest" screen:
 * "make it able to read this". It prints three figures, ₱0.15 at the top,
 * "Total interest earned ₱0.19" and "Withholding tax -₱0.04", and only one
 * of them is what arrived. A reading that takes the ₱0.19, or makes the tax
 * a spending row of its own, puts money in the ledger that never moved.
 *
 * Every interest row the owner has entered is the net amount, Revenue,
 * item Bank interest, into Maya Bank (Personal savings). So the figures are
 * put to their own arithmetic here (earned less tax is the net), the model
 * is told what they are, and its cards are held to them afterwards
 * (`proposal.ts`, `checkInterest`).
 */

import type { Centavos } from "./money";
import type { IsoDate } from "./types";

export interface InterestCredit {
  /** What arrived: the earned interest less the tax. */
  readonly net: Centavos;
  readonly gross?: Centavos;
  readonly tax?: Centavos;
  readonly date?: IsoDate;
  /** The account words the screen used ("My Savings"), and the bank, when named. */
  readonly account: string;
  readonly bank?: string;
  /** How sure: the three figures agreed, or only some were found. */
  readonly confidence: "high" | "medium";
  readonly evidence: readonly string[];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Peso figures on a line: "₱0.19", "-₱0.04", "P 1,234.50", "PHP 3.00". The currency mark is required. */
function figures(line: string): { value: Centavos; negative: boolean }[] {
  const out: { value: Centavos; negative: boolean }[] = [];
  for (const m of line.matchAll(/(-|−)?\s*(?:₱|php|p(?=\s?\d))\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\b/gi)) {
    const value = Number((m[2] ?? "0").replace(/,/g, "")) * 100 + Number(m[3] ?? "0");
    out.push({ value, negative: Boolean(m[1]) });
  }
  return out;
}

/** The figure on this line, or on the next line that has one, within two lines. */
function figureNear(lines: readonly string[], at: number): Centavos | undefined {
  for (let i = at; i <= Math.min(lines.length - 1, at + 2); i += 1) {
    const found = figures(lines[i] ?? "");
    if (found[0]) return found[0].value;
  }
  return undefined;
}

function dateIn(text: string): IsoDate | undefined {
  const dayFirst = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(20\d{2})\b/i.exec(text);
  const monthFirst = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i.exec(text);
  const [day, month, year] = dayFirst
    ? [Number(dayFirst[1]), MONTHS.indexOf((dayFirst[2] ?? "").toLowerCase()) + 1, dayFirst[3]]
    : monthFirst
      ? [Number(monthFirst[2]), MONTHS.indexOf((monthFirst[1] ?? "").toLowerCase()) + 1, monthFirst[3]]
      : [0, 0, ""];
  if (!day || !month || !year) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * An interest credit in what the device read off a picture, or null.
 *
 * Only a screen about interest that shows the tax or says the figure is net
 * or earned: a wallet's history with one "Interest" row among forty is a
 * list, and is left to the list rules.
 */
export function readInterestCredit(readings: readonly string[]): InterestCredit | null {
  for (const text of readings) {
    if (!text.trim()) continue;
    if (!/\binterest\b/i.test(text)) continue;
    if (!/withholding|w\/?tax|\bnet\b[^\n]{0,20}interest|interest (?:earned|credited|paid)|total interest/i.test(text)) continue;
    // Interest owed on a credit line or a loan is not income: those screens have their own rules.
    if (/\b(credit|loan|due|billing|payable|borrow\w*|installment|amount to pay|minimum payment)\b/i.test(text)) continue;
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    // A list of many movements is not one credit.
    const allFigures = lines.flatMap(figures);
    if (allFigures.length > 6) continue;

    const at = (pattern: RegExp): number => lines.findIndex((l) => pattern.test(l));
    const grossAt = at(/total interest|interest earned|gross interest|interest credited/i);
    const taxAt = at(/withholding|w\/?tax|\btax\b/i);
    const netAt = at(/\bnet\b[^\n]{0,30}interest|interest[^\n]{0,20}\bnet\b|net amount/i);
    const gross = grossAt >= 0 ? figureNear(lines, grossAt) : undefined;
    const tax = taxAt >= 0 ? figureNear(lines, taxAt) : undefined;
    const headline = netAt >= 0 ? figureNear(lines, netAt) : undefined;
    // The first figure on the screen, which is where a credit's amount is printed large.
    const first = allFigures.find((f) => !f.negative)?.value;

    const evidence: string[] = [];
    let net: Centavos | undefined;
    let confidence: "high" | "medium" = "medium";
    if (gross !== undefined && tax !== undefined && gross > tax) {
      net = gross - tax;
      evidence.push(`PHP ${(gross / 100).toFixed(2)} earned less PHP ${(tax / 100).toFixed(2)} withholding tax is PHP ${(net / 100).toFixed(2)}`);
      const printed = headline ?? first;
      if (printed === net) {
        confidence = "high";
        evidence.push(`the screen prints PHP ${(net / 100).toFixed(2)} as what arrived`);
      }
    } else if (headline !== undefined) {
      net = headline;
      evidence.push(`the screen prints PHP ${(net / 100).toFixed(2)} as the net interest`);
    } else if (gross !== undefined) {
      net = gross;
      evidence.push(`PHP ${(gross / 100).toFixed(2)} of interest, and no tax printed`);
    }
    if (net === undefined || net <= 0) continue;

    const accountLine = lines.find((l) => /\bsavings?\b|\bgoal\b|\bpocket\b|\bvault\b|\bstash\b/i.test(l) && !/interest/i.test(l));
    const bank = /\bmaya\b/i.test(text) ? "Maya" : /\bgcash\b|\bgsave\b/i.test(text) ? "GCash" : /\bseabank\b/i.test(text) ? "SeaBank" : /\bgotyme\b/i.test(text) ? "GoTyme" : /\bcimb\b/i.test(text) ? "CIMB" : /\bbdo\b/i.test(text) ? "BDO" : /\bbpi\b/i.test(text) ? "BPI" : undefined;
    const date = dateIn(text);
    return {
      net,
      ...(gross !== undefined ? { gross } : {}),
      ...(tax !== undefined ? { tax } : {}),
      ...(date ? { date } : {}),
      account: accountLine?.replace(/[^A-Za-z0-9 ()'-]/g, "").trim() ?? "",
      ...(bank ? { bank } : {}),
      confidence,
      evidence,
    };
  }
  return null;
}

/**
 * The savings account a credit went into, from the owner's own list.
 *
 * "My Savings" on a Maya screen is Maya Bank (Personal savings): an account
 * that names the bank and says savings wins, then one that says savings.
 */
export function accountFor(credit: InterestCredit, savings: readonly string[]): string {
  const words = credit.account.toLowerCase();
  const bank = credit.bank?.toLowerCase() ?? "";
  const score = (name: string): number => {
    const n = name.toLowerCase();
    let s = 0;
    if (bank && n.includes(bank)) s += 4;
    if (/savings?/.test(n) && /savings?/.test(words)) s += 2;
    if (/personal/.test(n) && /\bmy\b|personal/.test(words)) s += 1;
    for (const w of words.split(/\s+/).filter((x) => x.length > 3)) if (n.includes(w)) s += 1;
    return s;
  };
  const ranked = [...savings].map((name) => ({ name, s: score(name) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return ranked[0]?.name ?? "";
}

/** What the model is told, beside the text read off the picture. */
export function interestNote(credit: InterestCredit): string {
  const show = (c: Centavos): string => `PHP ${(c / 100).toFixed(2)}`;
  const parts = [
    `This is an interest credit, checked on this device: ${credit.evidence.join("; ")}.`,
    `It is one proposal: flow Revenue, category Revenue, item Bank interest, amountPesos ${credit.net / 100}${credit.account ? `, into the savings account the screen calls "${credit.account}"` : ""}${credit.date ? `, dated ${credit.date}` : ""}.`,
  ];
  const others = [credit.gross !== undefined && credit.gross !== credit.net ? `${show(credit.gross)} is what was earned before tax` : "", credit.tax !== undefined ? `${show(credit.tax)} is the withholding tax` : ""].filter(Boolean);
  if (others.length > 0) parts.push(`${others.join(", and ")}: parts of it, never rows of their own.`);
  return parts.join(" ");
}
