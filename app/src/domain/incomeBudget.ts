/**
 * The budget, moved by the money that came in.
 *
 * The owner, 12 October 2026: "I set it before the month then I have more
 * received money, like Nov 1 budget is 5000 then I earn 10k, then I can
 * adjust like income based. But be careful, make sure everything is
 * reasonable, not just random inputs. Like what will happen if I earn 10k,
 * the budget is 5k original, then that 10k I split to savings etc., like the
 * budget will be broken."
 *
 * Their own October shows it: the spending budget went from PHP 15,000.00 to
 * PHP 26,000.00 on the 12th, three days after PHP 10,000.00 came in.
 *
 * ── The rules ──────────────────────────────────────────────────────────────
 *
 * 1. Income is what `incomeOf` counts: never an opening balance, never money
 *    borrowed, never a move between the owner's own accounts.
 * 2. "Since the budget was set" is income dated on or after the day the
 *    spending and bills budget was last saved for the month (its local day);
 *    a budget set before the month began counts the whole month.
 * 3. The budget can never promise more than the money. What is left of the
 *    spending budget must fit in what is safe to spend (the wallets less the
 *    bills and debt payments still due, `monthPlan.ts`). So the most the
 *    spending budget can be is what it has already spent plus what is safe.
 * 4. Money kept aside for savings and not moved yet still sits in a wallet,
 *    so safe to spend still counts it. It is taken off the most the budget
 *    can be, so a raise and a saving are never the same peso. Once it is
 *    moved to a savings account, the wallets drop and it is out by itself.
 * 5. A split can never hand out more than came in. A raise beyond that is an
 *    ordinary budget change, made on the Budget screen.
 * 6. Nothing is saved without the owner pressing the button, and every
 *    change is one revision in the budget's history, with the reason.
 */
import { wholeRows } from "./covers";
import { formatMedium, localDay } from "./dates";
import { formatMoney, type Centavos } from "./money";
import { incomeOf } from "./totals";
import type { BudgetYear, IsoDate, ReferenceLists, Transaction } from "./types";

export interface IncomeBudget {
  readonly year: number;
  readonly month: number;
  /** The local day the month's budget was last saved, or null when it never was. */
  readonly setOn: IsoDate | null;
  /** Income dated on or after `setOn` in the month (the whole month when it was set before). */
  readonly cameIn: Centavos;
  /** The largest of it, for the words. */
  readonly sources: readonly { readonly name: string; readonly amount: Centavos; readonly date: IsoDate }[];
  /** Moved from the spending wallets into savings since then, less what came back. */
  readonly toSavings: Centavos;
  /** The spending budget now. */
  readonly budget: Centavos;
  /** The bills and subscriptions budget now. */
  readonly billsBudget: Centavos;
  /** Spent on the spending track this month. */
  readonly spent: Centavos;
  /** Safe to spend for the rest of the month (wallets less what is due). */
  readonly safe: Centavos;
  /** The most the spending budget can be with the money held now: spent + safe (rule 3). */
  readonly most: Centavos;
  /** How far the budget already promises more than the money. 0 when it does not. */
  readonly over: Centavos;
  /** How much the spending budget could still rise. 0 when it cannot. */
  readonly room: Centavos;
}

