import { describe, expect, it } from "vitest";

import { binarize, cutRows, darkBars, dropRepeats, invertBoxes, joinPieces, piecesOf, readingFor, rowsIn, tidyReading, worthSending } from "./ocrText";

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

describe("a tall picture, cut into pieces", () => {
  it("cuts in the empty gap between lines, never through one", () => {
    // 5,000 rows: a 40-row line of text every 100 rows, the gaps empty.
    const ink = Array.from({ length: 5000 }, (_, y) => (y % 100 < 40 ? 300 : 0));
    const cuts = cutRows(ink, 1600, 240);
    expect(cuts[0]).toBe(0);
    expect(cuts.at(-1)).toBe(5000);
    for (const y of cuts.slice(1, -1)) expect(ink[y]).toBe(0);
    for (let i = 1; i < cuts.length; i += 1) expect(cuts[i]! - cuts[i - 1]!).toBeLessThanOrEqual(1600);
  });

  it("leaves a picture that already fits alone", () => {
    expect(cutRows(Array(1200).fill(0), 1600)).toEqual([0, 1200]);
  });

  it("joins the pieces in order, without a line read twice at a cut", () => {
    expect(joinPieces(["September 20, 2026\nDST -₱1.23", "DST -₱1.23\nService Fee -₱149.80"])).toBe(
      "September 20, 2026\nDST -₱1.23\nService Fee -₱149.80",
    );
  });
});

describe("the dark date pills", () => {
  // A 400 by 120 white page with a black pill across the middle rows 40 to 80, white letters in it.
  const w = 400, h = 120;
  const page = (): Uint8ClampedArray => {
    const px = new Uint8ClampedArray(w * h * 4).fill(250);
    for (let y = 40; y < 80; y += 1) for (let x = 120; x < 280; x += 1) px.set([10, 10, 10, 255], (y * w + x) * 4);
    for (let y = 50; y < 70; y += 1) for (let x = 130; x < 270; x += 6) px.set([250, 250, 250, 255], (y * w + x) * 4);
    // A line of ordinary dark text lower down: wide, but mostly gaps.
    for (let x = 20; x < 380; x += 9) px.set([20, 20, 20, 255], (100 * w + x) * 4);
    return px;
  };

  it("finds the pill, and not the line of text", () => {
    const bars = darkBars(page(), w, h);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ top: 40, left: 120, right: 279 });
  });

  it("turns it dark-on-light, leaving the rest of the page alone", () => {
    const px = page();
    invertBoxes(px, w, darkBars(px, w, h));
    expect(px[(45 * w + 200) * 4]).toBe(245); // the pill's black, now light
    expect(px[(60 * w + 130) * 4]).toBe(5); // a white letter, now dark
    expect(px[(10 * w + 10) * 4]).toBe(250); // the page, untouched
  });
});

describe("piecesOf: a long list in parts", () => {
  const day = (date: string, rows: number, start: number): string[] => [
    date,
    ...Array.from({ length: rows }, (_, i) => [`Purchased on 0${(start + i) % 10}:15 PM`, `Shop ${start + i} - ₱${start + i}.00`]).flat(),
  ];

  it("leaves a short list whole", () => {
    const text = day("September 24, 2026", 6, 1).join("\n");
    expect(piecesOf(text)).toEqual([text]);
  });

  it("keeps every row, in order, once", () => {
    const text = ["- Transactions", ...day("September 24, 2026", 5, 1), ...day("September 23, 2026", 7, 10), ...day("September 21, 2026", 9, 20)].join("\n");
    const parts = piecesOf(text, 8);
    expect(parts.length).toBeGreaterThan(1);
    const shops = parts.flatMap((p) => p.split("\n").filter((l) => l.startsWith("Shop")));
    expect(shops).toEqual(text.split("\n").filter((l) => l.startsWith("Shop")));
    for (const p of parts) expect(rowsIn(p)).toBeLessThanOrEqual(8);
  });

  it("cuts at a date line when one is near", () => {
    const text = [...day("September 24, 2026", 5, 1), ...day("September 23, 2026", 5, 10), ...day("September 22, 2026", 5, 20)].join("\n");
    const parts = piecesOf(text, 8);
    expect(parts[1]?.split("\n")[0]).toBe("September 23, 2026");
  });

  it("dates a part that starts in the middle of a day", () => {
    const text = day("September 24, 2026", 20, 1).join("\n");
    const parts = piecesOf(text, 8);
    expect(parts.length).toBe(3);
    for (const p of parts) expect(p.split("\n")[0]).toBe("September 24, 2026");
  });
});

describe("dropRepeats: a stitched screenshot read once", () => {
  // The shape of the owner's Maya capture: 13, 12 and 11 September shown twice.
  const overlap = [
    "September 13, 2026",
    "Received money from 08:49 PM",
    "Maya ₱4.25",
    "Purchased (Updated) on 08:36 PM",
    "JOLLIBEE JB0892 -₱425.00",
    "September 12, 2026",
    "Purchased on 09:15 PM",
    "Globe - ₱999.00",
    "September 11, 2026",
    "September 13, 2026",
    "Maya ₱4.25",
    "Purchased (Updated) on 08:36 PM",
    "JOLLIBEE JB0892 - ₱425.00",
    "September 12, 2026",
    "Purchased on 09:15 PM",
    "Globe - ₱999.00",
    "September 11, 2026",
    "Purchased on 12:28 PM",
    "Globe - ₱50.00",
  ].join("\n");

  it("keeps each row once, and the rows only it has", () => {
    const { text, dropped } = dropRepeats(overlap);
    expect(dropped).toBe(3);
    expect(text.match(/4\.25/g)).toHaveLength(1);
    expect(text.match(/JOLLIBEE/g)).toHaveLength(1);
    expect(text.match(/999\.00/g)).toHaveLength(1);
    expect(text).toContain("Globe - ₱50.00");
    // The Globe 50 still sits under 11 September.
    const lines = text.split("\n");
    const at = lines.indexOf("Globe - ₱50.00");
    expect(lines.slice(0, at).reverse().find((l) => /September/.test(l))).toBe("September 11, 2026");
  });

  it("keeps two payments that differ only in their time", () => {
    const twice = [
      "September 20, 2026",
      "Withdrawal from 07:31 PM",
      "TANQUI SFLU - ₱1,018.00",
      "Withdrawal from 06:48 PM",
      "TANQUI SFLU - ₱1,018.00",
    ].join("\n");
    expect(dropRepeats(twice).dropped).toBe(0);
  });

  it("keeps the same row on two different days", () => {
    const days = ["September 20, 2026", "Withdrawal from 07:31 PM", "TANQUI SFLU - ₱1,018.00", "September 18, 2026", "Withdrawal from 07:31 PM", "TANQUI SFLU - ₱1,018.00"].join("\n");
    expect(dropRepeats(days).dropped).toBe(0);
  });
});
