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
  it("knows a borrowing before the bill closes is due a month after it", () => {
    const line = { id: "c", name: "Card", counterparty: "Bank", kind: "payable", form: "credit-line", billingDay: 6, dueDay: 6 } as unknown as Debt;
    expect(dueIfBorrowedOn(line, "2026-10-19")).toBe("2026-12-06");
    expect(dueIfBorrowedOn(line, "2026-11-06")).toBe("2026-12-06");
    expect(dueIfBorrowedOn(line, "2026-11-07")).toBe("2027-01-06");
  });
});
