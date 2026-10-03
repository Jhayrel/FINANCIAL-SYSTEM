/**
 * A thing, a price and maybe a wallet, with no verb: how most entries are
 * typed on a phone. With no model to read them the chat said the AI was not
 * working (3 October 2026, "lunch 99 cash"). The everyday word has to name one
 * of the owner's own kinds, and a question or a plan is never a row.
 */
import { describe, expect, it } from "vitest";

import { REFERENCE, TODAY } from "./eval/corpus";
import { readEntry } from "./readEntry";

const read = (s: string) => readEntry(s, [], REFERENCE, TODAY);

describe("a plain entry, read on the device", () => {
  it("files the everyday word under the owner's kind", () => {
    const cases: [string, string, number, string][] = [
      ["lunch 99 cash", "Food", 9_900, "Cash"],
      ["coffee 120 gcash", "Food", 12_000, "Gcash"],
      ["grab 250 gcash", "Travel", 25_000, "Gcash"],
      ["jeep fare 13 cash", "Travel", 1_300, "Cash"],
      ["groceries 850 maya", "Home Needs", 85_000, "Maya"],
      ["medicine 75 cash", "Health", 7_500, "Cash"],
      ["haircut 150 cash", "Self Care", 15_000, "Cash"],
      ["190 lunch cash", "Food", 19_000, "Cash"],
    ];
    for (const [said, item, amount, wallet] of cases) {
      const r = read(said);
      expect(r.worthOffering, said).toBe(true);
      expect(r.draft, said).toMatchObject({ flow: "Spending", item, amount, fromWallet: wallet });
    }
  });

  it("files a bill or subscription by name on its own list, with a verb or without", () => {
    expect(read("spotify 149 maya").draft).toMatchObject({ flow: "Spending", category: "Subscriptions", item: "Spotify", amount: 14_900 });
    expect(read("paid netflix 249 gcash").draft).toMatchObject({ category: "Subscriptions", item: "Netflix" });
    expect(read("globe at home wifi 999 maya").draft).toMatchObject({ category: "Bills", item: "Globe at Home Wifi" });
  });

  it("never makes a row of a question, a plan, or a word that names nothing of theirs", () => {
    for (const said of ["lunch 99?", "how much was lunch 99", "food budget 3000", "plan coffee 500 a week", "hatdog 50 cash", "save 500 for food"]) {
      expect(read(said).worthOffering, said).toBe(false);
    }
  });
});
