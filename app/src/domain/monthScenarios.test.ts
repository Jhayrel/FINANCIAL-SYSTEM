/**
 * Scenarios: a month of the owner's life, told step by step, with every
 * screen made to agree after each step.
 *
 * The owner, 4 October 2026: "Run more test and fix more, implement more",
 * then "Use scenario base testing". Unit tests check one rule at a time; a
 * fault the owner sees is usually two screens disagreeing about the same
 * money: a statement closing at one figure and the sidebar at another, a
 * chart's total beside a different month total, a debt owed on one screen
 * and paid on another. So each story here saves its entries the way the Add
 * form does (`checkDraft`, `withFeesPaid`, `draftToTransactions`), bins and
 * restores the way the Bin does, and after every step checks that:
 *
 *   - every wallet's balance is the same on the sidebar, its own statement,
 *     the balance chart, and Find a difference (which finds nothing when the
 *     real figure is the recorded one);
 *   - the account statement closes at everything held;
 *   - the month's spending is the same on the totals, the expense sheet, the
 *     spending chart, the budget, the budget chart and the AI's figures;
 *   - the month's income is the same on the totals, the revenue sheet and
 *     the income chart;
 *   - what is owed is the same on the debt position, the debt statement and
 *     the owed chart.
 *
 * Every name and figure is invented, in the shape of the owner's own month.
 */

import { describe, expect, it } from "vitest";

import { type Account } from "./accounts";
import { buildContext } from "./aiContext";
import { allWalletBalances, walletBalance } from "./balances";
import { assessMonthFor } from "./budget";
import { buildBalanceChart, buildBudgetChart, buildOwedChart, chartReading } from "./chartAsk";
import { buildChart } from "./charts";
import { outstandingOf, positionOf, withFeesPaid, type Debt } from "./debt";
import { checkDraft, draftToTransactions, emptyDraft, type Draft } from "./entry";
import { planBudget, readBudgetAsk } from "./budgetAsk";
import { correctsWhatWasSaid, detectIntent, isQuestion } from "./intent";
import { investigate, investigationWords } from "./investigate";
import { readInvestigateAsk } from "./investigateAsk";
import { lessonKey } from "./learning";
import { readEntry } from "./readEntry";
import { detectRecall, findRows } from "./recall";
import { buildSheet } from "./statementSheet";
import { costOf, incomeOf, totalsFor } from "./totals";
import type { Budgets, IsoDate, ReferenceLists, Transaction } from "./types";

// ── The owner's lists, in the same shape as theirs ──────────────────────────

const WALLETS = ["Cash", "Gcash", "Maya"] as const;
const SAVINGS = "Maya Bank (Personal savings)";

const reference: ReferenceLists = {
  wallets: [...WALLETS],
  savings: [SAVINGS],
  bills: ["Globe at Home Wifi"],
  subscriptions: ["Spotify"],
  revenueCategories: ["Allowance", "Bank interest", "Random"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Fare", remark: "Jeep, tricycle, bus" },
    { name: "School", remark: "Fees, projects, contributions" },
    { name: "Treat", remark: "Eating out, gifts" },
    { name: "Online Buy", remark: "Shopee, Lazada, load" },
  ],
  credits: ["Maya Credit"],
  onBehalf: [{ id: "tita", name: "Tita", side: "held" }],
};

const mayaCredit: Debt = {
  id: "maya-credit",
  name: "Maya Credit",
  kind: "payable",
  counterparty: "Maya Bank",
  counterpartyType: "institution",
  openedDate: "2026-07-01",
  wallet: "Maya",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
  form: "credit-line",
  creditLimit: 500000,
};
const tita: Debt = { ...mayaCredit, id: "tita", name: "Tita", counterparty: "Tita", counterpartyType: "person", form: "pass-through", creditLimit: undefined, wallet: "Gcash" };
const DEBTS = [mayaCredit, tita];

