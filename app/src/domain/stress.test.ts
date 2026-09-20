/**
 * The whole system under load, and at its edges.
 *
 * Asked for on 20 September 2026: "do some heavy untickable test, stress test
 * the system all parts ... make sure every part of the system works, all
 * formula correct, all things match in the database."
 *
 * The parity tests already pin the figures the workbook produced for 440
 * rows. This file asks a different question: do those same formulas hold when
 * the ledger is a hundred times longer, when the rows arrive in a different
 * order, when the figures are as large as the database will accept, and when
 * the input is hostile rather than typical. Every check here is an invariant
 * (true of any ledger) or a relation (a large ledger built from a known one,
 * whose answer is therefore known), never a hand-copied number: a stress test
 * that asserts constants only tests the constants.
 *
 * Timing budgets are deliberately loose. They are here to catch a change that
 * turns something quadratic, not to measure this machine.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { allWalletBalances, walletBalance } from "./balances";
import { getYear } from "./dates";
import { type Debt, owedChange, positionOf } from "./debt";
import { investigate, investigationWords, movedOn } from "./investigate";
import { formatMoney, parseAmount } from "./money";
import { readEntry } from "./readEntry";
import { monthlyTotalsForYear, totalsFor } from "./totals";
import type { Transaction } from "./types";

const fx = loadFixture();
const REAL = fx.transactions;

/** A seeded generator, so a failure here is reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * The real ledger, `copies` times over, each copy a year earlier.
 *
 * Shifting the year keeps every row legal and every month distinct, so a
 * wallet balance over the whole thing is exactly `copies` times the real one.
 * That relation is the point: the answer at scale is known without writing a
 * single new figure down.
 */
function multiplied(copies: number): Transaction[] {
  const out: Transaction[] = [];
  for (let c = 0; c < copies; c += 1) {
    for (const t of REAL) {
      out.push({
        ...t,
        id: `${t.id}-c${c}`,
        recordNumber: t.recordNumber + c * 10000,
        date: `${getYear(t.date) - c}${t.date.slice(4)}`,
      });
    }
  }
  return out;
}

const COPIES = 150;
const BIG = multiplied(COPIES);

const took = (fn: () => void): number => {
  const started = performance.now();
  fn();
  return performance.now() - started;
};

describe("a ledger a hundred and fifty times longer than the real one", () => {
  it("is as long as it says", () => {
    expect(BIG).toHaveLength(REAL.length * COPIES);
    expect(BIG.length).toBeGreaterThan(60_000);
  });

  it("gives every wallet exactly its own balance, multiplied", () => {
    let balances = new Map<string, number>();
    const ms = took(() => {
      balances = allWalletBalances(BIG);
    });
    const wallets = [...allWalletBalances(REAL).keys()];
    expect(wallets.length).toBeGreaterThan(3);
    for (const wallet of wallets) {
      expect(balances.get(wallet), wallet).toBe(walletBalance(REAL, wallet) * COPIES);
      expect(Number.isSafeInteger(balances.get(wallet)), wallet).toBe(true);
    }
    expect(ms, `${Math.round(ms)}ms for ${BIG.length} rows`).toBeLessThan(3000);
  });

  it("totals a year of it without a fraction of a centavo appearing", () => {
    const year = getYear(fx.expected.asOf);
    let months: ReturnType<typeof monthlyTotalsForYear> = [];
    const ms = took(() => {
      months = monthlyTotalsForYear(BIG, year);
    });
    expect(months).toHaveLength(12);
    for (const m of months) {
      for (const [field, value] of Object.entries(m)) {
        if (typeof value === "number") expect(Number.isInteger(value), field).toBe(true);
      }
    }
    expect(ms, `${Math.round(ms)}ms`).toBeLessThan(3000);
  });

  it("reads a debt position out of all of it in one pass", () => {
    const debt: Debt = {
      id: "maya-credit",
      name: "Maya Credit",
      kind: "payable",
      counterparty: "Maya",
      openedDate: "2026-01-01",
      wallet: "Maya",
      interestType: "none",
      interestRate: 0,
      notes: "",
      archived: false,
    };
    let outstanding = 0;
    const ms = took(() => {
      outstanding = positionOf(debt, BIG, fx.expected.asOf).outstanding;
    });
    expect(Number.isInteger(outstanding)).toBe(true);
    expect(ms, `${Math.round(ms)}ms`).toBeLessThan(1500);
  });
});

