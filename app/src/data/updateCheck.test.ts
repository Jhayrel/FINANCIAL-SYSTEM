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
