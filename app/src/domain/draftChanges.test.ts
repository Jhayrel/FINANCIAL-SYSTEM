import { describe, expect, it } from "vitest";

import { draftChanges } from "./draftChanges";
import { emptyDraft, type Draft } from "./entry";

const saved: Draft = {
  ...emptyDraft("2026-09-10"),
  flow: "Spending",
  fromWallet: "Maya",
  item: "Food",
  description: "Lunch at Mcdo",
  amount: 50000,
};

describe("draftChanges: what a correction is about to change", () => {
  it("says nothing changed for the row as it was saved", () => {
    expect(draftChanges(saved, { ...saved })).toEqual([]);
  });

  it("lists a new amount and wallet in the order the form shows them", () => {
    const out = draftChanges(saved, { ...saved, fromWallet: "Gcash", amount: 55000 });
    expect(out.map((c) => c.field)).toEqual(["amount", "fromWallet"]);
    expect(out[0]).toMatchObject({ label: "Amount", before: "₱500.00", after: "₱550.00" });
    expect(out[1]).toMatchObject({ before: "Maya", after: "Gcash" });
  });

  it("does not count spaces around a name as a change", () => {
    expect(draftChanges(saved, { ...saved, item: " Food ", description: "Lunch at Mcdo  " })).toEqual([]);
  });

  it("reads a cleared field as none, and an emptied amount too", () => {
    const out = draftChanges(saved, { ...saved, description: "", amount: null });
    expect(out).toEqual([
      { field: "amount", label: "Amount", before: "₱500.00", after: "none" },
      { field: "description", label: "Description", before: "Lunch at Mcdo", after: "none" },
    ]);
  });

  it("names money sent away as someone else, not as a blank wallet", () => {
    const moved: Draft = { ...emptyDraft("2026-09-10"), flow: "Transfer", fromWallet: "Maya", toWallet: "Cash", amount: 100000 };
    const out = draftChanges(moved, { ...moved, toWallet: "", sentOut: true });
    expect(out).toEqual([{ field: "toWallet", label: "To", before: "Cash", after: "Someone else" }]);
  });
});
