import { describe, expect, it } from "vitest";

import { describeRow } from "./activity";
import { factChanges, readRow } from "./activityRead";
import type { Transaction } from "./types";

const row = (over: Partial<Transaction> = {}): Transaction => ({
  id: "t1",
  recordNumber: 491,
  date: "2026-09-06",
  type: "Spending",
  fromWallet: "Maya",
  toWallet: "",
  category: "Spending",
  item: "Dito Prepaid",
  description: "",
  amount: 19900,
  fee: 0,
  total: 19900,
  notes: "",
  status: "Paid",
  ...over,
});

describe("reading an activity line back", () => {
  it("gives back every field describeRow wrote", () => {
    const line = describeRow(row());
    const facts = readRow(line);
    expect(facts).toMatchObject({
      date: "2026-09-06",
      type: "Spending",
      from: "Maya",
      to: "",
      item: "Dito Prepaid",
      fee: "",
      status: "Paid",
    });
    expect(facts?.amount).toBe(line.split(" | ")[5]);
  });

  it("tells a fee from a status", () => {
    const facts = readRow(describeRow(row({ type: "Transfer", toWallet: "Cash", fee: 1500, total: 21400 })));
    expect(facts?.to).toBe("Cash");
    expect(facts?.fee).not.toBe("");
    expect(facts?.fee.startsWith("fee")).toBe(false);
    expect(facts?.status).toBe("Paid");
  });

  it("reads a row with no status and no fee", () => {
    expect(readRow(describeRow(row({ status: "" })))?.status).toBe("");
  });

  it("refuses a line that is not one", () => {
    expect(readRow("Theme set to dark")).toBeNull();
    expect(readRow(undefined)).toBeNull();
  });

  it("lists only what an edit changed", () => {
    const changes = factChanges(
      describeRow(row()),
      describeRow(row({ amount: 25000, total: 25000, fromWallet: "Cash" })),
    );
    expect(changes.map((c) => c.label)).toEqual(["From", "Amount"]);
    expect(changes[0]).toMatchObject({ before: "Maya", after: "Cash" });
  });
});
