import { describe, expect, it } from "vitest";

import { bundleOf } from "./updateCheck";

describe("which bundle a page points at", () => {
  it("finds the hashed entry script in a built page", () => {
    const html = `<!doctype html><html><head>
      <script type="module" crossorigin src="/assets/index-BIUM2Q8U.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/vendor-BQU1gLX-.js">
      <link rel="stylesheet" crossorigin href="/assets/index-LB5nY7-W.css">
    </head><body><div id="root"></div></body></html>`;
    expect(bundleOf(html)).toBe("/assets/index-BIUM2Q8U.js");
  });

  it("tells two builds apart", () => {
    expect(bundleOf('<script src="/assets/index-xkEPT5rq.js">')).not.toBe(
      bundleOf('<script src="/assets/index-BIUM2Q8U.js">'),
    );
  });

  it("finds nothing on the dev server's page, so it never nags there", () => {
    expect(bundleOf('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
  });

  it("does not mistake the stylesheet for the script", () => {
    expect(bundleOf('<link rel="stylesheet" href="/assets/index-LB5nY7-W.css">')).toBeNull();
  });
});

/**
 * 27 September 2026, 06:04: a phone tab left open overnight was still
 * running the bundle from before a layout fix.
 */
describe("loading a new version on coming back", () => {
  it("does, after a minute away with nothing in progress", async () => {
    const { reloadOnReturn } = await import("./updateCheck");
    expect(reloadOnReturn(8 * 60 * 60 * 1000, 0)).toBe(true);
    expect(reloadOnReturn(60 * 1000, 0)).toBe(true);
  });

  it("does not, after a glance away, or with pictures attached or an answer on its way", async () => {
    const { reloadOnReturn } = await import("./updateCheck");
    expect(reloadOnReturn(5 * 1000, 0)).toBe(false);
    expect(reloadOnReturn(8 * 60 * 60 * 1000, 1)).toBe(false);
  });
});
