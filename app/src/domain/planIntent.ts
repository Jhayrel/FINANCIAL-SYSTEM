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
import { addDays, MONTH_NAMES } from "./dates";
import { formatMoney, withoutYears, type Centavos } from "./money";
import { aheadMonthIn, plannedSpendIn } from "./plannedSpend";
import { dueFor, isRecurringKind, kindFromHistory, NO_DATE, planKinds, type DueKind, type PlanInput } from "./planner";
import { capitalised, NO_DAY, sumIn, whenFor } from "./plannerAsk";
import { protectModels } from "./modelNumbers";
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
  /**
   * A day already gone: "I'm planning a trip on October 10" on the 26th. Not
   * a plan for later, and not money moved either; the chat asks which it is,
   * naming an entry that looks like it (27 October 2026).
   */
  | { readonly kind: "past"; readonly title: string; readonly plan: PlanInput }
  /**
   * One of the owner's own bills or subscriptions, said ahead: "I need to pay
   * the electric bill on nov 5, around 1200". Safe to spend holds it back
   * every month already, so it is no plan; it was booked as a paid entry
   * dated November 5 (27 October 2026 sweep).
   */
  | { readonly kind: "bill"; readonly name: string; readonly amount: Centavos | null; readonly due: IsoDate | null }
  /**
   * Money said to be coming in: "I will get my salary on the 30th", "my
   * friend will pay me 500 tomorrow". Booked when it arrives, never before;
   * it got the month's summary (27 October 2026 sweep).
   */
  | { readonly kind: "income"; readonly amount: Centavos | null; readonly due: IsoDate | null; readonly what: string }
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
// "I'm getting a haircut tomorrow", "thinking of getting a laptop", "I want a ps5", "plan: dinner 1500 saturday" (27 October 2026 sweep).
const INTENT =
  /\b(?:i'?m|im|i\s+am|we'?re|we\s+are)\s+(?:planning|thinking\s+(?:of|about)|going\s+to|gonna|about\s+to|preparing\s+(?:to|for)|getting|buying|booking|ordering|paying\s+for|treating|celebrating|throwing|hosting)\b|^\s*(?:i'?m\s+|im\s+)?thinking\s+(?:of|about)\s+(?:getting|buying|paying|booking|ordering|a|an|my|the)\b|\b(?:i|we)\s+(?:want|need|would\s+like|wanna)\s+(?:a|an|some|(?:a\s+)?new)\s+(?!(?:budget|limit|summary|report|chart|breakdown|list|advice|tips?|help|plan|answer|refund|receipt|break|rest)\b)|^\s*plan\s*[:\-]\s*\S|\b(?:i|we)\s+(?:plan|intend|want|need|have|would\s+like|wanna)\s+(?:to|on)\b|\b(?:i|we)\s+(?:plan|intend)\s+(?:next|this|in|on|by|sa)\s+[^.?!]{1,25}?\bto\b|\b(?:i|we)\s*(?:will|'ll|shall)\s+(?:buy|pay|spend|get|book|order|go|have|purchase|renew|treat)\b|^\s*(?:planning|thinking\s+of|going)\s+(?:to|a|an|my|on|for)\b|\b(?:my|our)\s+plans?\s+(?:today|tonight|tomorrow|for|this|is|are|next)\b|\bbalak\s+(?:ko|kong|namin|naming)\b|\bplano\s+(?:ko|kong|namin|naming)\b/i;

/*
 * Said as a question about buying, with no "I plan" in it: "what do you think
 * about buying a ps5?", "is it a good idea to buy a ps5 next month?", "I might
 * buy a jacket next month, good idea?" (27 October 2026 sweep, each got the
 * month's summary with the AI off).
 */
