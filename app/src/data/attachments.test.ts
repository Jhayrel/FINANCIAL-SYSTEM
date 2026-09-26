import { describe, expect, it } from "vitest";

import { checkFile, digestOf, formatBytes, LIMITS, totalBytes } from "./attachments";

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

  /*
   * The owner's 4.6 to 4.9 MB phone photos were refused against a 4.0 MB
   * limit (26 September 2026), though every one would have been shrunk to
   * about 1.5 MB before it was sent, and nothing is stored. The limit is on
   * what is sent, after shrinking, so no original size is refused here.
   */
  it("accepts a photo of any size, since it is shrunk before it is sent", () => {
    expect(checkFile(file({ size: 4_900_000 }), 0).ok).toBe(true);
    expect(checkFile(file({ size: 48_000_000 }), 0).ok).toBe(true);
    expect(checkFile(file({ size: 48_000_000 }), 0, { maxSizeMB: 1 }).ok).toBe(true);
  });

  it("accepts a text file of any size, since only its beginning is read", () => {
    expect(checkFile(file({ name: "a-year.csv", type: "text/csv", size: 90_000_000 }), 0).ok).toBe(true);
  });

  it("keeps five pictures together under what the endpoint takes", () => {
    // functions/api/ai.ts takes 6,000,000 characters of base64, four for every three bytes.
    expect(Math.ceil((LIMITS.totalBytes * 4) / 3)).toBeLessThan(6_000_000);
    expect(LIMITS.targetBytes).toBeLessThanOrEqual(LIMITS.totalBytes);
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

  /*
   * The size in Settings caps what is sent, once shrunk (`readFiles`), not
   * what is picked: a photo bigger than it is shrunk to fit it rather than
   * refused (owner, 26 September 2026: "just allow all file sizes").
   */
  it("does not refuse a photo for being bigger than the size set", () => {
    expect(checkFile(file({ size: 2_500_000 }), 0, { maxSizeMB: 2 }).ok).toBe(true);
    expect(checkFile(file({ size: 5_000_000 }), 0, {}).ok).toBe(true);
  });
});

/**
 * The same picture, attached twice.
 *
 * The owner's history has one message carrying three byte-identical copies of
 * the same screenshot, every one of them read separately and turned into an
 * identical card. Names cannot tell them apart: all three were `image.png`,
 * and so was a fourth that was a different picture entirely.
 */
describe("digestOf", () => {
  it("gives the same fingerprint to the same content", () => {
    expect(digestOf("data:image/png;base64,AAAB")).toBe(digestOf("data:image/png;base64,AAAB"));
  });

  it("gives a different one to different content of the same length", () => {
    expect(digestOf("data:image/png;base64,AAAB")).not.toBe(
      digestOf("data:image/png;base64,AAAC"),
    );
  });

  it("separates content that differs only at the far end", () => {
    const long = "x".repeat(50_000);
    expect(digestOf(`${long}a`)).not.toBe(digestOf(`${long}b`));
  });

  it("separates content that differs only in length", () => {
    expect(digestOf("abc")).not.toBe(digestOf("abcabc"));
  });

  it("has nothing to say about an empty file beyond it being empty", () => {
    expect(digestOf("")).toBe(digestOf(""));
  });
});