const accounts: Account[] = [
  ...WALLETS.map((name) => ({ id: name.toLowerCase(), name, kind: "spending" as const, archived: false })),
  { id: "savings", name: SAVINGS, kind: "savings" as const, archived: false },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ── A ledger kept the way the app keeps it ──────────────────────────────────

class Book {
  rows: Transaction[] = [];
  bin: Transaction[] = [];
  private n = 0;
  budgets: Budgets = {};

  /** Saved as the Add form saves it: checked, a payment's fees folded in, then written. */
  save(over: Partial<Draft> & Pick<Draft, "flow" | "date" | "amount">): Transaction[] {
    const draft: Draft = { ...emptyDraft(over.date), ...over };
    const check = checkDraft(draft, this.rows, reference, DEBTS, over.date);
    expect(check.errors, `${draft.flow} ${draft.item || draft.debtEffect || ""} ${draft.amount}`).toEqual([]);
    const final = withFeesPaid(draft, this.rows);
    this.n += 1;
    const rows = draftToTransactions(final, this.n, `s${this.n}`, check.repaymentSplit);
    this.rows.push(...rows);
    return rows;
  }

  /** An edit keeps the row's id and record number. */
  edit(id: string, change: Partial<Draft>): Transaction[] {
    const old = this.rows.find((t) => t.id === id);
    if (!old) throw new Error(`no row ${id}`);
    const draft: Draft = {
      ...emptyDraft(old.date),
      id: old.id,
      flow: old.type === "Revenue" || old.type === "Spending" || old.type === "Transfer" || old.type === "Debt" ? old.type : "",
      date: old.date,
      fromWallet: old.fromWallet,
      toWallet: old.toWallet,
      category: old.category,
      item: old.item,
      description: old.description,
      amount: old.amount,
      fee: old.fee,
      notes: old.notes,
      status: old.status,
      ...change,
    };
    const others = this.rows.filter((t) => t.id !== id);
    const check = checkDraft(draft, others, reference, DEBTS, draft.date);
    expect(check.errors).toEqual([]);
    const rows = draftToTransactions(draft, old.recordNumber, old.id, check.repaymentSplit);
    this.rows = [...others, ...rows];
    return rows;
  }

  /** To the bin, never removed: the Bin screen brings it back as it was. */
  toBin(id: string): void {
    const row = this.rows.find((t) => t.id === id);
    if (!row) throw new Error(`no row ${id}`);
    this.rows = this.rows.filter((t) => t.id !== id);
    this.bin.push(row);
  }

  restore(id: string): void {
    const row = this.bin.find((t) => t.id === id);
    if (!row) throw new Error(`no binned row ${id}`);
    this.bin = this.bin.filter((t) => t.id !== id);
    this.rows.push(row);
  }
}

const upTo = (rows: readonly Transaction[], day: IsoDate): Transaction[] => rows.filter((t) => t.date <= day);
const inMonthOf = (rows: readonly Transaction[], day: IsoDate): Transaction[] => rows.filter((t) => t.date.slice(0, 7) === day.slice(0, 7));
const lastDay = (day: IsoDate): IsoDate => {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};
const pesos = (c: number): number => Math.round(c) / 100;

/**
 * Every screen agrees about the money, on `asOf`.
 *
 * Said as one check so a story reads as a story, and a failure names the
 * screen that disagreed.
 */
function screensAgree(book: Book, asOf: IsoDate): void {
  const rows = book.rows;
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const end = lastDay(asOf);
  const name = `${MONTHS[month - 1]} ${year}`;

  // ── Balances ──────────────────────────────────────────────────────────
  const account = buildSheet(rows, { type: "account", year, fromMonth: month, toMonth: month }, reference, DEBTS);
  let held = 0;
  for (const [, v] of allWalletBalances(upTo(rows, end))) held += v;
  expect(account.closing, "account statement closes at everything held").toBe(held);
  expect(account.totalIn - account.totalOut, "account statement moves by its own totals").toBe(account.closing - (account.broughtForward ?? 0));

  for (const wallet of [...WALLETS, SAVINGS]) {
    // What the sidebar shows: everything entered, a row dated ahead of today included.
    const now = walletBalance(rows, wallet);
    const sheet = buildSheet(rows, { type: "wallet", wallet, year, fromMonth: month, toMonth: month }, reference, DEBTS);
    expect(sheet.closing, `${wallet}: its statement closes at its balance`).toBe(walletBalance(upTo(rows, end), wallet));
    if (rows.some((t) => t.fromWallet === wallet || t.toWallet === wallet)) {
      const chart = buildBalanceChart(`chart my ${wallet} balance this month`, rows, reference, asOf);
      expect(chart?.total, `${wallet}: the balance chart ends at its balance`).toBe(now);
    }
    const found = investigate({ transactions: rows, account: wallet, actual: now, asOf, countAhead: true });
    expect(found.gap, `${wallet}: Find a difference finds nothing when it matches`).toBe(0);
    expect(found.found, `${wallet}: and names no row`).toEqual([]);
  }

  // ── The month's spending ─────────────────────────────────────────────
  const monthRows = inMonthOf(rows, asOf);
  const spent = totalsFor(monthRows).total;
  expect(monthRows.reduce((s, t) => s + costOf(t), 0), "every row's cost adds to the month total").toBe(spent);
  const expense = buildSheet(rows, { type: "expense", year, fromMonth: month, toMonth: month }, reference, DEBTS);
  expect(expense.totalOut, "the expense sheet totals the month").toBe(spent);
  expect(assessMonthFor(rows, book.budgets, year, month).combined.spent, "the budget counts the month").toBe(spent);
  if (spent > 0) {
    expect(buildChart(`spending by item ${name}`, rows, asOf)?.total, "the spending chart totals the month").toBe(spent);
    const budgetChart = buildBudgetChart(`budget vs actual ${name}`, rows, book.budgets, asOf);
    expect(budgetChart?.total, "the budget chart totals the month").toBe(spent);
  }
  const ctx = buildContext({ transactions: rows, accounts, budgets: book.budgets, credits: DEBTS, reference, lowBalanceThreshold: 0, asOf });
  expect(ctx.month.spent, "the AI is told the same month total").toBe(pesos(spent));
  const plan = assessMonthFor(rows, book.budgets, year, month).combined;
  expect(ctx.month.budget, "the AI is told the same budget").toBe(plan.budget > 0 ? pesos(plan.budget) : null);
  if (plan.budget > 0) expect(ctx.month.remaining, "and the same left").toBe(pesos(plan.remaining));

  // ── The month's income ───────────────────────────────────────────────
  const income = monthRows.reduce((s, t) => s + incomeOf(t), 0);
  expect(totalsFor(monthRows).revenue, "income is counted one way").toBe(income);
  const revenue = buildSheet(rows, { type: "revenue", year, fromMonth: month, toMonth: month }, reference, DEBTS);
  expect(revenue.totalIn, "the revenue sheet totals the month's income").toBe(income);
  if (income > 0) expect(buildChart(`income by item ${name}`, rows, asOf)?.total, "the income chart totals it").toBe(income);
  expect(ctx.month.revenue, "the AI is told the same income").toBe(pesos(income));

  // ── What is owed ─────────────────────────────────────────────────────
  for (const debt of DEBTS) {
    const owed = outstandingOf(upTo(rows, asOf), debt.id);
    expect(positionOf(debt, upTo(rows, asOf), asOf).outstanding, `${debt.name}: the position`).toBe(owed);
    const statement = buildSheet(rows, { type: "debt", debtId: debt.id, year, fromMonth: month, toMonth: month }, reference, DEBTS);
    expect(statement.closing, `${debt.name}: the debt statement`).toBe(outstandingOf(upTo(rows, end), debt.id));
    if (rows.some((t) => t.debtId === debt.id)) {
      expect(buildOwedChart(`chart ${debt.name}`, rows, DEBTS, asOf)?.total, `${debt.name}: the owed chart`).toBe(owed);
    }
  }
}

// ── The stories ─────────────────────────────────────────────────────────────

describe("scenario: an allowance month", () => {
  const book = new Book();
  book.budgets = { "2026": { spending: [0, 0, 0, 0, 0, 0, 0, 0, 0, 300000, 0, 0], billsSubs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 120000, 0, 0] } };

  it("1. the allowance arrives in Gcash", () => {
    book.save({ flow: "Revenue", date: "2026-10-01", toWallet: "Gcash", category: "Revenue", item: "Allowance", amount: 1500000, status: "Received" });
    expect(walletBalance(book.rows, "Gcash")).toBe(1500000);
    screensAgree(book, "2026-10-01");
  });

  it("2. some of it moves to Maya, with a fee", () => {
    book.save({ flow: "Transfer", date: "2026-10-01", fromWallet: "Gcash", toWallet: "Maya", category: "Transfer", amount: 500000, fee: 1000, status: "Transferred" });
    expect(walletBalance(book.rows, "Gcash")).toBe(1500000 - 501000);
    expect(walletBalance(book.rows, "Maya")).toBe(500000);
    // Only the fee is spending: the money is still the owner's.
    expect(totalsFor(book.rows).total).toBe(1000);
    screensAgree(book, "2026-10-01");
  });

  it("3. cash out of an ATM, the machine's fee on its own line", () => {
    book.save({ flow: "Transfer", date: "2026-10-02", fromWallet: "Maya", toWallet: "Cash", category: "Transfer", amount: 100000, fee: 1800, status: "Withdrawn", description: "Withdrawal from an ATM" });
    expect(walletBalance(book.rows, "Cash")).toBe(100000);
    expect(walletBalance(book.rows, "Maya")).toBe(500000 - 101800);
    const sheet = buildSheet(book.rows, { type: "account", year: 2026, fromMonth: 10, toMonth: 10 }, reference, DEBTS);
    expect(sheet.lines.find((l) => l.date === "2026-10-02")).toMatchObject({ moneyOut: 1800, detail: "Withdrew ₱1,000.00, fee ₱18.00" });
    expect(sheet.notes).toContain("Cash withdrawn: ₱1,000.00 (1), fees ₱18.00. A transfer counts only its fee.");
    screensAgree(book, "2026-10-02");
  });

  it("4. a day spent in cash", () => {
    book.save({ flow: "Spending", date: "2026-10-02", fromWallet: "Cash", category: "Spending", item: "Food", description: "ate lunch", amount: 9500, status: "Paid" });
    book.save({ flow: "Spending", date: "2026-10-02", fromWallet: "Cash", category: "Spending", item: "Fare", description: "jeep", amount: 1300, status: "Paid" });
    expect(walletBalance(book.rows, "Cash")).toBe(100000 - 10800);
    screensAgree(book, "2026-10-02");
  });

  it("5. the internet bill and a subscription from Maya", () => {
    book.save({ flow: "Spending", date: "2026-10-03", fromWallet: "Maya", category: "Bills", item: "Globe at Home Wifi", amount: 99900, status: "Paid" });
    book.save({ flow: "Spending", date: "2026-10-03", fromWallet: "Maya", category: "Subscriptions", item: "Spotify", amount: 14900, status: "Paid" });
    const t = totalsFor(inMonthOf(book.rows, "2026-10-03"));
    expect(t).toMatchObject({ bills: 99900, subscriptions: 14900 });
    screensAgree(book, "2026-10-03");
  });

  it("6. money sent to a friend, which left the owner's accounts", () => {
    book.save({ flow: "Transfer", date: "2026-10-04", fromWallet: "Gcash", toWallet: "", sentOut: true, category: "Transfer", description: "to a friend", amount: 50000, fee: 1000, status: "Transferred" });
    // Money Send is spending in full, not only its fee.
    expect(totalsFor(inMonthOf(book.rows, "2026-10-04")).total).toBe(1000 + 1800 + 9500 + 1300 + 99900 + 14900 + 51000);
    expect(walletBalance(book.rows, "Gcash")).toBe(1500000 - 501000 - 51000);
    screensAgree(book, "2026-10-04");
  });

  it("7. the budget and its chart say where the month stands", () => {
    const spent = totalsFor(inMonthOf(book.rows, "2026-10-04")).total;
    const burn = buildBudgetChart("how is my budget this month, show me", book.rows, book.budgets, "2026-10-04")!;
    expect(burn.by).toBe("day");
    expect(burn.total).toBe(spent);
    expect(burn.against?.total).toBe(420000);
    expect(chartReading(burn)).toContain(`spent by Oct 4`);
  });
});

