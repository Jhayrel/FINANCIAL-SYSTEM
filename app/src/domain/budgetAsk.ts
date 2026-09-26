/**
 * Setting a budget from the chat.
 *
 * It used to be refused: "Budgets are set on the Budget screen, not here." The
 * owner asked on 2026-09-17 for the assistant to be able to change everything
 * except Settings, and a budget is not a setting. So the chat reads the
 * request, works out the change with the Budget screen's own rules
 * (`budgetLock.ts`: a running month changes freely, a closed month only as a
 * correction with a reason, every change kept in the month's history), and
 * shows it on a card to apply.
 *
 *   "set my budget to 8000"                     spending, this month
 *   "set bills budget for october to 2500"      bills and subscriptions
 *   "limit food to 3000 for the rest of the year"
 *   "same budget as last month"
 */

import { budgetForMonth, budgetForYear } from "./budget";
import { revisionSummary, saveLimit, saveTracks, type SaveOutcome } from "./budgetLock";
import type { PlanScope } from "./budgetView";
import { MONTH_NAMES } from "./dates";
import { formatMoney, type Centavos } from "./money";
import type { Budgets, IsoDate, ReferenceLists } from "./types";

export type BudgetAsk =
  | {
      readonly kind: "tracks";
      readonly year: number;
      readonly month: number;
      readonly spending?: Centavos | undefined;
      readonly billsSubs?: Centavos | undefined;
      readonly scope: PlanScope;
    }
  | { readonly kind: "copy"; readonly year: number; readonly month: number; readonly scope: PlanScope }
  | {
      readonly kind: "limit";
      readonly year: number;
      readonly month: number;
      readonly name: string;
      readonly value: Centavos;
      readonly scope: PlanScope;
    };

