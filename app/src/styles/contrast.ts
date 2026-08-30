/**
 * WCAG contrast maths, and a parser for tokens.css.
 *
 * Spec 6.3: "Every flow colour must clear 4.5:1 on its own wash in both
 * themes. Test it, don't assume it." This module is what makes that testable
 * rather than aspirational.
 */

import { readFileSync } from "node:fs";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;

  if (!/^[0-9a-f]{6}$/i.test(full)) {
    throw new Error(`Not a hex colour: "${hex}"`);
  }

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** Relative luminance, per WCAG 2.1. */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two hex colours. 1 (identical) to 21 (black/white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(parseHex(a));
  const lb = luminance(parseHex(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const ratio = (a: string, b: string): number =>
  Math.round(contrastRatio(a, b) * 100) / 100;

// ── Token extraction ───────────────────────────────────────────────────────

export type TokenMap = Record<string, string>;

/**
 * Remove `/* … *\/` comments.
 *
 * Essential, not cosmetic: tokens.css documents `.theme-dark` in its header
 * comment, and matching that occurrence made the parser read the light block
 * as the dark one: every dark value silently fell back to its light value.
 * Strip first, then parse.
 */
export function stripComments(css: string): string {
  // Replace with a space so token boundaries survive.
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Pull the custom properties out of one CSS block by selector.
 *
 * Deliberately simple: tokens.css is flat, hand-written, and the only file
 * this runs against. A full CSS parser would be more machinery than the job
 * needs, but the brace matching below is exact so a nested block cannot
 * silently swallow the wrong declarations.
 */
export function extractTokens(rawCss: string, selector: string): TokenMap {
  const css = stripComments(rawCss);
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Selector not found in tokens.css: ${selector}`);

  const open = css.indexOf("{", start);
  if (open === -1) throw new Error(`No block for selector: ${selector}`);

  let depth = 0;
  let end = -1;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`Unclosed block for selector: ${selector}`);

  const body = css.slice(open + 1, end);
  const tokens: TokenMap = {};

  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name && value) tokens[name] = value.trim();
  }

  return tokens;
}

/**
 * Light and dark token maps.
 *
 * Dark inherits from light: `.theme-dark` only overrides what changes, which
 * is exactly how the single-block design works.
 */
export function loadThemes(tokensPath: string): { light: TokenMap; dark: TokenMap } {
  const css = readFileSync(tokensPath, "utf-8");
  const light = extractTokens(css, ":root");
  const darkOverrides = extractTokens(css, ".theme-dark");
  return { light, dark: { ...light, ...darkOverrides } };
}

/** Resolve a token to a hex string, following one level of var() aliasing. */
export function resolve(tokens: TokenMap, name: string): string {
  const raw = tokens[name];
  if (!raw) throw new Error(`Token not defined: ${name}`);

  const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(raw);
  if (alias?.[1]) return resolve(tokens, alias[1]);

  if (!raw.startsWith("#")) {
    throw new Error(`Token ${name} is not a hex colour: "${raw}"`);
  }
  return raw;
}