export function incomeBudget(input: {
  readonly transactions: readonly Transaction[];
  readonly reference: Pick<ReferenceLists, "wallets" | "savings">;
  readonly plan: BudgetYear | undefined;
  readonly year: number;
  readonly month: number;
  /** Safe to spend for the month, from `monthBrief`. Null for a month that is not running. */
  readonly safe: Centavos | null;
  /** Spent on the spending track this month, from the month's assessment. */
  readonly spent: Centavos;
}): IncomeBudget | null {
  const { reference, plan, year, month, safe, spent } = input;
  if (safe === null) return null;
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const first = `${prefix}-01` as IsoDate;
  const rows = wholeRows(input.transactions);

  const last = [...(plan?.revisions?.[String(month)] ?? [])].filter((r) => r.what === "tracks").sort((a, b) => a.at.localeCompare(b.at)).pop();
  const setOn = last ? localDay(last.at) : null;
  const since = setOn && setOn > first ? setOn : first;

  // On the day it was set, only income saved after the change: the change may already have counted it.
  const setAtMs = last ? new Date(last.at).getTime() : 0;
  const income = rows.filter(
    (t) => t.date.startsWith(prefix) && t.date >= since && incomeOf(t) > 0 && (t.date > since || since !== setOn || (savedAt(t) ?? Infinity) > setAtMs),
  );
  const cameIn = income.reduce((sum, t) => sum + incomeOf(t), 0);
  const sources = [...income]
    .sort((a, b) => incomeOf(b) - incomeOf(a))
    .slice(0, 3)
    .map((t) => ({ name: t.item.trim() || t.description.trim() || "Income", amount: incomeOf(t), date: t.date }));

  const wallets = new Set(reference.wallets);
  const savings = new Set(reference.savings);
  let toSavings = 0;
  for (const t of rows) {
    if (t.type !== "Transfer" || !t.date.startsWith(prefix) || t.date < since) continue;
    if (wallets.has(t.fromWallet) && savings.has(t.toWallet)) toSavings += t.amount;
    if (savings.has(t.fromWallet) && wallets.has(t.toWallet)) toSavings -= t.amount;
  }

  const budget = plan?.spending[month - 1] ?? 0;
  const billsBudget = plan?.billsSubs[month - 1] ?? 0;
  const most = spent + Math.max(0, safe);
  return {
    year,
    month,
    setOn,
    cameIn,
    sources,
    toSavings: Math.max(0, toSavings),
    budget,
    billsBudget,
    spent,
    safe,
    most,
    over: Math.max(0, budget - most),
    room: Math.max(0, most - budget),
  };
}

export interface IncomeSplit {
  /** Added to the spending budget. */
  readonly toSpending: Centavos;
  /** Added to the bills and subscriptions budget. */
  readonly toBills: Centavos;
  /** Kept aside for savings and not moved yet (rule 4). */
  readonly keepAside: Centavos;
}

export interface SplitCheck {
  readonly ok: boolean;
  readonly errors: readonly string[];
  /** Said beside the button: what is left free, and what to do with the money kept aside. */
  readonly notes: readonly string[];
  /** The two budgets after it. */
  readonly value: { readonly spending: Centavos; readonly billsSubs: Centavos };
  /** Kept in the budget's history with the change. */
  readonly reason: string;
}

/**
 * Whether a split of the money that came in is reasonable, and the budget it
 * makes. Refuses, with the reason, a split that hands out more than came in
 * or a spending budget the money cannot keep (the owner's "broken budget").
 */
