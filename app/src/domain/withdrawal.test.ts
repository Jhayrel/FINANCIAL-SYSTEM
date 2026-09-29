/**
 * An ATM cash withdrawal slip (`withdrawal.ts`).
 *
 * The owner, 29 September 2026, with a China Bank Savings slip: "it should
 * know the withdraw amount and fee and wallet comes from and since it's
 * physical withdraw means cash". The first reading below is what this
 * device's own reader made of that photo, errors and all.
 */

import { describe, expect, it } from "vitest";

import { emptyDraft } from "./entry";
import { checkWithdrawal, type Proposal } from "./proposal";
import type { ReferenceLists, Transaction } from "./types";
import { cashAndFee, cashWallet, readWithdrawal, slipsIn, withdrawalNote, withdrawalSource } from "./withdrawal";

const SLIP = [
  "105 China Bank Savings",
  "Fanny of Crng Buyrg (inter",
  "Es",
  "DATE ~~ TIME TCOCATION",
  "29SEP2026 10:51:03CBS ST LOUIS LA",
  "TRANSACTION AMOUNT",
  "CASH WITHDRAWAL 1,000.00",
  "Brcurrent BALANCE AVAILABLE BALANCE",
  "; 2,934.79 2,934.79",
  "’ RACE NUMBER: 0001",
  "STAN: 123456",
  "APPLICATION ID A0000000031010",
  "APPLICATION LABEL Visa Credit",
  "*AN ATM FEE OF 16.00 IS ALREADY",
  "INCLUDED IN THE TRANSACTION AMOUNT",
].join("\n");

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya", "Extra Cash"],
  savings: ["Maya Bank (Personal savings)"],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
  credits: ["Maya Credit"],
};

let n = 0;
const transfer = (date: string, from: string, amount: number, fee: number, description: string): Transaction => {
  n += 1;
  return {
    id: `w-${n}`,
    recordNumber: n,
    date,
    type: "Transfer",
    fromWallet: from,
    toWallet: "Cash",
    category: "",
    item: "",
    description,
    amount,
    fee,
    total: amount + fee,
    notes: "",
    status: "",
  };
};

describe("the owner's slip", () => {
  const w = readWithdrawal([SLIP]);

  it("reads the cash, the fee and what left the account", () => {
    expect(w?.cash).toBe(100_000);
    expect(w?.fee).toBe(1_600);
    expect(w?.debit).toBe(101_600);
    expect(w?.confidence).toBe("high");
  });

  it("reads the balance after it, the day, the time and the machine", () => {
    expect(w?.balanceAfter).toBe(293_479);
    expect(w?.date).toBe("2026-09-29");
    expect(w?.time).toBe("10:51");
    expect(w?.place).toBe("CBS ST LOUIS LA");
    expect(w?.bank).toBe("China Bank Savings");
    expect(w?.label).toBe("Visa Credit");
  });

  it("tells the model it is one transfer into Cash, and that Visa Credit is not borrowing", () => {
    const note = w ? withdrawalNote(w, "Cash") : "";
    expect(note).toContain("flow Transfer, amountPesos 1000, feePesos 16, toWallet Cash");
    expect(note).toContain('"Visa Credit" is the card\'s chip label, not borrowing: never a Debt.');
    expect(note).toContain("PHP 2,934.79 is that account's balance after it, not a row.");
  });
});

describe("which figure is the cash", () => {
  it("takes the fee out of a printed figure that holds it", () => {
    const w = readWithdrawal(["CASH WITHDRAWAL 1,016.00\nATM FEE 16.00\nTERMINAL 00123\nAVAILABLE BALANCE 5,000.00"]);
    expect(w?.cash).toBe(100_000);
    expect(w?.fee).toBe(1_600);
  });

  it("reads a slip with no fee", () => {
    const w = readWithdrawal(["BDO ATM\n09/29/26 14:02\nWITHDRAWAL\nAMOUNT 2,000.00\nCARD NO XXXX1234\nAVAIL BAL 8,120.50"]);
    expect(w?.cash).toBe(200_000);
    expect(w?.fee).toBe(0);
    expect(w?.date).toBe("2026-09-29");
    expect(w?.bank).toBe("BDO");
    expect(w?.balanceAfter).toBe(812_050);
  });
});

describe("what is not a withdrawal slip", () => {
  it("leaves a wallet's history to the list rules", () => {
    const list = Array.from({ length: 10 }, (_, i) => `Withdrawal from TANQUI SFLU -1,018.00\nSep ${10 + i}, 2026 ATM`).join("\n");
    expect(readWithdrawal([list])).toBeNull();
  });

  it("leaves a deposit slip alone", () => {
    expect(readWithdrawal(["CASH DEPOSIT 1,000.00\nTERMINAL 001\nBALANCE 3,000.00"])).toBeNull();
  });

  it("leaves a shop receipt alone", () => {
    expect(readWithdrawal(["JOLLIBEE\nChickenjoy 1 99.00\nTOTAL 99.00\nCASH 100.00\nCHANGE 1.00"])).toBeNull();
  });
});