describe("scenario: borrowing on a credit line and paying it off", () => {
  const book = new Book();

  it("1. starting money in Maya", () => {
    book.save({ flow: "Revenue", date: "2026-09-01", toWallet: "Maya", category: "Revenue", item: "Allowance", amount: 300000, status: "Received" });
    screensAgree(book, "2026-09-01");
  });

  it("2. borrows PHP 2,000.00, and the lender adds PHP 151.03 in fees to what is owed", () => {
    book.save({ flow: "Debt", date: "2026-09-18", debtId: "maya-credit", debtEffect: "draw", item: "Maya Credit", toWallet: "Maya", amount: 200000, charges: 15103, status: "Received" });
    expect(walletBalance(book.rows, "Maya")).toBe(500000);
    expect(outstandingOf(book.rows, "maya-credit")).toBe(215103);
    // The fees are spending on the day they were added; the borrowed money is not income.
    expect(totalsFor(inMonthOf(book.rows, "2026-09-18")).total).toBe(15103);
    expect(totalsFor(inMonthOf(book.rows, "2026-09-18")).revenue).toBe(300000);
    screensAgree(book, "2026-09-18");
  });

  it("3. pays the whole of it in October, typed as borrowed plus fees", () => {
    book.save({ flow: "Debt", date: "2026-10-05", debtId: "maya-credit", debtEffect: "repay", item: "Maya Credit", fromWallet: "Maya", amount: 200000, interest: 15103, status: "Paid" });
    expect(outstandingOf(book.rows, "maya-credit")).toBe(0);
    expect(walletBalance(book.rows, "Maya")).toBe(500000 - 215103);
    // The fees were spending in September; paying them is not spending again.
    expect(totalsFor(inMonthOf(book.rows, "2026-10-05")).total).toBe(0);
    screensAgree(book, "2026-10-05");
    // Borrowed on the 18th of the month before: read day by day, the peak on the day it was borrowed.
    expect(chartReading(buildOwedChart("chart my maya credit", book.rows, DEBTS, "2026-10-05")!)).toBe(
      "Nothing owed now: it is paid off. The most owed was PHP 2,151.03, on Sep 18.",
    );
  });
});

