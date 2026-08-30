/**
 * W1, enforced instead of remembered.
 *
 * `docs/07-WRITING-RULES.md` bans the em dash everywhere, and the check it
 * describes is a grep someone has to think to run. It was not run: two of them
 * had shipped, one in a confirmation dialog the owner reads before deleting a
 * category, and an en dash was doing the same job in a chart subtitle.
 *
 * A rule that is only checked when someone remembers is not a rule, so this
 * runs with the suite.
 *
 * The AI is covered separately: `domain/aiText.ts` strips dashes from model
 * output at runtime, because a model cannot be made to read this file.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

const EM_DASH = "—";
const EN_DASH = "–";

/**
 * `aiText` is the module that removes these characters, and its tests assert
 * they are removed. Both have to contain them to do that job.
 */
const ALLOWED = new Set([
  "domain/aiText.ts",
  "domain/aiText.test.ts",
  // This file has to name the characters it bans in order to look for them.
  "styles/writing.test.ts",
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "fixtures" || entry === "_legacy") continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx|css)$/.test(entry)) out.push(full);
  }

  return out;
}

const files = sourceFiles(SRC).map((f) => ({
  path: relative(SRC, f).replace(/\\/g, "/"),
  text: readFileSync(f, "utf-8"),
}));

/** Both the character and the escape that produces it. */
const offenders = (dash: string, escape: string) =>
  files
    .filter((f) => !ALLOWED.has(f.path))
    .flatMap((f) =>
      f.text
        .split("\n")
        .map((line, i) => ({ file: f.path, line: i + 1, text: line.trim() }))
        .filter((l) => l.text.includes(dash) || l.text.includes(escape)),
    )
    .map((l) => `${l.file}:${l.line}  ${l.text.slice(0, 100)}`);

describe("writing rules", () => {
  it("finds source files to check, so a silent no-op cannot pass", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("has no em dash anywhere: W1", () => {
    expect(offenders(EM_DASH, "\\u2014")).toEqual([]);
  });

  it("has no en dash standing in for one", () => {
    // Not named in W1, but "January – August" is the same typographic move and
    // the owner asked for the rule to cover the whole system.
    expect(offenders(EN_DASH, "\\u2013")).toEqual([]);
  });

  it("still allows the minus sign in money, which W1 exempts", () => {
    // U+2212 is a different character and must never be swept up by this.
    const withMinus = files.filter((f) => f.text.includes("−"));
    expect(withMinus.length).toBeGreaterThan(0);
  });
});
