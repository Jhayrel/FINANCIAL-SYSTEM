/**
 * Narrowing a statement to part of what it covers.
 *
 * The owner, 12 October 2026, under the bills and subscriptions sheet: "allow
 * filter like bills only, subscription only or a specific only like specific
 * subscription or bills", then "to other parts too like transfer etc add
 * filters". Every statement that covers several kinds of row can be cut to
 * one of them. The cut is applied where the rows are chosen, so the figures,
 * the running column, the CSV and the PDF all follow it.
 *
 * A filter is a key: "cat:Bills", "kind:Spotify", "wallet:Maya" (in or out),
 * "from:Cash" (paid from), "into:Maya" (arrived in), "debt:<id>",
 * or one of the transfer shapes. The empty key is everything.
 */
import type { Debt } from "./debt";
import { kindOf } from "./kinds";
import type { Transaction } from "./types";
import { isWithdrawal } from "./withdrawal";

/** The statements a filter applies to. The rest follow one wallet or one debt already, or everything. */
type Filtered = "revenue" | "expense" | "bills" | "transfers" | "savings" | "borrowed" | "credit" | "lent" | "onbehalf";

const FILTERED: ReadonlySet<string> = new Set<Filtered>([
  "revenue",
  "expense",
  "bills",
  "transfers",
  "savings",
  "borrowed",
  "credit",
  "lent",
  "onbehalf",
]);

export const canFilter = (type: string): boolean => FILTERED.has(type);

/** Where income landed: its wallet, even when saved on the other side (`statementSheet.ts`). */
const arrivedIn = (t: Transaction): string => (t.toWallet.trim() ? t.toWallet : t.fromWallet);

/** Whether a row is in the part of the statement the key names. */
export function matchesFilter(t: Transaction, only: string | undefined, cash: string, debts: readonly Debt[] = []): boolean {
  if (!only) return true;
  const at = only.indexOf(":");
  const key = at < 0 ? only : only.slice(0, at);
  const value = at < 0 ? "" : only.slice(at + 1);
  switch (key) {
    case "cat":
      return t.type !== "Transfer" && t.category === value;
    case "kind":
      return kindOf(t, debts) === value;
    case "wallet":
      return t.fromWallet === value || t.toWallet === value;
    case "from":
      return t.fromWallet === value;
    case "into":
      return arrivedIn(t) === value;
    case "debt":
      return t.debtId === value;
    case "between":
      return t.type === "Transfer" && !!t.toWallet.trim() && !isWithdrawal(t, cash);
    case "out":
      return t.type === "Transfer" && !t.toWallet.trim();
    case "withdrawals":
      return t.type === "Transfer" && isWithdrawal(t, cash);
    default:
      return true;
  }
}

/** What a cut is called on the statement, its PDF and its file name: "Subscriptions only", "Spotify". */
export function filterName(only: string, debts: readonly Debt[] = []): string {
  const at = only.indexOf(":");
  const key = at < 0 ? only : only.slice(0, at);
  const value = at < 0 ? "" : only.slice(at + 1);
  switch (key) {
    case "cat":
      return `${value} only`;
    case "kind":
    case "wallet":
      return value;
    case "from":
      return `Paid from ${value}`;
    case "into":
      return `Into ${value}`;
    case "debt":
      return debts.find((d) => d.id === value)?.name ?? "";
    case "between":
      return "Between your accounts";
    case "out":
      return "Sent out";
    case "withdrawals":
      return "Cash withdrawals";
    default:
      return "";
  }
}

export interface FilterChoices {
  /** The labels a picker offers, "All" first. */
  readonly options: readonly string[];
  /** Label to heading, for the picker's groups. */
  readonly groups: Readonly<Record<string, string>>;
  /** Label to key, and back. */
  readonly keyOf: ReadonlyMap<string, string>;
  readonly labelOf: ReadonlyMap<string, string>;
}

