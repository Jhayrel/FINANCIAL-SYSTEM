/**
 * A credit line's confirm screen, read on this device.
 *
 * ── Why ───────────────────────────────────────────────────────────────────
 *
 * On 18 November 2026 the owner sent a credit line's "Confirm transfer"
 * screen with two receipts. The receipts came back as cards and the credit
 * screen left nothing: the borrowing was added by hand later with no fees,
 * so what the line owes in the app is short by every fee on that screen.
 *
 * A confirm screen is four or five figures in a fixed shape: the amount, one
 * line per fee (service fee, documentary stamp tax), and a total that is the
 * amount plus the fees. That shape is checked here to the centavo, so a card
 * built from it needs no model and cannot be off by a misread figure: when
 * the parts do not add up to the total, nothing is read at all.
 *
 * Money is integer centavos throughout (CLAUDE.md). A percentage on the fee
 * line ("Service fee (5.00%)") is never a figure.
 */

import type { LineToName } from "./cardQuestions";
import { formatMedium } from "./dates";
import { emptyDraft } from "./entry";
import { formatMoney } from "./money";
import type { Proposal } from "./proposal";
import type { Centavos, IsoDate, Transaction } from "./types";

export interface CreditFee {
  readonly label: string;
  readonly amount: Centavos;
}

export interface CreditConfirm {
  /** The money that goes to the wallet. */
  readonly amount: Centavos;
  /** Each fee the lender adds, in the order shown. */
  readonly fees: readonly CreditFee[];
  /** The amount plus the fees, as the screen prints it. */
  readonly total: Centavos;
  /** Where it goes, as written ("My Wallet"), or empty. */
  readonly destination: string;
  /** The lender's name as written on the screen, or empty. */
  readonly lender: string;
}

