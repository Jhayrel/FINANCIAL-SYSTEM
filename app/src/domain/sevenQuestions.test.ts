/**
 * The owner's seven hard questions, 10 November 2026, after the answers read
 * well and were wrong: a stopped subscription that was never stopped, money
 * paid on someone's behalf called the owner's own, a run-out day without the
 * allocations or next month's bill, a credit line's charge left out, a bin
 * listed under "Restore all" when told to put nothing back, "take out
 * Travel" read as Travel alone, and a saving schedule read as a spending
 * plan. Every name and figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { asksBinReview, binReview, binReviewWords, holdsBack } from "./binReview";
import { bridgeAnswer, readBridgeAsk } from "./bridgeAsk";
import { buildChart, chartAbout } from "./charts";
import { creditWhatIf, creditWhatIfWords, readCreditWhatIf } from "./creditWhatIf";
import { fitNote } from "./dayFit";
import type { Debt } from "./debt";
import { debtAnswer, readDebtAsk } from "./debtAsk";
import { makePlan, type Plan } from "./planner";
import { plansNamedAll, readScheduleAsk, schedulePlans, scheduleWords } from "./plansSchedule";
import { asksSubscriptionStops, subscriptionStops, subscriptionStopWords, subscriptionsNamed } from "./subscriptionStops";
import type { DeletedTransaction, ReferenceLists, Transaction } from "./types";

const ASOF = "2026-11-10";
const DASH = String.fromCharCode(0x2014);
let n = 0;
const row = (o: Partial<Transaction>): Transaction =>
  ({ id: `s${(n += 1)}`, recordNumber: 5000 + n, date: "2026-08-01", type: "Spending", category: "Spending", item: "", fromWallet: "Cash", toWallet: "", description: "", amount: 0, fee: 0, total: 0, notes: "", status: "Done", ...o }) as Transaction;
const spent = (date: string, item: string, amount: number, o: Partial<Transaction> = {}): Transaction => row({ date, item, amount, total: amount, ...o });

describe("take out Travel and what happened once, compared fairly", () => {
  const rows = [
    ...["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"].map((d) => spent(d, "Food", 300000)),
    ...["2026-08-09", "2026-09-09", "2026-10-09", "2026-11-09"].map((d) => spent(d, "Treat", 50000)),
    spent("2026-10-12", "Travel", 900000),
    spent("2026-11-02", "Travel", 20000),
    spent("2026-10-20", "Repairs", 120000),
  ];
  const q = "Was October really my worst month, or was it just the trip? Take out Travel and anything that only happened once, compare August to November fairly (November isn't over), and show it in a chart.";

  it("draws the months without them, and says what it left out", () => {
    const c = buildChart(q, rows, ASOF)!;
    expect(c.title).toBe("Spending without Travel and one-offs by month, August 2026 to November 2026");
    expect(c.rows.map((r) => r.value)).toEqual([350000, 350000, 350000, 350000]);
    expect(c.scope).toContain("Leaves out Travel PHP 9,200.00, and what happened in one month only: Repairs PHP 1,200.00.");
    expect(c.scope).toContain("A day, so months of different lengths and one still running compare fairly: August 2026 PHP 112.90, September 2026 PHP 116.67, October 2026 PHP 112.90, November 2026 so far (10 days) PHP 350.00.");
    expect(c.scope).not.toContain(DASH);
  });
  it("takes out only what it names, and a clause naming nothing is left alone", () => {
    expect(buildChart("Take out Travel, compare August to November", rows, ASOF)!.title).toBe("Spending without Travel by month, August 2026 to November 2026");
    expect(buildChart("chart Travel by month, August to November", rows, ASOF)!.title).toMatch(/^Travel by month/);
  });
  it("a long question takes no word as a topic unless it is said as one", () => {
    expect(chartAbout(q, [...rows, spent("2026-10-12", "Travel", 1000, { description: "the trip home" })])).toBe("");
    expect(chartAbout("how much did I spend on the trip", [spent("2026-10-12", "Travel", 1000, { description: "the trip home" })])).toBe("trip");
  });
});

describe("the bin, weighed, with nothing put back", () => {
  const live = [
    row({ date: "2026-09-27", type: "Debt", category: "", item: "", fromWallet: "Wallet A", amount: 260000, total: 260000, debtId: "card", debtEffect: "repay" }),
    row({ date: "2026-09-21", type: "Revenue", category: "Revenue", item: "Cashback", fromWallet: "", toWallet: "Wallet A", amount: 500, total: 500 }),
    row({ date: "2026-01-01", type: "Revenue", category: "Revenue", item: "Pay", fromWallet: "", toWallet: "Wallet A", amount: 100000, total: 100000 }),
    row({ date: "2026-01-01", type: "Revenue", category: "Revenue", item: "Pay", fromWallet: "", toWallet: "Cash", amount: 50000, total: 50000 }),
  ];
  const bin = (o: Partial<Transaction>, at: string): DeletedTransaction => ({ ...row(o), deletedAt: `${at}T08:00:00.000Z` }) as DeletedTransaction;
  const deleted = [
    bin({ date: "2026-09-26", type: "Debt", category: "", fromWallet: "Wallet A", amount: 260000, total: 260000 }, "2026-09-27"),
    bin({ date: "2026-09-27", type: "Debt", category: "", fromWallet: "Wallet A", amount: 40000, total: 40000 }, "2026-09-27"),
    bin({ date: "2026-09-21", type: "Revenue", category: "Revenue", item: "Cashback", fromWallet: "", toWallet: "Wallet A", amount: 500, total: 500 }, "2026-09-27"),
    bin({ date: "2026-09-27", item: "Unknown", fromWallet: "Cash", amount: 90000, total: 90000 }, "2026-09-27"),
    bin({ date: "2026-10-06", type: "Revenue", category: "Revenue", item: "Gift", fromWallet: "", toWallet: "Cash", amount: 2000, total: 2000 }, "2026-10-13"),
  ];
  const q = "Go through everything in my recycle bin. Which ones would be a mistake to put back, and what would each do to my balances? Don't put anything back.";

  it("reads a question about the bin, and the owner holding it back", () => {
    expect(asksBinReview(q)).toBe(true);
    expect(holdsBack(q)).toBe(true);
    expect(asksBinReview("what did I delete last week?")).toBe(false);
  });
  it("names what is in the ledger already, what looks like an earlier try, and what would sink a wallet", () => {
    const words = binReviewWords(binReview(deleted, live), true);
    expect(words.split("\n")[0]).toBe("**Nothing was put back.** The bin holds 5 entries. What each would do if it were put back, against what the wallets hold now (Wallet A −₱1,595.00, Cash ₱500.00):");
    expect(words).toContain("**A mistake to put back (4):**");
    expect(words).toMatch(/2026, Debt ₱2,600\.00 from Wallet A: the ledger already has it as #\d{4}, September 27, 2026, ₱2,600\.00, so it would count twice/);
    expect(words).toMatch(/Debt ₱400\.00 from Wallet A: the ledger already has a Debt like it from Wallet A on September 27, 2026/);
    expect(words).toContain("Spending Unknown ₱900.00 from Cash: it would take Cash below zero, to −₱400.00.");
    expect(words).toContain("**Fine to put back, if it really happened (1):**");
    expect(words).toContain("Revenue Gift ₱20.00 to Cash. Putting it back: Cash up ₱20.00, to ₱520.00.");
    expect(words).toContain("Nothing is put back from here.");
    expect(words).not.toMatch(/Restore all/);
    expect(words).not.toContain(DASH);
  });
});

describe("when the money runs out, with next month's bills and the allocations", () => {
  const rows: Transaction[] = [
    ...["2026-08-01", "2026-09-01", "2026-10-01"].map((d) => row({ date: d, type: "Revenue", category: "Revenue", item: "Pay", fromWallet: "", toWallet: "Cash", amount: 450000, total: 450000 })),
    row({ date: "2026-11-01", type: "Revenue", category: "Revenue", item: "Pay", fromWallet: "", toWallet: "Cash", amount: 400000, total: 400000 }),
    ...["2026-08-12", "2026-09-12", "2026-10-12"].map((d) => spent(d, "Wifi", 150000, { category: "Bills" })),
    ...["2026-08", "2026-09", "2026-10"].flatMap((m) => [5, 15, 25].map((d) => spent(`${m}-${String(d).padStart(2, "0")}`, "Food", 100000))),
  ];
  const reference = { wallets: ["Cash"], savings: [], spendingTypes: [{ name: "Food", remark: "" }, { name: "Gas", remark: "" }], bills: ["Wifi"], subscriptions: [], revenueCategories: ["Pay"] } as unknown as ReferenceLists;
  const ask = readBridgeAsk("Say my pay doesn't come until December 15. After my bills and my Gas allocation, on what day do I run out at my usual pace?", ASOF)!;

  it("counts next month's bill on its own day, the allocation, and the day it runs out", () => {
    const words = bridgeAnswer(ask, { transactions: rows, reference, debts: [], asOf: ASOF, allocations: [{ name: "Gas", kind: "Gas", held: 50000 }] });
    expect(words).toContain("Due before then: Wifi PHP 1,500.00 (November 12, 2026), Wifi PHP 1,500.00 (December 12, 2026), PHP 3,000.00 in all.");
    expect(words).toContain("Set aside in this month's allocations: Gas PHP 500.00, PHP 500.00.");
    expect(words).toContain("That leaves **PHP 500.00, PHP 14.28 a day** until the pay comes.");
    expect(words).toContain("**the money runs out on December 5, 2026**, 10 days before the pay. That counts Gas at its usual pace too, out of the same money its allocation holds.");
    expect(words).not.toContain(DASH);
  });
  it("says plainly when the bills and allocations alone are more than the wallets hold", () => {
    const words = bridgeAnswer(ask, { transactions: rows, reference, debts: [], asOf: ASOF, allocations: [{ name: "Gas", kind: "Gas", held: 150000 }] });
    expect(words).toContain("Together that is PHP 4,500.00, **PHP 500.00 more than your spending wallets hold**, so nothing is left for anything else until the pay comes.");
    expect(words).not.toMatch(/PHP 0\.00 a day/);
  });
  it("never checks a sum of bills, or a number of days, against a day's figure", () => {
    const day = { today: 0, after: 2000 };
    const money = (c: number): string => `PHP ${(c / 100).toFixed(2)}`;
    expect(fitNote("Your wallets hold PHP 2,000.00, but your bills due before December 15 total PHP 1,500.00, leaving only PHP 500.00 to cover 35 days.", day, money)).toBe("");
    expect(fitNote("A PHP 95.00 meal fits within today's PHP 20.00.", { today: 2000, after: 2000 }, money)).not.toBe("");
  });
});

describe("a credit line, supposed: what is paid back, when, and from which month", () => {
  const line = { id: "card", name: "Card Credit", counterparty: "Bank", kind: "payable", form: "credit-line", archived: false, openedDate: "2026-01-01", interestRate: 0, billingDay: 6, dueDay: 6, creditLimit: 1000000, notes: "" } as unknown as Debt;
  const history = [
    row({ date: "2026-10-01", type: "Debt", category: "", toWallet: "Wallet A", fromWallet: "", amount: 250000, total: 250000, debtId: "card", debtEffect: "draw" }),
    row({ date: "2026-10-01", type: "Debt", category: "", fromWallet: "", amount: 15000, total: 15000, debtId: "card", debtEffect: "charge" }),
    row({ date: "2026-10-20", type: "Debt", category: "", fromWallet: "Wallet A", amount: 265000, total: 265000, debtId: "card", debtEffect: "repay" }),
  ];
  const q = "If I put ₱4,000 of the bike repair on Card Credit on November 20, how much will I actually have to pay back, when, and which month's money pays it?";

  it("reads the line, the amount and the day, never the day as the amount", () => {
    expect(readCreditWhatIf(q, [line], ASOF)).toMatchObject({ amount: 400000, on: "2026-11-20", debt: { id: "card" } });
    expect(readCreditWhatIf("I paid 4000 with card credit", [line], ASOF)).toBeNull();
  });
  it("adds the charge at the last draw's rate and says which month pays it", () => {
    const words = creditWhatIfWords(creditWhatIf(readCreditWhatIf(q, [line], ASOF)!, history, ASOF));
    expect(words.split("\n")[0]).toBe("**If ₱4,000.00 goes on Card Credit on November 20, 2026, you pay back about ₱4,240.00, due January 6, 2027: January 2027's money pays it.**");
    expect(words).toContain("- Its limit is ₱10,000.00, so ₱5,760.00 of it stays free after this.");
    expect(words).toContain("- The charge: your last draw, ₱2,500.00 on October 1, 2026, was charged ₱150.00 (6.00%), so ₱4,000.00 would be charged about ₱240.00. The lender sets the real figure.");
    expect(words).toContain("the ₱4,000.00 is November 2026's spending, on November 20, 2026, and the ₱240.00 charge is spending the day it is added. Paying it back in January 2027 moves money to the lender; it is not spending again.");
    expect(words).not.toContain(DASH);
  });
});

describe("subscriptions the question says were stopped", () => {
  const rows = [
    spent("2025-02-10", "Streamflix", 30000, { category: "Subscriptions" }),
    ...["2026-07-03", "2026-08-03", "2026-09-03", "2026-10-03", "2026-11-03"].map((d) => spent(d, "Tunes", 9900, { category: "Subscriptions" })),
    ...["2026-08-21", "2026-09-21", "2026-10-21"].map((d) => spent(d, "Docs Suite", 25000, { category: "Subscriptions" })),
  ];
  const names = ["Streamflix", "Tunes", "Docs Suite", "Phone Bill"];
  const q = "Since I stopped Streamflix and Tunes in September, how much have I saved so far? And how much more would I save by the end of the year if I also stop Docs Suite today?";

  it("finds each one named, in the order said", () => {
    expect(asksSubscriptionStops(q, names)).toBe(true);
    expect(subscriptionsNamed(q, names)).toEqual(["Streamflix", "Tunes", "Docs Suite"]);
  });
  it("says what the ledger shows, where the question was wrong first", () => {
    const words = subscriptionStopWords(subscriptionStops(subscriptionsNamed(q, names), rows, [{ name: "Streamflix", since: "2026-09-20" }], ASOF), ASOF);
    expect(words).toContain("- **Streamflix**: stopped on September 20, 2026, but its last payment, ₱300.00 on February 10, 2025, was long before that. It was not being paid, so stopping it saved **nothing**.");
    expect(words).toContain("- **Tunes is not stopped**: last paid ₱99.00 on November 3, 2026, paid in 5 of the last 12 months. Stopped today, the 1 payment still to come this year would not be made: **₱99.00 saved by the end of 2026**.");
    expect(words).toContain("**₱500.00 saved by the end of 2026**");
    expect(words).not.toContain(DASH);
  });
  it("counts what stopping one that was being paid has saved", () => {
    const paid = ["2026-08-21", "2026-09-21"].map((d) => spent(d, "Docs Suite", 25000, { category: "Subscriptions" }));
    const words = subscriptionStopWords(subscriptionStops(["Docs Suite"], paid, [{ name: "Docs Suite", since: "2026-09-25" }], ASOF), ASOF);
    expect(words).toContain("1 monthly payment not made since: **₱250.00 saved** so far.");
  });
});

describe("money paid on someone's behalf is not the owner's own", () => {
  const uncle = { id: "uncle", name: "Uncle", counterparty: "Uncle", kind: "receivable", form: "pass-through", archived: false, openedDate: "2026-01-01", interestRate: 0, notes: "His phone plan: you pay it, he pays you back." } as unknown as Debt;
  const rows = [
    row({ date: "2026-03-04", type: "Debt", category: "", fromWallet: "Cash", amount: 70000, total: 70000, debtId: "uncle", debtEffect: "lend" }),
    row({ date: "2026-03-09", type: "Debt", category: "", toWallet: "Cash", fromWallet: "", amount: 70000, total: 70000, debtId: "uncle", debtEffect: "collect" }),
    row({ date: "2026-06-04", type: "Debt", category: "", fromWallet: "Cash", amount: 72000, total: 72000, debtId: "uncle", debtEffect: "lend" }),
    row({ date: "2026-06-10", type: "Debt", category: "", toWallet: "Cash", fromWallet: "", amount: 72000, total: 72000, debtId: "uncle", debtEffect: "collect" }),
  ];
  it("lists every movement of the year and says none of it was theirs", () => {
    const ask = readDebtAsk("How much of my own money went to his phone plan this year, and does my uncle still owe me anything?", [uncle])!;
    const words = debtAnswer(ask, [uncle], rows, ASOF);
    expect(words).toContain("Uncle: nothing open, settled. In 2026 you paid PHP 1,420.00 for Uncle (PHP 700.00 on March 4, 2026, PHP 720.00 on June 4, 2026), and Uncle gave back PHP 1,420.00");
    expect(words).toContain("So none of it was your own money in the end");
    expect(words).toContain("What the line is for: His phone plan");
  });
});

describe("saving a sum a month toward plans: the order, and when each is done", () => {
  const plan = (title: string, amount: number, over: Partial<Plan> = {}): Plan => ({ ...makePlan({ title, amount, due: "9999-12-31", dueKind: "none", item: "Home Needs", wallet: "", need: true, setAside: true, notes: "" }, ASOF, "owner", `p-${title}`), ...over });
  const plans = [plan("Tuition", 800000), plan("Scooter fix", 2000000), plan("Groceries", 400000, { notes: "For Christmas" }), plan("Concert", 300000, { need: false })];
  const q = "Tuition, scooter fix, at Groceries, wala pang date lahat. Kung ₱4,000 lang kaya kong itabi kada buwan simula December, alin ang uunahin, at kailan ko matatapos lahat? Huwag galawin ang savings.";

  it("reads the plans named, the saving, the month it starts, and the savings kept out", () => {
    expect(plansNamedAll(q, plans).map((p) => p.title)).toEqual(["Tuition", "Scooter fix", "Groceries"]);
    expect(readScheduleAsk(q, plans, ASOF)).toMatchObject({ perMonth: 400000, start: { year: 2026, month: 12 }, keepSavings: true });
    expect(readScheduleAsk("plan tuition 8000 by december", plans, ASOF)).toBeNull();
  });
  it("puts the one for Christmas first, then the smaller need, and pays month by month", () => {
    const words = scheduleWords(schedulePlans(readScheduleAsk(q, plans, ASOF)!, new Map(), ASOF));
    expect(words.split("\n")[0]).toBe("**₱32,000.00 in all, at ₱4,000.00 a month from December 2026: all 3 are done in July 2027, 8 months.**");
    expect(words).toContain("1. **Groceries, ₱4,000.00**: first, because its own words say it is for Christmas, so it is needed by December 24, 2026. December 2026's saving covers it, done in December 2026.");
    expect(words).toContain("2. **Tuition, ₱8,000.00**: a need with no date. Paid from January 2027 to February 2027, done in February 2027.");
    expect(words).toContain("3. **Scooter fix, ₱20,000.00**: a need with no date. Paid from March 2027 to July 2027, done in July 2027.");
    expect(words).toContain("None of it comes from your savings, as you asked.");
    expect(words).not.toContain(DASH);
  });
  it("says when a dated plan cannot be ready by its day", () => {
    const words = scheduleWords(schedulePlans({ ...readScheduleAsk(q, plans, ASOF)!, perMonth: 300000 }, new Map(), ASOF));
    expect(words).toContain("That is after December 24, 2026: ₱3,000.00 a month is not enough to have it by then.");
  });
});
