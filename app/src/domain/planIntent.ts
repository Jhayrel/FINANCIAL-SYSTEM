/**
 * A plan said in passing, sorted by when it is for: today's is a question
 * about today's money, a later one belongs on the Planner.
 *
 * The owner, 27 October 2026: "based on the database make sure it knows if I
 * want to plan something like 'I am planning a trip or etc or tuition etc'
 * make sure ai can do all. But be careful what if I said I plan to buy good
 * today at mall but what I meant is just a budget breakdown for today. Make
 * sure the system knows".
 *
 * Before this, "I plan to buy food today at the mall" and "I'm planning a
 * trip next month" both went to the model as a bare question; "we're
 * planning a birthday party for mama on nov 20, 2500" was made a PHP 2,500.00
 * spending entry dated November 20; "my plan today is to buy food at the
 * mall" asked "How much was it?"; and "I plan to pay my motor registration
 * on the 30th, 1800" was told no plan by that name existed.
 *
 * How it decides, in order:
 *
 *   1. Money that has moved ("I paid", "I bought") is an entry, not this.
 *      Income, saving towards a goal, a debt line and a bill already tracked
 *      are their own readers'.
 *   2. A day said decides it: today is today, any later day is the Planner.
 *   3. No day said: "tonight", "later", "for lunch", the mall or the market
 *      are today. So is a thing the ledger shows is bought every week or so
 *      (Food, eight times or more in sixty days): planning food is today's
 *      money. Anything else (a trip, tuition, a laptop) is the Planner.
 *
 * Nothing here saves anything. Today's answer is the afford answer with the
 * day's figures; a later one is a Planner card to press.
 */
import { addDays, dayOfWeek, formatMedium, lastOfMonth, MONTH_NAMES } from "./dates";
import { formatMoney, withoutYears, type Centavos } from "./money";
import { aheadMonthIn, plannedSpendIn } from "./plannedSpend";
import { isRecurringKind, kindFromHistory, planKinds, type PlanInput } from "./planner";
import { dayIn, sumIn } from "./plannerAsk";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

export interface PlanContext {
  readonly reference: ReferenceLists;
  readonly transactions: readonly Transaction[];
  readonly asOf: IsoDate;
  /** Debt and On behalf line names: paying one is the debt readers'. */
  readonly debtNames?: readonly string[] | undefined;
}

export type PlanIntent =
  /** For today: answered from today's money, never saved as a plan or an entry. */
  | { readonly kind: "today"; readonly thing: string; readonly why: "day" | "words" | "often" }
  /** For a later day: a Planner card, or a question for the amount when none was said. */
  | {
      readonly kind: "later";
      readonly plans: readonly PlanInput[];
      /** What it is for, as said: "Trip to Baguio". */
      readonly title: string;
      readonly amountSaid: boolean;
      readonly dueSaid: boolean;
      /** What the ledger says it cost before, for when no amount was said. */
      readonly hint: string;
      /** Asked as a question too ("how much do I need?"), so the question is answered first. */
      readonly asked: boolean;
    };