const WOULD_BUY =
  /\b(?:i|we)\s+(?:might|may|could)\s+(?:buy|get|order|book|purchase|pay\s+for)\b|\bwhat\s+(?:do|would)\s+you\s+(?:think|say)\s+(?:about|of)\s+(?:me\s+)?(?:buying|getting|ordering|booking|purchasing)\b|\b(?:is\s+it|would\s+it\s+be|it'?s)\s+(?:a\s+)?(?:good|bad|smart|wise)\s+(?:idea|move|choice)\s+(?:to|if\s+i)\s+(?:buy|get|order|book|purchase)\b|\bworth\s+(?:it\s+)?(?:to\s+)?(?:buy|buying|getting)\b|^\s*(?:please\s+)?remind\s+me\s+to\s+(?:buy|pay|get|order|book|renew)\b/i;

/** "Should I buy a ps5 next month?": a plan asked about only with a later day said; today's is the afford question's. */
const SHOULD_BUY = /\bshould\s+(?:i|we)\s+(?:buy|get|order|book|purchase)\b/i;

/**
 * A note with no verb, for later: "next week groceries 2000", "tuition next
 * month 9000". Only words that look ahead; "groceries saturday 2000" may be
 * last Saturday's, and the entry reader keeps it.
 */
const AHEAD = String.raw`(?:next\s+(?:week|weekend|month|(?:mon|tues|wednes|thurs|fri|satur|sun)day)|tomorrow|bukas|sa\s+susunod\s+na\s+(?:linggo|buwan))`;
const SUM = String.raw`(?:₱|php\s*)?\d[\d,]*(?:\.\d{1,2})?\s*k?`;
const TERSE = new RegExp(String.raw`^\s*(?:${AHEAD}\s+[a-z][a-z' ]{1,40}?\s+${SUM}|[a-z][a-z' ]{1,40}?\s+${AHEAD}\s+${SUM}|[a-z][a-z' ]{1,40}?\s+${SUM}\s+${AHEAD})\s*$`, "i");

/** Money coming in, said ahead. */
const INCOME_AHEAD =
  /\b(?:i|we)\s*(?:will|'ll|am\s+going\s+to|'m\s+going\s+to|m\s+going\s+to)\s+(?:get|receive|recieve)\s+(?:my\s+|our\s+|the\s+)?(?:salary|sahod|sweldo|allowance|pay|paycheck|bonus|13th\s+month|refund|stipend)\b|\b(?:will|'ll|going\s+to|gonna)\s+(?:pay|send|give)\s+(?:me|us)\b|\b(?:my\s+)?(?:salary|sahod|sweldo|allowance|bonus|paycheck)\s+(?:is\s+)?(?:coming|comes|arrives?|due)\b/i;

/** It costs money: a verb of paying, or a thing that costs. */
const SPENDS =
  /\b(?:buy|buying|bili|bumili|pay|paying|bayad|bayaran|magbayad|spend|gastos|purchase|order|ordering|book|booking|renew|get\s+(?:a|an|my|new|some|the)|getting\s+(?:a|an|my|new|some|the)|treat|treating|trip|travel|vacation|outing|party|birthday|tuition|enrol\w*|mall|shopping|shop|groceries|grocery|market|palengke|eat|dinner|lunch|breakfast|merienda|food|haircut|repair\w*|registration|gift|regalo|concert|ticket|phone|laptop|shoes|clothes|uniform|books?|fees?|iphone|ipad|airpods|macbook|tablet|ps5|playstation|xbox|nintendo|console|gadget|camera|watch|bike|motorcycle|car)\b/i;

/** Already happened: an entry, read by the entry readers. */
const MOVED = /\b(?:spent|paid|bought|purchased|got\s+paid|nagbayad|binili|bumili\s+na|nabili|ginastos|nagastos)\b/i;

/** Money coming in, kept or saved: not a plan to spend. */
const NOT_SPENDING = /\b(?:salary|sahod|sweldo|allowance|income|receive|recieve|get\s+paid|getting\s+paid|paid\s+me|send\s+me|save|saving|savings|ipon|withdraw|transfer|lend|borrow|utang|loan|debt|credit)\b/i;

/** A budget to set, not a thing to buy. */
const SETS_BUDGET = /\b(?:set|make|change|adjust|raise|lower|plan)\b[^.?!]{0,20}\bbudget\b/i;

/** Today by its words. "Later this month" is not today. */
const TODAY =
  /\b(?:today|tonight|now|ngayon|mamaya|this\s+(?:morning|afternoon|evening|noon)|later(?!\s+(?:this|next|in)\s+(?:week|month|year))|for\s+(?:lunch|dinner|breakfast|merienda)|lunch|dinner|breakfast|merienda)\b/i;

/** Where a day's spending happens: the mall, the market, eating out. */
const DAYS_PLACES = /\b(?:mall|sm|grocer\w*|market|palengke|supermarket|eat\s+out|kain|snacks?|fast\s*food|jollibee|mcdo|7-?eleven)\b/i;

/** A question about it, answered before any card. */
// "let me know", "tell me", "what do you think": asked for a view, as a question mark is (27 October 2026).
const ASKED = /\?|^\s*(?:what|how|can|could|should|would|will|is|am|do|does)\b|\b(?:how\s+much|can\s+i|could\s+i|should\s+i|is\s+it\s+enough|enough|what\s+budget|afford|let\s+me\s+know|tell\s+me|what\s+do\s+you\s+think|advise|ano\s+sa\s+tingin\s+mo)\b/i;

// A new phone, a console, a gadget: a want unless said otherwise ("iphone 18 pro max" was marked a need, 27 October 2026).
const WANTS = /\b(?:want|treat|jacket|hoodie|sneakers|perfume|makeup|gadget|trip|travel|vacation|outing|concert|party|shopping|game|games|gaming|shoes|clothes|bag|iphone|ipad|airpods|macbook|apple\s+watch|ps5|playstation|xbox|nintendo|console|upgrade)\b/i;


export { dayFor, whenFor } from "./plannerAsk";

/** What it is for, from the words after the verb: "a trip to Baguio", "my motor registration". */
function thingIn(text: string): string {
  // The thing is in the first clause: "my tuition next month but the date is unknown" is the tuition.
  // ", ok lang ba?", ", good idea?" are asked of it, not part of it ("Laptop ok ba", 27 October 2026 sweep).
  const pieces = text.split(/[?!;]|\.\s|,\s*(?:but|though|and\s+the|because|ok(?:ay)?|good\s+idea|worth|kaya|pwede|tama|right|ano|thoughts?)\b|\b(?:but|though|although|because|pero|kasi|how\s+much|what|can\s+you|can\s+i|could\s+you|could\s+i|is\s+it|will\s+it|should\s+i|do\s+i|and\s+(?:how|what|can|is)|ok(?:ay)?\s+lang\s+ba|good\s+idea|worth\s+it)\b/i);
  // "What do you think about buying a ps5": the thing is after the question words.
  const clause = pieces.find((p) => p.trim().split(/\s+/).length >= 2) ?? pieces[0] ?? text;
  const after =
    /^\s*plan\s*[:\-]\s*(.+)$/i.exec(clause) ??
    /\b(?:to\s+)?(?:buy(?:ing)?|bili|bumili|get(?:ting)?|purchas(?:e|ing)|order(?:ing)?|pay(?:ing)?(?:\s+for)?|bayaran|magbayad\s+(?:ng|sa)?|book(?:ing)?|renew(?:ing)?|hav(?:e|ing)|treat\s+(?:myself|me)\s+to|go\s+(?:to|on)|spend\s+(?:(?:₱|php\s*)?[\d,.]+\s*k?\s+)?(?:on|for|sa))\s+(.+)$/i.exec(clause) ??
    /\b(?:planning|plan(?:ning)?\s+(?:on|for)|thinking\s+(?:of|about)|preparing\s+for|balak\s+(?:ko|kong)|plano\s+(?:ko|kong))\s+(.+)$/i.exec(clause) ??
    /\bmy\s+plans?\s+(?:today|tonight|tomorrow|is|are)\s+(?:is\s+|are\s+)?(?:to\s+)?(.+)$/i.exec(clause);
  // "I'll treat my friends" is a treat; "I want a ps5" is a PS5 (27 October 2026 sweep).
  const treat = /\btreat(?:ing)?\s+(?!(?:myself|me)\s+to\b)(.+)$/i.exec(clause);
  const wanted = /\b(?:i|we)\s+(?:want|need|would\s+like|wanna)\s+((?:a|an|some|new)\s+.+)$/i.exec(clause);
  let thing = after?.[1] ?? (treat ? `treat ${treat[1]}` : (wanted?.[1] ?? (TERSE.test(clause) ? clause : "")));
  /*
   * What follows "like I want", "so I", "that costs" is how they feel about
   * it or what it costs, not what it is: "a trip on dec no date yet like i
   * want to spend 10k" is a trip, titled "Trip like i want to spend" until
   * this (owner, 27 October 2026).
   */
  thing =
    thing.split(/\s+(?:like\s+)?(?:i|we)\s+(?:want|wanna|need|think|guess|plan|will|would|might|hope|really)\b|\s+like\s+(?:i|we|maybe|around|about|mga|siguro)\b|\s+so\s+(?:i|we|that)\b|\s+(?:which|that)\s+(?:i|we|will|would|costs?|is)\b|\s+(?:let\s+me\s+know|tell\s+me|what\s+do\s+you\s+think|any\s+(?:advice|thoughts?)|please|pls)\b/i)[0] ?? thing;
  // "iphone 18 pro max": the model number is the name, kept through the cleaning below and put back (`modelNumbers.ts`).
  const models = protectModels(thing);
  thing = models.text;
  const months = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
  thing = withoutYears(thing)
    .replace(/^\s*(?:to\s+)?(?:buy(?:ing)?|get(?:ting)?|pay(?:ing)?(?:\s+for)?|go\s+(?:to|on)|hav(?:e|ing))\s+/i, "")
    .replace(new RegExp(String.raw`\b(?:on|by|for|in|until|before|this|next|sa)?\s*${months}\.?(?:\s+\d{1,2}(?:st|nd|rd|th)?)?(?:,?\s+20\d{2})?\b`, "gi"), " ")
    .replace(/\b(?:on|by|for|in|due|before|sa)?\s*(?:next\s+(?:month|week|year)|this\s+(?:month|week|weekend|year)|end\s+of\s+(?:the\s+|this\s+)?month|tomorrow|bukas|today|tonight|now|ngayon|mamaya|later|this\s+(?:morning|afternoon|evening|noon)|in\s+\w+\s+(?:days?|weeks?|months?)|(?:on\s+)?the\s+\d{1,2}(?:st|nd|rd|th)|(?:this\s+|next\s+|on\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|in\s+20\d{2}|christmas|pasko)\b/gi, " ")
    .replace(/(?:₱|php\s*)?\d[\d,]*(?:\.\d{1,2})?\s*k?\b/gi, " ")
    .replace(/\b(?:from|using|with|via)\s+(?:my\s+)?(?:cash|gcash|maya|bank|card|wallet|savings)\b/gi, " ")
    .replace(new RegExp(NO_DAY.source, "gi"), " ")
    .replace(/\b(?:(?:the\s+day\s+before\s+)?yesterday|kahapon|last\s+week)\b/gi, " ")
    .replace(/\b(?:around|about|approximately|roughly|maybe|probably|worth|pesos?|php|for\s+it|for\s+now|na|po|lang|siguro)\b/gi, " ")
    .replace(/[,.:;!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:a|an|the|my|our|some|ng|mga)\s+/i, "")
    .replace(/\s+(?:on|by|for|in|at|to|of|and|with|the|a|sa)$/i, "")
    .trim();
  thing = models.restore(thing).replace(/\s+/g, " ").trim();
  return thing.length > 60 ? thing.slice(0, 60).replace(/\s+\S*$/, "") : thing;
}

const titleOf = (thing: string): string => capitalised(thing);

/** The kind the words name outright: "food" is Food. */
function kindNamed(thing: string, ctx: PlanContext): string {
  const words = thing.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return planKinds(ctx.reference).options.find((k) => words.includes(k.toLowerCase()) || thing.toLowerCase() === k.toLowerCase()) ?? "";
}

/** Everyday words for a kind, used only when that kind is on the owner's list: a trip is Travel. */
const KIND_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:trip|travel|vacation|outing|getaway|bakasyon|lakad|flight|hotel)\b/i, "travel"],
  [/\b(?:tuition|enrol\w*|school|uniform|thesis|capstone)\b/i, "school"],
  [/\b(?:groceries|grocery|dinner|lunch|breakfast|meal|food)\b/i, "food"],
  [/\b(?:gifts?|regalo|present)\b/i, "gifts"],
  [/\b(?:haircut|salon|spa|skincare)\b/i, "self care"],
  [/\b(?:repairs?|fix|maintenance|change\s+oil|tune\s*up)\b/i, "repairs"],
];

