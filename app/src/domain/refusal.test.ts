/**
 * What the notice says when the database refuses a save.
 *
 * It used to say the same guess every time. It says what the database
 * answered now, and names the one cause the rules history explains: a
 * charge added to a debt, which rules published before 17 September 2026
 * refuse outright.
 */

import { describe, expect, it } from "vitest";

import { refusalWords } from "./syncState";

describe("why a save was refused", () => {
  it("names the rules when a charge is among the kept rows", () => {
    const words = refusalWords("Missing or insufficient permissions.", 1, [{ debtEffect: "charge" }]);
    expect(words).toContain("do not know a charge added to a debt");
    expect(words).toContain("Publish the latest firestore.rules");
  });

  it("says rules or sign-in for any other permission refusal", () => {
    expect(refusalWords("Missing or insufficient permissions.", 2, [{ debtEffect: "repay" }])).toContain("check you are signed in as the owner");
  });

  it("says the connection when that is what failed", () => {
    expect(refusalWords("Failed to get document because the client is offline.", 1)).toContain("connection dropped");
  });

  it("quotes anything else rather than guessing", () => {
    expect(refusalWords("Function setDoc() called with invalid data.", 1)).toContain("The database answered: Function setDoc() called with invalid data.");
  });

  it("always says the rows are kept", () => {
    for (const error of [null, "permission-denied", "offline", "boom"]) {
      expect(refusalWords(error, 1)).toContain("kept on this device");
    }
  });
});
