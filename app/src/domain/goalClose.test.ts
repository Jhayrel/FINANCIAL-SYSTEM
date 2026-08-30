/**
 * Closing a goal.
 *
 * The three assertions that matter are in "the invariant": the goal ends at
 * zero, the parent receives exactly what the goal held, and net worth moves by
 * the interest and by nothing else. Everything else is wording.
 */

import { describe, expect, it } from "vitest";

import { walletBalance } from "./balances";
import { describeClose, overdueGoals, planGoalClose } from "./goalClose";
import { formatMoney } from "./money";
import type { Account } from "./accounts";
import type { Transaction } from "./types";

const TODAY = "2026-08-30";

const parent: Account = {
  id: "maya-bank",
  name: "Maya Bank (Personal savings)",
  kind: "savings",
  archived: false,
  channel: "bank",
};

const cashParent: Account = {
  id: "extra-cash",
  name: "Extra Cash",
  kind: "savings",
  archived: false,
  channel: "cash",
};

const goal: Account = {
  id: "maya-drone",
  name: "Maya Bank (Drone)",
  kind: "goal",
  archived: false,
  parentId: "maya-bank",
  target: 2_000_00,
  deadline: "2026-06-30",
};

/** Funding the goal, the way the owner actually does it: a plain transfer. */
const fund = (amount: number, n = 1): Transaction => ({
  id: `fund-${n}`,
  recordNumber: n,
  date: "2026-02-01",
  type: "Transfer",
  fromWallet: parent.name,
  toWallet: goal.name,
  category: "",
  item: "",
  description: "Saving for the drone",
  amount,
  fee: 0,
  total: amount,
  notes: "",
  status: "Transferred",
});

const accounts = [parent, cashParent, goal];

describe("the invariant", () => {
  const ledger = [fund(1_500_00)];
  const plan = planGoalClose(goal, accounts, ledger, { today: TODAY, nextRecordNumber: 2 });
  const after = [...ledger, ...plan.rows];

  it("leaves the goal holding exactly nothing", () => {
    expect(walletBalance(ledger, goal.name)).toBe(1_500_00);
    expect(walletBalance(after, goal.name)).toBe(0);
  });

  it("gives the parent back exactly what the goal held", () => {
    const before = walletBalance(ledger, parent.name);
    expect(walletBalance(after, parent.name)).toBe(before + 1_500_00);
  });

  it("does not change net worth, because nothing entered or left", () => {
    const total = (rows: readonly Transaction[]): number =>
      accounts.reduce((a, x) => a + walletBalance(rows, x.name), 0);
    expect(total(after)).toBe(total(ledger));
  });

  it("writes one row, and it is a transfer", () => {
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]?.type).toBe("Transfer");
    expect(plan.rows[0]?.fromWallet).toBe(goal.name);
    expect(plan.rows[0]?.toWallet).toBe(parent.name);
  });

  it("costs nothing, because an internal move with no fee is not spending", () => {
    expect(plan.rows[0]?.fee).toBe(0);
    expect(plan.rows[0]?.item).toBe("");
  });
});

