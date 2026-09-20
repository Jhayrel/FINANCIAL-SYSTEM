/**
 * A credit line and a person, from first movement to last.
 *
 * The unit tests check each movement on its own. This walks two whole
 * stories, one step at a time, and after every step asserts the three things
 * that must always hold together:
 *
 *   the wallet holds what the movements put in it,
 *   what is owed is draws plus charges less repayments and write-offs,
 *   and the month's buckets count each row exactly once, in the right one:
 *   what a lender charges is not in the spending track, and principal paid
 *   back is not a cost at all.
 *
 * Interactions are what this catches. A rule can be right on its own and
 * wrong after the step before it: interest counted twice because it is both a
 * movement and a part of a payment, a write-off that clears a balance and
 * also books spending, money held for someone that reads as income the moment
 * it arrives. Every figure below is derived from the rows, never typed.
 */

import { describe, expect, it } from "vitest";

import { walletBalance } from "./balances";
import { type Debt, positionOf } from "./debt";
import { draftToTransactions, emptyDraft, type Draft } from "./entry";
import { totalsFor } from "./totals";
import type { Transaction } from "./types";

const DAY = "2026-09-20";

const CREDIT: Debt = {
  id: "maya-credit",
  name: "Maya Credit",
  kind: "payable",
  counterparty: "Maya",
  openedDate: "2026-01-01",
  wallet: "Maya",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
};

const PERSON: Debt = {
  id: "stephen",
  name: "Stephen",
  kind: "receivable",
  counterparty: "Stephen",
  openedDate: "2026-01-01",
  wallet: "Cash",
  interestType: "none",
  interestRate: 0,
  notes: "",
  archived: false,
};

/** The ledger as it grows, one saved entry at a time. */
class Ledger {
  readonly rows: Transaction[] = [];
  private n = 0;

  add(draft: Draft, split?: { principal: number; interest: number }): Transaction[] {
    this.n += 1;
    const made = draftToTransactions(draft, this.n, `t${this.n}`, split);
    this.rows.push(...made);
    return made;
  }

  wallet(name: string): number {
    return walletBalance(this.rows, name);
  }

  owed(debt: Debt): number {
    return positionOf(debt, this.rows, DAY).outstanding;
  }

  /** The spending bucket alone: what the Spending track counts. */
  get spending(): number {
    return totalsFor(this.rows).spending;
  }

  /** Everything that cost money this month, across all five buckets. */
  get cost(): number {
    return totalsFor(this.rows).total;
  }

  /** What a lender added or was paid in interest, which has its own bucket. */
  get interest(): number {
    return totalsFor(this.rows).interest;
  }

  get revenue(): number {
    return totalsFor(this.rows).revenue;
  }
}

const draft = (over: Partial<Draft>): Draft => ({ ...emptyDraft(DAY), ...over });

describe("the life of a credit line", () => {
  const led = new Ledger();

  it("opens with money in the wallet and the same amount owed", () => {
    led.add(draft({ flow: "Debt", debtId: CREDIT.id, debtEffect: "draw", toWallet: "Maya", amount: 250_000 }));

    expect(led.wallet("Maya")).toBe(250_000);
    expect(led.owed(CREDIT)).toBe(250_000);
    // Borrowing is not income, and spending it later is not double counted.
    expect(led.revenue).toBe(0);
    expect(led.spending).toBe(0);
  });

  it("a late fee the lender adds is owed, costs money, and moves no wallet", () => {
    led.add(draft({ flow: "Debt", debtId: CREDIT.id, debtEffect: "charge", amount: 2_000, item: "Late fee" }));

    expect(led.wallet("Maya"), "a charge moves no money").toBe(250_000);
    expect(led.owed(CREDIT)).toBe(252_000);
    // It costs money the day it is added, in the bucket for what a lender charges.
    expect(led.interest).toBe(2_000);
    expect(led.cost).toBe(2_000);
    expect(led.spending, "and not in the spending track").toBe(0);
  });

  it("spending the borrowed money is spending, once", () => {
    led.add(draft({ flow: "Spending", category: "Spending", item: "Food", fromWallet: "Maya", amount: 50_000, status: "Paid" }));

    expect(led.wallet("Maya")).toBe(200_000);
    expect(led.owed(CREDIT), "what you owe does not change when you spend").toBe(252_000);
    expect(led.spending).toBe(50_000);
    expect(led.cost, "the charge and the meal, each once").toBe(52_000);
  });

  it("a payment with interest pays down the principal only, and books the interest", () => {
    const before = led.owed(CREDIT);
    led.add(
      draft({ flow: "Debt", debtId: CREDIT.id, debtEffect: "repay", fromWallet: "Maya", amount: 118_879, interest: 18_879 }),
      { principal: 100_000, interest: 18_879 },
    );

    expect(led.wallet("Maya"), "the whole payment leaves the wallet").toBe(200_000 - 118_879);
    expect(led.owed(CREDIT), "only the principal comes off what is owed").toBe(before - 100_000);
    expect(led.interest, "interest paid from a wallet costs money").toBe(2_000 + 18_879);
    expect(led.cost).toBe(50_000 + 2_000 + 18_879);
    expect(led.spending, "the principal is not a cost at all").toBe(50_000);
  });

  it("what the lender writes off clears the balance and is neither spending nor income", () => {
    const costBefore = led.cost;
    const revenueBefore = led.revenue;
    const owed = led.owed(CREDIT);
    const walletBefore = led.wallet("Maya");

    led.add(draft({ flow: "Debt", debtId: CREDIT.id, debtEffect: "writeoff", amount: owed }));

    expect(led.owed(CREDIT)).toBe(0);
    expect(led.wallet("Maya"), "nothing moved").toBe(walletBefore);
    expect(led.cost).toBe(costBefore);
    expect(led.revenue).toBe(revenueBefore);
    expect(positionOf(CREDIT, led.rows, DAY).status).toBe("written_off");
  });

  it("and a new draw reopens it", () => {
    led.add(draft({ flow: "Debt", debtId: CREDIT.id, debtEffect: "draw", toWallet: "Maya", amount: 30_000 }));

    expect(led.owed(CREDIT)).toBe(30_000);
    expect(positionOf(CREDIT, led.rows, DAY).status).toBe("open");
  });
});

