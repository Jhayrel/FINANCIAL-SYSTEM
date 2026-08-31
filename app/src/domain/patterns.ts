/**
 * Patterns the owner cannot see from inside the moment.
 *
 * ── Why this is not more totals ───────────────────────────────────────────
 *
 * Tracking already existed. The Excel did it well, and it changed nothing,
 * because a total tells you what happened and not why. Everything here answers
 * a different question: what would go unnoticed while it was happening?
 *
 * That makes the bar for including something high. Each detector below has to
 * point at a specific figure in the ledger, and has to say something a person
 * looking at the dashboard would not already have seen. A detector that
 * restates a number on screen is noise, and noise is what turned the old
 * alerts into wallpaper nobody read.
 *
 * ── What each one is looking for ──────────────────────────────────────────
 *
 *   VELOCITY        How fast money leaves after it arrives, not how much. The
 *                   same amount spent on the day income lands and on day ten
 *                   are different events, and only one of them is a habit.
 *
 *   MIGRATION       Whether a category that shrank actually shrank, or moved.
 *                   Reporting "Treats: zero this month, well done" while a
 *                   sibling category absorbed the same pesos is worse than
 *                   saying nothing: it is a congratulation for nothing.
 *
 *   REPETITION      Whether this is the first time or the fourth. A wallet
 *                   hitting zero is worth one sentence; hitting zero for the
 *                   fourth time this quarter is a different fact.
 *
 * ── The rules every detector follows ──────────────────────────────────────
 *
 *   1. Quantify, never judge. Every finding carries the figures that produced
 *      it. "You spent 62% of it within two days" is the whole intervention.
 *      Adding "you should be careful" turns a fact into scolding, and scolding
 *      is what gets ignored.
 *
 *   2. Point at real rows. If a detector cannot name the figure behind a
 *      claim, it does not make the claim.
 *
 *   3. Compare against this ledger only, never a general benchmark. What other
 *      people save is not evidence about this person and is easy to dismiss.
 *
 *   4. Report, never correct. Same rule as the integrity checks.
 */

import { getMonth, getYear } from "./dates";
import type { Centavos } from "./money";
import { costOf } from "./totals";
import type { IsoDate, Transaction } from "./types";

export interface Finding {
  readonly id: string;
  readonly kind: "velocity" | "migration" | "repetition" | "streak" | "uncategorised";
  /** One line, figures included. Shown as-is, so it must read as English. */
  readonly detail: string;
  /** Higher sorts first. */
  readonly weight: number;
}

const day = 86_400_000;

const daysBetween = (a: IsoDate, b: IsoDate): number =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / day);

