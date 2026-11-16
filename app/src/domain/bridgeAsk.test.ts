import { describe, expect, it } from "vitest";

import { readBridgeAsk } from "./bridgeAsk";
import { dueIfBorrowedOn, type Debt } from "./debt";

/* 19 October 2026: "salary on the 7th, will I have money the first week, should I loan?" */
describe("money until the next income", () => {
  it("reads when the money comes, the later money, and the loan question", () => {
    const ask = readBridgeAsk(
      "I expect 10k salary next month, but it will be in the 7th day of the month and probably allowance in the 15th day of November. I am worried I dont have money in the first week, should I loan?",
      "2026-10-19",
    );
    expect(ask).toMatchObject({ arrives: "2026-11-07", what: "salary", later: [{ what: "allowance", on: "2026-11-15" }], asksLoan: true });
  });
  it("leaves alone money that already came and plain questions", () => {
    expect(readBridgeAsk("I received my salary today 10000", "2026-10-19")).toBeNull();
    expect(readBridgeAsk("how much can I spend today?", "2026-10-19")).toBeNull();
  });
  it("knows a borrowing goes on the bill that closes next, and when that bill is due", () => {
    // The same day for both: due the day the bill closes (owner, 17 November 2026).
    const line = { id: "c", name: "Card", counterparty: "Bank", kind: "payable", form: "credit-line", billingDay: 6, dueDay: 6 } as unknown as Debt;
    expect(dueIfBorrowedOn(line, "2026-10-19")).toBe("2026-11-06");
    expect(dueIfBorrowedOn(line, "2026-11-06")).toBe("2026-11-06");
    expect(dueIfBorrowedOn(line, "2026-11-07")).toBe("2026-12-06");
    // Due 15 days after the bill closes.
    const after = { ...line, dueDay: undefined, dueAfterDays: 15 } as unknown as Debt;
    expect(dueIfBorrowedOn(after, "2026-10-19")).toBe("2026-11-21");
    expect(dueIfBorrowedOn(after, "2026-11-06")).toBe("2026-11-21");
    expect(dueIfBorrowedOn(after, "2026-11-07")).toBe("2026-12-21");
    // Another day of the month: the first one after the bill closes.
    const day = { ...line, dueDay: 25 } as unknown as Debt;
    expect(dueIfBorrowedOn(day, "2026-11-07")).toBe("2026-12-25");
  });
});