describe("money that was never yours: paid on someone's behalf", () => {
  const led = new Ledger();

  it("an advance leaves your wallet and is not spending", () => {
    led.add(draft({ flow: "Debt", behalf: "owed", debtId: PERSON.id, debtEffect: "lend", fromWallet: "Cash", amount: 35_000, item: "Treat" }));

    expect(led.wallet("Cash")).toBe(-35_000);
    expect(led.owed(PERSON), "they owe you").toBe(35_000);
    expect(led.spending, "their meal is not your spending").toBe(0);
  });

  it("being paid back is not income", () => {
    led.add(draft({ flow: "Debt", behalf: "owed", debtId: PERSON.id, debtEffect: "collect", toWallet: "Cash", amount: 20_000 }));

    expect(led.wallet("Cash")).toBe(-15_000);
    expect(led.owed(PERSON)).toBe(15_000);
    expect(led.revenue, "your own money coming back is not income").toBe(0);
    expect(led.spending).toBe(0);
  });

  it("what they will not pay back becomes spending, on the day you decide", () => {
    led.add(draft({ flow: "Debt", behalf: "owed", debtId: PERSON.id, debtEffect: "writeoff", amount: 15_000, item: "Treat" }));

    expect(led.owed(PERSON)).toBe(0);
    expect(led.spending, "written off on someone's behalf is spending").toBe(15_000);
    expect(led.revenue).toBe(0);
  });
});

describe("money that was never yours: held for someone", () => {
  const led = new Ledger();

  it("money arriving for someone else is not income", () => {
    led.add(draft({ flow: "Debt", behalf: "held", debtId: PERSON.id, debtEffect: "draw", toWallet: "Maya", amount: 100_000 }));

    expect(led.wallet("Maya")).toBe(100_000);
    expect(led.owed(PERSON), "you owe it to them").toBe(100_000);
    expect(led.revenue).toBe(0);
  });

  it("passing it on is not spending", () => {
    led.add(draft({ flow: "Debt", behalf: "held", debtId: PERSON.id, debtEffect: "repay", fromWallet: "Maya", amount: 60_000 }));

    expect(led.wallet("Maya")).toBe(40_000);
    expect(led.owed(PERSON)).toBe(40_000);
    expect(led.spending).toBe(0);
  });

  it("what they let you keep is income, on the day they say so", () => {
    led.add(draft({ flow: "Debt", behalf: "held", debtId: PERSON.id, debtEffect: "writeoff", amount: 40_000, item: "Change" }));

    expect(led.owed(PERSON)).toBe(0);
    expect(led.revenue, "retained on someone's behalf is income").toBe(40_000);
    expect(led.spending).toBe(0);
  });
});

describe("what holds across all of it", () => {
  it("a wallet is the sum of what moved through it, however the rows were classified", () => {
    const led = new Ledger();
    led.add(draft({ flow: "Debt", debtId: CREDIT.id, debtEffect: "draw", toWallet: "Maya", amount: 250_000 }));
    led.add(draft({ flow: "Spending", category: "Spending", item: "Food", fromWallet: "Maya", amount: 50_000, status: "Paid" }));
    led.add(draft({ flow: "Transfer", fromWallet: "Maya", toWallet: "Cash", amount: 20_000, fee: 1_500, status: "Transferred" }));
    led.add(draft({ flow: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Maya", amount: 100_000, status: "Received" }));

    // Worked out here, from the rows, the way rule 3.1 says.
    let maya = 0;
    for (const t of led.rows) {
      if (t.type === "Revenue" && t.fromWallet === "Maya") maya += t.total;
      if (t.toWallet === "Maya") maya += t.amount;
      if (t.fromWallet === "Maya" && t.type !== "Revenue") maya -= t.total;
    }

    expect(led.wallet("Maya")).toBe(maya);
    expect(led.wallet("Maya")).toBe(250_000 - 50_000 - 21_500 + 100_000);
    expect(led.wallet("Cash")).toBe(20_000);
  });

  it("every row it writes carries whole centavos and its own total", () => {
    const led = new Ledger();
    led.add(draft({ flow: "Debt", debtId: CREDIT.id, debtEffect: "draw", toWallet: "Maya", amount: 250_000, charges: 2_265 }));
    led.add(draft({ flow: "Transfer", fromWallet: "Maya", toWallet: "Cash", amount: 120_000, fee: 1_500, status: "Withdrawn" }));

    for (const t of led.rows) {
      expect(Number.isInteger(t.amount) && Number.isInteger(t.fee) && Number.isInteger(t.total), `#${t.recordNumber}`).toBe(true);
      expect(t.total, `#${t.recordNumber}`).toBe(t.amount + t.fee);
    }
  });
});