const php = (c: Centavos): string =>
  `PHP ${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * What a row cost: the app's own definition, not a fourth one.
 *
 * This was the last private copy. It differed from `costOf` in the same two
 * places every private copy has: it counted a Spending row whose category is
 * blank, which the app ignores, and it ignored debt interest and fees, which
 * the app counts.
 *
 * The figures here are shown to the owner, in the patterns panel and in what
 * the model is told about their habits, so "you are spending faster than
 * usual" was being worked out from a different total than the one on screen.
 * Same reason `charts.ts` and `aiChatContext.ts` gave theirs up.
 *
 * If a genuine "money that left the wallet" measure is ever wanted, which is
 * not the same question, it should be written as that and named that.
 */
const outflow = costOf;

/**
 * Categories chosen freely rather than owed to someone.
 *
 * Kept as a predicate rather than a list, because the whole point of the
 * migration check is that the names move around. A hardcoded list would go
 * stale the moment a new one was invented, which is exactly when it matters.
 */
/**
 * What the owner calls this kind of spending.
 *
 * ── The field this file was reading, and why it found nothing ─────────────
 *
 * Every detector here grouped by `t.category`. In this ledger that field
 * holds the structure, not the subject: it is only ever Spending, Bills,
 * Subscriptions, Transfer, Revenue or Opening. `isDiscretionary` then throws
 * out all but two of those, so "a category that fell while another rose"
 * was comparing one group against itself and could never fire, and a streak
 * reported "40 days without a Spending entry", which says nothing.
 *
 * What a person means by a category is Treat, Food, Gas: that is `item`.
 * The tests hid this by putting item names in the category field, so they
 * described a shape the real data has never had.
 *
 * `category` still decides eligibility, because that is genuinely what it is
 * for: it is how Bills and Subscriptions are told apart from discretionary
 * spending. It just cannot be the label.
 */
const subjectOf = (t: Transaction): string => t.item.trim() || t.category.trim();

export function isDiscretionary(category: string): boolean {
  const c = category.trim().toLowerCase();
  if (!c) return false;
  return !["bills", "subscriptions", "debt", "opening", "savings", "transfer"].includes(c);
}

// ── Velocity ───────────────────────────────────────────────────────────────

export interface IncomeEvent {
  readonly date: IsoDate;
  readonly amount: Centavos;
  readonly spentWithin: Centavos;
  readonly share: number;
  readonly windowDays: number;
}

/**
 * How much of a deposit went straight back out.
 *
 * Only deposits big enough to matter are considered: a PHP 0.02 interest
 * posting followed by a PHP 500 lunch is not a 2,500,000% spike, it is two
 * unrelated rows, and reporting it as one would be the kind of technically
 * true nonsense that destroys trust in the whole panel.
 */
export function incomeVelocity(
  transactions: readonly Transaction[],
  asOf: IsoDate,
  options: { windowDays?: number; minimumIncome?: Centavos; lookbackDays?: number } = {},
): IncomeEvent[] {
  const windowDays = options.windowDays ?? 2;
  const minimum = options.minimumIncome ?? 100_00;
  const lookback = options.lookbackDays ?? 45;

  const deposits = transactions.filter(
    (t) => t.type === "Revenue" && t.category !== "Opening" && t.total >= minimum,
  );

  const out: IncomeEvent[] = [];

  for (const deposit of deposits) {
    const age = daysBetween(deposit.date, asOf);
    if (age < 0 || age > lookback) continue;

    const inWindow = (t: Transaction): boolean => {
      const gap = daysBetween(deposit.date, t.date);
      return gap >= 0 && gap <= windowDays;
    };

    const spentWithin = transactions.filter(inWindow).reduce((sum, t) => sum + outflow(t), 0);
    if (spentWithin === 0) continue;

    /**
     * Every deposit in the window, not just this one.
     *
     * The first version divided the window's whole outflow by a single
     * deposit and reported the result as a percentage of it, which produced
     * "200% of the PHP 997.34 that arrived went back out". That is not a
     * strong finding, it is an impossible one: money cannot leave a deposit
     * twice. It happened because two deposits landed in the same window and
     * only one was counted, and because spending can also draw on a balance
     * that was already there.
     *
     * Dividing by everything that arrived makes the ratio mean what it says.
     * It can still exceed one, which is a real and different fact worth
     * reporting: more went out than came in, so the difference came from
     * money already held. `patternFindings` words that case separately
     * rather than printing a percentage above a hundred.
     */
    const arrived = transactions
      .filter((t) => {
        if (t.type !== "Revenue" || t.category === "Opening") return false;
        /**
         * Symmetric, unlike the spending window.
         *
         * Spending is only counted after the deposit, because money cannot be
         * spent before it arrives. Income is counted on both sides, because a
         * deposit the day before is just as available to fund this window's
         * spending, and ignoring it is what made a burst look like it came
         * from a single smaller deposit.
         */
        const gap = daysBetween(deposit.date, t.date);
        return gap >= -windowDays && gap <= windowDays;
      })
      .reduce((sum, t) => sum + t.total, 0);

    if (arrived <= 0) continue;

    out.push({
      date: deposit.date,
      amount: arrived,
      spentWithin,
      share: spentWithin / arrived,
      windowDays,
    });
  }

  /**
   * One finding per window, not one per deposit.
   *
   * Two deposits a day apart share almost the same window and would otherwise
   * produce two near-identical sentences about the same money.
   */
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.share - a.share)
    .filter((e) => {
      const key = `${e.spentWithin}:${e.amount}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// ── Migration ──────────────────────────────────────────────────────────────

export interface Migration {
  readonly fell: { readonly category: string; readonly by: Centavos };
  readonly rose: { readonly category: string; readonly by: Centavos };
  readonly netChange: Centavos;
}

/** Discretionary spend per category for one month. */
function discretionaryByCategory(
  transactions: readonly Transaction[],
  year: number,
  month: number,
): Map<string, Centavos> {
  const out = new Map<string, Centavos>();

  for (const t of transactions) {
    if (getYear(t.date) !== year || getMonth(t.date) !== month) continue;
    if (!isDiscretionary(t.category)) continue;

    const cost = outflow(t);
    if (cost === 0) continue;

    const key = subjectOf(t);
    if (!key) continue;
    out.set(key, (out.get(key) ?? 0) + cost);
  }

  return out;
}