describe("scenario: money that arrives for someone else", () => {
  const book = new Book();

  it("1. mom sends 40,000: 25,000 is the aunt's, 15,000 is the owner's", () => {
    book.save({ flow: "Debt", behalf: "held", date: "2026-09-27", debtId: "tita", debtEffect: "draw", toWallet: "Gcash", item: "Tita", description: "for lola's funeral", amount: 2500000, status: "Received" });
    book.save({ flow: "Revenue", date: "2026-09-27", toWallet: "Gcash", category: "Revenue", item: "Allowance", description: "fare to Abra", amount: 300000, status: "Received" });
    book.save({ flow: "Revenue", date: "2026-09-27", toWallet: "Gcash", category: "Revenue", item: "Allowance", amount: 1200000, status: "Received" });
    expect(walletBalance(book.rows, "Gcash")).toBe(4000000);
    // Only the owner's part is income; the aunt's is held.
    expect(totalsFor(book.rows).revenue).toBe(1500000);
    expect(outstandingOf(book.rows, "tita")).toBe(2500000);
    screensAgree(book, "2026-09-27");
  });

  it("2. the aunt's money is passed on, which is neither spending nor income", () => {
    book.save({ flow: "Debt", behalf: "held", date: "2026-09-28", debtId: "tita", debtEffect: "repay", fromWallet: "Gcash", item: "Tita", amount: 2500000, status: "Paid" });
    expect(outstandingOf(book.rows, "tita")).toBe(0);
    expect(walletBalance(book.rows, "Gcash")).toBe(1500000);
    expect(totalsFor(book.rows)).toMatchObject({ total: 0, revenue: 1500000 });
    screensAgree(book, "2026-09-28");
  });
});

describe("scenario: a withdrawal saved with the machine's fee inside it", () => {
  const book = new Book();
  let atm = "";

  it("1. read off a history as one figure, PHP 1,018.00, with no fee", () => {
    book.save({ flow: "Revenue", date: "2026-09-01", toWallet: "Maya", category: "Revenue", item: "Allowance", amount: 500000, status: "Received" });
    atm = book.save({ flow: "Transfer", date: "2026-09-18", fromWallet: "Maya", toWallet: "Cash", category: "Transfer", amount: 101800, status: "Withdrawn", description: "Withdrawal from an ATM" })[0]!.id;
    // Cash is recorded PHP 18.00 higher than the machine gave.
    expect(walletBalance(book.rows, "Cash")).toBe(101800);
    const sheet = buildSheet(book.rows, { type: "account", year: 2026, fromMonth: 9, toMonth: 9 }, reference, DEBTS);
    expect(sheet.lines.find((l) => l.id === atm)?.detail).toBe("Withdrew ₱1,018.00, fee not saved");
    expect(sheet.notes).toContain("No fee saved on 1 withdrawal (Sep 18). Edit it: cash in Amount, the rest in Fee.");
    screensAgree(book, "2026-09-18");
  });

  it("2. counting the cash finds PHP 18.00 less, and Find a difference names the withdrawal", () => {
    const result = investigate({ transactions: book.rows, account: "Cash", actual: 100000, asOf: "2026-09-20" });
    const clue = result.possible.find((c) => c.kind === "fee-inside");
    expect(clue?.explains).toBe(1800);
    expect(clue && "rows" in clue ? clue.rows.map((r) => r.id) : []).toEqual([atm]);
  });

  it("3. edited to the cash and its fee, Cash matches and the fee is spending", () => {
    book.edit(atm, { amount: 100000, fee: 1800 });
    expect(walletBalance(book.rows, "Cash")).toBe(100000);
    expect(walletBalance(book.rows, "Maya")).toBe(500000 - 101800);
    expect(totalsFor(book.rows).total).toBe(1800);
    const sheet = buildSheet(book.rows, { type: "account", year: 2026, fromMonth: 9, toMonth: 9 }, reference, DEBTS);
    expect(sheet.notes.some((n) => n.startsWith("No fee saved"))).toBe(false);
    screensAgree(book, "2026-09-20");
  });
});

