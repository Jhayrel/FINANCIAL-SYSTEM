import { describe, expect, it } from "vitest";

import { checkFile, formatBytes, LIMITS, totalBytes } from "./attachments";

const file = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: "receipt.jpg",
  type: "image/jpeg",
  size: 500_000,
  ...over,
});

describe("checkFile", () => {
  it("accepts the three picture formats", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(checkFile(file({ type }), 0).ok).toBe(true);
    }
  });

  it("accepts a CSV even when the browser reports no type", () => {
    expect(checkFile(file({ name: "august.csv", type: "" }), 0).ok).toBe(true);
    expect(checkFile(file({ name: "notes.txt", type: "" }), 0).ok).toBe(true);
  });

  it("refuses a format it cannot read, and says which it can", () => {
    const result = checkFile(file({ name: "statement.pdf", type: "application/pdf" }), 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("JPEG");
  });

  it("refuses a file over the size cap, naming the size and the limit", () => {
    const result = checkFile(file({ size: 6_200_000 }), 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("5.9 MB");
      expect(result.reason).toContain("4.0 MB");
      expect(result.reason).toContain("not sent");
    }
  });

  it("accepts a file exactly on the cap", () => {
    expect(checkFile(file({ size: LIMITS.maxBytes }), 0).ok).toBe(true);
  });

  it("refuses more than the per-message count, and says what to do", () => {
    expect(checkFile(file(), LIMITS.maxCount - 1).ok).toBe(true);
    const result = checkFile(file(), LIMITS.maxCount);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Send these");
  });

  it("refuses an empty file", () => {
    expect(checkFile(file({ size: 0 }), 0).ok).toBe(false);
  });
});

describe("formatBytes", () => {
  it("reads the way a person would write it", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1_572_864)).toBe("1.5 MB");
  });
});

describe("totalBytes", () => {
  it("adds up what will actually be sent", () => {
    expect(totalBytes([])).toBe(0);
    expect(
      totalBytes([
        { id: "1", name: "a", kind: "image", bytes: 100 },
        { id: "2", name: "b", kind: "text", bytes: 50 },
      ]),
    ).toBe(150);
  });
});

describe("checkFile honours the limits from Settings", () => {
  it("uses a smaller count when one is set", () => {
    expect(checkFile(file(), 2, { maxCount: 3 }).ok).toBe(true);
    const refused = checkFile(file(), 3, { maxCount: 3 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain("3 files");
  });

  it("uses a smaller size when one is set, and names it", () => {
    const refused = checkFile(file({ size: 2_500_000 }), 0, { maxSizeMB: 2 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain("2.0 MB");
  });

  it("falls back to the defaults when Settings says nothing", () => {
    expect(checkFile(file({ size: 3_000_000 }), 0, {}).ok).toBe(true);
    expect(checkFile(file({ size: 5_000_000 }), 0, {}).ok).toBe(false);
  });
});
