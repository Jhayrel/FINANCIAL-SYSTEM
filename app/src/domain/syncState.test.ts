/**
 * 26 September 2026: "A change did not save ... add it again", floating over
 * the bell's list, with no way to tell an entry from a setting from a read
 * that changed nothing.
 */
import { describe, expect, it } from "vitest";

import { syncWords } from "./syncState";

const refused = "Missing or insufficient permissions.";
const at = { online: true, pending: 0 } as const;

describe("a refusal names what was refused", () => {
  it("an entry, with what to do", () => {
    const notice = syncWords({ ...at, error: refused });
    expect(notice).toMatchObject({ level: "over", title: "An entry did not save" });
    expect(notice?.detail).toContain("publish the latest firestore.rules");
    expect(notice?.detail).toContain("Add it again");
  });

  it("a setting or a budget, and says the entries are not affected", () => {
    expect(syncWords({ ...at, error: refused, what: "settings" })).toMatchObject({ title: "A settings change did not save" });
    expect(syncWords({ ...at, error: refused, what: "settings" })?.detail).toContain("Your entries are saving normally");
    expect(syncWords({ ...at, error: refused, what: "budget" })?.title).toBe("A budget change did not save");
  });

  it("a read, which changed nothing, is never called a change", () => {
    const notice = syncWords({ ...at, error: refused, what: "settings-read" });
    expect(notice).toMatchObject({ level: "warn", title: "Your settings could not be loaded" });
    expect(notice?.title).not.toContain("change");
  });

  it("the activity trail, quietly, because the ledger is fine", () => {
    expect(syncWords({ ...at, error: refused, what: "activity" })).toMatchObject({ level: "info", title: "The activity trail is not recording" });
  });

  it("says signed out, or a dropped connection, when that is what the database said", () => {
    expect(syncWords({ ...at, error: "unauthenticated", what: "settings" })?.detail).toContain("sign in again");
    expect(syncWords({ ...at, error: "Failed to get document because the client is offline.", what: "budget" })?.detail).toContain("connection dropped");
  });
});