describe("scenario: a wrong entry binned, then brought back", () => {
  const book = new Book();
  let lunch = "";

  it("1. a lunch entered twice by mistake", () => {
    book.save({ flow: "Revenue", date: "2026-10-01", toWallet: "Cash", category: "Revenue", item: "Allowance", amount: 100000, status: "Received" });
    book.save({ flow: "Spending", date: "2026-10-02", fromWallet: "Cash", category: "Spending", item: "Food", description: "lunch", amount: 9500, status: "Paid" });
    lunch = book.save({ flow: "Spending", date: "2026-10-02", fromWallet: "Cash", category: "Spending", item: "Food", description: "lunch", amount: 9500, status: "Paid" })[0]!.id;
    // Counted, Cash holds PHP 95.00 more than the ledger says, and the second lunch is the reason.
    const result = investigate({ transactions: book.rows, account: "Cash", actual: 100000 - 9500, asOf: "2026-10-02" });
    expect(result.gap).toBe(-9500);
    expect(result.found.map((c) => (c.kind === "duplicate" ? c.row.id : c.kind))).toEqual([lunch]);
    screensAgree(book, "2026-10-02");
  });

  it("2. to the bin: every total drops it", () => {
    book.toBin(lunch);
    expect(walletBalance(book.rows, "Cash")).toBe(100000 - 9500);
    expect(totalsFor(book.rows).total).toBe(9500);
    screensAgree(book, "2026-10-02");
  });

  it("3. restored: as it was, with its own record number", () => {
    book.restore(lunch);
    expect(walletBalance(book.rows, "Cash")).toBe(100000 - 19000);
    expect(book.rows.find((t) => t.id === lunch)?.recordNumber).toBe(3);
    screensAgree(book, "2026-10-02");
  });
});

