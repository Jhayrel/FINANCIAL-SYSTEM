/**
 * The test that matters here is the balance test.
 *
 * Rebuilding a list of names is easy to get superficially right and still be
 * useless: a name that differs by one character is a different account, and
 * the balance silently splits in two. So the assertion is not "23 accounts
 * came back", it is "every known peso figure is reproduced exactly from the
 * rebuilt list".
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { accountBalances, migrateAccounts } from "./accounts";
import { allWalletBalances } from "./balances";
import { accountNamesInLedger, recoverAccounts } from "./recovery";
import type { Transaction } from "./types";

const fixture = loadFixture();
const { transactions } = fixture;

const row = (over: Partial<Transaction>): Transaction => ({
  id: "t1",
  recordNumber: 1,
  date: "2026-01-01",
  type: "Spending",
  category: "Food",
  item: "Lunch",
  description: "",
  amount: 10000,
  fee: 0,
  total: 10000,
  fromWallet: "Cash",
  toWallet: "",
  ...over,
});

describe("accountNamesInLedger", () => {
  it("finds every name the ledger mentions", () => {
    const names = accountNamesInLedger(transactions);
    const fromBalances = [...allWalletBalances(transactions).keys()];

    expect([...names].sort()).toEqual([...fromBalances].sort());
  });

  it("never returns a blank name", () => {
    // Transfers that leave the owner's accounts have an empty toWallet, and an
    // empty string must not become an account called "".
    expect(accountNamesInLedger(transactions)).not.toContain("");
  });

  it("orders by how much the ledger uses each account", () => {
    const names = accountNamesInLedger([
      row({ fromWallet: "Rare" }),
      row({ fromWallet: "Common" }),
      row({ fromWallet: "Common" }),
      row({ fromWallet: "Common" }),
    ]);

    expect(names[0]).toBe("Common");
  });

  it("treats surrounding whitespace as the same account", () => {
    expect(accountNamesInLedger([row({ fromWallet: "Cash" }), row({ fromWallet: " Cash " })]))
      .toEqual(["Cash"]);
  });
});

describe("recoverAccounts", () => {
  it("refuses to touch a populated list", () => {
    const good = migrateAccounts(
      fixture.reference.wallets,
      fixture.reference.savings,
      transactions,
    );
    const report = recoverAccounts(transactions, good);

    expect(report.alreadyPopulated).toBe(true);
    expect(report.recovered).toBe(0);
    expect(report.accounts).toBe(good);
  });

  it("rebuilds every account the real ledger touches", () => {
    const report = recoverAccounts(transactions, []);

    expect(report.alreadyPopulated).toBe(false);
    expect(report.recovered).toBeGreaterThan(0);
    expect(report.accounts).toHaveLength(allWalletBalances(transactions).size);
  });

  it("reproduces the known balances to the centavo", () => {
    const report = recoverAccounts(transactions, []);
    const balances = accountBalances(report.accounts, transactions);
    const by = (name: string): number =>
      balances.find((b) => b.account.name === name)?.balance ?? Number.NaN;

    // The figures pinned in CLAUDE.md. If recovery loses or splits an account
    // these move, which is exactly the failure worth catching.
    expect(by("Maya")).toBe(579574);
    expect(by("Cash")).toBe(16100);
    expect(by("Gcash")).toBe(15571);
    expect(by("Maya Bank (Personal savings)")).toBe(152758);
  });

  it("matches the balances of a correctly migrated list, account for account", () => {
    const good = migrateAccounts(
      fixture.reference.wallets,
      fixture.reference.savings,
      transactions,
    );
    const recovered = recoverAccounts(transactions, []).accounts;

    const asMap = (list: readonly { account: { name: string }; balance: number }[]) =>
      new Map(list.map((b) => [b.account.name, b.balance]));

    expect(asMap(accountBalances(recovered, transactions))).toEqual(
      asMap(accountBalances(good, transactions)),
    );
  });

  it("gives every account a distinct id", () => {
    const ids = recoverAccounts(transactions, []).accounts.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("recognises a goal by its bracketed suffix and points it at the parent", () => {
    const { accounts } = recoverAccounts(transactions, []);
    const drone = accounts.find((a) => a.name === "Maya Bank (Drone)");
    const parent = accounts.find((a) => a.name === "Maya Bank (Personal savings)");

    expect(drone?.kind).toBe("goal");
    expect(drone?.parentId).toBe(parent?.id);
  });

  it("marks nothing archived, because a transaction cannot say so", () => {
    expect(recoverAccounts(transactions, []).accounts.every((a) => !a.archived)).toBe(true);
  });

  it("says so plainly when there is nothing to rebuild", () => {
    const report = recoverAccounts([], []);
    expect(report.recovered).toBe(0);
    expect(report.accounts).toEqual([]);
    expect(report.note).toContain("nothing to rebuild");
  });

  it("is stable: recovering twice gives the same list", () => {
    expect(recoverAccounts(transactions, []).accounts).toEqual(
      recoverAccounts(transactions, []).accounts,
    );
  });
});