/** Said before it happens, about the owner's own spending. */
const INTENT =
  /\b(?:i'?m|im|i\s+am|we'?re|we\s+are)\s+(?:planning|thinking\s+(?:of|about)|going\s+to|gonna|about\s+to|preparing\s+(?:to|for))\b|\b(?:i|we)\s+(?:plan|intend|want|need|have|would\s+like|wanna)\s+(?:to|on)\b|\b(?:i|we)\s*(?:will|'ll|shall)\s+(?:buy|pay|spend|get|book|order|go|have|purchase|renew|treat)\b|^\s*(?:planning|thinking\s+of|going)\s+(?:to|a|an|my|on|for)\b|\b(?:my|our)\s+plans?\s+(?:today|tonight|tomorrow|for|this|is|are|next)\b|\bbalak\s+(?:ko|kong|namin|naming)\b|\bplano\s+(?:ko|kong|namin|naming)\b/i;

/** It costs money: a verb of paying, or a thing that costs. */
const SPENDS =
  /\b(?:buy|bili|bumili|pay|bayad|bayaran|magbayad|spend|gastos|purchase|order|book|renew|get\s+(?:a|an|my|new|some|the)|treat|trip|travel|vacation|outing|party|birthday|tuition|enrol\w*|mall|shopping|shop|groceries|grocery|market|palengke|eat|dinner|lunch|breakfast|merienda|food|haircut|repair\w*|registration|gift|regalo|concert|ticket|phone|laptop|shoes|clothes|uniform|books?|fees?)\b/i;

/** Already happened: an entry, read by the entry readers. */
const MOVED = /\b(?:spent|paid|bought|purchased|got\s+paid|nagbayad|binili|bumili\s+na|nabili|ginastos|nagastos)\b/i;

/** Money coming in, kept or saved: not a plan to spend. */
const NOT_SPENDING = /\b(?:salary|sahod|sweldo|allowance|income|receive|recieve|get\s+paid|paid\s+me|send\s+me|save|saving|savings|ipon|withdraw|transfer|lend|borrow|utang|loan|debt|credit)\b/i;

/** A budget to set, not a thing to buy. */
const SETS_BUDGET = /\b(?:set|make|change|adjust|raise|lower|plan)\b[^.?!]{0,20}\bbudget\b/i;

/** Today by its words. "Later this month" is not today. */
const TODAY =
  /\b(?:today|tonight|now|ngayon|mamaya|this\s+(?:morning|afternoon|evening|noon)|later(?!\s+(?:this|next|in)\s+(?:week|month|year))|for\s+(?:lunch|dinner|breakfast|merienda)|lunch|dinner|breakfast|merienda)\b/i;

/** Where a day's spending happens: the mall, the market, eating out. */
const DAYS_PLACES = /\b(?:mall|sm|grocer\w*|market|palengke|supermarket|eat\s+out|kain|snacks?|fast\s*food|jollibee|mcdo|7-?eleven)\b/i;

/** A question about it, answered before any card. */
const ASKED = /\?|^\s*(?:what|how|can|could|should|would|will|is|am|do|does)\b|\b(?:how\s+much|can\s+i|could\s+i|should\s+i|is\s+it\s+enough|enough|what\s+budget|afford)\b/i;

const WANTS = /\b(?:want|treat|gadget|trip|travel|vacation|outing|concert|party|shopping|game|shoes|clothes|bag)\b/i;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** The day it is for, when one is said; null when none is. */
export function dayFor(text: string, asOf: IsoDate): IsoDate | null {
  const t = text.toLowerCase();
  const said = dayIn(t, asOf);
  if (said) return said;
  const y = Number(asOf.slice(0, 4));
  const wd = /\b(?:this\s+|next\s+|on\s+|sa\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(t);
  if (wd) {
    const want = WEEKDAYS.indexOf(wd[1] ?? "");
    const now = dayOfWeek(asOf);
    let ahead = (want - now + 7) % 7;
    if (ahead === 0) ahead = 7;
    return addDays(asOf, ahead);
  }
  if (/\bthis\s+weekend\b/.test(t)) return addDays(asOf, Math.max(1, (6 - dayOfWeek(asOf) + 7) % 7 || 7));
  if (/\bthis\s+week\b/.test(t)) return addDays(asOf, (7 - dayOfWeek(asOf)) % 7 || 7);
  if (/\bthis\s+month\b/.test(t)) return lastOfMonth(y, Number(asOf.slice(5, 7)));
  if (/\bnext\s+year\b/.test(t)) return `${y + 1}-12-31`;
  const year = /\b(?:in|by|for|on|this|sa|of)\s+(20\d{2})\b/.exec(t);
  if (year && Number(year[1]) >= y) return `${year[1]}-12-31`;
  if (/\b(?:christmas|pasko)\b/.test(t)) return `${asOf.slice(5) > "12-25" ? y + 1 : y}-12-25`;
  if (/\bnew\s+year\b/.test(t)) return `${y}-12-31`;
  return null;
}

/** What it is for, from the words after the verb: "a trip to Baguio", "my motor registration". */
function thingIn(text: string): string {
  // The thing is in the first clause: "my tuition next month but the date is unknown" is the tuition.
  const clause = text.split(/[?!;]|\.\s|,\s*(?:but|though|and\s+the|because)\b|\b(?:but|though|although|because|pero|kasi|how\s+much|what|can\s+you|can\s+i|could\s+you|could\s+i|is\s+it|will\s+it|should\s+i|do\s+i|and\s+(?:how|what|can|is))\b/i)[0] ?? text;
  const after =
    /\b(?:to\s+)?(?:buy|bili|bumili|get|purchase|order|pay(?:\s+for)?|bayaran|magbayad\s+(?:ng|sa)?|book|renew|have|treat\s+(?:myself|me)\s+to|go\s+(?:to|on)|spend\s+(?:(?:₱|php\s*)?[\d,.]+\s*k?\s+)?(?:on|for|sa))\s+(.+)$/i.exec(clause) ??
    /\b(?:planning|plan(?:ning)?\s+(?:on|for)|thinking\s+(?:of|about)|preparing\s+for|balak\s+(?:ko|kong)|plano\s+(?:ko|kong))\s+(.+)$/i.exec(clause) ??
    /\bmy\s+plans?\s+(?:today|tonight|tomorrow|is|are)\s+(?:is\s+|are\s+)?(?:to\s+)?(.+)$/i.exec(clause);
  let thing = after?.[1] ?? "";
  const months = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
  thing = withoutYears(thing)
    .replace(/^\s*(?:to\s+)?(?:buy|get|pay(?:\s+for)?|go\s+(?:to|on)|have)\s+/i, "")
    .replace(new RegExp(String.raw`\b(?:on|by|for|in|until|before|this|next|sa)?\s*${months}\.?(?:\s+\d{1,2}(?:st|nd|rd|th)?)?(?:,?\s+20\d{2})?\b`, "gi"), " ")
    .replace(/\b(?:on|by|for|in|due|before|sa)?\s*(?:next\s+(?:month|week|year)|this\s+(?:month|week|weekend|year)|end\s+of\s+(?:the\s+|this\s+)?month|tomorrow|bukas|today|tonight|now|ngayon|mamaya|later|this\s+(?:morning|afternoon|evening|noon)|in\s+\w+\s+(?:days?|weeks?|months?)|(?:on\s+)?the\s+\d{1,2}(?:st|nd|rd|th)|(?:this\s+|next\s+|on\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|in\s+20\d{2}|christmas|pasko)\b/gi, " ")
    .replace(/(?:₱|php\s*)?\d[\d,]*(?:\.\d{1,2})?\s*k?\b/gi, " ")
    .replace(/\b(?:from|using|with|via)\s+(?:my\s+)?(?:cash|gcash|maya|bank|card|wallet|savings)\b/gi, " ")
    .replace(/\b(?:around|about|approximately|roughly|maybe|probably|worth|pesos?|php|for\s+it|for\s+now|na|po|lang|siguro)\b/gi, " ")
    .replace(/[,.:;!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:a|an|the|my|our|some|ng|mga)\s+/i, "")
    .replace(/\s+(?:on|by|for|in|at|to|of|and|with|the|a|sa)$/i, "")
    .trim();
  return thing.length > 60 ? thing.slice(0, 60).replace(/\s+\S*$/, "") : thing;
}

const titleOf = (thing: string): string => thing.replace(/^./, (c) => c.toUpperCase());

/** The kind the words name outright: "food" is Food. */
function kindNamed(thing: string, ctx: PlanContext): string {
  const words = thing.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return planKinds(ctx.reference).options.find((k) => words.includes(k.toLowerCase()) || thing.toLowerCase() === k.toLowerCase()) ?? "";
}

/** The kind it would be filed under: one the words name ("food"), else what its entries were. */
function kindOf(thing: string, ctx: PlanContext): string {
  return kindNamed(thing, ctx) || (kindFromHistory(thing, ctx.transactions, planKinds(ctx.reference).options) ?? "");
}

/**
 * How many times in the last sixty days the ledger shows it bought. By the
 * kind only when the words name the kind ("food"); else by the thing's own
 * words, so a laptop filed under Online Buy is not everyday because Online
 * Buy is (27 October 2026, "I'm planning to buy a laptop" was answered as
 * today's spending).
 */
function timesBought(thing: string, ctx: PlanContext): number {
  const since = addDays(ctx.asOf, -60);
  const recent = ctx.transactions.filter((t) => t.type === "Spending" && t.date >= since && t.date <= ctx.asOf);
  const named = kindNamed(thing, ctx);
  if (named) return recent.filter((t) => t.item.trim().toLowerCase() === named.toLowerCase()).length;
  const words = thing.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  if (words.length === 0) return 0;
  return recent.filter((t) => words.some((w) => ` ${t.item} ${t.description} `.toLowerCase().includes(w))).length;
}

/** Bought this often or more in sixty days, it is everyday spending: today's money, not a plan. */
export const EVERYDAY = 8;

const shortDay = (d: IsoDate): string => `${MONTH_NAMES[Number(d.slice(5, 7)) - 1] ?? ""} ${Number(d.slice(8, 10))}`;

/**
 * What it cost before, for a plan said with no amount: the last few entries
 * whose words name it, else of its kind when the kind is not everyday.
 */
export function costHint(thing: string, kind: string, ctx: PlanContext): string {
  const words = thing
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !["with", "from", "that", "this", "there", "their"].includes(w));
  // The app's own carry-forward rows ("The 2025 records closed ...") are not purchases.
  const spending = ctx.transactions.filter((t) => t.type === "Spending" && t.date <= ctx.asOf && t.total > 0 && !/\brecords\s+(?:closed|opened)\b|\bcarried\s+(?:forward|over)\b/i.test(t.description));
  let rows = words.length > 0 ? spending.filter((t) => words.some((w) => t.description.toLowerCase().includes(w))) : [];
  if (rows.length === 0 && kind && timesBought(kind, ctx) < EVERYDAY) rows = spending.filter((t) => t.item.trim().toLowerCase() === kind.toLowerCase());
  /*
   * Small change beside the real thing is not what it cost: phone load is
   * not a phone. Of the five latest, those under a quarter of their middle
   * one, or a twentieth of the largest, are left out.
   */
  const latest = [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.recordNumber - a.recordNumber).slice(0, 5);
  const sorted = latest.map((t) => t.total).sort((a, b) => a - b);
  const middle = sorted.length === 0 ? 0 : sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  const most = sorted[sorted.length - 1] ?? 0;
  const last = latest.filter((t) => t.total * 4 >= middle && t.total * 20 >= most).slice(0, 3);
  if (last.length === 0) return "";
  return `What it cost before: ${last.map((t) => `${formatMoney(t.total)} on ${shortDay(t.date)}${t.date.slice(0, 4) !== ctx.asOf.slice(0, 4) ? `, ${t.date.slice(0, 4)}` : ""}${t.description.trim() ? ` (${t.description.trim().slice(0, 50)})` : ` (${t.item})`}`).join("; ")}.`;
}

/** The plan for one thing, filled in as the Planner's form would be. */
export function planInputFor(title: string, amount: Centavos | null, due: IsoDate, ctx: PlanContext, said = ""): PlanInput {
  const kind = kindOf(title, ctx);
  const wallet = [...ctx.reference.wallets, ...ctx.reference.savings].find((w) => new RegExp(`\\b(?:from|using|with|via)\\s+(?:my\\s+)?${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(said)) ?? "";
  return {
    title: titleOf(title),
    amount,
    due,
    item: kind,
    wallet,
    need: !WANTS.test(`${title} ${said}`),
    setAside: !isRecurringKind(kind, ctx.reference),
    notes: "",
  };
}

/** The end of the month after this one: the Planner's own default. */
export function nextMonthEnd(asOf: IsoDate): IsoDate {
  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7));
  return m === 12 ? lastOfMonth(y + 1, 1) : lastOfMonth(y, m + 1);
}

export function readPlanIntent(text: string, ctx: PlanContext): PlanIntent | null {
  const t = text.trim();
  if (!t || t.split(/\s+/).length > 45) return null;
  if (!INTENT.test(t) || !SPENDS.test(t)) return null;
  if (MOVED.test(t) || NOT_SPENDING.test(t) || SETS_BUDGET.test(t)) return null;
  const lower = t.toLowerCase();
  if ((ctx.debtNames ?? []).some((d) => d.trim() && lower.includes(d.trim().toLowerCase()))) return null;

  const thing = thingIn(t);
  const kind = kindOf(thing || t, ctx);
  // A bill or subscription is set aside every month already; its own readers say when it is due.
  if (kind && isRecurringKind(kind, ctx.reference)) return null;

  /*
   * "The date is unknown", "not sure when", "no exact date yet": a month may
   * be said, but no day. The card says so rather than passing its own pick
   * off as theirs (owner, 27 October 2026: "I plan to pay my tuition next
   * month but the date is unknown").
   */
  const noDay = /\b(?:date|day|when)\b[^.?!]{0,20}\b(?:unknown|not\s+(?:sure|known|yet|set|final)|tba|tbd|undecided|walang\s+petsa|di\s+pa\s+alam|hindi\s+pa\s+alam)\b|\bnot\s+sure\s+(?:when|what\s+day|of\s+the\s+date)\b|\bno\s+(?:exact\s+)?(?:date|day)\s+yet\b/i.test(t);
  const due = dayFor(t, ctx.asOf);
  // A day already gone is not a plan: it is an entry to add, or a question about it.
  if (due !== null && due < ctx.asOf) return null;
  if (due === ctx.asOf) return { kind: "today", thing, why: "day" };
  if (due === null) {
    if (TODAY.test(t) || DAYS_PLACES.test(t)) return { kind: "today", thing, why: "words" };
    if (timesBought(thing || t, ctx) >= EVERYDAY) return { kind: "today", thing, why: "often" };
  }
  if (!thing) return null;

  const asked = ASKED.test(t);
  // The month a question names, else the end of next month; said in the card.
  const ahead = aheadMonthIn(t, ctx.asOf);
  const payBy = due ?? (ahead ? lastOfMonth(ahead.year, ahead.month) : nextMonthEnd(ctx.asOf));
  const sums = plannedSpendIn(t);
  if (sums.length > 1) {
    return {
      kind: "later",
      plans: sums.map((s) => planInputFor(s.name, s.amount, payBy, ctx, t)),
      title: titleOf(thing),
      amountSaid: true,
      dueSaid: due !== null && !noDay,
      hint: "",
      asked,
    };
  }
  const amount = sums[0]?.amount ?? sumIn(t);
  return {
    kind: "later",
    plans: [planInputFor(thing, amount, payBy, ctx, t)],
    title: titleOf(thing),
    amountSaid: amount !== null,
    dueSaid: due !== null && !noDay,
    hint: amount === null ? costHint(thing, kind, ctx) : "",
    asked,
  };
}

/**
 * "Add it as a plan", "can you add it to my planner", "put the tuition on
 * the planner", "plan it": asking for something already said to go on the
 * Planner. "Set a plan" alone is a budget (4 October 2026), so not this.
 *
 * The owner, 27 October 2026: "If I have 9k in tuition pending how much do i
 * need including my budget to survive next month? Can you add it as a plan
 * for now", answered with a Budget change card, because "plan" was read as
 * "set a budget".
 */
export function asksToPlan(text: string): boolean {
  return (
    /\b(?:add|put|save|make|turn|set|include|log|list|record)\s+(?:it|that|this|them|those|these|(?:the|my|our)\s+[a-z]+(?:\s+[a-z]+)?)\s+(?:as|into|in|on|to)\s+(?:a\s+|my\s+|the\s+)?(?:plan|planner|plans)\b/i.test(text) ||
    /\b(?:to|in|into|on)\s+(?:my|the)\s+planner\b/i.test(text) ||
    /\bas\s+a\s+plan\b/i.test(text) ||
    /\b(?:plan|schedule)\s+(?:it|that|this|them)\b/i.test(text) ||
    /\bmake\s+(?:it|that|this)\s+a\s+plan\b/i.test(text) ||
    /\badd\s+(?:a\s+)?plan\s+for\s+(?:it|that|this|the|my)\b/i.test(text) ||
    /\bilagay\s+(?:mo\s+)?(?:sa|ito\s+sa)\s+planner\b/i.test(text)
  );
}

/** The thing "add the tuition as a plan" names, when it names one; "" for "add it as a plan". */
export function thingToPlan(text: string): string {
  const m = /\b(?:add|put|save|make|include|log|list|record)\s+(?:the|my|our|a|an)\s+(.+?)\s+(?:as|into|in|on|to)\s+(?:a\s+|my\s+|the\s+)?(?:plan|planner|plans)\b/i.exec(text);
  const thing = (m?.[1] ?? "").replace(/(?:₱|php\s*)?\d[\d,]*(?:\.\d{1,2})?\s*k?\b/gi, " ").replace(/\s+/g, " ").trim();
  return /^(?:it|that|this|them|those|these)$/i.test(thing) ? "" : thing;
}

/** Words naming which of several, when said ("add the tuition as a plan"): checked against each name. */
export function namesIt(text: string, name: string): boolean {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const said = ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, " ")} `;
  return words.some((w) => said.includes(` ${w} `) || said.includes(` ${w}s `));
}

/** "How much will it be?": the question when a plan was said with no amount, with what it cost before. */
export function askAmountWords(title: string, hint: string, due: IsoDate, dueSaid: boolean): string {
  return [
    `How much will ${title.toLowerCase().startsWith("my ") ? title : `the ${title.charAt(0).toLowerCase()}${title.slice(1)}`} be? Say the amount${dueSaid ? "" : " and the day"}, like "5000${dueSaid ? "" : ` by ${formatMedium(due).replace(/, \d{4}$/, "")}`}", and it goes on the Planner as a card to press. Nothing is saved until you press it.`,
    hint,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The plan a model's answer worked out, on its own line: "Plan: Tuition, PHP
 * 9,000.00, by 2026-11-15". The chat is told to end such an answer with one
 * (ai.ts), and the panel offers it as a Planner card, as it does an "Entry:"
 * line.
 */
export function planLineIn(text: string): string {
  const found = /^\s*(?:[-*]\s*)?\**plan\**\s*:\s*(.+?)\s*$/im.exec(text);
  return found?.[1]?.replace(/\*\*/g, "").trim() ?? "";
}

/** A "Plan:" line read into the Planner's form: what, how much, by when. Null when it says too little. */
export function readPlanLine(line: string, ctx: PlanContext): PlanInput | null {
  const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(line)?.[1];
  const due = iso ?? dayFor(line, ctx.asOf) ?? nextMonthEnd(ctx.asOf);
  const amount = sumIn(line.replace(/\b20\d{2}-\d{2}-\d{2}\b/g, " "));
  const title = (line.split(/,|\s+(?:php|₱)\s*\d|\s+\d/i)[0] ?? "").replace(/^\s*(?:a|an|the|my)\s+/i, "").trim();
  if (!title || amount === null || due < ctx.asOf) return null;
  const wallet = /\bfrom\s+([^,]+?)\s*(?:,|$)/i.exec(line)?.[1]?.trim() ?? "";
  const input = planInputFor(title, amount, due, ctx, line);
  return { ...input, wallet: [...ctx.reference.wallets, ...ctx.reference.savings].find((w) => w.toLowerCase() === wallet.toLowerCase()) ?? input.wallet };
}