export function checkSplit(ib: IncomeBudget, split: IncomeSplit): SplitCheck {
  const errors: string[] = [];
  const notes: string[] = [];
  const parts = [split.toSpending, split.toBills, split.keepAside];
  if (parts.some((p) => !Number.isInteger(p) || p < 0)) errors.push("Each part must be zero or more.");
  const given = split.toSpending + split.toBills + split.keepAside;
  if (given > ib.cameIn) {
    errors.push(`That splits ${formatMoney(given)}, but ${formatMoney(ib.cameIn)} came in. Take ${formatMoney(given - ib.cameIn)} off one of the parts.`);
  }
  const spending = ib.budget + split.toSpending;
  const ceiling = ib.most - split.keepAside;
  if (split.toSpending > 0 && spending > ceiling) {
    errors.push(
      split.keepAside > 0
        ? `A spending budget of ${formatMoney(spending)} would count the ${formatMoney(split.keepAside)} kept for savings twice: with it set aside, your money keeps a spending budget of ${formatMoney(Math.max(0, ceiling))} at most.`
        : `A spending budget of ${formatMoney(spending)} promises more than your money: ${formatMoney(ib.spent)} is spent and ${formatMoney(ib.safe)} is safe to spend, so ${formatMoney(Math.max(0, ceiling))} at most.`,
    );
  }
  if (given === 0) errors.push("Put some of it into a part first.");
  const free = ib.cameIn - given;
  if (free > 0 && errors.length === 0) notes.push(`${formatMoney(free)} stays free: in your wallets, in no budget.`);
  if (split.keepAside > 0 && errors.length === 0) {
    notes.push(`Move the ${formatMoney(split.keepAside)} into a savings account when you can. Until you do, it is still in a wallet and safe to spend still counts it.`);
  }
  const reason = [
    `From income: ${formatMoney(ib.cameIn)} came in`,
    split.toSpending > 0 ? `${formatMoney(split.toSpending)} to spending` : "",
    split.toBills > 0 ? `${formatMoney(split.toBills)} to bills and subscriptions` : "",
    split.keepAside > 0 ? `${formatMoney(split.keepAside)} kept for savings` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return {
    ok: errors.length === 0,
    errors,
    notes,
    value: { spending, billsSubs: ib.billsBudget + split.toBills },
    reason,
  };
}

/** The figures in words, for the chat and the model. */
export function incomeBudgetWords(ib: IncomeBudget, monthName: string): string[] {
  const out: string[] = [];
  const since = ib.setOn ? `since the budget was last set on ${formatMedium(ib.setOn)}` : `in ${monthName}, with no budget saved for it yet`;
  out.push(
    ib.cameIn > 0
      ? `Came in ${since}: ${formatMoney(ib.cameIn)}${ib.sources.length > 0 ? ` (${ib.sources.map((s) => `${s.name} ${formatMoney(s.amount)} on ${formatMedium(s.date)}`).join("; ")})` : ""}.`
      : `Nothing has come in ${since}.`,
  );
  if (ib.toSavings > 0) out.push(`Moved into savings since then: ${formatMoney(ib.toSavings)}.`);
  out.push(
    `Spending budget ${formatMoney(ib.budget)}, ${formatMoney(ib.spent)} spent; safe to spend ${formatMoney(ib.safe)}. The most the spending budget can be with the money held now: ${formatMoney(ib.most)} (spent plus safe to spend).`,
  );
  if (ib.over > 0) out.push(`The spending budget already promises ${formatMoney(ib.over)} more than the money. Lower it to ${formatMoney(ib.most)}, or it cannot be kept.`);
  else if (ib.cameIn > 0) out.push(`It can rise by ${formatMoney(Math.min(ib.room, ib.cameIn))} at most from this income; any part kept for savings comes off that.`);
  return out;
}

/**
 * "I got 10k, adjust my budget", "split my income", "is my budget still
 * right after this income?": the budget against the money that came in,
 * answered with the figures above, never a budget set from words alone.
 */
export function asksIncomeBudget(text: string): boolean {
  const t = text.trim();
  if (!/\bbudget\b/i.test(t)) return false;
  if (!/\b(?:income|earn(?:ed|ings?)?|salary|sahod|kita|received|receive|got|came in|natanggap|money in|allowance|paid me|payment)\b/i.test(t)) return false;
  return /\b(?:adjust|split|raise|increase|change|update|add|based|put|move|allocate|divide|hati(?:in)?|still|enough|right|reasonable|should|how much|what)\b/i.test(t);
}

export interface FromIncome {
  readonly ok: boolean;
  readonly errors: readonly string[];
  /** The spending budget the income leaves. */
  readonly spending: Centavos;
  /** True when it was lowered to what the money held now can keep (rule 3). */
  readonly capped: boolean;
  /** What the income would have left before the cap. */
  readonly uncapped: Centavos;
  readonly reason: string;
}

/**
 * A month's budget worked out from its income: "Nov 1 budget is 5000 then I
 * earn 10k" (owner, 12 October 2026). Spending is what the income leaves
 * after savings and bills. For the month that is running it is never more
 * than the money held now can keep (`most`); a month ahead is planned from
 * the income expected, and is checked again by "Money that came in" once
 * the month runs.
 */
export function budgetFromIncome(input: {
  readonly income: Centavos;
  readonly keep: Centavos;
  readonly bills: Centavos;
  /** The most the spending budget can be with the money held now; null for a month ahead. */
  readonly most: Centavos | null;
}): FromIncome {
  const { income, keep, bills, most } = input;
  const errors: string[] = [];
  if (![income, keep, bills].every((v) => Number.isInteger(v) && v >= 0)) errors.push("Each figure must be zero or more.");
  if (income <= 0) errors.push("Put in the income for the month first.");
  if (keep + bills > income && income > 0) {
    errors.push(`Savings and bills come to ${formatMoney(keep + bills)}, more than the ${formatMoney(income)} income: nothing is left to spend. Keep less for savings, or put in more income.`);
  }
  const uncapped = Math.max(0, income - keep - bills);
  const capped = most !== null && uncapped > most;
  const spending = capped ? Math.max(0, most ?? 0) : uncapped;
  return {
    ok: errors.length === 0,
    errors,
    spending,
    capped,
    uncapped,
    reason: `From income: ${formatMoney(income)} income, ${formatMoney(keep)} kept for savings, ${formatMoney(bills)} for bills and subscriptions${capped ? `, spending held to ${formatMoney(spending)}, what the money keeps now` : ""}`,
  };
}

/** When a row was saved, from its id ("t-1791764690917"); null for rows from the workbook or a card. */
function savedAt(t: Transaction): number | null {
  const m = /^t-(\d{13})\b/.exec(t.id);
  return m ? Number(m[1]) : null;
}

/** Income dated on or after the day the month's budget was last set: what the bell says came in since. */
export function incomeSinceSet(transactions: readonly Transaction[], plan: BudgetYear | undefined, year: number, month: number): { readonly setOn: IsoDate | null; readonly amount: Centavos } {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const last = [...(plan?.revisions?.[String(month)] ?? [])].filter((r) => r.what === "tracks").sort((a, b) => a.at.localeCompare(b.at)).pop();
  const setOn = last ? localDay(last.at) : null;
  if (!setOn) return { setOn: null, amount: 0 };
  // On the day it was set, only income saved after the change counts: the change may already have used it.
  const after = new Date(last!.at).getTime();
  const amount = wholeRows(transactions)
    .filter((t) => t.date.startsWith(prefix) && t.date >= setOn && incomeOf(t) > 0)
    .filter((t) => t.date > setOn || (savedAt(t) ?? Infinity) > after)
    .reduce((sum, t) => sum + incomeOf(t), 0);
  return { setOn, amount };
}

export interface IncomePlanAsk {
  /** The income said, or null to use what has come in this month. */
  readonly income: Centavos | null;
  /** Kept for savings, as an amount or a share of the income. */
  readonly keep: { readonly amount: Centavos } | { readonly percent: number } | null;
}

const AMOUNT = String.raw`(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(k\b)?`;
const toCentavosSaid = (digits: string, k: string | undefined): Centavos => {
  const value = Number(digits.replace(/,/g, ""));
  return Math.round(value * (k ? 1000 : 1) * 100);
};

/**
 * "base my budget on my 10k income, save 20%", "budget from my salary of
 * 15000, keep 3000 for savings", "make my budget income based": a budget
 * worked out from income, made as a card the owner confirms.
 */
export function readIncomePlan(text: string): IncomePlanAsk | null {
  const t = text.trim();
  if (!/\bbudget\b/i.test(t)) return null;
  if (!/\b(?:income|salary|sahod|kita|earn(?:ing|ings)?|earned)\b/i.test(t)) return null;
  if (!/\b(?:base[sd]?|from|out of|using|with|set|make|plan|split|income[- ]based)\b/i.test(t)) return null;
  // A question about the budget against income is answered, never made a card (`asksIncomeBudget`).
  if (/\?\s*$/.test(t) && !/\b(?:can you|could you|please|pls)\b/i.test(t)) return null;

  let keep: IncomePlanAsk["keep"] = null;
  let rest = t;
  const pct = /(\d{1,2}(?:\.\d+)?)\s*%\s*(?:(?:for|to|in(?:to)?)\s+)?(?:savings?|save|ipon)?|\b(?:save|keep|set aside|ipon)\s+(\d{1,2}(?:\.\d+)?)\s*%/i.exec(t);
  if (pct) {
    keep = { percent: Number(pct[1] ?? pct[2]) };
    rest = t.replace(pct[0], " ");
  } else {
    const amt = new RegExp(String.raw`\b(?:save|keep|set aside|ipon)\s+${AMOUNT}|${AMOUNT}\s+(?:for|to|in(?:to)?)\s+savings?`, "i").exec(t);
    if (amt) {
      const digits = amt[1] ?? amt[3];
      const k = amt[1] ? amt[2] : amt[4];
      if (digits) keep = { amount: toCentavosSaid(digits, k) };
      rest = t.replace(amt[0], " ");
    }
  }
  const said = new RegExp(AMOUNT, "i").exec(rest.replace(/\b(?:19|20)\d{2}\b/g, " "));
  const income = said && said[1] ? toCentavosSaid(said[1], said[2]) : null;
  if (keep && "percent" in keep && (keep.percent <= 0 || keep.percent >= 100)) keep = null;
  /*
   * "With my recent income what can you propose in budget change?" asks, and
   * names no figure: the budget against what came in answers it
   * (`asksIncomeBudget`). Read as a plan, it went to next month's
   * recommendation, and "add that" put November's figures on October
   * (19 October 2026).
   */
  if ((income === null || income <= 0) && keep === null && /\b(?:what|how|propos\w*|suggest\w*|recommend\w*|should|any)\b/i.test(t)) return null;
  return { income: income !== null && income > 0 ? income : null, keep };
}

export type BudgetMove =
  /** "lower my budget to what my money can keep", "fit my budget to my money", "lower it". */
  | { readonly kind: "fit" }
  /** "add the money that came in to my budget, keep 2000 for savings". */
  | { readonly kind: "addIncome"; readonly keep: IncomePlanAsk["keep"]; readonly toBills: boolean };

/**
 * The two budget moves the Budget screen's card makes, said in chat (owner,
 * 13 October 2026: "make sure ai can do this like lower or add"). Each is
 * worked out by the app and made as the usual budget card to apply.
 */
export function readBudgetMove(text: string, cardJustShown = false): BudgetMove | null {
  const t = text.trim();
  if (/\?\s*$/.test(t) && !/\b(?:can you|could you|please|pls)\b/i.test(t)) return null;
  const budget = /\b(?:budget|it)\b/i.test(t);
  if (!budget) return null;
  const fit =
    /\b(?:lower|reduce|cut|bring\s+down|fit|match|adjust|set|fix)\b[^.]*\b(?:to\s+)?(?:what\s+)?(?:my\s+|the\s+)?(?:money|wallets?|balance|can\s+keep|keeps|afford|safe(?:\s+to\s+spend)?|realistic|what\s+i\s+have)\b/i.test(t) ||
    /\bfit\s+(?:my\s+|the\s+)?budget\b|\bmake\s+(?:my\s+|the\s+)?budget\s+fit\b/i.test(t) ||
    (cardJustShown && /^\s*(?:ok(?:ay)?,?\s+)?(?:lower|reduce)\s+it\b/i.test(t));
  if (fit && /\bbudget\b|\bit\b/i.test(t)) return { kind: "fit" };
  const addIncome =
    /\b(?:add|put|move|include|use)\b[^.]*\b(?:income|salary|sahod|money\s+(?:that\s+)?came\s+in|what\s+came\s+in|came\s+in|new\s+money|earnings?|it)\b[^.]*\b(?:to|into|in)\s+(?:my\s+|the\s+)?budget\b/i.test(t) ||
    /\b(?:add|put)\s+(?:the\s+)?(?:new\s+)?(?:income|money)\s+(?:to|into|in)\b/i.test(t);
  if (!addIncome) return null;
  const plan = readIncomePlan(`plan ${t.replace(/\?\s*$/, "")} budget income`);
  return { kind: "addIncome", keep: plan?.keep ?? null, toBills: /\bbills?\b|\bsubscriptions?\b/i.test(t) };
}

const MONTH_WORDS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * What an answer proposed doing to the running month's budget, so "add the
 * proposed budget changes" does that: "raise your October spending budget by
 * PHP 1,229.51 at most" is a raise, "lower it to PHP 25,907.51" is a fit.
 * Null when it names another month, proposes both, or neither.
 *
 * 19 October 2026: the model proposed October's raise, and "add the proposed
 * budget changes" put November's recommendation on October.
 */
export function answerMoveIn(text: string, monthIndex: number): "raise" | "fit" | null {
  const t = text.replace(/\*\*/g, "").toLowerCase();
  const named = MONTH_WORDS.filter((m) => new RegExp(`\\b${m}\\b`).test(t));
  if (named.length > 0 && !named.includes(MONTH_WORDS[monthIndex - 1] ?? "")) return null;
  const raise = /\b(?:raise|increase|add)\w*\b[^.]{0,80}\bbudget\b[^.]{0,80}\bby\s+(?:up\s+to\s+|at\s+most\s+)?(?:php|₱)|\bbudget\b[^.]{0,40}\bcan\s+(?:rise|go\s+up)\s+by\b/.test(t);
  const fit = /\b(?:lower|reduce|cut|bring\s+down)\w*\b[^.]{0,80}\bbudget\b|\bbudget\b[^.]{0,60}\b(?:lower|reduce)\w*\s+(?:it\s+)?to\b/.test(t);
  return raise === fit ? null : raise ? "raise" : "fit";
}