/**
 * A category that fell while another rose to meet it.
 *
 * The test is not "did anything fall". It is whether the fall was cancelled
 * out, which is why the pair is only reported when the rise covers at least
 * half the fall. Two unrelated categories drifting in opposite directions is
 * ordinary month-to-month noise.
 */
export function categoryMigration(
  transactions: readonly Transaction[],
  asOf: IsoDate,
  minimum: Centavos = 300_00,
): Migration | null {
  const year = getYear(asOf);
  const month = getMonth(asOf);

  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;

  const now = discretionaryByCategory(transactions, year, month);
  const before = discretionaryByCategory(transactions, previousYear, previousMonth);

  const names = new Set([...now.keys(), ...before.keys()]);

  let biggestFall: { category: string; by: Centavos } | null = null;
  let biggestRise: { category: string; by: Centavos } | null = null;

  for (const name of names) {
    const change = (now.get(name) ?? 0) - (before.get(name) ?? 0);

    if (change < 0 && (!biggestFall || -change > biggestFall.by)) {
      biggestFall = { category: name, by: -change };
    }
    if (change > 0 && (!biggestRise || change > biggestRise.by)) {
      biggestRise = { category: name, by: change };
    }
  }

  if (!biggestFall || !biggestRise) return null;
  if (biggestFall.by < minimum || biggestRise.by < minimum) return null;
  // A fall that was not really replaced is just a fall, and good news.
  if (biggestRise.by < biggestFall.by / 2) return null;

  const total = (m: Map<string, Centavos>): Centavos =>
    [...m.values()].reduce((a, b) => a + b, 0);

  return {
    fell: biggestFall,
    rose: biggestRise,
    netChange: total(now) - total(before),
  };
}

// ── Repetition ─────────────────────────────────────────────────────────────

/**
 * How many times a running balance has touched zero recently.
 *
 * Walked forward through the rows rather than sampled, because a wallet that
 * empties and refills on the same day still emptied, and a daily snapshot
 * would miss it.
 */
export function zeroBalanceCount(
  transactions: readonly Transaction[],
  wallet: string,
  asOf: IsoDate,
  windowDays = 60,
): number {
  const from = new Date(asOf);
  from.setDate(from.getDate() - windowDays);
  const start = from.toISOString().slice(0, 10);

  const rows = [...transactions]
    .filter((t) => t.fromWallet === wallet || t.toWallet === wallet)
    .sort((a, b) => a.date.localeCompare(b.date) || a.recordNumber - b.recordNumber);

  let balance = 0;
  let hits = 0;
  let wasZero = true;

  for (const t of rows) {
    /**
     * The same three terms as `walletBalance`, deliberately identical.
     *
     * A first attempt here summed its own way and dropped the first term,
     * revenue booked against `fromWallet`, which is how most income lands.
     * Every wallet then looked permanently empty. A running balance has one
     * correct definition in this codebase and this has to be it.
     */
    if (t.type === "Revenue" && t.fromWallet === wallet) balance += t.total;
    if (t.toWallet === wallet) balance += t.amount;
    if (t.fromWallet === wallet && t.type !== "Revenue") balance -= t.total;

    const atZero = balance <= 0;
    if (atZero && !wasZero && t.date >= start && t.date <= asOf) hits++;
    wasZero = atZero;
  }

  return hits;
}

// ── Streaks ────────────────────────────────────────────────────────────────

export interface Streak {
  readonly category: string;
  readonly days: number;
  readonly brokenOn: IsoDate;
  readonly amount: Centavos;
}

/**
 * A long gap in a discretionary category that has just ended.
 *
 * Worth naming in both directions: a streak is an achievement while it runs
 * and a real event when it stops. Saying nothing when it breaks is how the
 * achievement quietly stops counting.
 */
