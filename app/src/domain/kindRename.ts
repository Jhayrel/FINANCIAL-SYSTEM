/**
 * Renaming a kind on one of the owner's lists, and the rows that follow it.
 *
 * 3 October 2026, the owner, on Settings, Categories: "make them editable
 * too then it will sync to the whole system and fix every data". Only kinds
 * of spending could be renamed; a bill, a subscription or a kind of income
 * could only be removed and added again, which left every row under the old
 * name on no list at all.
 *
 * A rename changes the name on the list, every row that carries it (live and
 * in the bin, `renameItem`), the budget limits keyed by it (`renameLimitKind`)
 * and a stop on it. Renaming onto a name already on the same list merges the
 * two: the rows of both are one kind afterwards. Amounts and dates never
 * change, so no balance and no total moves.
 */

import type { AppSettings } from "./settings";
import type { SpendingType, StoppedItem, Transaction } from "./types";

export type KindList = "bills" | "subscriptions" | "revenueCategories" | "spendingTypes";

/** What each list is called on screen, as Settings names it. */
export const KIND_LIST_WORD: Readonly<Record<KindList, string>> = {
  bills: "bills",
  subscriptions: "subscriptions",
  revenueCategories: "kinds of income",
  spendingTypes: "kinds of spending",
};

type Lists = Pick<AppSettings, "bills" | "subscriptions" | "revenueCategories" | "spendingTypes" | "stopped">;

const key = (name: string): string => name.trim().toLowerCase();

/** The names on one list. */
export function namesOn(lists: Lists, list: KindList): string[] {
  return list === "spendingTypes" ? lists.spendingTypes.map((t) => t.name) : [...lists[list]];
}

/** Money Send and Transaction Fee are worked out from the destination, never picked (`domain/transfers.ts`). */
const DERIVED = new Set(["money send", "transaction fee"]);

/** Words that name a field's values, never a kind: a flow, a category, a status. */
const STRUCTURAL = new Set(["spending", "revenue", "income", "transfer", "debt", "opening", "bills", "subscriptions", "paid", "received", "pending"]);