describe("the order rows arrive in changes nothing", () => {
  const shuffled = (() => {
    const next = rng(20260920);
    const rows = [...REAL];
    for (let i = rows.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      const a = rows[i]!;
      const b = rows[j]!;
      rows[i] = b;
      rows[j] = a;
    }
    return rows;
  })();

  it("every wallet balance is the same", () => {
    expect(allWalletBalances(shuffled)).toEqual(allWalletBalances(REAL));
  });

  it("every month total is the same", () => {
    expect(totalsFor(shuffled)).toEqual(totalsFor(REAL));
  });
});

describe("figures as large as the database will accept", () => {
  /** validTransaction() refuses anything at or beyond 100,000,000,000 centavos. */
  const CAP = 99_999_999_999;

  const row = (n: number, amount: number): Transaction => ({
    id: `cap${n}`,
    recordNumber: n,
    date: "2026-09-20",
    type: "Revenue",
    fromWallet: "",
    toWallet: "Maya",
    category: "Revenue",
    item: "Cap",
    description: "",
    amount,
    fee: 0,
    total: amount,
    notes: "",
    status: "Received",
  });

  it("adds ten thousand of the largest rows without losing a centavo", () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => row(i + 1, CAP));
    const balance = walletBalance(rows, "Maya");
    expect(balance).toBe(CAP * 10_000);
    expect(Number.isSafeInteger(balance)).toBe(true);
  });

  it("reads back everything it writes, at both ends of the range", () => {
    // Its own output, character for character: symbol, commas, minus sign.
    for (const c of [CAP, -CAP, 1, -1, 0, 123_456_789, -99, 100]) {
      expect(parseAmount(formatMoney(c)), formatMoney(c)).toBe(c);
      expect(parseAmount(formatMoney(c, { symbol: false })), String(c)).toBe(c);
    }
  });

  it("holds the arithmetic of a difference at the cap", () => {
    const result = investigate({ transactions: [row(1, CAP)], account: "Maya", actual: 0, asOf: "2026-09-21" });
    expect(result.gap).toBe(CAP);
    expect(result.explained + result.unexplained).toBe(result.gap);
  });
});

describe("the investigation, against a thousand differences it has never seen", () => {
  const accounts = [...allWalletBalances(REAL).keys()].filter(Boolean).slice(0, 8);
  const asOf = fx.expected.asOf;

  it("has accounts to work on at all", () => {
    // A loop over an empty list passes every assertion inside it.
    expect(accounts.length).toBeGreaterThan(3);
  });

  it("keeps its arithmetic whatever the owner types", () => {
    const next = rng(7);
    let checked = 0;
    const ms = took(() => {
      for (const account of accounts) {
        const recorded = walletBalance(REAL, account);
        for (let i = 0; i < 125; i += 1) {
          // Anything from a centavo out to twenty million out, either way.
          const off = Math.round((next() - 0.5) * 2_000_000_000);
          const result = investigate({ transactions: REAL, account, actual: recorded - off, asOf });
          checked += 1;

          expect(result.gap, account).toBe(recorded - result.actual);
          expect(result.explained + result.unexplained, account).toBe(result.gap);
          expect(Number.isInteger(result.explained), account).toBe(true);
          for (const clue of result.found) expect(Number.isInteger(clue.explains), account).toBe(true);

          // Nothing is offered as a possibility once the findings overshoot.
          if (result.overshoot) expect(result.possible, account).toEqual([]);

          // A possibility must move money the way the gap points, or it is an
          // answer that would make the difference worse.
          if (!result.overshoot) {
            for (const clue of result.possible) {
              if (clue.kind === "together") {
                expect(Math.sign(clue.explains), account).toBe(Math.sign(result.unexplained));
              }
            }
          }

          const words = investigationWords(result);
          expect(words.headline.length).toBeGreaterThan(0);
          if (result.overshoot) expect(words.lines.join(" ")).not.toContain("Found ");
        }
      }
    });
    expect(checked).toBe(accounts.length * 125);
    expect(ms, `${Math.round(ms)}ms for ${checked} investigations`).toBeLessThan(30_000);
  });

  it("never reads a row as moving money on an account it does not name", () => {
    for (const t of REAL) {
      for (const account of accounts) {
        if (t.fromWallet !== account && t.toWallet !== account) {
          expect(movedOn(t, account), `#${t.recordNumber} ${account}`).toBe(0);
        }
      }
    }
  });
});