describe("interest the bank paid and the app never saw", () => {
  const ledger = [fund(1_500_00)];

  it("records the difference as income before returning the money", () => {
    // The bank says PHP 1,512.40. The app has PHP 1,500.00. The PHP 12.40 is
    // interest that was never typed in.
    const plan = planGoalClose(goal, accounts, ledger, {
      today: TODAY,
      nextRecordNumber: 2,
      reconcile: { actual: 1_512_40 },
    });

    expect(plan.adjustment).toBe(12_40);
    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[0]?.type).toBe("Revenue");
    expect(plan.rows[0]?.item).toBe("Interest");
    expect(plan.rows[0]?.total).toBe(12_40);
  });

  it("returns the interest along with the principal", () => {
    const plan = planGoalClose(goal, accounts, ledger, {
      today: TODAY,
      nextRecordNumber: 2,
      reconcile: { actual: 1_512_40 },
    });
    const after = [...ledger, ...plan.rows];

    expect(plan.returning).toBe(1_512_40);
    expect(walletBalance(after, goal.name)).toBe(0);
    // The parent funded the goal, so it sits at minus 1,500.00 here. What
    // matters is that it receives the whole 1,512.40 back.
    expect(walletBalance(after, parent.name) - walletBalance(ledger, parent.name)).toBe(1_512_40);
  });

  it("raises net worth by the interest and by nothing else", () => {
    const plan = planGoalClose(goal, accounts, ledger, {
      today: TODAY,
      nextRecordNumber: 2,
      reconcile: { actual: 1_512_40 },
    });
    const total = (rows: readonly Transaction[]): number =>
      accounts.reduce((a, x) => a + walletBalance(rows, x.name), 0);

    expect(total([...ledger, ...plan.rows]) - total(ledger)).toBe(12_40);
  });

  it("records a shortfall as a charge, not as a correction", () => {
    const plan = planGoalClose(goal, accounts, ledger, {
      today: TODAY,
      nextRecordNumber: 2,
      reconcile: { actual: 1_495_00 },
    });

    expect(plan.adjustment).toBe(-5_00);
    expect(plan.rows[0]?.type).toBe("Spending");
    expect(plan.rows[0]?.total).toBe(5_00);
    expect(plan.returning).toBe(1_495_00);
  });

  it("skips the whole question when the balance matches", () => {
    const plan = planGoalClose(goal, accounts, ledger, {
      today: TODAY,
      nextRecordNumber: 2,
      reconcile: { actual: 1_500_00 },
    });
    expect(plan.adjustment).toBe(0);
    expect(plan.rows).toHaveLength(1);
  });
});

describe("when the question is worth asking", () => {
  it("asks about interest for a goal inside a bank", () => {
    const plan = planGoalClose(goal, accounts, [], { today: TODAY, nextRecordNumber: 1 });
    expect(plan.couldEarnInterest).toBe(true);
  });

  it("does not ask for a goal inside physical cash", () => {
    const cashGoal: Account = { ...goal, id: "cash-goal", parentId: "extra-cash" };
    const plan = planGoalClose(cashGoal, accounts, [], { today: TODAY, nextRecordNumber: 1 });
    expect(plan.couldEarnInterest).toBe(false);
  });
});

describe("an empty goal", () => {
  it("writes nothing at all", () => {
    const plan = planGoalClose(goal, accounts, [], { today: TODAY, nextRecordNumber: 1 });
    expect(plan.rows).toHaveLength(0);
    expect(plan.blocked).toBeUndefined();
    expect(describeClose(plan, formatMoney)).toContain("only changes its status");
  });
});

describe("a goal with nowhere to return money to", () => {
  it("refuses rather than inventing a destination", () => {
    const orphan: Account = { ...goal, parentId: undefined };
    const plan = planGoalClose(orphan, accounts, [fund(500_00)], {
      today: TODAY,
      nextRecordNumber: 2,
    });
    expect(plan.blocked).toContain("nowhere to return it to");
    expect(plan.rows).toHaveLength(0);
  });

  it("still closes cleanly when it is empty", () => {
    const orphan: Account = { ...goal, parentId: undefined };
    const plan = planGoalClose(orphan, accounts, [], { today: TODAY, nextRecordNumber: 1 });
    expect(plan.blocked).toBeUndefined();
  });
});

describe("what the confirmation says", () => {
  it("names both the interest and the destination", () => {
    const plan = planGoalClose(goal, accounts, [fund(1_500_00)], {
      today: TODAY,
      nextRecordNumber: 2,
      reconcile: { actual: 1_512_40 },
    });
    const text = describeClose(plan, formatMoney);
    expect(text).toContain("12.40");
    expect(text).toContain("1,512.40");
    expect(text).toContain(parent.name);
  });
});

describe("goals past their deadline", () => {
  it("reports the ones still holding money", () => {
    const overdue = overdueGoals([goal], [fund(1_500_00)], TODAY);
    expect(overdue).toHaveLength(1);
    expect(overdue[0]?.balance).toBe(1_500_00);
  });

  it("says nothing about an empty one, because there is nothing to decide", () => {
    expect(overdueGoals([goal], [], TODAY)).toHaveLength(0);
  });

  it("says nothing before the deadline", () => {
    expect(overdueGoals([goal], [fund(1_500_00)], "2026-05-01")).toHaveLength(0);
  });

  it("never closes anything by itself", () => {
    // The app cannot know whether the money was spent, so it reports and stops.
    const overdue = overdueGoals([goal], [fund(1_500_00)], TODAY);
    expect(overdue[0]?.goal.archived).toBe(false);
  });
});
