/**
 * How far a photo's print is tilted (`ocrText.ts`, `skewAngle`).
 *
 * A 7-Eleven receipt photographed on granite, 29 September 2026, tilted
 * about ten degrees, lost its item, its total and its date to the reader.
 * The photo is straightened first; these pin the measure on drawn pictures:
 * level print, tilted print, and tilted print on a speckled background.
 */

import { describe, expect, it } from "vitest";

import { skewAngle } from "./ocrText";

const W = 400;
const H = 500;

/** A white page of `lines` rows of dashes, like print, tilted by `degrees`, on a background. */
function page(degrees: number, speckle = false): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  const t = (degrees * Math.PI) / 180;
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      // The page, in its own level coordinates.
      const u = (x - W / 2) * Math.cos(t) + (y - H / 2) * Math.sin(t) + W / 2;
      const v = -(x - W / 2) * Math.sin(t) + (y - H / 2) * Math.cos(t) + H / 2;
      const onPage = u > 100 && u < 300 && v > 40 && v < 460;
      let lum: number;
      if (onPage) {
        // Rows of print 5 pixels tall every 16, broken into words.
        const inRow = Math.floor(v) % 16 < 5;
        const inWord = Math.floor(u / 6) % 5 !== 4;
        lum = inRow && inWord && Math.floor(u) % 3 !== 0 ? 20 : 235;
      } else {
        lum = speckle ? (rand() < 0.45 ? 40 : 170) : 120;
      }
      const i = (y * W + x) * 4;
      px[i] = lum;
      px[i + 1] = lum;
      px[i + 2] = lum;
      px[i + 3] = 255;
    }
  }
  return px;
}

describe("the tilt of a photo's print", () => {
  it("is nothing for level print", () => {
    expect(Math.abs(skewAngle(page(0), W, H))).toBeLessThanOrEqual(0.5);
  });

  it.each([6, -4, 10])("finds a tilt of %i degrees", (degrees) => {
    expect(Math.abs(skewAngle(page(degrees), W, H) - degrees)).toBeLessThanOrEqual(1);
  });

  it("is not thrown by a speckled background", () => {
    expect(Math.abs(skewAngle(page(9, true), W, H) - 9)).toBeLessThanOrEqual(1);
  });

  it("is nothing for a blank picture", () => {
    const blank = new Uint8ClampedArray(W * H * 4).fill(255);
    expect(skewAngle(blank, W, H)).toBe(0);
  });
});
