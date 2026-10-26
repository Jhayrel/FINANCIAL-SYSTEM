/**
 * The Planner from the chat: "plan tuition 9000 on nov 15", "what's
 * planned?", "move the tuition plan to nov 30", "I paid the haircut plan",
 * "skip the trip plan", "remove the gym plan", "put back the trip plan".
 *
 * The owner, 26 October 2026: "Make sure ai can do it all too any type of
 * edit edit add etc". Every one names the Planner or a plan in so many
 * words, so "I plan to spend 1000 on dinner tonight" and "I plan to spend
 * 3000 on a trip next month, what budget should I set?" stay the questions
 * they are (`plannedSpend.ts`). Each change is a card to press.
 */
import { addDays, formatMedium, lastOfMonth, MONTH_NAMES } from "./dates";
import { formatMoney, parseAmount, withoutYears, type Centavos } from "./money";
import { kindFromHistory, type Plan, type PlanInput, type PlanView } from "./planner";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

export type PlannerAsk =
  | { readonly kind: "list" }
  | { readonly kind: "add"; readonly input: PlanInput }
  | { readonly kind: "move"; readonly plan: Plan; readonly to: IsoDate }
  | { readonly kind: "amount"; readonly plan: Plan; readonly amount: Centavos }
  | { readonly kind: "skip"; readonly plan: Plan }
  | { readonly kind: "remove"; readonly plan: Plan }
  | { readonly kind: "restore"; readonly plan: Plan }
  | { readonly kind: "pay"; readonly plan: Plan; readonly amount: Centavos | null; readonly wallet: string }
  /** It names a plan that is not there. */
  | { readonly kind: "none"; readonly said: string };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;

