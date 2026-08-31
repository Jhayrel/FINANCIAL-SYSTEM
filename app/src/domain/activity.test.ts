import { describe, expect, it } from "vitest";

import {
  BY_OWNER,
  binned,
  byNewest,
  changedFields,
  created,
  describeRow,
  restored,
  updated,
  type ActivityEvent,
} from "./activity";
import type { Transaction } from "./types";

const row = (over: Partial<Transaction> = {}): Transaction => ({
  id: "t-1",
  recordNumber: 441,
  date: "2026-08-31",
  type: "Spending",
  fromWallet: "Cash",
  toWallet: "",
  category: "Spending",
  item: "Food",
  description: "lunch",
  amount: 50000,
  fee: 0,
  total: 50000,
  notes: "",
  status: "Paid",
  ...over,
});

describe("what an event records", () => {
  it("names the row, what it was, and how much", () => {
    const e = created(row());
    expect(e.action).toBe("transaction.create");
    expect(e.summary).toBe("Added #0441, Food, PHP 500.00.");
    expect(e.targetId).toBe("t-1");
    expect(e.recordNumber).toBe(441);
    expect(e.amount).toBe(50000);
  });

  it("says when the assistant read it, and which model", () => {
    const e = created(row(), { actor: "ai", via: "ai_image", model: "groq:qwen" });
    expect(e.actor).toBe("ai");
    expect(e.via).toBe("ai_image");
    expect(e.model).toBe("groq:qwen");
    expect(e.summary).toContain("read by the assistant");
  });

  it("defaults to the owner typing it", () => {
    expect(created(row()).actor).toBe("owner");
    expect(created(row()).via).toBe("manual");
    expect(created(row()).model).toBeUndefined();
    expect(BY_OWNER).toEqual({ actor: "owner", via: "manual" });
  });

  it("keeps both sides of an edit, and names what moved", () => {
    const before = row();
    const after = row({ amount: 60000, total: 60000, item: "Transport" });
    const e = updated(before, after);
    expect(e.summary).toBe("Changed #0441: item, amount.");
    expect(e.before).toContain("PHP 500.00");
    expect(e.after).toContain("PHP 600.00");
  });

  it("records a bin and a restore against the same row", () => {
    expect(binned(row()).summary).toBe("Moved #0441, Food, to the bin.");
    expect(restored(row()).summary).toBe("Restored #0441, Food.");
    expect(binned(row()).before).toBeDefined();
    expect(restored(row()).after).toBeDefined();
  });

  it("falls back to the description, then the type, for a row with no item", () => {
    expect(created(row({ item: "" })).summary).toContain("lunch");
    expect(created(row({ item: "", description: "" })).summary).toContain("Spending");
  });
});

describe("the shapes the rules will accept", () => {
  it("gives every event a distinct id, even in the same millisecond", () => {
    const ids = new Set([created(row()).id, created(row()).id, created(row()).id]);
    expect(ids.size).toBe(3);
  });

  it("stamps an ISO instant", () => {
    expect(created(row()).at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("keeps before and after inside the 600 character cap the rule sets", () => {
    const long = row({ description: "x".repeat(2000), notes: "y".repeat(2000) });
    const e = updated(row(), long);
    expect((e.before ?? "").length).toBeLessThanOrEqual(600);
    expect((e.after ?? "").length).toBeLessThanOrEqual(600);
  });

  it("keeps every summary inside the 300 character cap", () => {
    const long = row({ item: "z".repeat(400) });
    expect(created(long).summary.length).toBeLessThanOrEqual(300);
  });

  it("carries money as integer centavos, never a float", () => {
    const e = created(row({ amount: 12345, fee: 55, total: 12400 }));
    expect(e.amount).toBe(12400);
    expect(Number.isInteger(e.amount)).toBe(true);
  });
});

describe("changedFields", () => {
  it("finds nothing when nothing moved", () => {
    expect(changedFields(row(), row())).toEqual([]);
  });

  it("does not report a field that only looks different", () => {
    expect(changedFields(row(), row({ id: "t-2" }))).toEqual([]);
  });
});

describe("describeRow", () => {
  it("reads as one line, with the fee only when there is one", () => {
    expect(describeRow(row())).toBe("2026-08-31 | Spending | Cash | - | Food | PHP 500.00 | Paid");
    expect(describeRow(row({ fee: 1500 }))).toContain("fee PHP 15.00");
  });
});

describe("byNewest", () => {
  it("puts the most recent first", () => {
    const events = [
      { at: "2026-08-01T00:00:00.000Z", id: "a" },
      { at: "2026-08-31T00:00:00.000Z", id: "b" },
      { at: "2026-08-15T00:00:00.000Z", id: "c" },
    ] as ActivityEvent[];
    expect([...events].sort(byNewest).map((e) => e.id)).toEqual(["b", "c", "a"]);
  });
});