describe("scenario: a month over its budget", () => {
  const book = new Book();
  book.budgets = { "2026": { spending: [0, 0, 0, 0, 0, 0, 0, 0, 300000, 300000, 0, 0], billsSubs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };

  it("1. September goes over, October is still running", () => {
    book.save({ flow: "Revenue", date: "2026-09-01", toWallet: "Maya", category: "Revenue", item: "Allowance", amount: 1000000, status: "Received" });
    book.save({ flow: "Spending", date: "2026-09-10", fromWallet: "Maya", category: "Spending", item: "Treat", amount: 250000, status: "Paid" });
    book.save({ flow: "Spending", date: "2026-09-20", fromWallet: "Maya", category: "Spending", item: "School", amount: 100000, status: "Paid" });
    book.save({ flow: "Spending", date: "2026-10-02", fromWallet: "Maya", category: "Spending", item: "Food", amount: 20000, status: "Paid" });
    screensAgree(book, "2026-09-30");
    screensAgree(book, "2026-10-03");
    const chart = buildBudgetChart("budget vs actual since september", book.rows, book.budgets, "2026-10-03")!;
    expect(chart.rows.map((r) => [r.label, r.value, r.previous])).toEqual([
      ["September 2026", 350000, 300000],
      ["October 2026", 20000, 300000],
    ]);
    expect(chartReading(chart)).toBe(
      "Over the budget in 1 of 1 month with one; September 2026 by the most, PHP 500.00 over. October 2026 is still running: PHP 200.00 of PHP 3,000.00 so far.",
    );
  });
});

describe("scenario: the year turns", () => {
  const book = new Book();

  it("1. 1 January opens with what 31 December closed with, and nothing is income", () => {
    book.save({ flow: "Revenue", date: "2025-12-01", toWallet: "Gcash", category: "Revenue", item: "Allowance", amount: 500000, status: "Received" });
    book.save({ flow: "Spending", date: "2025-12-31", fromWallet: "Gcash", category: "Spending", item: "Food", amount: 120000, status: "Paid" });
    const december = buildSheet(book.rows, { type: "account", year: 2025, fromMonth: 12, toMonth: 12 }, reference, DEBTS);
    const january = buildSheet(book.rows, { type: "account", year: 2026, fromMonth: 1, toMonth: 1 }, reference, DEBTS);
    expect(january.broughtForward).toBe(december.closing);
    expect(totalsFor(inMonthOf(book.rows, "2026-01-01")).revenue).toBe(0);
    screensAgree(book, "2025-12-31");
    screensAgree(book, "2026-01-05");
  });
});

describe("scenario: a day typed into the chat, read on the device", () => {
  /*
   * The sentences the owner types, read the way the chat reads them when no
   * model answers (`readEntry`), each saved as its card would save it. What
   * the model adds is wording; the money has to come out right without it.
   */
  const book = new Book();
  const type = (said: string, asOf: IsoDate): Draft => {
    const read = readEntry(said, book.rows, reference, asOf);
    expect(read.draft.amount, said).not.toBeNull();
    return read.draft;
  };

  it("1. the allowance, the cash taken out, lunch, the bill and money sent", () => {
    const allowance = type("mom sent my allowance 5000 to gcash", "2026-10-01");
    expect(allowance).toMatchObject({ flow: "Revenue", toWallet: "Gcash", amount: 500000 });
    book.save({ ...allowance, item: allowance.item || "Allowance", date: "2026-10-01", amount: allowance.amount });

    const moved = type("transferred 2000 from gcash to maya 10 fee", "2026-10-01");
    expect(moved).toMatchObject({ flow: "Transfer", fromWallet: "Gcash", toWallet: "Maya", amount: 200000, fee: 1000 });
    book.save({ ...moved, date: "2026-10-01", amount: moved.amount });

    const cash = type("withdrew 1000 from maya 18 fee", "2026-10-02");
    expect(cash).toMatchObject({ flow: "Transfer", fromWallet: "Maya", toWallet: "Cash", amount: 100000, fee: 1800 });
    book.save({ ...cash, date: "2026-10-02", amount: cash.amount });

    const lunch = type("ate lunch 95 cash", "2026-10-02");
    expect(lunch).toMatchObject({ flow: "Spending", fromWallet: "Cash", item: "Food", amount: 9500 });
    book.save({ ...lunch, date: "2026-10-02", amount: lunch.amount });

    const wifi = type("paid globe at home wifi 999 from maya", "2026-10-03");
    expect(wifi).toMatchObject({ flow: "Spending", fromWallet: "Maya", item: "Globe at Home Wifi", amount: 99900 });
    book.save({ ...wifi, date: "2026-10-03", amount: wifi.amount });

    expect(walletBalance(book.rows, "Cash")).toBe(100000 - 9500);
    expect(walletBalance(book.rows, "Maya")).toBe(200000 - 101800 - 99900);
    expect(walletBalance(book.rows, "Gcash")).toBe(500000 - 201000);
    expect(totalsFor(book.rows).total).toBe(1000 + 1800 + 9500 + 99900);
    screensAgree(book, "2026-10-03");
  });

  it("2. a plan and a question are never saved", () => {
    for (const said of ["I will be spending 1000 cash tomorrow", "im planning to spend 500 for food later", "how much did i spend on food this week?"]) {
      // The chat answers these rather than offering a card.
      expect(isQuestion(said), said).toBe(true);
      expect(detectIntent(said), said).toBe("ask");
    }
    // "I said 250 not 450" puts the conversation right, and is no PHP 250.00 card.
    expect(correctsWhatWasSaid("I said 250 not 450")).toBe(true);
  });
});

describe("scenario: savings put aside and taken back", () => {
  const book = new Book();

  it("1. some of the allowance goes to savings", () => {
    book.save({ flow: "Revenue", date: "2026-10-01", toWallet: "Maya", category: "Revenue", item: "Allowance", amount: 1000000, status: "Received" });
    book.save({ flow: "Transfer", date: "2026-10-01", fromWallet: "Maya", toWallet: SAVINGS, category: "Transfer", amount: 300000, status: "Transferred" });
    expect(walletBalance(book.rows, SAVINGS)).toBe(300000);
    // Saving is not spending.
    expect(totalsFor(book.rows).total).toBe(0);
    const savings = buildSheet(book.rows, { type: "savings", year: 2026, fromMonth: 10, toMonth: 10 }, reference, DEBTS);
    expect(savings.closing).toBe(300000);
    screensAgree(book, "2026-10-01");
  });

  it("2. some of it comes back out", () => {
    book.save({ flow: "Transfer", date: "2026-10-10", fromWallet: SAVINGS, toWallet: "Maya", category: "Transfer", amount: 100000, status: "Transferred" });
    expect(walletBalance(book.rows, SAVINGS)).toBe(200000);
    expect(walletBalance(book.rows, "Maya")).toBe(800000);
    screensAgree(book, "2026-10-10");
  });
});

describe("scenario: paying for a friend who pays back, and one who does not", () => {
  const friend: Debt = { ...tita, id: "pedro", name: "Pedro", kind: "receivable", counterparty: "Pedro" };
  const DEBTS2 = [...DEBTS, friend];
  const book = new Book();
  const save = (over: Partial<Draft> & Pick<Draft, "flow" | "date" | "amount">): void => {
    const draft: Draft = { ...emptyDraft(over.date), ...over };
    const check = checkDraft(draft, book.rows, reference, DEBTS2, over.date);
    expect(check.errors).toEqual([]);
    book.rows.push(...draftToTransactions(draft, book.rows.length + 1, `p${book.rows.length + 1}`));
  };

  it("1. a meal paid for him is not spending while he owes it", () => {
    save({ flow: "Revenue", date: "2026-10-01", toWallet: "Gcash", category: "Revenue", item: "Allowance", amount: 100000, status: "Received" });
    save({ flow: "Debt", behalf: "owed", date: "2026-10-02", debtId: "pedro", debtEffect: "lend", fromWallet: "Gcash", item: "Pedro", amount: 25000, status: "Paid" });
    expect(walletBalance(book.rows, "Gcash")).toBe(75000);
    expect(outstandingOf(book.rows, "pedro")).toBe(25000);
    expect(totalsFor(book.rows).total).toBe(0);
  });

  it("2. he pays half back, and the rest is written off as a treat", () => {
    save({ flow: "Debt", behalf: "owed", date: "2026-10-05", debtId: "pedro", debtEffect: "collect", toWallet: "Gcash", item: "Pedro", amount: 12500, status: "Received" });
    save({ flow: "Debt", behalf: "owed", date: "2026-10-06", debtId: "pedro", debtEffect: "writeoff", item: "Treat", amount: 12500, status: "Paid" });
    expect(outstandingOf(book.rows, "pedro")).toBe(0);
    expect(walletBalance(book.rows, "Gcash")).toBe(87500);
    // Only what he never paid back is spending, on the day it was given up.
    expect(totalsFor(book.rows)).toMatchObject({ total: 12500, revenue: 100000 });
  });
});

describe("scenario: an entry filed on the wrong wallet, edited", () => {
  const book = new Book();

  it("moves the money between the two wallets and nothing else", () => {
    book.save({ flow: "Revenue", date: "2026-10-01", toWallet: "Cash", category: "Revenue", item: "Allowance", amount: 100000, status: "Received" });
    book.save({ flow: "Revenue", date: "2026-10-01", toWallet: "Maya", category: "Revenue", item: "Allowance", amount: 100000, status: "Received" });
    const id = book.save({ flow: "Spending", date: "2026-10-02", fromWallet: "Cash", category: "Spending", item: "School", amount: 30000, status: "Paid" })[0]!.id;
    const before = totalsFor(book.rows).total;
    book.edit(id, { fromWallet: "Maya" });
    expect(walletBalance(book.rows, "Cash")).toBe(100000);
    expect(walletBalance(book.rows, "Maya")).toBe(70000);
    expect(totalsFor(book.rows).total).toBe(before);
    expect(book.rows.find((t) => t.id === id)?.recordNumber).toBe(3);
    screensAgree(book, "2026-10-02");
  });
});

describe("scenario: a week run from the chat", () => {
  /*
   * Everything here is said, not typed into a form: the budget, the
   * entries, a delete, a restore, and the balance the phone shows. Each is
   * read the way the chat reads it on the device and applied the way its
   * card applies it.
   */
  const book = new Book();
  const ASOF = "2026-10-06";
  const say = (said: string, asOf: IsoDate = ASOF): Transaction[] => {
    expect(isQuestion(said), said).toBe(false);
    const { draft } = readEntry(said, book.rows, reference, asOf);
    // The card keeps the words that named it as the description when the reading wrote none.
    const description = draft.description.trim() || lessonKey(said, reference);
    return book.save({ ...draft, description, date: asOf, amount: draft.amount });
  };

  it("1. the budget is set by a sentence", () => {
    const ask = readBudgetAsk("set my october budget: spending 6000 and bills 1000", reference, "2026-10-01");
    expect(ask).toMatchObject({ kind: "tracks", year: 2026, month: 10, spending: 600000, billsSubs: 100000 });
    const plan = planBudget(ask!, book.budgets, "2026-10-01", "2026-10-01T08:00:00Z");
    expect(plan.outcome.refused).toBeUndefined();
    book.budgets = { ...book.budgets, [plan.year]: plan.outcome.plan };
    expect(assessMonthFor(book.rows, book.budgets, 2026, 10).combined.budget).toBe(700000);
    screensAgree(book, "2026-10-01");
  });

  it("2. the allowance and the week's spending, said in the chat", () => {
    say("mom sent my allowance 5000 to gcash", "2026-10-01");
    say("transferred 1500 from gcash to maya 10 fee", "2026-10-01");
    const school = say("spent 1200 on school project using gcash", "2026-10-02");
    expect(school[0]).toMatchObject({ item: "School", fromWallet: "Gcash", amount: 120000 });
    const wifi = say("paid my wifi bill 999 from maya", "2026-10-03");
    expect(wifi[0]).toMatchObject({ item: "Globe at Home Wifi", category: "Bills", fromWallet: "Maya" });
    say("bought load 100 gcash", "2026-10-04");
    expect(walletBalance(book.rows, "Gcash")).toBe(500000 - 151000 - 120000 - 10000);
    expect(assessMonthFor(book.rows, book.budgets, 2026, 10).billsSubs.spent).toBe(99900);
    screensAgree(book, "2026-10-04");
  });

  it("3. a lunch typed twice: deleting the extra one by describing it", () => {
    const first = say("lunch 95 gcash", "2026-10-05");
    const twice = say("lunch 95 gcash", "2026-10-05");
    const recall = detectRecall("delete the lunch 95 I typed twice");
    expect(recall?.action).toBe("bin");
    const found = findRows(recall!.phrase, book.rows, ASOF);
    const ids = found.map((c) => c.row.id);
    expect(ids).toContain(first[0]!.id);
    expect(ids).toContain(twice[0]!.id);
    // Only lunches are offered, never the rest of the week.
    expect(found.every((c) => c.row.amount === 9500)).toBe(true);
    book.toBin(twice[0]!.id);
    expect(walletBalance(book.rows, "Gcash")).toBe(500000 - 151000 - 120000 - 10000 - 9500);
    screensAgree(book, "2026-10-05");
  });

  it("4. brought back by describing it, then binned again", () => {
    const recall = detectRecall("restore the lunch I deleted");
    expect(recall?.action).toBe("restore");
    const found = findRows(recall!.phrase, book.bin, ASOF);
    expect(found.map((c) => c.row.item)).toEqual(["Food"]);
    const id = found[0]!.row.id;
    book.restore(id);
    expect(book.rows.filter((t) => t.item === "Food")).toHaveLength(2);
    book.toBin(id);
    screensAgree(book, "2026-10-05");
  });

  it("5. the balance on the phone is told, and the difference is found without touching a row", () => {
    // The 4 October load saved again from a history screenshot: Gcash really holds PHP 100.00 more.
    const extra = say("bought load 100 gcash", "2026-10-04");
    const recorded = walletBalance(book.rows, "Gcash");
    const real = recorded + 10000;
    const before = JSON.stringify(book.rows);
    const ask = readInvestigateAsk(`my gcash balance is ${pesos(real).toFixed(2)}`, [...WALLETS, SAVINGS], (a) => walletBalance(book.rows, a), ASOF);
    expect(ask).toMatchObject({ account: "Gcash", actual: real });
    const result = investigate({ transactions: book.rows, account: "Gcash", actual: real, asOf: ASOF });
    expect(result.gap).toBe(-10000);
    expect(result.found.some((c) => c.kind === "duplicate" && [c.row.id, c.twin.id].includes(extra[0]!.id))).toBe(true);
    // Integrity checks report, they never auto-correct.
    expect(JSON.stringify(book.rows)).toBe(before);
    book.toBin(extra[0]!.id);
    expect(walletBalance(book.rows, "Gcash")).toBe(real);
    screensAgree(book, ASOF);
  });

  it("6. the budget stands where every screen says it does", () => {
    const month = assessMonthFor(book.rows, book.budgets, 2026, 10);
    expect(month.spending.spent).toBe(1000 + 120000 + 10000 + 9500);
    expect(month.combined.remaining).toBe(700000 - month.combined.spent);
    const chart = buildBudgetChart("how is my budget this month, show me", book.rows, book.budgets, ASOF)!;
    expect(chart.total).toBe(month.combined.spent);
  });
});

describe("scenario: savings asked for the way it is said", () => {
  const book = new Book();

  it("draws the savings account for its short name and for the words in its brackets", () => {
    book.save({ flow: "Revenue", date: "2026-10-01", toWallet: "Maya", category: "Revenue", item: "Allowance", amount: 1000000, status: "Received" });
    book.save({ flow: "Transfer", date: "2026-10-01", fromWallet: "Maya", toWallet: SAVINGS, category: "Transfer", amount: 300000, status: "Transferred" });
    for (const said of ["chart my maya bank balance", "show my personal savings balance this month", `chart my ${SAVINGS} balance`]) {
      expect(buildBalanceChart(said, book.rows, reference, "2026-10-05")?.total, said).toBe(300000);
    }
    // The wallet inside the name is still the wallet.
    expect(buildBalanceChart("chart my maya balance", book.rows, reference, "2026-10-05")?.total).toBe(700000);
  });
});

describe("scenario: an entry dated ahead of today", () => {
  /*
   * The Add form takes a date ahead with a warning, and the sidebar counts
   * the row at once. Every screen that says what an account holds now has
   * to count it the same way, and Find a difference has to name it.
   */
  const book = new Book();
  const TODAY = "2026-10-04";

  it("1. the tuition is entered for the 10th, six days early", () => {
    book.save({ flow: "Revenue", date: "2026-10-01", toWallet: "Gcash", category: "Revenue", item: "Allowance", amount: 500000, status: "Received" });
    book.save({ flow: "Spending", date: "2026-10-10", fromWallet: "Gcash", category: "Spending", item: "School", amount: 200000, status: "Paid" });
    expect(walletBalance(book.rows, "Gcash")).toBe(300000);
    const chart = buildBalanceChart("chart my gcash balance", book.rows, reference, TODAY)!;
    expect(chart.total).toBe(300000);
    expect(chartReading(chart)).toContain("Counts 1 entry dated after today.");
    screensAgree(book, TODAY);
  });

  it("2. the phone still shows the 5,000, and the early entry is named as why", () => {
    const result = investigate({ transactions: book.rows, account: "Gcash", actual: 500000, asOf: TODAY, countAhead: true });
    expect(result.recorded).toBe(300000);
    expect(result.gap).toBe(-200000);
    const ahead = result.possible.find((c) => c.kind === "ahead");
    expect(ahead).toMatchObject({ kind: "ahead", explains: -200000 });
    expect(investigationWords(result).lines.join(" ")).toContain("dated after today and counted already, ₱2,000.00 out");
    // Named once, not again as "adds up to exactly".
    expect(result.possible.filter((c) => c.kind === "together")).toEqual([]);
  });

  it("3. a difference smaller than the early entry is not put down to it", () => {
    // The phone shows PHP 95.00 less than the sidebar: a lunch not written down, not the PHP 2,000.00 tuition.
    const result = investigate({ transactions: book.rows, account: "Gcash", actual: 300000 - 9500, asOf: TODAY, countAhead: true });
    expect(result.gap).toBe(9500);
    expect(result.possible.some((c) => c.kind === "ahead")).toBe(false);
  });
});
