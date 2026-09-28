/**
 * A day written with its month is read as that day.
 *
 * The owner, 28 September 2026, typed a list into the chat, one line a day,
 * and every card came back dated today: the reader knew "yesterday" and
 * "2026-08-30" but not "Aug 25", which is how every bank and wallet history
 * writes a day. Figures and items are invented.
 */
import { describe, expect, it } from "vitest";

import { readEntry } from "./readEntry";
import type { ReferenceLists, Transaction } from "./types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }, { name: "Gas", remark: "" }],
};

const TODAY = "2026-08-29";

// A little history, so a bare "food 150 cash" reads as spending the way it does in the app.
const past = (n: number, item: string): Transaction => ({
  id: `h${n}`,
  recordNumber: n,
  date: `2026-07-${String(n).padStart(2, "0")}`,
  type: "Spending",
  fromWallet: "Cash",
  toWallet: "",
  category: "Spending",
  item,
  description: "",
  amount: 10000,
  fee: 0,
  total: 10000,
  notes: "",
  status: "",
});
const history = [past(1, "Food"), past(2, "Food"), past(3, "Gas"), past(4, "Gas"), past(5, "Food")];
const read = (text: string, asOf = TODAY) => readEntry(text, history, reference, asOf).draft;

describe("a day named with its month", () => {
  it("is that day, whichever side the month is on", () => {
    expect(read("Aug 25 food 150 cash").date).toBe("2026-08-25");
    expect(read("food 150 cash aug 25").date).toBe("2026-08-25");
    expect(read("August 3rd gas 200 cash").date).toBe("2026-08-03");
    expect(read("25 Aug food 150 cash").date).toBe("2026-08-25");
    expect(read("food 150 on the 2nd of August").date).toBe("2026-08-02");
    expect(read("Sept. 1 gas 200 cash").date).toBe("2026-09-01");
  });

  it("takes the year when one is written", () => {
    expect(read("food 150 cash Dec 30, 2025").date).toBe("2025-12-30");
    expect(read("food 150 cash 14 February 2024").date).toBe("2024-02-14");
  });

  it("is last year's when this year's would be more than a month ahead", () => {
    expect(read("Dec 30 food 150 cash", "2026-01-03").date).toBe("2025-12-30");
    // A few days ahead stays this year: something planned, not last year's.
    expect(read("Sep 3 gas 200 cash").date).toBe("2026-09-03");
  });

  it("reads 08/25 as August 25, but never a fraction as a date", () => {
    expect(read("08/25 food 150 cash").date).toBe("2026-08-25");
    expect(read("1/2 kilo pork 150 cash").date).toBe(TODAY);
  });

  it("does not take the Tagalog 'may' for May", () => {
    expect(read("gave 20 may natira pa cash").date).toBe(TODAY);
    expect(read("may 30 pa ako sa cash").date).toBe(TODAY);
    expect(read("food 150 cash May 5th").date).toBe("2026-05-05");
    expect(read("food 150 cash 5th of May").date).toBe("2026-05-05");
  });

  it("does not take the day as the amount", () => {
    expect(read("Aug 25 food 150 cash").amount).toBe(15000);
    expect(read("25 Aug food 150 cash").amount).toBe(15000);
  });

  it("leaves a day that does not exist unread", () => {
    expect(read("Feb 30 food 150 cash").date).toBe(TODAY);
  });

  it("still reads yesterday and a written-out date as before", () => {
    expect(read("food 150 cash yesterday").date).toBe("2026-08-28");
    expect(read("food 150 cash 2026-08-20").date).toBe("2026-08-20");
    expect(read("food 150 cash 8/20/2026").date).toBe("2026-08-20");
  });
});
