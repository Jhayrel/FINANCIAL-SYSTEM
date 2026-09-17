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

/** Read a budget request, or return null when the sentence is not one. */
export function readBudgetAsk(text: string, reference: ReferenceLists, asOf: IsoDate): BudgetAsk | null {
  if (!/\b(budget|limit|cap)\b/i.test(text) || !SET.test(text)) return null;
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