describe("the debt engine, under five thousand random movements", () => {
  const EFFECTS = ["draw", "charge", "repay", "interest", "fee", "writeoff", "lend", "collect"] as const;

  const rows: Transaction[] = (() => {
    const next = rng(99);
    const out: Transaction[] = [];
    for (let i = 0; i < 5000; i += 1) {
      const effect = EFFECTS[Math.floor(next() * EFFECTS.length)]!;
      const amount = Math.floor(next() * 500_000);
      out.push({
        id: `d${i}`,
        recordNumber: i + 1,
        date: "2026-09-20",
        type: "Debt",
        fromWallet: "",
        toWallet: "",
        category: "",
        item: "Line",
        description: "",
        amount,
        fee: 0,
        total: amount,
        notes: "",
        status: "",
        debtId: `line-${Math.floor(next() * 12)}`,
        debtEffect: effect,
      });
    }
    return out;
  })();

  it("what is owed is always draws plus charges, less repayments and write-offs", () => {
    for (let n = 0; n < 12; n += 1) {
      const id = `line-${n}`;
      const debt: Debt = {
        id,
        name: id,
        kind: "payable",
        counterparty: "",
        openedDate: "2026-01-01",
        wallet: "Maya",
        interestType: "none",
        interestRate: 0,
        notes: "",
        archived: false,
      };
      const p = positionOf(debt, rows, "2026-09-20");
      expect(p.outstanding, id).toBe(p.drawn + p.charged - p.repaid - p.writtenOff);
      expect(Number.isInteger(p.outstanding), id).toBe(true);

      /*
       * Interest paid from a wallet is expense, never a reduction of what is
       * owed (rule 5.6.2). It is counted, and counted apart.
       */
      const mine = rows.filter((t) => t.debtId === id);
      expect(p.interestPaid, id).toBe(
        mine.filter((t) => t.debtEffect === "interest" || t.debtEffect === "fee").reduce((s, t) => s + t.amount, 0),
      );
      expect(
        mine.reduce((s, t) => s + owedChange(t), 0),
        id,
      ).toBe(p.outstanding);
    }
  });
});

describe("a message far longer than anyone would type", () => {
  const long = Array.from(
    { length: 300 },
    (_, i) => `on september ${(i % 28) + 1} I paid ${i + 1}00 for item ${i} from maya and then`,
  ).join(" ");

  it("reads it without hanging and without inventing a figure", () => {
    let read: ReturnType<typeof readEntry> | null = null;
    const ms = took(() => {
      read = readEntry(long, REAL, fx.reference, "2026-09-20");
    });
    expect(long.length).toBeGreaterThan(12_000);
    expect(read).not.toBeNull();
    const amount = read!.draft.amount;
    expect(amount === null || Number.isInteger(amount)).toBe(true);
    expect(ms, `${Math.round(ms)}ms for ${long.length} characters`).toBeLessThan(4000);
  });

  it("is not tripped by punctuation, emoji, or a wall of digits", () => {
    const nasty = [
      "₱₱₱₱₱ !!! ??? ,,,...",
      "0000000000000000000000000000000",
      "😀😀😀 paid 😀",
      "-".repeat(500),
      "1".repeat(400),
      "<script>alert(1)</script> paid 100 cash",
      "'; DROP TABLE transactions; --",
      " [31m paid 50 cash",
    ];
    for (const text of nasty) {
      const read = readEntry(text, REAL, fx.reference, "2026-09-20");
      const amount = read.draft.amount;
      expect(amount === null || Number.isInteger(amount), text.slice(0, 20)).toBe(true);
      expect(Number.isInteger(read.draft.fee)).toBe(true);
    }
  });
});
