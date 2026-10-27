/**
 * Everyday questions about the month, answered from the app's own figures.
 *
 * The owner, 27 October 2026: "improve the ai and system ... make sure it
 * knows better like better reasoning. improve also the recognition". With
 * the model off, "what's my biggest expense this month?", "am i over
 * budget?", "how much is my savings?" and "how much did i save this month?"
 * were answered with the month's summary, and "magkano natitira sa budget
 * ko?" with next month's suggested budget. Each is a figure the Dashboard
 * and the Budget screen already show; they are said here from the same
 * figures (`monthPlan.ts`, `kinds.ts`), so the chat cannot disagree with
 * the screens, model or no model.
 */
import { costByKind } from "./kinds";
import type { Debt } from "./debt";
import type { MonthBrief } from "./monthPlan";
import type { Centavos } from "./money";
import { costOf } from "./totals";
import type { IsoDate, Transaction } from "./types";

export type QuickAsk =
  | { readonly kind: "biggest"; readonly month: "this" | "last" }
  | { readonly kind: "budget" }
  | { readonly kind: "savings" }
  | { readonly kind: "saved" };

const BIGGEST =
  /\b(?:biggest|largest|highest|top|most)\b[^?.!]{0,30}\b(?:expenses?|spending|spend|costs?|gastos|categor(?:y|ies)|kinds?)\b|\bwhere\s+(?:did|does|do)\s+(?:most\s+of\s+)?my\s+money\s+go\b|\bsaan\s+(?:napunta|nauubos)\b|\bwhat\s+(?:did|do)\s+i\s+spend\s+(?:the\s+)?most\s+on\b|\bpinaka\s*malaki\b[^?.!]{0,20}\bgastos\b/i;
const BUDGET =
  /\b(?:am\s+i|are\s+we|did\s+i\s+go|have\s+i\s+gone|is\s+my\s+spending)\s+(?:over|above|past|within|under)\s+(?:my\s+|the\s+)?budget\b|\bover\s+(?:my\s+|the\s+)?budget\s*\?|\blagpas\b[^?.!]{0,20}\bbudget\b|\b(?:how\s+much|magkano|what'?s|what\s+is)\b[^?.!]{0,30}\b(?:left|natitira|matitira|remaining|natira)\b[^?.!]{0,20}\bbudget\b|\bbudget\b[^?.!]{0,20}\b(?:left|natitira|remaining|natira)\b|\bhow\s+(?:is|'?s)\s+my\s+budget\b/i;
