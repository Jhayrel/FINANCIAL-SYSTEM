import { describe, expect, it } from "vitest";

import { aiEvent, byNewest, correctionsFrom, type AiEvent } from "./aiLog";

describe("aiEvent", () => {
  it("records what happened and where", () => {
    const e = aiEvent("asked", "add", { text: "how is this month going" });
    expect(e.action).toBe("asked");
    expect(e.where).toBe("add");
    expect(e.text).toBe("how is this month going");
    expect(e.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  /** A picture is a megabyte; a description of one is a line. */
  it("describes a file and never carries its bytes", () => {
    const e = aiEvent("uploaded", "add", {
      files: [{ name: "123.png", kind: "receipt", bytes: 245_000, details: "one entry: Fun, PHP 320.00" }],
    });
    expect(e.files?.[0]).toEqual({
      name: "123.png",
      kind: "receipt",
      bytes: 245_000,
      details: "one entry: Fun, PHP 320.00",
    });
    expect(JSON.stringify(e)).not.toContain("data:image");
  });

  it("keeps a correction as both halves", () => {
    const e = aiEvent("edited", "add", { field: "item", proposed: "Jolibee", corrected: "Food" });
    expect(e.proposed).toBe("Jolibee");
    expect(e.corrected).toBe("Food");
  });

  it("takes a pasted key out of anything it writes", () => {
    const e = aiEvent("asked", "add", { text: "my key is gsk_abcdefghijklmnopqrst" });
    expect(e.text).not.toContain("gsk_abcdefghijklmnopqrst");
    expect(e.text).toContain("[redacted]");
  });

  it("caps every field at what the rule accepts", () => {
    const e = aiEvent("answered", "insights", {
      text: "x".repeat(9000),
      entry: "y".repeat(900),
      proposed: "z".repeat(300),
    });
    expect(e.text?.length).toBe(2000);
    expect(e.entry?.length).toBe(300);
    expect(e.proposed?.length).toBe(80);
  });

  it("leaves out what was not given, because Firestore refuses undefined", () => {
    const e = aiEvent("cleared", "add");
    expect(Object.values(e).every((v) => v !== undefined)).toBe(true);
    expect("text" in e).toBe(false);
  });

  it("gives every event a distinct id in the same millisecond", () => {
    const ids = new Set([aiEvent("asked", "add").id, aiEvent("asked", "add").id]);
    expect(ids.size).toBe(2);
  });

  it("never carries more than a handful of files", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      name: `${i}.png`,
      kind: "photo",
      bytes: 1,
      details: "",
    }));
    expect(aiEvent("uploaded", "add", { files: many }).files?.length).toBe(5);
  });
});

describe("correctionsFrom: what the assistant learns", () => {
  const at = (n: number) => `2026-08-${String(n).padStart(2, "0")}T00:00:00.000Z`;

  const log: AiEvent[] = [
    { id: "1", at: at(1), action: "edited", where: "add", field: "item", proposed: "Jolibee", corrected: "Food" },
    { id: "2", at: at(2), action: "edited", where: "add", field: "item", proposed: "Shopee", corrected: "Online Buy" },
    { id: "3", at: at(3), action: "accepted", where: "add", entry: "something" },
  ];

  it("turns corrections into a lookup", () => {
    const learned = correctionsFrom(log, "item");
    expect(learned.get("jolibee")).toBe("Food");
    expect(learned.get("shopee")).toBe("Online Buy");
  });

  it("takes the latest word on it, not the first", () => {
    const changedMind: AiEvent[] = [
      ...log,
      { id: "4", at: at(9), action: "edited", where: "add", field: "item", proposed: "Jolibee", corrected: "Treat" },
    ];
    expect(correctionsFrom(changedMind, "item").get("jolibee")).toBe("Treat");
  });

  it("ignores everything that is not a correction to that field", () => {
    const learned = correctionsFrom(log, "fromWallet");
    expect(learned.size).toBe(0);
  });

  it("ignores a half-recorded correction", () => {
    const broken: AiEvent[] = [
      { id: "5", at: at(1), action: "edited", where: "add", field: "item", proposed: "X" },
    ];
    expect(correctionsFrom(broken, "item").size).toBe(0);
  });
});

describe("byNewest", () => {
  it("puts the most recent first", () => {
    const events = [
      { at: "2026-08-01T00:00:00.000Z", id: "a" },
      { at: "2026-08-31T00:00:00.000Z", id: "b" },
    ] as AiEvent[];
    expect([...events].sort(byNewest).map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("correctionsFrom refuses a mapping that would do harm", () => {
  const at = (n: number) => `2026-08-${String(n).padStart(2, "0")}T00:00:00.000Z`;

  /**
   * The one that got through and had to be caught: keyed on the field's old
   * value rather than on the words that produced the card, one correction
   * taught "gas is Food", and applying it would have turned every future Gas
   * entry into Food.
   */
  it("ignores a mapping from a value onto itself", () => {
    const log: AiEvent[] = [
      { id: "1", at: at(1), action: "edited", where: "add", field: "item", proposed: "Food", corrected: "food" },
    ];
    expect(correctionsFrom(log, "item").size).toBe(0);
  });

  it("keeps a mapping from words the ledger has no meaning for", () => {
    const log: AiEvent[] = [
      { id: "1", at: at(1), action: "edited", where: "add", field: "item", proposed: "i paid 300 jolibee cash", corrected: "Food" },
    ];
    expect(correctionsFrom(log, "item").get("i paid 300 jolibee cash")).toBe("Food");
  });
});
