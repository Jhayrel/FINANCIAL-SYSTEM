/**
 * Binning and restoring several rows at once.
 *
 * The Database screen can now move a selection to the bin in one action, and
 * the bin can put a selection back in one action. That is a convenience over
 * the money records themselves, so the thing worth pinning is not the button:
 * it is that a round trip through the bin changes nothing.
 *
 * Same shape as the debt migration invariant. If binning twelve rows and
 * restoring them leaves any wallet a centavo different, the feature is losing
 * money and must not ship.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { insertChronologically } from "./entry";
import { walletBalance } from "./balances";
import { totalsFor } from "./totals";
import type { Transaction } from "./types";

const fx = loadFixture();
const ledger = fx.transactions;

const wallets = [...new Set(ledger.flatMap((t) => [t.fromWallet, t.toWallet]))].filter(Boolean);

const balances = (rows: readonly Transaction[]): Record<string, number> =>
  Object.fromEntries(wallets.map((w) => [w, walletBalance(rows, w)]));

/** What the screen does: drop the picked rows, keep the rest in order. */
const bin = (rows: readonly Transaction[], ids: readonly string[]): Transaction[] => {
  const gone = new Set(ids);
  return rows.filter((t) => !gone.has(t.id));
};

/** What the bin does: put them back where their dates say they belong. */
const restore = (rows: readonly Transaction[], back: readonly Transaction[]): Transaction[] =>
  insertChronologically(rows, back);

describe("a round trip through the bin changes nothing", () => {
  const picked = [ledger[7], ledger[31], ledger[189], ledger[400]].filter(
    (t): t is Transaction => Boolean(t),
  );

  it("picked four real rows to work with", () => {
    expect(picked.length).toBe(4);
  });

  it("leaves every wallet exactly where it was", () => {
    const before = balances(ledger);
    const after = balances(restore(bin(ledger, picked.map((t) => t.id)), picked));
    expect(after).toEqual(before);
  });

  it("leaves the spending total exactly where it was", () => {
    const after = restore(bin(ledger, picked.map((t) => t.id)), picked);
    expect(totalsFor(after).total).toBe(totalsFor(ledger).total);
  });

  it("gives back every row, and no more", () => {
    const after = restore(bin(ledger, picked.map((t) => t.id)), picked);
    expect(after.length).toBe(ledger.length);
    expect(new Set(after.map((t) => t.id))).toEqual(new Set(ledger.map((t) => t.id)));
  });

  /**
   * Record numbers are a display ordinal, reassigned on every write: spec
   * 5.11. So they come back the same because the dates put the rows back in
   * the same places, not because anything stored them.
   */
  it("puts the rows back in the same order, with the same numbers", () => {
    const after = restore(bin(ledger, picked.map((t) => t.id)), picked);
    expect(after.map((t) => t.id)).toEqual(ledger.map((t) => t.id));
    expect(after.map((t) => t.recordNumber)).toEqual(ledger.map((t) => t.recordNumber));
  });
});

describe("binning a whole month, which is the case that would hurt", () => {
  const august = ledger.filter((t) => t.date.startsWith("2026-08"));

  it("found a month to bin", () => {
    expect(august.length).toBeGreaterThan(10);
  });

  it("takes the month out of the balances, and puts it back", () => {
    const before = balances(ledger);
    const without = bin(ledger, august.map((t) => t.id));
    expect(balances(without)).not.toEqual(before);
    expect(balances(restore(without, august))).toEqual(before);
  });

  it("takes the month out of the spending total, and puts it back", () => {
    const before = totalsFor(ledger).total;
    const without = bin(ledger, august.map((t) => t.id));
    expect(totalsFor(without).total).toBeLessThan(before);
    expect(totalsFor(restore(without, august)).total).toBe(before);
  });
});

describe("binning nothing", () => {
  it("is a no-op, not an empty ledger", () => {
    expect(bin(ledger, []).length).toBe(ledger.length);
    expect(balances(bin(ledger, []))).toEqual(balances(ledger));
  });

  /** An id that is not there must take nothing with it. */
  it("ignores an id the ledger does not have", () => {
    expect(bin(ledger, ["not-a-real-id"]).length).toBe(ledger.length);
  });
});