/** A day said: "nov 15", "november 15 2026", "the 30th", "next month", "by december", "in 2 weeks". */
export function dayIn(text: string, asOf: IsoDate): IsoDate | null {
  const t = text.toLowerCase();
  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7));
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const named = new RegExp(String.raw`\b${MONTH_RE}\.?(?:\s+(\d{1,2})(?:st|nd|rd|th)?)?(?:,?\s+(20\d{2}))?\b`).exec(t);
  if (named && !/^may$/.test(named[1] ?? "") || (named && /\b(?:in|by|on|for|until|till|this|next)\s+may\b/.test(t))) {
    const month = MONTHS.indexOf((named[1] ?? "").slice(0, 3)) + 1;
    let year = named[3] ? Number(named[3]) : y;
    if (!named[3] && month < m) year += 1;
    const day = named[2] ? Math.min(Number(named[2]), 31) : null;
    const date = day ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : lastOfMonth(year, month);
    return date;
  }
  if (/\bnext\s+month\b/.test(t)) return m === 12 ? lastOfMonth(y + 1, 1) : lastOfMonth(y, m + 1);
  if (/\bend of (?:the |this )?month\b/.test(t)) return lastOfMonth(y, m);
  if (/\btomorrow\b/.test(t)) return addDays(asOf, 1);
  if (/\bnext\s+week\b/.test(t)) return addDays(asOf, 7);
  const span = /\bin\s+(\d{1,2}|a|one|two|three)\s+(days?|weeks?|months?)\b/.exec(t);
  if (span) {
    const n = /^\d+$/.test(span[1] ?? "") ? Number(span[1]) : ({ a: 1, one: 1, two: 2, three: 3 } as Record<string, number>)[span[1] ?? ""] ?? 1;
    return (span[2] ?? "").startsWith("day") ? addDays(asOf, n) : (span[2] ?? "").startsWith("week") ? addDays(asOf, n * 7) : addDays(asOf, n * 30);
  }
  const nth = /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/.exec(t);
  if (nth) {
    const day = Number(nth[1]);
    const here = `${asOf.slice(0, 7)}-${String(day).padStart(2, "0")}`;
    return here >= asOf ? here : m === 12 ? `${y + 1}-01-${String(day).padStart(2, "0")}` : `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

/** A sum said: "9000", "9k", "PHP 9,000". */
function sumIn(text: string): Centavos | null {
  const m = /(?:₱|php\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(k)?\b(?!\s*(?:st|nd|rd|th|days?|weeks?|months?|%))/i.exec(withoutYears(text).replace(new RegExp(String.raw`\b${MONTH_RE}\.?\s+\d{1,2}(?:st|nd|rd|th)?\b`, "gi"), " "));
  if (!m?.[1]) return null;
  const base = parseAmount(m[1]);
  return base === null || base <= 0 ? null : m[2] ? base * 1000 : base;
}

/** The plan a sentence names, by the words of its title; the state asked about first. */
export function planNamed(text: string, plans: readonly Plan[], prefer: readonly Plan["status"][]): Plan | null {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, " ")} `;
  const scored = plans
    .map((p) => {
      const words = p.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
      const hits = words.filter((w) => lower.includes(` ${w} `) || lower.includes(` ${w}s `)).length;
      return { p, hits, all: words.length > 0 && hits === words.length };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => Number(b.all) - Number(a.all) || b.hits - a.hits || prefer.indexOf(a.p.status) - prefer.indexOf(b.p.status) || b.p.due.localeCompare(a.p.due));
  const preferred = scored.find((s) => prefer.includes(s.p.status));
  return (preferred ?? scored[0])?.p ?? null;
}

const PLANNER = /\b(?:planner|plans?|planned)\b/i;
const QUESTIONISH = /\?\s*$|^\s*(?:what|how|can|could|should|would|will|is|am|do|does)\b/i;

export function readPlannerAsk(
  text: string,
  context: { readonly plans: readonly Plan[]; readonly reference: ReferenceLists; readonly transactions: readonly Transaction[]; readonly asOf: IsoDate },
): PlannerAsk | null {
  const t = text.trim();
  if (!t || t.split(/\s+/).length > 30) return null;
  const { plans, reference, transactions, asOf } = context;

  // "What's planned?", "show my planner", "what plans are due this week?"
  if (/\b(?:what(?:'s| is| do i have)?|show|list|any|see|check)\b[^.?!]{0,30}\b(?:planned|planner|plans)\b/i.test(t) && !/\b(?:add|move|skip|remove|delete|pay|paid)\b/i.test(t)) {
    return { kind: "list" };
  }

  // Adding: "plan tuition 9000 on nov 15", "add a new phone 25k by march 2027 to my planner".
  const adds =
    /^\s*(?:please\s+|pls\s+)?(?:plan|schedule)\s+(?!to\b)/i.test(t) ||
    /\b(?:to|in|into|on)\s+(?:my|the)\s+planner\b|\badd\s+(?:a\s+)?(?:new\s+)?plan\b|\bnew\s+plan\b|^\s*remind\s+me\s+to\s+pay\b/i.test(t);
  if (adds && !QUESTIONISH.test(t)) {
    const amount = sumIn(t);
    const due = dayIn(t, asOf) ?? lastOfMonth(Number(asOf.slice(0, 4)) + (Number(asOf.slice(5, 7)) === 12 ? 1 : 0), (Number(asOf.slice(5, 7)) % 12) + 1);
    const wallet = [...reference.wallets, ...reference.savings].find((w) => new RegExp(`\\b(?:from|using|with|via)\\s+${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) ?? "";
    const title = t
      .replace(/^\s*(?:please\s+|pls\s+)?(?:plan|schedule|add|put|remind\s+me\s+to\s+pay)\s+/i, "")
      .replace(/\b(?:to|in|into|on)\s+(?:my|the)\s+planner\b/gi, " ")
      .replace(/\b(?:a\s+)?(?:new\s+)?plan\s+(?:for\s+)?/gi, " ")
      .replace(/(?:₱|php\s*)?\d[\d,]*(?:\.\d{1,2})?\s*k?\b/gi, " ")
      .replace(new RegExp(String.raw`\b(?:on|by|for|in|until|before|this|next)?\s*${MONTH_RE}\.?(?:\s+\d{1,2}(?:st|nd|rd|th)?)?(?:,?\s+20\d{2})?\b`, "gi"), " ")
      .replace(/\b(?:by|on|for|in|due|before)?\s*(?:next\s+(?:month|week)|end of (?:the |this )?month|tomorrow|in\s+\w+\s+(?:days?|weeks?|months?))\b/gi, " ")
      .replace(/\b(?:from|using|with|via)\s+\S+/gi, " ")
      .replace(/\b(?:pesos?|php|worth|of|to pay|pay|for|by|on|due|the|my|a|an)\b/gi, " ")
      .replace(/[,.:;!]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (amount === null || !title) return null;
    const kinds = [...new Set([...reference.spendingTypes.map((s) => s.name), ...reference.bills, ...reference.subscriptions])];
    const name = title.replace(/^./, (c) => c.toUpperCase());
    const recurring = [...reference.bills, ...reference.subscriptions].some((b) => b.toLowerCase() === (kindFromHistory(name, transactions, kinds) ?? "").toLowerCase());
    return {
      kind: "add",
      input: { title: name, amount, due, item: kindFromHistory(name, transactions, kinds) ?? "", wallet, need: !/\b(?:want|treat|gadget|trip|vacation|concert)\b/i.test(t), setAside: !recurring, notes: "" },
    };
  }

  if (!PLANNER.test(t)) return null;
  const open = plans.filter((p) => p.status === "open");

  if (/\b(?:put\s+back|restore|bring\s+back|un-?skip|reopen)\b/i.test(t)) {
    const plan = planNamed(t, plans, ["removed", "skipped", "done"]);
    return plan ? { kind: "restore", plan } : { kind: "none", said: t };
  }
  if (/\b(?:remove|delete|take\s+off|drop)\b/i.test(t)) {
    const plan = planNamed(t, plans, ["open", "skipped", "done"]);
    return plan ? { kind: "remove", plan } : { kind: "none", said: t };
  }
  if (/\b(?:skip|cancel|won'?t|not\s+(?:going|buying|paying)|no\s+longer|call\s+off)\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    return plan ? { kind: "skip", plan } : { kind: "none", said: t };
  }
  if (/\b(?:move|extend|push|postpone|resched\w*|delay|change\s+the\s+date|later\s+to)\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    const to = dayIn(t, asOf);
    return plan && to ? { kind: "move", plan, to } : plan ? null : { kind: "none", said: t };
  }
  if (/\b(?:paid|pay|settle|mark\b[^.?!]{0,30}\bpaid)\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    if (!plan) return { kind: "none", said: t };
    const wallet = [...reference.wallets, ...reference.savings].find((w) => new RegExp(`\\b${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) ?? "";
    return { kind: "pay", plan, amount: sumIn(t), wallet };
  }
  if (/\b(?:is\s+now|now|costs?|price|change|make\s+it|actually)\b/i.test(t)) {
    const plan = planNamed(t, open, ["open"]);
    const amount = sumIn(t);
    return plan && amount !== null && amount !== plan.amount ? { kind: "amount", plan, amount } : null;
  }
  return null;
}

/** "What's planned?": the open plans, overdue first, each with its state. */
export function plansWords(views: readonly PlanView[], setAside: Centavos): string {
  const open = views.filter((v) => v.state !== "paid" && v.state !== "skipped" && v.state !== "removed").sort((a, b) => a.plan.due.localeCompare(b.plan.due));
  if (open.length === 0) return 'Nothing is planned. Say "plan tuition 9000 by November 15" and it goes on the Planner, or open the Planner to add one.';
  const total = open.reduce((s, v) => s + v.left, 0);
  const lines = open.slice(0, 12).map((v) => `- ${v.plan.title}: ${formatMoney(v.left)} by ${formatMedium(v.plan.due)}. ${v.words}${v.counts ? ", set aside" : ""}${v.goal && !v.goal.missing ? `, ${v.goal.name} holds ${formatMoney(v.goal.holds)}` : ""}.`);
  return [
    `**${open.length} ${open.length === 1 ? "plan" : "plans"} open, ${formatMoney(total)} still to pay.**${setAside > 0 ? ` ${formatMoney(setAside)} of it is set aside from this month's safe to spend.` : ""}`,
    ...lines,
    open.length > 12 ? `And ${open.length - 12} more on the Planner.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** "November 15, 2026" with how far off it is. */
export function dueWords(due: IsoDate, asOf: IsoDate): string {
  const month = MONTH_NAMES[Number(due.slice(5, 7)) - 1] ?? "";
  return `${month} ${Number(due.slice(8, 10))}, ${due.slice(0, 4)}${due < asOf ? " (already passed)" : ""}`;
}
