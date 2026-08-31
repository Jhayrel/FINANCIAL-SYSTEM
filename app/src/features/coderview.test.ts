/**
 * Coderview dumps everything, and keeps dumping everything.
 *
 * The point of the screen is that nothing is left out. A seventh collection
 * added to `firestore.rules` and not to the dump would be invisible in
 * exactly the way that matters: you would read the file, see no sign of it,
 * and conclude the data was not there.
 *
 * So the list is checked against the rules, which is the one place every
 * collection has to be declared for the app to work at all.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { COLLECTIONS } from "./CoderView";

const rules = readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8");

/** Every `match /users/{uid}/<name>` in the rules, deduplicated. */
const declared = [
  ...new Set(
    [...rules.matchAll(/match\s+\/users\/\{uid\}\/([a-zA-Z]+)\//g)].map((m) => m[1] ?? ""),
  ),
].filter(Boolean);

describe("the dump covers the whole database", () => {
  it("found the collections declared in the rules", () => {
    expect(declared.length).toBeGreaterThan(3);
  });

  it("dumps every collection the rules declare", () => {
    for (const name of declared) {
      expect(COLLECTIONS as readonly string[], `${name} is in the rules but not in the dump`).toContain(
        name,
      );
    }
  });

  it("dumps nothing the rules do not declare", () => {
    for (const name of COLLECTIONS) {
      expect(declared, `${name} is dumped but not declared in the rules`).toContain(name);
    }
  });

  /** The one the debugging is for. Named explicitly so it cannot drift out. */
  it("includes the assistant's own record", () => {
    expect(COLLECTIONS as readonly string[]).toContain("ai");
  });
});
