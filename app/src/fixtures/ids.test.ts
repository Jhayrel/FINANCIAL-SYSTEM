/**
 * Ids have to be unique, because the whole app keys on them.
 *
 * React reported "two children with the same key, d120" in the Bin, and a
 * duplicate key there is not cosmetic: `handleRestore` finds a row by id, so
 * two rows sharing one means restoring either restores the first.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "./load";

const fx = loadFixture();

describe("fixture ids", () => {
  it("gives every live row its own id", () => {
    const ids = fx.transactions.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every binned row its own id", () => {
    const ids = fx.deleted.map((t) => t.id);
    const seen = new Map<string, number>();
    for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
    const clashes = [...seen.entries()].filter(([, n]) => n > 1);
    expect(clashes, `duplicate ids: ${JSON.stringify(clashes)}`).toEqual([]);
  });

  it("never gives a binned row the same id as a live one", () => {
    const live = new Set(fx.transactions.map((t) => t.id));
    expect(fx.deleted.filter((t) => live.has(t.id))).toEqual([]);
  });
});