describe("the account it came out of", () => {
  const w = readWithdrawal([SLIP]);
  if (!w) throw new Error("slip not read");

  it("is the account whose balance, less what left it, is what the slip prints", () => {
    const balances = new Map([["Maya", 395_079], ["Gcash", 50_000]]);
    const s = withdrawalSource(w, balances, [], [...reference.wallets, ...reference.savings], "Cash");
    expect(s?.account).toBe("Maya");
    expect(s?.off).toBe(0);
  });

  it("is where withdrawals at the same machine came from, and says how far the balance is off", () => {
    const history = [
      transfer("2026-09-24", "Maya", 51_600, 0, "St.Louis College withdrawal"),
      transfer("2026-09-20", "Gcash", 100_000, 1_500, "withdrawal"),
      transfer("2026-09-18", "Maya", 101_800, 0, "Withdrawal from TANQUI SFLU"),
    ];
    const balances = new Map([["Maya", 394_495], ["Gcash", 50_000]]);
    const s = withdrawalSource(w, balances, history, [...reference.wallets, ...reference.savings], "Cash");
    expect(s?.account).toBe("Maya");
    expect(s?.off).toBe(584);
    expect(s?.how).toContain("your withdrawal at this machine on 2026-09-24 came from it");
    expect(s?.how).toContain("PHP 5.84 less");
  });

  it("says to check the account when its balance is far from the slip's", () => {
    const history = [transfer("2026-09-24", "Maya", 51_600, 0, "St.Louis College withdrawal")];
    const s = withdrawalSource(w, new Map([["Maya", 11_503_600]]), history, [...reference.wallets], "Cash");
    expect(s?.account).toBe("Maya");
    expect(s?.how).toContain("check that it is the right account");
    expect(s?.how).not.toContain("something small");
  });

  it("asks when nothing says", () => {
    const history = [transfer("2026-09-24", "Maya", 50_000, 1_600, "withdrawal"), transfer("2026-09-20", "Gcash", 100_000, 1_500, "withdrawal")];
    expect(withdrawalSource(w, new Map(), history, [...reference.wallets], "Cash")).toBeNull();
  });

  it("finds the cash wallet by its name", () => {
    expect(cashWallet(reference.wallets)).toBe("Cash");
    expect(cashWallet(["Gcash", "Extra Cash", "Cash on hand"])).toBe("Cash on hand");
  });
});

describe("the model's cards, held to the slip", () => {
  const w = readWithdrawal([SLIP]);
  if (!w) throw new Error("slip not read");
  const card = (over: Partial<Proposal["draft"]>): Proposal => ({
    draft: { ...emptyDraft("2026-09-29"), ...over },
    confidence: "high",
    sourceRef: "the picture",
    adjustments: [],
  });

  it("makes borrowing on 'Visa Credit', a fee row and a balance row into one transfer into Cash", () => {
    const out = checkWithdrawal(
      [
        card({ flow: "Debt", debtEffect: "draw", amount: 100_000, toWallet: "Cash" }),
        card({ flow: "Spending", category: "Spending", item: "Transaction Fee", amount: 1_600, fromWallet: "Maya" }),
        card({ flow: "Spending", category: "Spending", amount: 293_479 }),
      ],
      [w],
      reference,
      "2026-09-29",
    );
    expect(out).toHaveLength(1);
    const d = out[0]?.draft;
    expect(d?.flow).toBe("Transfer");
    expect(d?.amount).toBe(100_000);
    expect(d?.fee).toBe(1_600);
    expect(d?.toWallet).toBe("Cash");
    expect(d?.fromWallet).toBe("");
    expect(d?.date).toBe("2026-09-29");
    expect(d?.description).toBe("Withdrawal from CBS ST LOUIS LA");
    expect(d?.debtEffect).toBeUndefined();
    expect(out[0]?.adjustments.join(" ")).toContain("not borrowing");
  });

  it("keeps a right reading, and the account the model named when it is one of theirs", () => {
    const out = checkWithdrawal([card({ flow: "Transfer", category: "Transfer", amount: 100_000, fee: 1_600, fromWallet: "Maya", toWallet: "Cash" })], [w], reference, "2026-09-29");
    expect(out).toHaveLength(1);
    expect(out[0]?.draft.fromWallet).toBe("Maya");
    expect(out[0]?.draft.fee).toBe(1_600);
  });

  it("makes the card from the slip alone when the model found nothing", () => {
    const out = checkWithdrawal([], [w], reference, "2026-09-29");
    expect(out[0]?.draft.amount).toBe(100_000);
    expect(out[0]?.draft.fee).toBe(1_600);
  });

  it("finds a slip once, however many ways it was read", () => {
    expect(slipsIn([SLIP, SLIP.toLowerCase(), "nothing here"])).toHaveLength(1);
  });
});

describe("a history's one figure for cash taken out", () => {
  it.each([
    [101_800, 100_000, 1_800],
    [51_600, 50_000, 1_600],
    [21_800, 20_000, 1_800],
    [151_800, 150_000, 1_800],
  ])("%i is %i of cash and a %i fee", (total, cash, fee) => {
    expect(cashAndFee(total)).toEqual({ cash, fee });
  });

  it.each([100_000, 200, 104_500, 5_000])("leaves %i alone", (total) => {
    expect(cashAndFee(total)).toBeNull();
  });
});
