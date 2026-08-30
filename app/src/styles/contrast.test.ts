/**
 * The Phase 1 gate.
 *
 * Spec 6.3: "Every flow colour must clear 4.5:1 on its own wash in both
 * themes. Test it, don't assume it." This file is that test.
 *
 * It also enforces rule T1: hex literals appear only in tokens.css, by
 * scanning the rest of the source tree.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadThemes, ratio, resolve, stripComments, type TokenMap } from "./contrast";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(HERE, "tokens.css");
const SRC = join(HERE, "..");

const { light, dark } = loadThemes(TOKENS);
const themes: [string, TokenMap][] = [
  ["light", light],
  ["dark", dark],
];

const AA = 4.5;
const AA_LARGE = 3.0;

const FLOWS = ["revenue", "spending", "transfer", "debt"] as const;

describe("flow colours clear 4.5:1 on their own wash", () => {
  for (const [name, tokens] of themes) {
    describe(name, () => {
      for (const flow of FLOWS) {
        it(`${flow} text on ${flow} wash`, () => {
          const text = resolve(tokens, `--flow-${flow}-text`);
          const bg = resolve(tokens, `--flow-${flow}-bg`);
          const r = ratio(text, bg);
          expect(r, `${text} on ${bg} = ${r}:1`).toBeGreaterThanOrEqual(AA);
        });

        it(`${flow} rail is visible against the surface`, () => {
          // The rail is a 3px graphical object, so the 3:1 non-text floor
          // applies rather than the 4.5:1 text floor.
          const rail = resolve(tokens, `--flow-${flow}`);
          const surface = resolve(tokens, "--surface");
          const r = ratio(rail, surface);
          expect(r, `${rail} on ${surface} = ${r}:1`).toBeGreaterThanOrEqual(AA_LARGE);
        });
      }
    });
  }
});

describe("status colours clear 4.5:1 on their own background", () => {
  const STATUSES = ["ok", "over", "warn", "info", "none"] as const;

  for (const [name, tokens] of themes) {
    for (const status of STATUSES) {
      it(`${name}: --${status} on --${status}-bg`, () => {
        const fg = resolve(tokens, `--${status}`);
        const bg = resolve(tokens, `--${status}-bg`);
        const r = ratio(fg, bg);
        expect(r, `${fg} on ${bg} = ${r}:1`).toBeGreaterThanOrEqual(AA);
      });
    }
  }
});

describe("ink clears its documented floors", () => {
  for (const [name, tokens] of themes) {
    const surface = resolve(tokens, "--surface");
    const paper = resolve(tokens, "--paper");

    it(`${name}: --ink on --surface is AAA (7:1)`, () => {
      expect(ratio(resolve(tokens, "--ink"), surface)).toBeGreaterThanOrEqual(7);
    });

    it(`${name}: --ink-2 on --surface is AAA (7:1)`, () => {
      expect(ratio(resolve(tokens, "--ink-2"), surface)).toBeGreaterThanOrEqual(7);
    });

    it(`${name}: --ink-3 is AA on every background it appears on`, () => {
      // ink-3 carries the ₱ symbol, captions and placeholders, all text, so
      // the 4.5:1 floor applies on the surface, the paper canvas AND sunk
      // zebra rows. --surface-sunk is the tightest of the three.
      for (const bg of ["--surface", "--paper", "--surface-sunk"]) {
        const r = ratio(resolve(tokens, "--ink-3"), resolve(tokens, bg));
        expect(r, `--ink-3 on ${bg} = ${r}:1`).toBeGreaterThanOrEqual(AA);
      }
    });

    it(`${name}: --ink on --paper is AAA (7:1)`, () => {
      expect(ratio(resolve(tokens, "--ink"), paper)).toBeGreaterThanOrEqual(7);
    });

    it(`${name}: --ink on --surface-sunk is AAA (7:1)`, () => {
      // Zebra rows and table footers.
      expect(
        ratio(resolve(tokens, "--ink"), resolve(tokens, "--surface-sunk")),
      ).toBeGreaterThanOrEqual(7);
    });
  }
});

describe("chrome", () => {
  for (const [name, tokens] of themes) {
    it(`${name}: text on the brand fill is AA`, () => {
      const r = ratio(resolve(tokens, "--on-brand"), resolve(tokens, "--brand-700"));
      expect(r, `= ${r}:1`).toBeGreaterThanOrEqual(AA);
    });

    it(`${name}: hairlines are perceptible against the surface`, () => {
      // Separation comes from hairlines and whitespace, so they must not
      // vanish, but they are decorative, not text, so the floor is low.
      const r = ratio(resolve(tokens, "--hairline"), resolve(tokens, "--surface"));
      expect(r, `= ${r}:1`).toBeGreaterThanOrEqual(1.06);
    });

    it(`${name}: the focus ring is visible on the surface`, () => {
      const r = ratio(resolve(tokens, "--focus-ring"), resolve(tokens, "--surface"));
      expect(r, `= ${r}:1`).toBeGreaterThanOrEqual(AA_LARGE);
    });
  }
});

describe("theme completeness", () => {
  it("dark overrides every colour token that needs one", () => {
    // A token whose light value is dark ink must not survive into dark mode.
    const css = stripComments(readFileSync(TOKENS, "utf-8"));
    const darkBlock = css.slice(css.indexOf(".theme-dark"));

    for (const token of [
      "--paper", "--surface", "--surface-sunk", "--hairline",
      "--ink", "--ink-2", "--ink-3",
      "--flow-revenue", "--flow-spending", "--flow-transfer", "--flow-debt",
      "--ok", "--over", "--warn", "--info", "--none",
    ]) {
      expect(darkBlock, `${token} missing from .theme-dark`).toContain(`${token}:`);
    }
  });

  it("defines exactly one dark block, so the two can never drift", () => {
    const css = stripComments(readFileSync(TOKENS, "utf-8"));
    expect(css.match(/\.theme-dark\s*\{/g) ?? []).toHaveLength(1);
    // The previous build duplicated dark values into a media query and they
    // fell out of sync. There must be no such block here.
    expect(css).not.toContain("prefers-color-scheme");
  });
});

describe("rule T1: hex literals live only in tokens.css", () => {
  it("no hex colour appears anywhere else in src/", () => {
    const offenders: string[] = [];

    /**
     * Two patterns, because a bare `#0442` in UI copy is a record number, not
     * a colour. Six and eight digit forms are unambiguous anywhere; the three
     * and four digit shorthand only counts in a CSS value position, after a
     * quote, colon or open bracket.
     *
     * Comments are stripped before the scan, so record numbers in prose
     * (#8, #190, #280) never reach here either way.
     */
    const longHex = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6})(?![0-9a-fA-F])/;
    const shortHex = /[:'"(`]\s*#[0-9a-fA-F]{3,4}(?![0-9a-fA-F])/;
    const hex = { test: (l: string) => longHex.test(l) || shortHex.test(l) };

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          // _legacy holds the pre-token screens Phase 4 rewrites. They are
          // not imported, not built, and deleted when Phase 4 lands.
          if (entry === "node_modules" || entry === "fixtures") continue;
          if (entry === "_legacy") continue;
          walk(path);
          continue;
        }
        if (path === TOKENS) continue;
        if (![".ts", ".tsx", ".css"].includes(extname(path))) continue;
        if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) continue;

        const source = stripComments(readFileSync(path, "utf-8")).replace(
          /^\s*\/\/.*$/gm,
          "",
        );

        source.split("\n").forEach((line, i) => {
          // Ignore URL fragments; we only care about colour literals.
          if (hex.test(line) && !line.includes("://")) {
            offenders.push(`${path.slice(SRC.length + 1)}:${i + 1}  ${line.trim()}`);
          }
        });
      }
    };

    walk(SRC);
    expect(offenders, `Hex literals outside tokens.css:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });
});