export function brokenStreaks(
  transactions: readonly Transaction[],
  asOf: IsoDate,
  minimumDays = 20,
  noticedWithinDays = 7,
): Streak[] {
  const byCategory = new Map<string, Transaction[]>();

  for (const t of transactions) {
    if (!isDiscretionary(t.category) || outflow(t) === 0) continue;
    const key = subjectOf(t);
    if (!key) continue;
    const list = byCategory.get(key);
    if (list) list.push(t);
    else byCategory.set(key, [t]);
  }

  const out: Streak[] = [];

  for (const [category, rows] of byCategory) {
    rows.sort((a, b) => a.date.localeCompare(b.date));

    for (let i = 1; i < rows.length; i++) {
      const previous = rows[i - 1];
      const current = rows[i];
      if (!previous || !current) continue;

      const gap = daysBetween(previous.date, current.date);
      const sinceBreak = daysBetween(current.date, asOf);

      if (gap >= minimumDays && sinceBreak >= 0 && sinceBreak <= noticedWithinDays) {
        out.push({
          category,
          days: gap,
          brokenOn: current.date,
          amount: outflow(current),
        });
      }
    }
  }

  return out.sort((a, b) => b.days - a.days);
}

// ── Uncategorised ──────────────────────────────────────────────────────────

/** Rows with nothing in the category, accumulating without review. */
export function uncategorisedCount(
  transactions: readonly Transaction[],
  asOf: IsoDate,
  windowDays = 14,
): number {
  const from = new Date(asOf);
  from.setDate(from.getDate() - windowDays);
  const start = from.toISOString().slice(0, 10);

  return transactions.filter((t) => {
    const c = t.category.trim().toLowerCase();
    const blank = !c || c === "unknown" || c === "uncategorised" || c === "uncategorized";
    return blank && t.date >= start && t.date <= asOf;
  }).length;
}

// ── The findings ───────────────────────────────────────────────────────────

export interface PatternInput {
  readonly transactions: readonly Transaction[];
  readonly asOf: IsoDate;
  readonly wallets: readonly string[];
}

/**
 * Everything worth saying that a total would not have said.
 *
 * Thresholds are deliberately high. Every one of these fires rarely, which is
 * the only way any of them keeps its meaning.
 */
export function patternFindings({ transactions, asOf, wallets }: PatternInput): Finding[] {
  const out: Finding[] = [];

  // Velocity: the strongest single signal, so it leads.
  const spikes = incomeVelocity(transactions, asOf);
  const worst = spikes[0];
  if (worst && worst.share >= 0.4) {
    const days = `${worst.windowDays} days`;

    /**
     * Above a hundred percent the sentence has to change, not the number.
     * More went out than came in, so the rest came from money already held,
     * and saying "140%" of a deposit would be describing something that
     * cannot happen.
     */
    const detail =
      worst.share > 1
        ? `${php(worst.spentWithin)} went out within ${days} of the ${php(worst.amount)} that arrived on ${worst.date}. That is ${php(worst.spentWithin - worst.amount)} more than arrived, so the difference came from what was already there.`
        : `${Math.round(worst.share * 100)}% of the ${php(worst.amount)} that arrived on ${worst.date} went back out within ${days}: ${php(worst.spentWithin)}.`;

    out.push({ id: `velocity-${worst.date}`, kind: "velocity", detail, weight: 90 });
  }

  const moved = categoryMigration(transactions, asOf);
  if (moved) {
    const direction =
      moved.netChange >= 0
        ? `Total discretionary spending is ${php(moved.netChange)} higher than last month`
        : `Total discretionary spending is ${php(-moved.netChange)} lower than last month`;

    out.push({
      id: "migration",
      kind: "migration",
      detail: `${moved.fell.category} fell by ${php(moved.fell.by)} while ${moved.rose.category} rose by ${php(moved.rose.by)}. ${direction}.`,
      weight: 80,
    });
  }

  for (const wallet of wallets) {
    const hits = zeroBalanceCount(transactions, wallet, asOf);
    if (hits >= 2) {
      out.push({
        id: `zeroes-${wallet}`,
        kind: "repetition",
        detail: `${wallet} has reached zero ${hits} times in the last 60 days.`,
        weight: 70,
      });
    }
  }

  for (const streak of brokenStreaks(transactions, asOf).slice(0, 2)) {
    out.push({
      id: `streak-${streak.category}`,
      kind: "streak",
      detail: `${streak.days} days without a ${streak.category} entry ended on ${streak.brokenOn}, with ${php(streak.amount)}.`,
      weight: 55,
    });
  }

  const blank = uncategorisedCount(transactions, asOf);
  if (blank >= 3) {
    out.push({
      id: "uncategorised",
      kind: "uncategorised",
      detail: `${blank} rows in the last fortnight have no category, so they are missing from every category total.`,
      weight: 60,
    });
  }

  return out.sort((a, b) => b.weight - a.weight);
}
