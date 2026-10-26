/**
 * The Planner as a statement (owner, 27 October 2026: "in statement add plans
 * too").
 *
 * Laid out as every other statement is, so the screen's table, the PDF and
 * the spreadsheet need nothing of their own: a line a plan, by the day it is
 * due; Planned and Paid in the money columns, and what is still to pay where
 * a balance would be. A plan is not an entry: only the payments it names
 * moved money, and those are in the entries already, so nothing here is
 * counted twice.
 *
 * Removed plans are left out, as binned rows are left out of a statement.
 * Plans with no date yet are listed after the dated ones whenever the period
 * reaches today, since they belong to no month.
 */

import type { Account } from "./accounts";
import { formatMoney, type Centavos } from "./money";
import { NO_DATE, viewOf, whenOf, type Plan, type PlanState } from "./planner";
import type { SheetLine, StatementSheet } from "./statementSheet";
import type { IsoDate, Transaction } from "./types";

const STATE: Record<PlanState, string> = {
  later: "Open",
  soon: "Due soon",
  today: "Due today",
  overdue: "Overdue",
  partly: "Part paid",
  paid: "Paid",
  skipped: "Skipped",
  removed: "Removed",
};

export function buildPlanSheet(
  plans: readonly Plan[],
  context: { readonly transactions: readonly Transaction[]; readonly accounts: readonly Account[]; readonly asOf: IsoDate },
  range: { readonly from: IsoDate; readonly to: IsoDate },
  period: string,
): StatementSheet {
  const { transactions, asOf } = context;
  const byNumber = new Map(transactions.map((t) => [t.id, t.recordNumber]));
  const kept = plans.filter((p) => p.status !== "removed");
  const dated = kept.filter((p) => p.due !== NO_DATE && p.due >= range.from && p.due <= range.to).sort((a, b) => (a.due === b.due ? a.title.localeCompare(b.title) : a.due < b.due ? -1 : 1));
  const undated = range.to >= asOf ? kept.filter((p) => p.due === NO_DATE && p.status === "open") : [];

  const lines: SheetLine[] = [...dated, ...undated].map((plan) => {
    const v = viewOf(plan, context);
    const open = v.state !== "paid" && v.state !== "skipped";
    const paidBy = plan.entryIds.map((id) => byNumber.get(id)).filter((n): n is number => n !== undefined).map((n) => `#${String(n).padStart(4, "0")}`);
    const detail = [
      plan.dueKind && plan.dueKind !== "day" ? whenOf(plan) : "",
      plan.item,
      plan.need ? "" : "a want",
      paidBy.length > 0 ? `paid by ${paidBy.join(", ")}` : "",
      plan.status === "skipped" && plan.reason ? `skipped: ${plan.reason}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      id: plan.id,
      recordNumber: 0,
      date: plan.due === NO_DATE ? "" : plan.due,
      description: plan.title,
      kind: STATE[v.state],
      fromWallet: plan.wallet,
      toWallet: "",
      // Planned first, then paid, as the columns read left to right.
      moneyIn: plan.amount,
      moneyOut: v.paid,
      // A skipped or paid plan has nothing still to pay.
      balance: open ? v.left : 0,
      detail,
    };
  });

  const sum = (pick: (l: SheetLine) => Centavos): Centavos => lines.reduce((s, l) => s + pick(l), 0);
  const totalIn = sum((l) => l.moneyIn);
  const totalOut = sum((l) => l.moneyOut);
  const closing = sum((l) => l.balance ?? 0);
  const skipped = lines.filter((l) => l.kind === "Skipped");
  return {
    type: "plans",
    title: "Plans",
    subject: "",
    period,
    from: range.from,
    to: range.to,
    headings: { moneyIn: "Planned", moneyOut: "Paid", balance: "Still to pay" },
    broughtForward: null,
    lines,
    totalIn,
    totalOut,
    closing,
    notes: [
      "A plan is not an entry. Only the payments each plan names moved money, and they are in the entries already.",
      ...(skipped.length > 0 ? [`${skipped.length === 1 ? "1 plan was" : `${skipped.length} plans were`} skipped: ${formatMoney(sum((l) => (l.kind === "Skipped" ? l.moneyIn - l.moneyOut : 0)))} planned and never paid, not counted as still to pay.`] : []),
      ...(undated.length > 0 ? [`${undated.length === 1 ? "1 plan has" : `${undated.length} plans have`} no date yet, listed last.`] : []),
    ],
  };
}

const cell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const pesos = (c: Centavos): string => (c / 100).toFixed(2);

/** The same lines as a spreadsheet. */
export function planSheetCsv(sheet: StatementSheet): string {
  const rows = [
    ["Due", "Plan", "State", "Pay from", "Planned", "Paid", "Still to pay", "Details"],
    ...sheet.lines.map((l) => [l.date || "No date yet", l.description, l.kind, l.fromWallet, pesos(l.moneyIn), pesos(l.moneyOut), pesos(l.balance ?? 0), l.detail]),
    ["", "Total", "", "", pesos(sheet.totalIn), pesos(sheet.totalOut), pesos(sheet.closing), ""],
  ];
  return `${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

export function planSheetFilename(sheet: StatementSheet, extension: "csv" | "pdf"): string {
  return `plans-${sheet.from.slice(0, 7)}-to-${sheet.to.slice(0, 7)}.${extension}`;
}
