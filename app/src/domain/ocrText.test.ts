import { describe, expect, it } from "vitest";

import { binarize, readingFor, tidyReading, worthSending } from "./ocrText";

describe("the clean-up before reading", () => {
  it("turns grey text on white black, and the white around it white", () => {
    // A 40 by 40 white field with a 4 by 4 grey mark (#999) in the middle.
    const w = 40, h = 40;
    const px = new Uint8ClampedArray(w * h * 4).fill(250);
    for (let y = 18; y < 22; y += 1) for (let x = 18; x < 22; x += 1) px.set([153, 153, 153, 255], (y * w + x) * 4);
    binarize(px, w, h);
    expect(px[(20 * w + 20) * 4]).toBe(0);
    expect(px[(2 * w + 2) * 4]).toBe(255);
  });

  it("copes with a shadow across the page: paper stays white on both sides", () => {
    const w = 60, h = 20;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const paper = x < 30 ? 240 : 120; // lit half, shadowed half
      px.set([paper, paper, paper, 255], (y * w + x) * 4);
    }
    // Ink in the shadow: darker than the shadowed paper around it.
    for (let x = 44; x < 47; x += 1) px.set([40, 40, 40, 255], (10 * w + x) * 4);
    binarize(px, w, h);
    expect(px[(10 * w + 45) * 4]).toBe(0);
    expect(px[(3 * w + 50) * 4]).toBe(255);
    expect(px[(3 * w + 5) * 4]).toBe(255);
  });
});

describe("the reading, tidied", () => {
  it("writes every misread peso sign as one, and keeps the minus", () => {
    const read = "DST -P1.23\nService Fee - £149.80\nMy Wallet -$£2,000.00\nTotal PHP 500.00";
    expect(tidyReading(read)).toBe("DST -₱1.23\nService Fee - ₱149.80\nMy Wallet -₱2,000.00\nTotal ₱500.00");
  });

  it("drops blank lines and stray marks, and leaves words alone", () => {
    // The reader often returns a lone dash for a rule drawn across the screen.
    expect(tidyReading("  Transactions |\n\n-\nPay Bills  \n")).toBe("Transactions\nPay Bills");
  });
});

describe("worth sending instead of the picture", () => {
  it("a wallet screenshot is", () => {
    expect(worthSending("September 20, 2026\nFee applied 07:57 PM\nDST -₱1.23")).toBe(true);
  });

  it("a picture with no figure, or no words, is not", () => {
    expect(worthSending("sunset beach")).toBe(false);
    expect(worthSending("1.23 4.56")).toBe(false);
  });
});

describe("what the model is sent for one picture", () => {
  const wallet = "September 20, 2026\nFee applied 07:57 PM\nDST -₱1.23";

  it("both readings, labelled, with how to settle a disagreement", () => {
    const text = readingFor("maya.jpg", { plain: "DST -₱1.23\nMy Wallet -₱2,000.00", raised: wallet })!;
    expect(text).toContain("Reading 1, as photographed:\nDST -₱1.23");
    expect(text).toContain("Reading 2, contrast raised:\nSeptember 20, 2026");
    expect(text).toContain("items adding up to its total");
  });

  it("one reading when the two agree, or only one is any good", () => {
    expect(readingFor("a.jpg", { plain: wallet, raised: wallet })).not.toContain("Reading 2");
    expect(readingFor("a.jpg", { plain: "x", raised: wallet })).toContain("DST -₱1.23");
  });

  it("nothing, so the picture goes to a vision model, when neither reading has a figure", () => {
    expect(readingFor("sunset.jpg", { plain: "sunset", raised: "a b" })).toBeNull();
  });

  it("keeps each picture to its share", () => {
    const long = `${wallet}\n${"Service Fee -₱149.80\n".repeat(400)}`;
    expect(readingFor("long.jpg", { plain: long, raised: long }, 1_000)!.length).toBeLessThan(1_300);
  });
});
