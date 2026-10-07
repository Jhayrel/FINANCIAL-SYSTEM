/**
 * A note after spending is saved, when there is something worth knowing.
 *
 * ── What the owner asked for ───────────────────────────────────────────────
 *
 * 28 September 2026: "example I spend then its already over the budget ...
 * but dont make those pushy what if its food or gas or whatever that is
 * important that is not in the budget but its need? just make it good and
 * reasonable".
 *
 * So the rules here are about restraint first:
 *
 *   - Only an entry dated this month, that costs something, says anything.
 *     Catching up on last week's receipts is bookkeeping, not news.
 *   - Only a change is worth a note: the month goes past its budget, an item
 *     goes past a limit the owner set, or the month goes past nine tenths of
 *     its budget. Each of those is said once a month, never on every save.
 *     A limit is read from where the kind stands after the save, not from
 *     whether this one save crossed it: a save of several cards, an edit or
 *     a limit set after the kind was already over took it past its limit
 *     and nothing was ever said (7 October 2026 limits audit).
 *   - Spending paid with borrowed money is said every time, with whose money
 *     it was and what of the owner's own is left (7 October 2026: "it warns
 *     me like you're using that money from credit and you spend it to
 *     treat"). Money held for someone, the same. See `borrowed.ts`.
 *   - A need (food, fuel, health, school, bills, home needs) is never judged.
 *     Its note says it is counted, and at most where the month's wants have
 *     room. Once the month is already over, saving a need says nothing.
 *   - A want, once the month is already over, is mentioned at most once a
 *     day, and only when it is not small.
 *
 * Every figure is worked out here, in centavos. The model may word the note
 * (`functions/api/ai.ts`, task "note") but is given these facts and nothing
 * else, and its words are thrown away if they carry a figure these do not.
 */

import { assessMonth, budgetForMonth } from "./budget";
import { categoryLimits } from "./budgetView";
import { daysLeftInMonth, firstOfMonth, getMonth, getYear, lastOfMonth, monthName } from "./dates";
import { formatMoney, type Centavos } from "./money";
import { costOf, monthTotals, UNCATEGORISED } from "./totals";
import { limitKindOf, spendingTrackByKind } from "./kinds";
import { borrowedMoney, lenderNames } from "./borrowed";
import type { Debt } from "./debt";
import type { Budgets, IsoDate, SpendingType, Transaction } from "./types";

/** Things bought because they are needed, whatever the budget says. */
export const NEEDS =
  /\b(food|groceries|grocery|rice|meals?|gas|fuel|diesel|health|medicine|medical|pharmacy|clinic|hospital|school|tuition|books?|home needs|household|rent|utilit\w*|electric\w*|water|wifi|internet|bills?|repairs?|transport\w*|fare|commute|parking|toll|emergency|load|baby|milk)\b/i;

export type NoteStage = "borrowed" | "crossed" | "limit" | "near" | "over-want";

/**
 * Whether a kind of spending is a need. The owner marks each kind on the
 * list as essential, an emergency or discretionary; the words are the guess
 * only for a kind not marked.
 */
