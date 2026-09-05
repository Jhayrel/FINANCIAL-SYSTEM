/**
 * What replaces a photo, once the photo is gone.
 *
 * The picture is never stored, so this text is the whole answer to "which
 * receipt was that and what did it say". The first version gave three of
 * eight rows with no dates, no wallets and no total, and silently dropped the
 * rest. The owner asked for it to be really detailed.
 */

import { describe, expect, it } from "vitest";

import { describeFile, summariseFile, MAX_NOTE } from "./photoNote";
import { emptyDraft, type Draft } from "./entry";

const draft = (over: Partial<Draft>): Draft => ({ ...emptyDraft("2026-09-04"), ...over });

const SPOTIFY = draft({
  flow: "Spending",
  item: "Spotify",
  amount: 8500,
  fromWallet: "Maya",
  category: "Subscriptions",
});

const MOVE = draft({
  flow: "Transfer",
  date: "2026-09-02",
  amount: 201500,
  fromWallet: "Maya",
  toWallet: "Cash",
});

const file = { name: "Screenshot_20260905_132223_Maya.jpg", bytes: 76452, kind: "image" as const };

describe("a receipt, written out", () => {
  const note = describeFile(file, [SPOTIFY, MOVE], "2026-09-05");

  it("names the file and its size on the first line", () => {
    expect(note.split("\n")[0]).toBe("Screenshot_20260905_132223_Maya.jpg, 75 KB");
  });

  it("says what it was, when it was read, how many and how much", () => {
    expect(note).toContain("A receipt, read on 2026-09-05. 2 entries, ₱2,100.00 in total.");
  });

  it("gives every row its date, kind, item and figure", () => {
    expect(note).toContain("2026-09-04  Spending  Spotify  ₱85.00  from Maya");
  });

  it("names both ends of a transfer, because that is the question about one", () => {
    expect(note).toContain("2026-09-02  Transfer  ₱2,015.00  Maya to Cash");
  });

  it("says money in went into a wallet, not out of one", () => {
    const income = draft({ flow: "Revenue", item: "Allowance", amount: 300000, toWallet: "Maya" });
    expect(describeFile(file, [income], "2026-09-05")).toContain("₱3,000.00  into Maya");
  });

  it("names a fee, which is money and must never be silent", () => {
    const withFee = draft({ ...MOVE, fee: 1500 });
    expect(describeFile(file, [withFee], "2026-09-05")).toContain("fee ₱15.00");
  });

  it("counts the fee into the total, because it left the wallet", () => {
    expect(describeFile(file, [draft({ ...MOVE, fee: 1500 })], "2026-09-05")).toContain(
      "₱2,030.00 in total",
    );
  });
});

describe("a photo that said nothing", () => {
  const note = describeFile(file, [], "2026-09-05");

  it("still names the file and its size", () => {
    expect(note).toContain("Screenshot_20260905_132223_Maya.jpg, 75 KB");
  });

  it("says what was missing rather than just failing", () => {
    expect(note).toContain("Nothing readable in it: no amount and no date were found.");
  });

  it("calls it a photo, not a receipt", () => {
    expect(note).toContain("A photo,");
    expect(note).not.toContain("A receipt,");
  });
});

describe("it stays small enough to store", () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    draft({ flow: "Spending", item: `Item number ${i}`, amount: 100000 + i, fromWallet: "Gcash" }),
  );

  it("never exceeds the cap", () => {
    expect(describeFile(file, many, "2026-09-05").length).toBeLessThanOrEqual(MAX_NOTE);
  });

  /**
   * Cut from the end, never the middle. A description that stops early still
   * reads correctly down to where it stops; one with a hole in it looks
   * complete and is not.
   *
   * The row cap usually keeps it well inside the limit, so this needs rows
   * long enough to blow the budget on their own: eight descriptions with very
   * long item names and both wallets named.
   */
  it("says it was cut rather than pretending to be whole", () => {
    const wordy = Array.from({ length: 8 }, (_, i) =>
      draft({
        flow: "Transfer",
        item: `A very long item name that somebody actually typed, number ${i}`,
        amount: 100000,
        fromWallet: "Maya Bank (Personal savings)",
        toWallet: "Allowance (Reserve)",
        fee: 1500,
      }),
    );
    const note = describeFile(file, wordy, "2026-09-05");
    expect(note).toContain("and the rest, cut");
    expect(note.length).toBeLessThanOrEqual(MAX_NOTE);
  });

  it("counts the ones it did not write out", () => {
    const twelve = many.slice(0, 12);
    expect(describeFile(file, twelve, "2026-09-05")).toContain("and 4 more");
  });

  it("still reports the true total when it could not list them all", () => {
    expect(describeFile(file, many.slice(0, 12), "2026-09-05")).toContain("12 entries");
  });
});

describe("the one-line version, for the log", () => {
  it("names the count, the total and the first few", () => {
    const line = summariseFile([SPOTIFY, MOVE]);
    expect(line).toContain("2 entries");
    expect(line).toContain("₱2,100.00 total");
    expect(line).toContain("Spotify, ₱85.00");
  });

  it("says nothing readable when there was nothing", () => {
    expect(summariseFile([])).toBe("nothing readable");
  });

  it("counts the rest rather than listing them", () => {
    const five = [SPOTIFY, MOVE, SPOTIFY, MOVE, SPOTIFY];
    expect(summariseFile(five)).toContain("and 2 more");
  });
});
