import { describe, expect, it } from "vitest";
import { accountIn, interestFromBalance } from "./interestAsk";

const accounts = ["Cash", "Gcash", "Maya", "Maya Bank (Personal savings)"];
const balance = (a: string) => (a === "Maya Bank (Personal savings)" ? 350000 : a === "Maya" ? 120000 : 0);

describe("interest worked out from a balance (7 October 2026)", () => {
  it("is the balance less what the ledger holds", () => {
    expect(interestFromBalance("My maya bank is 3500.42 in my account now i earn interest but i scan the images to know", accounts, balance)).toEqual({
      account: "Maya Bank (Personal savings)", told: 350042, ledger: 350000, gap: 42,
    });
  });
  it("reads the account by the words before its brackets", () => {
    expect(accountIn("my maya bank balance", accounts)).toBe("Maya Bank (Personal savings)");
    expect(accountIn("my maya balance", accounts)).toBe("Maya");
  });
  it("leaves alone a sentence that is a credit, not a balance", () => {
    expect(interestFromBalance("I earned 0.42 interest in maya bank", accounts, balance)).toBeNull();
    expect(interestFromBalance("my maya bank is 3500.42", accounts, balance)).toBeNull();
  });
  it("'how much it gain', with three accounts called Maya Bank: the one the figure sits above (3 November 2026)", () => {
    const three = [...accounts, "Maya Bank (Drone)", "Maya Bank (New Phone)"];
    expect(interestFromBalance("my maya bank 2510.40 let me know how much it gain", three, (a) => (a === "Maya Bank (Personal savings)" ? 250744 : balance(a)))).toEqual({
      account: "Maya Bank (Personal savings)", told: 251040, ledger: 250744, gap: 296,
    });
  });
});