/** The words that make a screen a credit line's borrowing, not a receipt. */
const IS_CONFIRM = /\b(?:total\s+credit\s+amount|confirm\s+(?:transfer|borrow\w*|cash\s*out)|transfer\s+summary|you(?:'re|\s+are)\s+about\s+to\s+borrow|easy\s+credit|credit\s+line|loan\s+summary)\b/i;

const FEE_LABEL = /\b(?:service\s+fee|processing\s+fee|convenience\s+fee|doc(?:ument(?:ary)?)?\s*stamp\s+tax|stamp\s+tax|DST)\b/i;
const TOTAL_LABEL = /\btotal\s+(?:credit\s+)?amount\b|\btotal\s+(?:to\s+(?:be\s+)?)?(?:repay|repaid|pay)\b/i;
const AMOUNT_LABEL = /^\s*(?:amount(?:\s+to\s+(?:transfer|borrow|receive|cash\s*out))?|loan\s+amount|principal|you(?:'ll|\s+will)\s+(?:get|receive))\b/i;

/** A printed figure with two decimals, never a percentage: "₱1,051.50" is 105150. */
function figuresOn(line: string): Centavos[] {
  const out: Centavos[] = [];
  const pattern = /(?:₱|php|p)?\s*(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)(\s*%)?/gi;
  for (let m = pattern.exec(line); m !== null; m = pattern.exec(line)) {
    if (m[3]) continue;
    const whole = (m[1] ?? "").replace(/,/g, "");
    if (whole.length > 9) continue;
    out.push(Number(whole) * 100 + Number(m[2] ?? "0"));
  }
  return out;
}

/** The figure a label is printed beside: on its line after it, or alone on the line below. */
function figureFor(lines: readonly string[], at: number, label: RegExp): Centavos | null {
  const line = lines[at] ?? "";
  const after = line.slice((label.exec(line)?.index ?? 0) + (label.exec(line)?.[0].length ?? 0));
  const here = figuresOn(after);
  if (here.length > 0) return here[here.length - 1] ?? null;
  // Only the line straight below: two lines down is another label's figure when the labels stand in a column.
  const next = lines[at + 1] ?? "";
  if (FEE_LABEL.test(next) || TOTAL_LABEL.test(next) || AMOUNT_LABEL.test(next)) return null;
  return figuresOn(next)[0] ?? null;
}

/** The name of a fee, as the owner would say it. */
function feeName(line: string): string {
  const m = FEE_LABEL.exec(line)?.[0] ?? "fee";
  if (/stamp|DST/i.test(m)) return "documentary stamp tax";
  return m.toLowerCase().replace(/\s+/g, " ");
}

/**
 * Label by label: each figure printed beside its own label.
 */
function byLabel(lines: readonly string[]): Omit<CreditConfirm, "destination" | "lender"> | null {
  let amount: Centavos | null = null;
  let total: Centavos | null = null;
  const fees: CreditFee[] = [];
  lines.forEach((line, i) => {
    if (TOTAL_LABEL.test(line)) {
      total ??= figureFor(lines, i, TOTAL_LABEL);
      return;
    }
    if (FEE_LABEL.test(line)) {
      const fee = figureFor(lines, i, FEE_LABEL);
      if (fee !== null) fees.push({ label: feeName(line), amount: fee });
      return;
    }
    if (amount === null && AMOUNT_LABEL.test(line)) amount = figureFor(lines, i, AMOUNT_LABEL);
  });
  if (amount === null || total === null || fees.length === 0) return null;
  return { amount, fees, total };
}

/**
 * By the sum alone, for a reading that put the labels in one column and the
 * figures in another, or printed the amount large with no label: a total, an
 * amount below it, and exactly as many other figures as there are fee labels
 * making up the difference. A total or amount read beside its label is held
 * fixed. One way only, or nothing.
 */
function bySum(
  text: string,
  feeLabels: readonly string[],
  known: { readonly total: Centavos | null; readonly amount: Centavos | null },
): Omit<CreditConfirm, "destination" | "lender"> | null {
  const all = [...new Set(text.split(/\n/).flatMap(figuresOn))].sort((a, b) => b - a);
  const k = feeLabels.length;
  if (k === 0 || k > 3 || all.length > 16) return null;
  const ways: { total: Centavos; amount: Centavos; fees: Centavos[] }[] = [];
  for (const total of known.total !== null ? [known.total] : all) {
    for (const amount of known.amount !== null ? [known.amount] : all.filter((f) => f < total)) {
      const gap = total - amount;
      const rest = all.filter((f) => f !== total && f !== amount && f <= gap);
      const pick = (from: number, chosen: Centavos[], sum: number): void => {
        if (chosen.length === k) {
          if (sum === gap) ways.push({ total, amount, fees: [...chosen] });
          return;
        }
        for (let i = from; i < rest.length; i += 1) pick(i + 1, [...chosen, rest[i] ?? 0], sum + (rest[i] ?? 0));
      };
      pick(0, [], 0);
    }
  }
  // The amount is the larger part: a fee bigger than what was borrowed is a misreading.
  const sane = ways.filter((w) => w.fees.every((f) => f < w.amount));
  if (sane.length !== 1) return null;
  const only = sane[0];
  if (!only) return null;
  return { amount: only.amount, total: only.total, fees: only.fees.map((amount, i) => ({ label: feeLabels[i] ?? "fee", amount })) };
}

/** A credit line's confirm screen in one reading, when its parts add up to its total to the centavo. */
export function readCreditConfirm(text: string): CreditConfirm | null {
  if (!IS_CONFIRM.test(text) || !FEE_LABEL.test(text) || !TOTAL_LABEL.test(text)) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const adds = (r: Omit<CreditConfirm, "destination" | "lender"> | null): boolean =>
    r !== null && r.amount > 0 && r.amount + r.fees.reduce((s, f) => s + f.amount, 0) === r.total;

  const labelled = byLabel(lines);
  const feeLabels = lines.filter((l) => FEE_LABEL.test(l)).map(feeName);
  const totalAt = lines.findIndex((l) => TOTAL_LABEL.test(l));
  const amountAt = lines.findIndex((l) => AMOUNT_LABEL.test(l) && !TOTAL_LABEL.test(l) && !FEE_LABEL.test(l));
  const read = adds(labelled)
    ? labelled
    : bySum(text, feeLabels, {
        total: totalAt >= 0 ? figureFor(lines, totalAt, TOTAL_LABEL) : null,
        amount: amountAt >= 0 ? figureFor(lines, amountAt, AMOUNT_LABEL) : null,
      });
  if (!read || !adds(read)) return null;

  // "Destination" and what follows it, on its line or the next.
  const at = lines.findIndex((l) => /^\s*(?:destination|transfer\s+to|send\s+to)\b/i.test(l));
  const rest = at >= 0 ? (lines[at] ?? "").replace(/^\s*(?:destination|transfer\s+to|send\s+to)\s*:?\s*/i, "").trim() : "";
  const below = (lines[at + 1] ?? "").trim();
  const named = at < 0 ? "" : rest !== "" ? rest : figuresOn(below).length > 0 ? "" : below;
  const destination = named || (/\bmy\s+wallet\b/i.test(text) ? "My Wallet" : "");
  const lender = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Easy\s+)?Credit)\b/.exec(text)?.[1]?.trim() ?? "";
  return { ...read, destination, lender };
}

/** Every confirm screen among what was read, once each: a picture is read two ways and either may find it. */
export function creditConfirmsIn(readings: readonly string[]): CreditConfirm[] {
  const out: CreditConfirm[] = [];
  for (const r of readings) {
    const c = readCreditConfirm(r);
    if (c && !out.some((o) => o.amount === c.amount && o.total === c.total)) out.push(c);
  }
  return out;
}

/** The fees together. */
export function feesOf(c: CreditConfirm): Centavos {
  return c.fees.reduce((s, f) => s + f.amount, 0);
}

/**
 * The line a confirm screen belongs to: the one whose name the screen
 * carries, word for word or without "Easy"; else the one that pays into the
 * wallet it names; else the only line there is. Empty when it cannot be
 * told, and then no card is made: a borrowing on the wrong line is a debt
 * owed to the wrong lender.
 */
export function lineForConfirm<L extends { readonly name: string; readonly wallet?: string | undefined }>(
  c: CreditConfirm,
  text: string,
  lines: readonly L[],
  wallets: readonly string[],
): { line: L; wallet: string } | null {
  const flat = ` ${text.toLowerCase().replace(/\beasy\s+/g, "").replace(/\s+/g, " ")} `;
  const named = lines.filter((l) => flat.includes(` ${l.name.toLowerCase().replace(/\beasy\s+/g, "").trim()} `));
  const line = named.length === 1 ? named[0] : lines.length === 1 ? lines[0] : undefined;
  if (!line) return null;
  // "My Wallet" on a lender's own app is the wallet that line pays into.
  const said = wallets.find((w) => c.destination.toLowerCase() === w.toLowerCase());
  const wallet = said ?? line.wallet ?? "";
  return wallet ? { line, wallet } : null;
}

/** The fees by name, for a card's note: "service fee ₱50.00 and documentary stamp tax ₱1.50". */
function feeWords(c: CreditConfirm): string {
  const parts = c.fees.map((f) => `${f.label} ${formatMoney(f.amount)}`);
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const DAY = 86_400_000;
const daysApart = (a: IsoDate, b: IsoDate): number => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY;

/**
 * What a confirm screen changes among the cards, and what it says.
 *
 * In order, the first that applies:
 *
 *  1. A borrowing card for the same amount: its fees are the screen's, when
 *     it has none and no fee card came with it. Fees on it that differ are
 *     said, never changed.
 *  2. The borrowing already saved on that line within a week, with no fees
 *     beside it: a card for the missing fees, dated with it. This is the
 *     owner's 18 November 2026 entry, saved by hand without its fees.
 *  3. Money in for the same amount to the wallet the line pays into, read as
 *     income: it is the borrowing, with its fees.
 *  4. Nothing at all: a borrowing card made here, with its fees, dated today.
 *
 * Nothing is saved: every result is a card the owner adds or discards.
 */
export function applyCreditConfirms(
  proposals: readonly Proposal[],
  confirms: readonly CreditConfirm[],
  context: {
    readonly text: string;
    readonly lines: readonly LineToName[];
    readonly wallets: readonly string[];
    readonly transactions: readonly Transaction[];
    readonly asOf: IsoDate;
  },
): Proposal[] {
  let out = [...proposals];
  for (const c of confirms) {
    const fees = feesOf(c);
    const sum = `${formatMoney(c.amount)} and the fees make the ${formatMoney(c.total)} total it shows`;

    // 1. The borrowing is among the cards.
    const drawAt = out.findIndex((p) => p.draft.flow === "Debt" && p.draft.debtEffect === "draw" && p.draft.amount === c.amount);
    if (drawAt >= 0) {
      const draw = out[drawAt];
      if (!draw) continue;
      const feeCards = out.some((p) => p.draft.flow === "Debt" && p.draft.debtEffect === "charge" && p.draft.debtId === draw.draft.debtId && c.fees.some((f) => f.amount === p.draft.amount));
      const had = draw.draft.charges ?? 0;
      if (feeCards || had === fees) continue;
      out[drawAt] =
        had === 0
          ? { ...draw, draft: { ...draw.draft, charges: fees }, adjustments: [...draw.adjustments, `Fees of ${formatMoney(fees)} from the screen added (${feeWords(c)}): ${sum}.`] }
          : { ...draw, confidence: "low", adjustments: [...draw.adjustments, `The screen's fees come to ${formatMoney(fees)}, and this card has ${formatMoney(had)}. Check the fees.`] };
      continue;
    }

    const found = lineForConfirm(c, context.text, context.lines, context.wallets);
    if (!found) continue;
    const { line, wallet } = found;

    // 2. Saved already, without its fees.
    const saved = context.transactions
      .filter((t) => t.debtId === line.id && t.debtEffect === "draw" && t.amount === c.amount && daysApart(t.date, context.asOf) <= 7)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (saved) {
      const charged = context.transactions.some(
        (t) => t.debtEffect === "charge" && (t.partOf === saved.id || (t.debtId === line.id && t.date === saved.date && t.amount === fees)),
      );
      if (charged) continue;
      out = [
        ...out,
        {
          draft: {
            ...emptyDraft(saved.date),
            flow: "Debt",
            category: "",
            item: line.name,
            debtId: line.id,
            debtEffect: "charge",
            description: `Fees on ${line.name}`,
            amount: fees,
            status: "",
          },
          confidence: "high",
          sourceRef: "the credit screen, read on this device",
          adjustments: [`#${String(saved.recordNumber).padStart(4, "0")}, the ${formatMoney(c.amount)} borrowed on ${formatMedium(saved.date)}, was saved without the fees this screen shows: ${feeWords(c)}. Add them here: ${sum}.`],
        },
      ];
      continue;
    }

    // 3. Read as income into the wallet it went to.
    const incomeAt = out.findIndex((p) => p.draft.flow === "Revenue" && p.draft.amount === c.amount && p.draft.toWallet === wallet);
    const income = incomeAt >= 0 ? out[incomeAt] : undefined;
    const draw: Proposal = {
      draft: {
        ...(income ? income.draft : emptyDraft(context.asOf)),
        flow: "Debt",
        category: "",
        item: line.name,
        debtId: line.id,
        debtEffect: "draw",
        fromWallet: "",
        toWallet: wallet,
        status: "Received",
        description: income?.draft.description || `Borrowed on ${line.name}`,
        amount: c.amount,
        fee: 0,
        charges: fees,
      },
      confidence: "medium",
      sourceRef: income?.sourceRef ?? "the credit screen, read on this device",
      adjustments: [
        `Borrowed on ${line.name} into ${wallet}, with ${formatMoney(fees)} of fees (${feeWords(c)}): ${sum}.`,
        ...(income ? ["It was read as income; the credit screen shows it was borrowed."] : ["The screen shows no date, so it is dated today. Change it if it was another day. A confirm screen comes before the transfer: add it once the money has arrived."]),
      ],
    };
    out = income ? out.map((p, i) => (i === incomeAt ? draw : p)) : [...out, draw];
  }
  return out;
}
