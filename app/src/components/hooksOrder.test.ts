/**
 * No hook after an early return, checked instead of remembered.
 *
 * 27 September 2026: the owner's PC showed a black window. App called the
 * Back button's hooks below the sign-in gate, so the first render (signed
 * in, not yet known) returned the sign-in page before reaching them and the
 * next render called them. React stops on a changed number of hooks, and
 * nothing was left on the page. The local copy has no sign-in, so every
 * check run here passed. There is no linter in this repo to catch it, so
 * this does: in every component, a hook called at the top of the body after
 * a top-level `return` is a failure.
 *
 * A reading of the source, not a parser. It looks at the top level of each
 * top-level function (two-space indent), which is where both the returns
 * and the hooks of a component live in this codebase.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** "file:line  hook" for each hook called after an early return in the same function. */
export function hooksAfterReturn(source: string): string[] {
  const lines = source.split("\n");
  const found: string[] = [];
  let inside = false;
  let returnedAt = 0;
  lines.forEach((line, i) => {
    if (/^(export (default )?)?function [A-Za-z0-9_]+/.test(line)) {
      inside = true;
      returnedAt = 0;
      return;
    }
    if (line.startsWith("}")) {
      inside = false;
      return;
    }
    if (!inside) return;
    const returns =
      /^ {2}(if \(.*\) return\b|return\b)/.test(line) ||
      (/^ {2}if \(/.test(line) && /^ {4}return\b/.test(lines[i + 1] ?? ""));
    if (returns && returnedAt === 0) returnedAt = i + 1;
    if (returnedAt > 0 && /^ {2}(const [^=]+= )?use[A-Z]\w*\(/.test(line)) {
      found.push(`line ${i + 1}, after the return on line ${returnedAt}: ${line.trim()}`);
    }
  });
  return found;
}

describe("hooks come before any early return", () => {
  it("finds the mistake that blacked out the app", () => {
    const shape = [
      "export default function App() {",
      "  const [screen] = useState(0);",
      "  if (!signedIn) {",
      "    return <SignIn />;",
      "  }",
      "  useScreenHistory(screen, go);",
      "  return <main />;",
      "}",
    ].join("\n");
    expect(hooksAfterReturn(shape)).toHaveLength(1);
  });

  it("holds in every file", () => {
    const found = sourceFiles(SRC).flatMap((file) =>
      hooksAfterReturn(readFileSync(file, "utf8")).map((where) => `${relative(SRC, file)} ${where}`),
    );
    expect(found).toEqual([]);
  });
});