const SAVINGS = /\b(?:how\s+much|magkano|what'?s|what\s+is|show)\b[^?.!]{0,15}\b(?:is\s+|are\s+)?(?:my|aking)\s+(?:savings?|ipon)\b|\bmy\s+savings?\s+(?:balance|total)\b|\bmagkano\s+(?:na\s+)?(?:ang\s+)?(?:ipon|naipon)\b/i;
const SAVED = /\bhow\s+much\s+(?:did|have)\s+i\s+(?:save|saved|kept|keep)\b|\bmagkano\s+(?:ang\s+)?(?:na\s*)?ipon\s+ko\s+(?:this|ngayong)\b/i;

/** The question, or null. A kind of spending named ("food budget left") is a limit's question, not this. */
export function readQuickAsk(text: string, kinds: readonly string[] = []): QuickAsk | null {
  const t = text.trim();
  if (!t || t.split(/\s+/).length > 18) return null;
  const flat = ` ${t.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const namesKind = kinds.some((k) => {
    const w = k.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return w.length > 2 && flat.includes(` ${w} `);
  });
  if (SAVED.test(t) && !/\b(?:per|a|each)\s+month\s+for\b|\bto\s+(?:have|reach|buy)\b/i.test(t)) return { kind: "saved" };
  if (SAVINGS.test(t)) return { kind: "savings" };
  if (BIGGEST.test(t)) return { kind: "biggest", month: /\blast\s+month\b|\bnakaraang\s+buwan\b/i.test(t) ? "last" : "this" };
  if (BUDGET.test(t) && !namesKind && !/\b(?:next\s+month|set|make|change|propose|recommend|suggest)\b/i.test(t)) return { kind: "budget" };
  return null;
}

export interface QuickFacts {
  readonly brief: MonthBrief;
  /** The month as a name: "October 2026". */
  readonly name: string;
  readonly transactions: readonly Transaction[];
  readonly debts: readonly Debt[];
  readonly asOf: IsoDate;
  /** Each savings account and what it holds. */
  readonly savings: readonly { readonly name: string; readonly holds: Centavos }[];
  /** What went into savings this month, by transfer. */
  readonly movedToSavings: Centavos;
}

export function quickAnswer(ask: QuickAsk, f: QuickFacts, money: (c: Centavos) => string): string {
  const { brief, name } = f;
  const t = brief.tracks;
  if (ask.kind === "biggest") {
    const y = Number(f.asOf.slice(0, 4));
    const m = Number(f.asOf.slice(5, 7));
    const back = ask.month === "last" ? (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }) : { y, m };
    const key = `${back.y}-${String(back.m).padStart(2, "0")}`;
    const rows = f.transactions.filter((r) => r.date.startsWith(key) && r.date <= f.asOf);
    const kinds = costByKind(rows, f.debts).slice(0, 5);
    if (kinds.length === 0) return `Nothing was spent in ${ask.month === "last" ? "last month" : name} yet.`;
    const total = rows.reduce((s, r) => s + Math.max(0, costOf(r)), 0);
    // One entry over several days is one entry: its days' shares together (`covers.ts`).
    const entries = new Map<string, { row: Transaction; cost: Centavos }>();
    for (const r of rows) {
      if (costOf(r) <= 0) continue;
      const key = r.coveredBy ?? r.id;
      const at = entries.get(key);
      entries.set(key, at ? { row: r.date < at.row.date ? r : at.row, cost: at.cost + costOf(r) } : { row: r, cost: costOf(r) });
    }
    const biggest = [...entries.values()].sort((a, b) => b.cost - a.cost)[0];
    const top = biggest?.row;
    const topCost = biggest?.cost ?? 0;
    const said = top ? top.description.replace(/(?:,\s*)?day \d+ of \d+\s*$/i, "").replace(/[,\s]+$/, "").trim() : "";
    const when = ask.month === "last" ? "last month" : `${name} so far`;
    return [
      `**${kinds[0]!.name} is the biggest, ${money(kinds[0]!.amount)}** of ${money(total)} spent ${when}.`,
      ...kinds.map((k) => `- ${k.name}: ${money(k.amount)}${total > 0 ? ` (${Math.round((k.amount * 100) / total)}%)` : ""}`),
      top ? `The largest single entry was #${String(top.recordNumber).padStart(4, "0")}, ${top.item || top.type} ${money(topCost)}${said ? ` (${said.slice(0, 50)})` : ""}.` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (ask.kind === "budget") {
    if (t.combined.budget <= 0) return `${name} has no budget set, so nothing to be over or under. ${money(t.combined.spent)} is spent so far. Set one on the Budget screen, or say "set my budget to 20000".`;
    const left = t.combined.remaining;
    const day = brief.safe?.budgetPerDay ?? null;
    const lines = [
      left < 0
        ? `**Over the budget by ${money(-left)}.** ${money(t.combined.spent)} spent of ${money(t.combined.budget)} in ${name}.`
        : `**Within the budget: ${money(left)} left** of ${money(t.combined.budget)} in ${name}, ${money(t.combined.spent)} spent.`,
      `- Spending: ${money(t.spending.spent)} of ${money(t.spending.budget)}, ${t.spending.remaining < 0 ? `${money(-t.spending.remaining)} over` : `${money(t.spending.remaining)} left`}${day !== null && t.spending.remaining > 0 && brief.daysLeft > 0 ? `, ${money(day)} a day for the ${brief.daysLeft} ${brief.daysLeft === 1 ? "day" : "days"} left` : ""}`,
      `- Bills and subscriptions: ${money(t.billsSubs.spent)} of ${money(t.billsSubs.budget)}, ${t.billsSubs.remaining < 0 ? `${money(-t.billsSubs.remaining)} over` : `${money(t.billsSubs.remaining)} left`}`,
    ];
    // The budget is the plan; the money decides what can be spent (`safeAsk.ts`).
    if (brief.safe && left > 0 && brief.safe.safe < t.spending.remaining) lines.push(`Your wallets cover less than that: safe to spend until the month ends is ${money(Math.max(0, brief.safe.safe))}.`);
    return lines.join("\n");
  }
  if (ask.kind === "savings") {
    const total = f.savings.reduce((s, a) => s + a.holds, 0);
    if (f.savings.length === 0) return "You have no savings account on your list. Add one in Settings, Accounts.";
    return [`**Your savings hold ${money(total)}.**`, ...f.savings.map((a) => `- ${a.name}: ${money(a.holds)}`), f.movedToSavings > 0 ? `${money(f.movedToSavings)} went into them in ${name}.` : ""]
      .filter(Boolean)
      .join("\n");
  }
  // Saved this month: what came in less what went out, and what was moved into savings.
  const kept = brief.kept;
  return [
    kept >= 0 ? `**You kept ${money(kept)} in ${name} so far:** ${money(brief.cameIn)} came in and ${money(brief.wentOut)} went out.` : `**Nothing was kept in ${name} so far: ${money(-kept)} more went out than came in** (${money(brief.cameIn)} in, ${money(brief.wentOut)} out).`,
    f.movedToSavings > 0 ? `${money(f.movedToSavings)} was moved into savings this month.` : "Nothing was moved into savings this month.",
  ].join(" ");
}
