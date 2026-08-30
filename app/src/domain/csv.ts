/**
 * CSV export of the whole system.
 *
 * The old export wrote one account statement, so opening it showed the ledger
 * and nothing else: no recycle bin, no accounts, no budget, no categories. That
 * is the same gap the Excel's own backup had.
 *
 * This writes every part, each as its own labelled block with its own header
 * row. A spreadsheet opens it as one sheet with sections you can read top to
 * bottom, which is what a CSV can do honestly. The JSON backup remains the
 * thing you restore from; this is the thing you read.
 *
 * Money is written as a plain decimal, never with a currency symbol or a
 * thousands separator, so a spreadsheet reads it as a number rather than text.
 */

import { walletBalance } from "./balances";
import { outstandingOf } from "./debt";
import { toPesos } from "./money";
import type { BackupData } from "./backup";
import type { Transaction } from "./types";

/** RFC 4180: quote when the value could otherwise break the row. */
function cell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (values: (string | number)[]): string => values.map(cell).join(",");

/** Plain decimal, two places. Never a symbol, never a separator. */
const money = (centavos: number): string => toPesos(centavos).toFixed(2);

const TRANSACTION_HEADER = [
  "Record",
  "Date",
  "Type",
  "Debt effect",
  "From",
  "To",
  "Category",
  "Item",
  "Description",
  "Amount",
  "Fee",
  "Total",
  "Notes",
  "Status",
];

const transactionRow = (t: Transaction): (string | number)[] => [
  String(t.recordNumber).padStart(4, "0"),
  t.date,
  t.type,
  t.debtEffect ?? "",
  t.fromWallet,
  t.toWallet,
  t.category,
  t.item,
  t.description,
  money(t.amount),
  money(t.fee),
  money(t.total),
  t.notes,
  t.status,
];

/**
 * Everything, as one CSV.
 *
 * `now` is passed in rather than read from the clock so the output is
 * reproducible and the function stays pure.
 */
export function systemToCsv(data: BackupData, now: string): string {
  const out: string[] = [];
  const section = (title: string, header: string[], rows: (string | number)[][]): void => {
    if (out.length > 0) out.push("");
    out.push(row([`# ${title}`]));
    out.push(row(header));
    if (rows.length === 0) out.push(row(["(none)"]));
    else for (const r of rows) out.push(row(r));
  };

  const accountNames = data.settings.accounts.map((a) => a.name);

  out.push(row(["# FINANCIAL MANAGEMENT SYSTEM"]));
  out.push(row(["Exported", now]));
  out.push(row(["Transactions", data.transactions.length]));
  out.push(row(["In the bin", data.deleted.length]));
  out.push(
    row([
      "Note",
      "Amounts are plain decimals in pesos. Restore from the JSON backup, not from this file.",
    ]),
  );

  section("TRANSACTIONS", TRANSACTION_HEADER, data.transactions.map(transactionRow));

  section(
    "RECYCLE BIN",
    [...TRANSACTION_HEADER, "Deleted at"],
    data.deleted.map((t) => [...transactionRow(t), t.deletedAt]),
  );

  section(
    "ACCOUNTS AND GOALS",
    ["Name", "Kind", "Holds", "Status", "Inside", "Target", "Deadline", "Balance"],
    data.settings.accounts.map((a) => [
      a.name,
      a.kind,
      a.channel ?? "bank",
      a.archived ? "archived" : "active",
      data.settings.accounts.find((p) => p.id === a.parentId)?.name ?? "",
      a.target === undefined ? "" : money(a.target),
      a.deadline ?? "",
      money(walletBalance(data.transactions, a.name)),
    ]),
  );

  section(
    "CREDIT AND LOANS",
    ["Name", "Kind", "Bank or account", "Opened", "Status", "Outstanding"],
    data.settings.credits.map((c) => [
      c.name,
      c.kind === "payable" ? "credit I owe" : "loan owed to me",
      c.wallet,
      c.openedDate,
      c.archived ? "archived" : "open",
      money(outstandingOf(data.transactions, c.id)),
    ]),
  );

  section(
    "BUDGETS",
    ["Year", "Month", "Spending budget", "Bills and subscriptions budget"],
    Object.entries(data.budgets).flatMap(([year, y]) =>
      y.spending.map((_, i) => [
        year,
        MONTHS[i] ?? String(i + 1),
        money(y.spending[i] ?? 0),
        money(y.billsSubs[i] ?? 0),
      ]),
    ),
  );

  section(
    "SPENDING TYPES",
    ["Type", "What counts as this", "Rows using it"],
    data.settings.spendingTypes.map((s) => [
      s.name,
      s.remark,
      data.transactions.filter((t) => t.item === s.name).length,
    ]),
  );

  section("BILLS", ["Bill"], data.settings.bills.map((b) => [b]));
  section("SUBSCRIPTIONS", ["Subscription"], data.settings.subscriptions.map((b) => [b]));
  section(
    "REVENUE CATEGORIES",
    ["Category"],
    data.settings.revenueCategories.map((b) => [b]),
  );

  section(
    "BALANCES",
    ["Account", "Balance"],
    accountNames.map((n) => [n, money(walletBalance(data.transactions, n))]),
  );

  section(
    "SETTINGS",
    ["Setting", "Value"],
    [
      ["Theme", data.preferences.theme],
      ["Low balance warning", money(data.settings.lowBalanceThreshold)],
      ["AI enabled", data.settings.ai.enabled ? "yes" : "no"],
      ["AI provider", data.settings.ai.provider],
      ["AI model", data.settings.ai.model],
      ["AI tone", data.settings.ai.tone],
    ],
  );

  // A trailing newline, so appending to the file later does not join two rows.
  return `${out.join("\r\n")}\r\n`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
