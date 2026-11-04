/**
 * A file finished after the tap that asked for it waits for one more tap
 * instead of being blocked silently (`download.ts`; owner, 4 November 2026:
 * "For some reason I cannot download backup").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dropWaitingFile, onWaitingFile, saveFile, saveWaitingFile, type WaitingFile } from "./download";

let clicks: string[] = [];
let active: boolean | undefined = true;

beforeEach(() => {
  clicks = [];
  active = true;
  vi.stubGlobal("navigator", {
    get userActivation() {
      return active === undefined ? undefined : { isActive: active, hasBeenActive: true };
    },
  });
  vi.stubGlobal("document", {
    createElement: () => {
      const a = { href: "", download: "", click: () => clicks.push(a.download), remove: () => undefined };
      return a;
    },
    body: { appendChild: () => undefined },
  });
  vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
});
afterEach(() => {
  dropWaitingFile();
  vi.unstubAllGlobals();
});

describe("saveFile", () => {
  it("saves at once while the tap still counts, and where the browser cannot say", () => {
    expect(saveFile("a.pdf", "x", "application/pdf")).toBe("saved");
    active = undefined;
    expect(saveFile("b.pdf", "x", "application/pdf")).toBe("saved");
    expect(clicks).toEqual(["a.pdf", "b.pdf"]);
  });

  it("after the tap has gone: kept, said, and saved by the next tap", () => {
    const seen: (WaitingFile | null)[] = [];
    const stop = onWaitingFile((f) => seen.push(f));
    active = false;
    expect(saveFile("statement.pdf", "x", "application/pdf")).toBe("waiting");
    expect(clicks).toEqual([]);
    expect(seen.at(-1)?.name).toBe("statement.pdf");
    saveWaitingFile();
    expect(clicks).toEqual(["statement.pdf"]);
    expect(seen.at(-1)).toBeNull();
    stop();
  });

  it("dismissed, nothing is saved", () => {
    active = false;
    saveFile("c.pdf", "x", "application/pdf");
    dropWaitingFile();
    saveWaitingFile();
    expect(clicks).toEqual([]);
  });
});