export type RenameCheck =
  | { readonly ok: true; readonly merge: boolean; readonly to: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Whether `from` on `list` can become `to`, and whether that merges it into
 * a kind already there.
 *
 * A name lives on one list: a bill renamed to a kind of spending's name
 * would be counted under both. An account's or a credit line's name is
 * never a kind. A change of case alone is a rename, not a merge.
 */
export function checkRename(
  lists: Lists,
  list: KindList,
  from: string,
  to: string,
  others: { readonly accounts: readonly string[]; readonly credits: readonly string[] },
): RenameCheck {
  const now = to.trim().replace(/\s+/g, " ");
  if (!now) return { ok: false, reason: "Type the new name first." };
  if (now === from.trim()) return { ok: false, reason: "That is its name already." };
  if (now.length > 80) return { ok: false, reason: "Keep the name under 80 characters." };
  if (DERIVED.has(key(now))) return { ok: false, reason: `${now} is worked out from where the money went, so it is never a name on a list.` };
  if (STRUCTURAL.has(key(now))) return { ok: false, reason: `${now} is the name of a kind of entry, not of a kind on a list. Pick a name that says what the money was for.` };
  if ([...others.accounts, ...others.credits].some((a) => key(a) === key(now))) {
    return { ok: false, reason: `${now} is the name of one of your accounts or credit lines. Pick a name that says what the money was for.` };
  }
  for (const other of Object.keys(KIND_LIST_WORD) as KindList[]) {
    if (other === list) continue;
    if (namesOn(lists, other).some((n) => key(n) === key(now))) {
      return { ok: false, reason: `${namesOn(lists, other).find((n) => key(n) === key(now))} is already one of your ${KIND_LIST_WORD[other]}. A name is on one list only, or its rows would count twice.` };
    }
  }
  const merge = key(now) !== key(from) && namesOn(lists, list).some((n) => key(n) === key(now));
  // Merged into the name as the list already spells it.
  const spelled = merge ? (namesOn(lists, list).find((n) => key(n) === key(now)) ?? now) : now;
  return { ok: true, merge, to: spelled };
}

/**
 * The lists after the rename: the name changed in place, or taken off when
 * it merged into one already there. A stop follows the name. A kind of
 * spending merged keeps the target's note and mark, or takes the old one's
 * where the target has none.
 */
export function renameInLists(lists: Lists, list: KindList, from: string, to: string): Partial<AppSettings> {
  const was = key(from);
  const now = to.trim();
  const merge = key(now) !== was && namesOn(lists, list).some((n) => key(n) === key(now));

  const stopped: StoppedItem[] = [];
  for (const s of lists.stopped) {
    if (key(s.name) !== was) stopped.push(s);
    else if (!lists.stopped.some((t) => key(t.name) === key(now))) stopped.push({ ...s, name: now });
  }

  if (list === "spendingTypes") {
    const old = lists.spendingTypes.find((t) => key(t.name) === was);
    const spendingTypes: SpendingType[] = merge
      ? lists.spendingTypes
          .filter((t) => key(t.name) !== was)
          .map((t) =>
            key(t.name) === key(now) && old
              ? { ...t, remark: t.remark || old.remark, ...(t.necessity ?? old.necessity ? { necessity: t.necessity ?? old.necessity } : {}) }
              : t,
          )
      : lists.spendingTypes.map((t) => (key(t.name) === was ? { ...t, name: now } : t));
    return { spendingTypes, stopped };
  }

  const names = lists[list];
  const renamed = merge ? names.filter((n) => key(n) !== was) : names.map((n) => (key(n) === was ? now : n));
  return { [list]: renamed, stopped } as Partial<AppSettings>;
}

/** How many rows carry a name, live and binned, whatever its case. */
export function rowsNamed(rows: readonly Transaction[], name: string): number {
  const k = key(name);
  return rows.filter((t) => key(t.item) === k).length;
}

/** A kind the entries use that is on none of the lists. */
export interface Unlisted {
  readonly name: string;
  readonly flow: "Spending" | "Revenue";
  /** The list its rows belong on, by the category most of them carry. */
  readonly list: KindList;
  readonly rows: number;
  readonly last: string;
}

/**
 * The kinds rows carry that no list has: renamed away, removed, or saved
 * from a card before 3 October 2026, when a card could still save one. Each
 * can be moved into a kind on the list or put on the list itself. Money Send
 * and Transaction Fee are worked out, never listed, so they are not here.
 */
export function unlistedKinds(rows: readonly Transaction[], lists: Lists): Unlisted[] {
  const spending = new Set([...lists.spendingTypes.map((t) => t.name), ...lists.bills, ...lists.subscriptions].map(key));
  const income = new Set(lists.revenueCategories.map(key));
  const found = new Map<string, { name: string; flow: "Spending" | "Revenue"; rows: number; last: string; by: Map<KindList, number> }>();
  for (const t of rows) {
    if (t.type !== "Spending" && t.type !== "Revenue") continue;
    if (t.category === "Opening") continue;
    const k = key(t.item);
    if (!k || DERIVED.has(k)) continue;
    if ((t.type === "Spending" ? spending : income).has(k)) continue;
    const id = `${t.type}:${k}`;
    const list: KindList = t.type === "Revenue" ? "revenueCategories" : t.category === "Bills" ? "bills" : t.category === "Subscriptions" ? "subscriptions" : "spendingTypes";
    const was = found.get(id) ?? { name: t.item.trim(), flow: t.type, rows: 0, last: "", by: new Map<KindList, number>() };
    was.rows += 1;
    if (t.date > was.last) was.last = t.date;
    was.by.set(list, (was.by.get(list) ?? 0) + 1);
    found.set(id, was);
  }
  return [...found.values()]
    .map(({ by, ...u }) => ({ ...u, list: [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "spendingTypes" }))
    // Most recent first: what was saved last week matters more than a kind from years back.
    .sort((a, b) => (a.last === b.last ? b.rows - a.rows : a.last < b.last ? 1 : -1));
}

// ── Moving a bill to subscriptions, or back ───────────────────────────────

/*
 * The owner, 6 October 2026, on Settings, Categories: "what happen if I want
 * to change it the subscription to bills ... add option like moving dito from
 * subscription to bills. make sure it works all entry will be connected and
 * the database is still good".
 *
 * A bill or subscription's rows carry the list in their category (Bills or
 * Subscriptions), and the Budget screen, the Dashboard and the statements
 * split by it. Removing a name from one list and adding it to the other left
 * every row it already had under the old category, so the new list showed
 * it never paid. A move changes the name's list and the category of every
 * row that carries it, live and in the bin, together. The name, amounts and
 * dates never change, and bills and subscriptions share one budget line, so
 * no balance, month total or budget moves: only which of the two it counts
 * under.
 */

export type BillList = "bills" | "subscriptions";
export type BillCategory = "Bills" | "Subscriptions";

export const CATEGORY_OF: Readonly<Record<BillList, BillCategory>> = { bills: "Bills", subscriptions: "Subscriptions" };
export const otherList = (list: BillList): BillList => (list === "bills" ? "subscriptions" : "bills");

export type MoveCheck =
  | { readonly ok: true; readonly to: BillList; readonly already: boolean }
  | { readonly ok: false; readonly reason: string };

/** Whether `name` can move off `from` to the other list, and whether the other list has it already. */
export function checkMove(lists: Lists, from: BillList, name: string): MoveCheck {
  const k = key(name);
  if (!k) return { ok: false, reason: "Pick a bill or subscription to move." };
  if (!lists[from].some((n) => key(n) === k)) return { ok: false, reason: `${name.trim()} is not one of your ${KIND_LIST_WORD[from]}.` };
  const to = otherList(from);
  return { ok: true, to, already: lists[to].some((n) => key(n) === k) };
}

/** The two lists after the move: off one, on the other once, spelled as it was. A stop follows the name, so it stays. */
export function moveInLists(lists: Lists, from: BillList, name: string): Partial<AppSettings> {
  const k = key(name);
  const to = otherList(from);
  const spelled = lists[from].find((n) => key(n) === k) ?? name.trim();
  const left = lists[from].filter((n) => key(n) !== k);
  const onto = lists[to].some((n) => key(n) === k) ? [...lists[to]] : [...lists[to], spelled];
  return { [from]: left, [to]: onto } as Partial<AppSettings>;
}

/** Whether a row is one of this name's payments, filed under the other list's category. */
const filedUnder = (t: Transaction, k: string, was: BillCategory): boolean =>
  key(t.item) === k &&
  t.category === was &&
  // A payment, or money paid for someone on this bill and written off as spending (`writtenOffAsSpending`).
  (t.type === "Spending" || (t.type === "Debt" && t.debtEffect === "writeoff"));

/** Every row of `name` filed under the other category, now under `to`. Nothing else on a row changes. */
export function moveRows<T extends Transaction>(rows: readonly T[], name: string, to: BillCategory): T[] {
  const k = key(name);
  const was: BillCategory = to === "Bills" ? "Subscriptions" : "Bills";
  return rows.map((t) => (filedUnder(t, k, was) ? { ...t, category: to } : t));
}

/** How many rows a move to `to` would change. */
export function rowsToMove(rows: readonly Transaction[], name: string, to: BillCategory): number {
  const k = key(name);
  const was: BillCategory = to === "Bills" ? "Subscriptions" : "Bills";
  return rows.filter((t) => filedUnder(t, k, was)).length;
}