const SET = /\b(set|make|change|update|increase|raise|lower|reduce|put|copy|use|same|limit|cap)\b/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function figure(text: string): Centavos | null {
  const m = /(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(k)?\b/i.exec(text);
  if (!m?.[1]) return null;
  const [pesos = "0", cents = ""] = m[1].replace(/,/g, "").split(".");
  const value = (Number(pesos) * 100 + Number((cents + "00").slice(0, 2))) * (m[2] ? 1000 : 1);
  return value;
}

function monthIn(text: string, asOf: IsoDate): { year: number; month: number } {
  const year = Number(asOf.slice(0, 4));
  const now = Number(asOf.slice(5, 7));
  if (/\bnext month\b/i.test(text)) return now === 12 ? { year: year + 1, month: 1 } : { year, month: now + 1 };
  if (/\blast month\b/i.test(text) && !/\b(same|as|copy|like)\b.*\blast month\b/i.test(text)) {
    return now === 1 ? { year: year - 1, month: 12 } : { year, month: now - 1 };
  }
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b(?:\s+(20\d{2}))?/i.exec(text.replace(/\blast month\b/gi, " "));
  if (named?.[1]) return { year: named[2] ? Number(named[2]) : year, month: MONTHS.indexOf(named[1].slice(0, 3).toLowerCase()) + 1 };
  return { year, month: now };
}

function scopeIn(text: string): PlanScope {
  if (/\b(whole|all|entire)\s+year\b|\bevery month (of|in) \d{4}\b/i.test(text)) return "year";
  if (/\b(rest of the year|from now on|every month|each month|onwards|until december)\b/i.test(text)) return "rest";
  return "month";
}

/**
 * A budget command that names no figure of its own.
 *
 * ── The conversation this comes from, 21 September 2026 ────────────────────
 *
 *   "so based on my spending and current balance what do you propose??"
 *   ... a budget is proposed ...
 *   "ok thanks. can you add those to my budget?"
 *   "Yes, the entries will be added to your budget."
 *   "so is it added?"
 *   "Yes, the app will add those budget entries when you press the button."
 *   "the budget still not change"
 *
 * `readBudgetAsk` wants a figure and the sentence has none, because the
 * figure is in the answer above it, which is how anyone would say this. So
 * it returned null, no card was made, and the model filled the silence with
 * a yes.
 *
 * This is the first half of the gate, without the figure: enough to know
 * the owner is asking for the budget to change, so the app can go and look
 * for the figure rather than saying nothing.
 */
export function namesBudgetCommand(said: string): boolean {
  const text = said.replace(/\b(buget|budjet|bugdet|budgt|budet|bujet|budgets?)\b/gi, "budget");
  if (!/\b(budget|limit|cap)\b/i.test(text)) return false;

  /*
   * Asking for advice about the budget is not asking for it to change.
   * "should I raise my budget?" wants an answer; "can you set my budget?"
   * wants a card. The verbs of degree, raise and lower and increase, are
   * left out on purpose: they nearly always come with a figure, which
   * `readBudgetAsk` already handles, and without one they are usually a
   * question about whether to.
   */
  if (/\b(should|shall|would|might|worth it|do you think|is it|are you able)\b/i.test(text)) return false;

  return /\b(add|set|change|update|copy|make|put|apply|use|same)\b/i.test(text);
}

/**
 * The budget an answer proposed, when it named one.
 *
 * Only a figure the sentence itself calls a budget. An answer about the
 * month is full of figures, the overage and the daily rate and last month's
 * total, and picking the first of them would set a budget to a number
 * nobody proposed. "a budget of PHP 53,710.80 for next month" says which
 * one it means, and nothing else here counts.
 */
export function proposedBudgetIn(text: string): Centavos | null {
  const MONEY = String.raw`(?:₱|php\s*)?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|(?:₱|php\s*)\d+(?:\.\d{1,2})?`;
  // The bold markers are optional: the model uses them sometimes and not others.
  const B = String.raw`\*{0,2}`;
  const patterns = [
    new RegExp(String.raw`budget(?:\s+of)?\s+(?:is\s+|at\s+|to\s+|would\s+be\s+)?${B}(${MONEY})`, "i"),
    new RegExp(String.raw`${B}(${MONEY})${B}\s+(?:a\s+month\s+|for\s+next\s+month\s+|per\s+month\s+)?(?:as\s+(?:a|the|your)\s+)?budget`, "i"),
  ];

  for (const pattern of patterns) {
    const found = pattern.exec(text);
    if (found?.[1]) {
      const value = figure(found[1]);
      if (value !== null && value > 0) return value;
    }
  }
  return null;
}

/** Read a budget request, or return null when the sentence is not one. */
export function readBudgetAsk(said: string, reference: ReferenceLists, asOf: IsoDate): BudgetAsk | null {
  // "add buget same as last month": the misspellings that came in, read as the word.
  const text = said.replace(/\b(buget|budjet|bugdet|budgt|budet|bujet|budgets?)\b/gi, "budget");
  if (!/\b(budget|limit|cap)\b/i.test(text) || !(SET.test(text) || /\badd\b/i.test(text))) return null;
  const { year, month } = monthIn(text, asOf);
  const scope = scopeIn(text);

  if (/\b(same|copy|use)\b.*\b(as|from)?\s*last month('?s)?\b/i.test(text) && !/\d/.test(text.replace(/20\d{2}/g, ""))) {
    return { kind: "copy", year, month, scope };
  }

  const kinds = [...reference.spendingTypes.map((t) => t.name)].sort((a, b) => b.length - a.length);
  const flat = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const kind = kinds.find((k) => flat.includes(` ${k.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `));
  const withoutDates = text.replace(/\b20\d{2}\b/g, " ");
  const value = figure(withoutDates);

  if (/\b(limit|cap)\b/i.test(text) && kind) {
    if (value === null && !/\b(remove|clear|no limit|delete)\b/i.test(text)) return null;
    return { kind: "limit", year, month, name: kind, value: value ?? 0, scope };
  }
  if (value === null) return null;
  if (/\b(bills?|subscriptions?|subs)\b/i.test(text)) return { kind: "tracks", year, month, billsSubs: value, scope };
  return { kind: "tracks", year, month, spending: value, scope };
}

export interface BudgetPlan {
  readonly year: number;
  readonly outcome: SaveOutcome;
  /** What it would do, in a sentence. */
  readonly words: string;
  /** One line per month it would change, for the activity trail. */
  readonly changes: readonly string[];
}

/** The change, worked out with the Budget screen's own rules. Nothing is saved. */
export function planBudget(ask: BudgetAsk, budgets: Budgets, asOf: IsoDate, at: string): BudgetPlan {
  const plan = budgetForYear(budgets, ask.year);
  const name = `${MONTH_NAMES[ask.month - 1] ?? ""} ${ask.year}`;
  const span = ask.scope === "month" ? name : ask.scope === "rest" ? `${name} to December` : `every month of ${ask.year} still ahead`;
  let outcome: SaveOutcome;
  let words: string;

  if (ask.kind === "limit") {
    outcome = saveLimit(plan, ask.year, ask.month, ask.name, ask.value, ask.scope, asOf, at);
    words = ask.value > 0 ? `${ask.name} limited to ${formatMoney(ask.value)} a month, ${span}.` : `The limit on ${ask.name} removed, ${span}.`;
  } else {
    const current = budgetForMonth(budgets, ask.year, ask.month);
    let value = current;
    if (ask.kind === "copy") {
      const prevYear = ask.month === 1 ? ask.year - 1 : ask.year;
      const prevMonth = ask.month === 1 ? 12 : ask.month - 1;
      value = budgetForMonth(budgets, prevYear, prevMonth);
    } else {
      value = { spending: ask.spending ?? current.spending, billsSubs: ask.billsSubs ?? current.billsSubs };
    }
    outcome = saveTracks(plan, ask.year, ask.month, value, ask.scope, asOf, at);
    words =
      ask.kind === "copy"
        ? `${span}: the same budget as the month before, ${formatMoney(value.spending)} for spending and ${formatMoney(value.billsSubs)} for bills and subscriptions.`
        : `${span}: ${formatMoney(value.spending)} for spending and ${formatMoney(value.billsSubs)} for bills and subscriptions, was ${formatMoney(
            current.spending,
          )} and ${formatMoney(current.billsSubs)}.`;
  }

  const changes = outcome.revisions.map((r, i) => revisionSummary(ask.year, outcome.written[i] ?? ask.month, r));
  return { year: ask.year, outcome, words, changes };
}