const ALL_LABEL: Record<Filtered, string> = {
  revenue: "All income",
  expense: "All spending",
  bills: "All bills and subscriptions",
  transfers: "All transfers",
  savings: "All savings accounts",
  borrowed: "Everyone you owe",
  credit: "Every credit card and line",
  lent: "Everyone who owes you",
  onbehalf: "Everyone",
};

const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: "base" });

/**
 * What a statement can be cut to, from the rows it holds before any cut, so
 * only what the period has is offered (the owner's rule for the months too:
 * "show only the available").
 */
export function filterChoices(
  type: string,
  rows: readonly Transaction[],
  savings: ReadonlySet<string>,
  cash: string,
  debts: readonly Debt[] = [],
): FilterChoices {
  const options: string[] = [];
  const groups: Record<string, string> = {};
  const keyOf = new Map<string, string>();
  const labelOf = new Map<string, string>();
  const add = (label: string, key: string, group?: string): void => {
    if (keyOf.has(label) || labelOf.has(key)) return;
    options.push(label);
    keyOf.set(label, key);
    labelOf.set(key, label);
    if (group) groups[label] = group;
  };
  if (!canFilter(type)) return { options, groups, keyOf, labelOf };

  add(ALL_LABEL[type as Filtered], "");
  const kinds = (pick: (t: Transaction) => boolean = () => true): string[] =>
    [...new Set(rows.filter(pick).map((t) => kindOf(t, debts)))].filter(Boolean).sort(byName);
  const walletsIn = (pick: (w: string) => boolean = () => true): string[] =>
    [...new Set(rows.flatMap((t) => [t.fromWallet, t.toWallet]).filter((w) => !!w.trim() && pick(w)))].sort(byName);

  switch (type as Filtered) {
    case "bills": {
      const has = (c: string) => rows.some((t) => t.category === c);
      if (has("Bills")) add("Bills only", "cat:Bills");
      if (has("Subscriptions")) add("Subscriptions only", "cat:Subscriptions");
      for (const k of kinds((t) => t.category === "Bills")) add(k, `kind:${k}`, "Bills");
      for (const k of kinds((t) => t.category === "Subscriptions")) add(k, `kind:${k}`, "Subscriptions");
      break;
    }
    case "expense": {
      for (const c of ["Spending", "Bills", "Subscriptions"]) {
        if (rows.some((t) => t.type !== "Transfer" && t.category === c)) add(`${c} only`, `cat:${c}`);
      }
      for (const k of kinds()) add(k, `kind:${k}`, "Kind");
      for (const w of [...new Set(rows.map((t) => t.fromWallet).filter((w) => !!w.trim()))].sort(byName)) add(`Paid from ${w}`, `from:${w}`, "Wallet");
      break;
    }
    case "revenue": {
      for (const k of kinds()) add(k, `kind:${k}`, "Kind");
      for (const w of [...new Set(rows.map(arrivedIn).filter((w) => !!w.trim()))].sort(byName)) add(`Into ${w}`, `into:${w}`, "Wallet");
      break;
    }
    case "transfers": {
      if (rows.some((t) => matchesFilter(t, "between", cash))) add("Between your accounts", "between");
      if (rows.some((t) => matchesFilter(t, "withdrawals", cash))) add("Cash withdrawals", "withdrawals");
      if (rows.some((t) => matchesFilter(t, "out", cash))) add("Sent out", "out");
      for (const w of walletsIn()) add(`From or to ${w}`, `wallet:${w}`, "Wallet");
      break;
    }
    case "savings": {
      for (const w of walletsIn((w) => savings.has(w))) add(w, `wallet:${w}`);
      break;
    }
    case "borrowed":
    case "credit":
    case "lent":
    case "onbehalf": {
      const ids = new Set(rows.map((t) => t.debtId).filter((id): id is string => !!id));
      const named = debts.filter((d) => ids.has(d.id)).sort((a, b) => byName(a.name, b.name));
      for (const d of named) add(d.name, `debt:${d.id}`);
      break;
    }
  }
  return { options, groups, keyOf, labelOf };
}