/** The kind it would be filed under: one the words name ("food"), else what its entries were, else what the words usually mean. */
function kindOf(thing: string, ctx: PlanContext): string {
  const options = planKinds(ctx.reference).options;
  const usual = (): string => {
    const hit = KIND_WORDS.find(([words]) => words.test(thing));
    return hit ? (options.find((k) => k.toLowerCase() === hit[1]) ?? "") : "";
  };
  return kindNamed(thing, ctx) || (kindFromHistory(thing, ctx.transactions, options) ?? "") || usual();
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
export function planInputFor(title: string, amount: Centavos | null, due: IsoDate, ctx: PlanContext, said = "", dueKind: DueKind = "day"): PlanInput {
  const kind = kindOf(title, ctx);
  const wallet = [...ctx.reference.wallets, ...ctx.reference.savings].find((w) => new RegExp(`\\b(?:from|using|with|via)\\s+(?:my\\s+)?${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(said)) ?? "";
  return {
    title: titleOf(title),
    amount,
    due: dueFor(dueKind, due),
    dueKind,
    item: kind,
    wallet,
    need: !WANTS.test(`${title} ${said}`),
    setAside: !isRecurringKind(kind, ctx.reference),
    notes: "",
  };
}

export { nextMonthEnd } from "./planner";

export function readPlanIntent(text: string, ctx: PlanContext): PlanIntent | null {
  const t = text.trim();
  if (!t || t.split(/\s+/).length > 45) return null;
  const lower = t.toLowerCase();
  const owed = (ctx.debtNames ?? []).some((d) => d.trim() && lower.includes(d.trim().toLowerCase()));
  if (INCOME_AHEAD.test(t) && !ASKED.test(t) && !MOVED.test(t) && !owed) {
    const when = whenFor(t, ctx.asOf);
    const what = /\b(salary|sahod|sweldo|allowance|bonus|paycheck|stipend|refund|13th\s+month)\b/i.exec(t)?.[1]?.toLowerCase() ?? "";
    return { kind: "income", amount: sumIn(t), due: when?.due ?? null, what };
  }
  const should = SHOULD_BUY.test(t) && !INTENT.test(t) && !WOULD_BUY.test(t);
  if (!(((INTENT.test(t) || WOULD_BUY.test(t) || should) && SPENDS.test(t)) || TERSE.test(t))) return null;
  if (MOVED.test(t) || NOT_SPENDING.test(t) || SETS_BUDGET.test(t)) return null;
  if (owed) return null;
  // "Should I buy a ps5?" with no later day is about today's money; with one, it is a plan asked about.
  if (should && (whenFor(t, ctx.asOf)?.due ?? "") <= ctx.asOf && aheadMonthIn(t, ctx.asOf) === null) return null;

  const thing = thingIn(t);
  const kind = kindOf(thing || t, ctx);
  // A bill or subscription is set aside every month already: said back as one, never a plan or an entry.
  if (kind && isRecurringKind(kind, ctx.reference)) {
    const when = whenFor(t, ctx.asOf);
    return { kind: "bill", name: kind, amount: plannedSpendIn(t)[0]?.amount ?? sumIn(t), due: when?.due ?? null };
  }

  /*
   * "The date is unknown", "not sure when", "no exact date yet": a month may
   * be said, but no day. The card says so rather than passing its own pick
   * off as theirs (owner, 27 October 2026: "I plan to pay my tuition next
   * month but the date is unknown").
   */
  const noDay = NO_DAY.test(t);
  const when = whenFor(t, ctx.asOf);
  const due = when?.due ?? null;
  // A day already gone is not a plan for later: paid already (an entry), or still to pay (a new day).
  if (due !== null && due < ctx.asOf) {
    if (!thing) return null;
    return { kind: "past", title: titleOf(thing), plan: planInputFor(thing, plannedSpendIn(t)[0]?.amount ?? sumIn(t), due, ctx, t, when?.kind ?? "day") };
  }
  if (due === ctx.asOf && when?.kind === "day") return { kind: "today", thing, why: "day" };
  if (due === null && !noDay) {
    if (TODAY.test(t) || DAYS_PLACES.test(t)) return { kind: "today", thing, why: "words" };
    if (timesBought(thing || t, ctx) >= EVERYDAY) return { kind: "today", thing, why: "often" };
  }
  if (!thing) return null;

  const asked = ASKED.test(t);
  /*
   * The day, month or year said; else the month a question names; else no
   * date at all. Nothing is given a day nobody said (owner, 27 October 2026:
   * "LIKE NO DATE LIKE NO IDEA WHEN").
   */
  const ahead = aheadMonthIn(t, ctx.asOf);
  const dueKind: DueKind = when ? when.kind : ahead ? "month" : "none";
  const payBy = due ?? (ahead ? dueFor("month", `${ahead.year}-${String(ahead.month).padStart(2, "0")}-01`) : NO_DATE);
  const sums = plannedSpendIn(t);
  if (sums.length > 1) {
    return {
      kind: "later",
      plans: sums.map((s) => planInputFor(s.name, s.amount, payBy, ctx, t, dueKind)),
      title: titleOf(thing),
      amountSaid: true,
      dueSaid: dueKind !== "none",
      hint: "",
      asked,
    };
  }
  const amount = sums[0]?.amount ?? sumIn(t);
  /*
   * Asked whether to buy it ("I might buy a jacket, good idea?"): a want,
   * unless it is plainly a need. It was "marked a need" (27 October 2026 sweep).
   */
  const one = planInputFor(thing, amount, payBy, ctx, t, dueKind);
  const wondering = (WOULD_BUY.test(t) || should) && !/\b(?:tuition|school|rent|bills?|medicine|medical|hospital|repairs?|fare|uniform|books?|enrol\w*|groceries)\b/i.test(t);
  return {
    kind: "later",
    plans: [wondering ? { ...one, need: false } : one],
    title: titleOf(thing),
    amountSaid: amount !== null,
    dueSaid: dueKind !== "none",
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
export function askAmountWords(title: string, hint: string, _due: IsoDate, dueSaid: boolean): string {
  return [
    // "PS5" and "iPhone" keep their capitals: only a plain word is lowered ("the pS5", 27 October 2026 sweep).
    `How much will ${title.toLowerCase().startsWith("my ") ? title : `the ${/^[A-Z][a-z]/.test(title) ? `${title.charAt(0).toLowerCase()}${title.slice(1)}` : title}`} be? Say the amount${dueSaid ? "" : ", and when if you know it"}, like "5000"${dueSaid ? "" : ', "5000 by December 20" or "5000 in December"'}.${dueSaid ? "" : " With no date it is kept on the Planner and counted nowhere until it has one."} It comes back as a card to press; nothing is saved until you press it.`,
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
  // "by 2026-11-15", "in November 2026", "in 2027", "no date yet".
  const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(line)?.[1];
  const when = iso ? { due: iso, kind: "day" as const } : NO_DAY.test(line) ? null : whenFor(line, ctx.asOf);
  const kind: DueKind = when ? when.kind : "none";
  const due = when ? when.due : NO_DATE;
  const amount = sumIn(line.replace(/\b20\d{2}-\d{2}-\d{2}\b/g, " ").replace(/\b(?:in|by|of)\s+20\d{2}\b/gi, " "));
  const title = (line.split(/,|\s+(?:php|₱)\s*\d|\s+\d/i)[0] ?? "").replace(/^\s*(?:a|an|the|my)\s+/i, "").trim();
  if (!title || amount === null || due < ctx.asOf) return null;
  const wallet = /\bfrom\s+([^,]+?)\s*(?:,|$)/i.exec(line)?.[1]?.trim() ?? "";
  const input = planInputFor(title, amount, due, ctx, line, kind);
  return { ...input, wallet: [...ctx.reference.wallets, ...ctx.reference.savings].find((w) => w.toLowerCase() === wallet.toLowerCase()) ?? input.wallet };
}