export function isNeed(name: string, spendingTypes: readonly Pick<SpendingType, "name" | "necessity">[] = []): boolean {
  const marked = spendingTypes.find((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase())?.necessity;
  if (marked === "discretionary") return false;
  if (marked === "essential" || marked === "emergency") return true;
  return NEEDS.test(name);
}

/** What the note can see beyond the ledger: whose money is borrowed, which accounts are the owner's, and which kinds are needs. */
export interface NoteContext {
  readonly debts?: readonly Debt[] | undefined;
  readonly accounts?: readonly string[] | undefined;
  readonly spendingTypes?: readonly Pick<SpendingType, "name" | "necessity">[] | undefined;
}

export interface SpendNote {
  /** Said once: a note with an id already shown is not shown again. */
  readonly id: string;
  readonly stage: NoteStage;
  /** Short, for the notice's title. */
  readonly title: string;
  /** The note in the device's own words. */
  readonly text: string;
  /** What the note is made of, for the model to word; every figure in it is exact. */
  readonly facts: readonly string[];
  /** A need: never judged. */
  readonly need: boolean;
  /** Other notes this one already says, so they are not said again. */
  readonly also?: readonly string[] | undefined;
}

const money = (c: Centavos): string => formatMoney(c);

/** The kind a limit counts the row under: the spending track's own split (`kinds.ts`). */
const kindOf = limitKindOf;

/**
 * The note for what was just saved, or null when there is nothing worth
 * saying. `before` is the ledger without the new rows; `shown` holds the ids
 * of notes already said.
 */
export function spendNoteFor(
  saved: readonly Transaction[],
  before: readonly Transaction[],
  budgets: Budgets,
  asOf: IsoDate,
  shown: ReadonlySet<string>,
  context: NoteContext = {},
): SpendNote | null {
  const month = asOf.slice(0, 7);
  const rows = saved.filter((t) => t.date.startsWith(month) && costOf(t) > 0);
  if (rows.length === 0) return null;

  const year = getYear(asOf);
  const m = getMonth(asOf);
  const name = `${monthName(m)}`;
  const main = [...rows].sort((a, b) => costOf(b) - costOf(a))[0];
  if (!main) return null;
  const cost = rows.reduce((sum, t) => sum + costOf(t), 0);
  const bills = main.type === "Spending" && (main.category === "Bills" || main.category === "Subscriptions");
  const track = bills ? "billsSubs" : "spending";
  const kind = kindOf(main);
  const label = (main.item.trim() || kind || (bills ? main.category : "This")).replace(/^Uncategorised$/, "This entry");
  const need = bills || isNeed(kind ?? main.item, context.spendingTypes) || (!kind && NEEDS.test(main.item));

  const budget = budgetForMonth(budgets, year, m);
  const after = [...before, ...rows];
  const was = assessMonth(monthTotals(before, year, m), budget)[track];
  const now = assessMonth(monthTotals(after, year, m), budget)[track];
  // Today included, as the Budget screen and the Dashboard count them (6 October 2026 audit).
  const daysLeft = daysLeftInMonth(asOf);
  const trackName = bills ? "bills and subscriptions" : "spending";
  const range = { start: firstOfMonth(year, m), end: lastOfMonth(year, m) };

  /** The wants this month with the most in them: where there is room, if any is wanted. */
  const wants = (): { words: string; count: number } => {
    const list = [...spendingTrackByKind(after, range)]
      .filter(([k, v]) => v > 0 && !isNeed(k, context.spendingTypes) && k !== UNCATEGORISED && !/transaction fee/i.test(k))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
    return { words: list.map(([k, v]) => `${k} ${money(v)}`).join(" and "), count: list.length };
  };

  const pick = (candidate: SpendNote | null): SpendNote | null => (candidate && !shown.has(candidate.id) ? candidate : null);

  // Every kind this save touched that is past its limit now, and not yet said.
  const limits = categoryLimits(budgets[String(year)], m);
  const pastLimit = [...new Set(rows.map(kindOf).filter((k): k is string => k !== null))]
    .map((k) => ({ kind: k, limit: limits.get(k) ?? 0, now: spendingTrackByKind(after, range).get(k) ?? 0 }))
    .filter((x) => x.limit > 0 && x.now > x.limit && !shown.has(`${month}:limit:${x.kind.toLowerCase()}`));

  // ── 0. Borrowed money, or money held for someone, paid for it ───────────
  if (context.debts && context.debts.length > 0 && context.accounts && context.accounts.length > 0) {
    const b = borrowedMoney(after, context.debts, context.accounts);
    const lent = new Map<string, number>();
    const held = new Map<string, number>();
    let fromLent = 0;
    let fromHeld = 0;
    for (const r of rows) {
      const use = b.spent.get(r.id);
      if (use) {
        fromLent += use.amount;
        for (const [id, v] of use.from) lent.set(id, (lent.get(id) ?? 0) + v);
      }
      const hold = b.spentHeld.get(r.id);
      if (hold) {
        fromHeld += hold.amount;
        for (const [id, v] of hold.from) held.set(id, (held.get(id) ?? 0) + v);
      }
    }
    if (fromLent > 0 || fromHeld > 0) {
      const whose = fromLent > 0 ? lenderNames(lent, context.debts) : "";
      const forWhom = fromHeld > 0 ? lenderNames(held, context.debts) : "";
      const ownLeft = b.own;
      const facts = [
        `Saved: ${label} ${money(cost)}.`,
        ...(fromLent > 0 ? [`${money(fromLent)} of it was borrowed money, from ${whose}: their own money in the accounts ran out first.`] : []),
        ...(fromHeld > 0 ? [`${money(fromHeld)} of it was money held for ${forWhom}, which is not theirs.`] : []),
        `Their own money left in their accounts: ${money(ownLeft)}. Borrowed money still in them: ${money(b.inHand)}.`,
        need ? `${label} is a need.` : `${label} is not a need.`,
      ];
      const parts = [
        fromLent > 0 ? `${money(fromLent)} of this ${money(cost)} ${label} was borrowed money, from ${whose}.` : "",
        fromHeld > 0 ? `${money(fromHeld)} of it was money held for ${forWhom}, which has to go back.` : "",
        `Your own money left: ${money(ownLeft)}${b.inHand > 0 ? `; borrowed still in your wallets: ${money(b.inHand)}` : ""}.`,
        need ? "It is a need, so this is for knowing." : "",
      ].filter(Boolean);
      const extra = pastLimit.map((x) => `${x.kind} is ${money(x.now)}, past its ${money(x.limit)} limit.`);
      const note = pick({
        id: `${asOf}:borrowed:${main.id}`,
        stage: "borrowed",
        title: fromLent > 0 ? (need ? "Paid partly with borrowed money" : "A want paid with borrowed money") : "Paid with money held for someone",
        text: [...parts, ...extra].join(" "),
        facts: [...facts, ...extra],
        need,
        also: pastLimit.map((x) => `${month}:limit:${x.kind.toLowerCase()}`),
      });
      if (note) return note;
    }
  }

  /*
   * ── 1. The month goes past its budget ────────────────────────────────────
   * Only the save that crosses it: once a month is over, a need says nothing
   * more. `before` is the ledger as it stood just before this save, cards
   * saved a moment earlier included (`App.tsx`), so a save of several cards
   * crosses on the card that does it.
   */
  if (now.budget > 0 && was.spent <= now.budget && now.spent > now.budget) {
    const past = now.spent - now.budget;
    const room = need && !bills ? wants() : { words: "", count: 0 };
    const facts = [
      `Saved: ${label} ${money(cost)}.`,
      `${name}'s ${trackName} is now ${money(now.spent)} against a budget of ${money(now.budget)}: ${money(past)} past it, with ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left.`,
      need ? `${label} is a need.` : `${label} is not a need.`,
      ...(room.words ? [`The ${room.count === 1 ? "want" : "wants"} with the most in ${room.count === 1 ? "it" : "them"} this month: ${room.words}.`] : []),
    ];
    const text = bills
      ? `${label} ${money(cost)} takes ${name}'s bills and subscriptions ${money(past)} past their ${money(now.budget)} budget. A bill has to be paid; the budget may simply be set too low for it.`
      : need
        ? `${label} ${money(cost)} takes ${name}'s spending ${money(past)} past its ${money(now.budget)} budget. It is a need, so it is counted and that is all.${room.words ? ` If you want to make up for it, ${room.words} ${room.count === 1 ? "is this month's biggest want" : "are this month's biggest wants"}.` : ""}`
        : `${label} ${money(cost)} takes ${name}'s spending ${money(past)} past its ${money(now.budget)} budget, with ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left. Your call; the Budget screen shows where the month went.`;
    // A kind past its limit in the same save is said in the same note (7 October 2026 limits audit).
    const extra = pastLimit.map((x) => `${x.kind} is ${money(x.now)}, past its ${money(x.limit)} limit too.`);
    const note = pick({
      id: `${month}:${track}:crossed`,
      stage: "crossed",
      title: `${name} is past its ${trackName} budget`,
      text: [text, ...extra].join(" "),
      facts: [...facts, ...extra],
      need,
      also: pastLimit.map((x) => `${month}:limit:${x.kind.toLowerCase()}`),
    });
    if (note) return note;
  }

  // ── 2. A kind past a limit the owner set ─────────────────────────────────
  for (const x of pastLimit) {
    const kindNeed = isNeed(x.kind, context.spendingTypes);
    const facts = [`Saved: ${label} ${money(cost)}.`, `${x.kind} this month is now ${money(x.now)}, past the limit of ${money(x.limit)} they set for it.`, kindNeed ? `${x.kind} is a need.` : `${x.kind} is not a need.`];
    const text = kindNeed
      ? `${x.kind} is now ${money(x.now)} this month, past the ${money(x.limit)} limit you set. It is a need, so this is for knowing, not for stopping.`
      : `${x.kind} is now ${money(x.now)} this month, past the ${money(x.limit)} limit you set for it.`;
    const note = pick({ id: `${month}:limit:${x.kind.toLowerCase()}`, stage: "limit", title: `${x.kind} is past its limit`, text, facts, need: kindNeed });
    if (note) return note;
  }

  // ── 3. The month goes past nine tenths of its budget ─────────────────────
  if (now.budget > 0 && was.spent * 10 < now.budget * 9 && now.spent * 10 >= now.budget * 9 && now.spent <= now.budget) {
    const left = now.budget - now.spent;
    const perDay = daysLeft > 0 ? Math.floor(left / daysLeft) : left;
    const share = Math.floor((now.spent * 100) / now.budget);
    const facts = [
      `Saved: ${label} ${money(cost)}.`,
      `${name}'s ${trackName} is at ${share}% of its ${money(now.budget)} budget: ${money(left)} left${daysLeft > 0 ? ` for ${daysLeft} ${daysLeft === 1 ? "day" : "days"}, about ${money(perDay)} a day` : ""}.`,
    ];
    const text = `${name}'s ${trackName} is at ${share}% of its budget: ${money(left)} left${daysLeft > 0 ? ` for ${daysLeft} ${daysLeft === 1 ? "day" : "days"}, about ${money(perDay)} a day` : ""}.`;
    const note = pick({ id: `${month}:${track}:near`, stage: "near", title: `${name} is near its ${trackName} budget`, text, facts, need });
    if (note) return note;
  }

  // ── 4. A want, not small, when the month is already over ────────────────
  const notSmall = cost >= 50_000 || (now.budget > 0 && cost * 20 >= now.budget);
  if (!need && now.budget > 0 && was.spent > now.budget && notSmall) {
    const over = now.spent - now.budget;
    const kindNow = kind ? spendingTrackByKind(after, range).get(kind) ?? 0 : 0;
    const facts = [
      `Saved: ${label} ${money(cost)}.`,
      `${name}'s ${trackName} was already past its ${money(now.budget)} budget; it is now ${money(over)} past it.`,
      ...(kind ? [`${kind} this month is now ${money(kindNow)}.`] : []),
      `${label} is not a need.`,
    ];
    const text = `${name} was already past its ${trackName} budget; with ${label} ${money(cost)} it is ${money(over)} past.${kind ? ` ${kind} this month: ${money(kindNow)}.` : ""}`;
    const note = pick({ id: `${asOf}:${track}:over-want`, stage: "over-want", title: `${name} is over its ${trackName} budget`, text, facts, need });
    if (note) return note;
  }

  return null;
}

/**
 * Whether the model's wording of a note may be shown in place of the device's.
 *
 * Every figure it carries must be one of the note's own, it must be short, and
 * it must not preach. Otherwise the device's words are shown.
 */
export function acceptableWording(words: string, note: SpendNote): boolean {
  const text = words.trim();
  if (text.length === 0 || text.length > 320) return false;
  if (/!|\b(must|should|need to|stop|don'?t|never|warning|careful|urgent|immediately)\b/i.test(text)) return false;
  const allowed = new Set(
    [...note.facts.join(" ").matchAll(/(\d[\d,]*(?:\.\d+)?)/g)].map((m) => (m[1] ?? "").replace(/,/g, "")),
  );
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)/g)) {
    const n = (m[1] ?? "").replace(/,/g, "");
    if (!allowed.has(n)) return false;
  }
  return true;
}

/**
 * Every figure in `text` is one of the facts', and it is not too long: the
 * check any wording by the model must pass before it replaces the device's.
 */
export function onlyTheirFigures(text: string, facts: readonly string[], most: number): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > most) return false;
  const allowed = new Set([...facts.join(" ").matchAll(/(\d[\d,]*(?:\.\d+)?)/g)].map((m) => (m[1] ?? "").replace(/,/g, "")));
  for (const m of t.matchAll(/(\d[\d,]*(?:\.\d+)?)/g)) {
    if (!allowed.has((m[1] ?? "").replace(/,/g, ""))) return false;
  }
  return true;
}
