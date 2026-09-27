/**
 * Every account picker files an account under the heading Settings gives it.
 *
 * The owner, 27 September 2026, with the Add form's wallet list beside
 * Settings: three reserves sat under "Savings" in the list and under
 * "Reserve" in Settings ("fix all the filters and dropdown in the system").
 * Names are invented.
 */

import { describe, expect, it } from "vitest";

import { accountGroups, INACTIVE_GROUP, type Account } from "./accounts";

const account = (name: string, kind: Account["kind"], archived = false): Account => ({ id: name, name, kind, archived });

const accounts = [
  account("Cash", "spending"),
  account("Pocket", "spending"),
  account("Rainy day (Reserve)", "reserve"),
  account("Bank savings", "savings"),
  account("New phone", "goal"),
  account("Old wallet", "spending", true),
];

describe("account headings in a picker", () => {
  it("are the ones Settings uses, in its order, whatever order the names come in", () => {
    const { options, groups } = accountGroups(["Bank savings", "Cash", "Rainy day (Reserve)", "New phone", "Pocket"], accounts);
    expect(options).toEqual(["Cash", "Pocket", "Rainy day (Reserve)", "Bank savings", "New phone"]);
    expect(groups).toEqual({
      Cash: "Spending",
      Pocket: "Spending",
      "Rainy day (Reserve)": "Reserve",
      "Bank savings": "Savings",
      "New phone": "Goal",
    });
  });

  it("put an archived account, or a name no account has, at the end as not active", () => {
    const { options, groups } = accountGroups(["Old wallet", "Cash", "Somewhere else"], accounts);
    expect(options).toEqual(["Cash", "Old wallet", "Somewhere else"]);
    expect(groups["Old wallet"]).toBe(INACTIVE_GROUP);
    expect(groups["Somewhere else"]).toBe(INACTIVE_GROUP);
  });

  it("fall back to the wallet and savings lists for data from before accounts had kinds", () => {
    const { groups } = accountGroups(["Cash", "Bank"], [], { wallets: ["Cash"], savings: ["Bank"] });
    expect(groups).toEqual({ Cash: "Spending", Bank: "Savings" });
  });

  it("list each name once, and never a blank", () => {
    expect(accountGroups(["Cash", "", " Cash ", "Cash"], accounts).options).toEqual(["Cash"]);
  });
});
