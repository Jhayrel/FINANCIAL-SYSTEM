/**
 * Reading a picture on the device: the clean-up before, and the tidy-up after.
 *
 * ── Why the device reads the picture at all ────────────────────────────────
 *
 * Every picture used to go to a free vision model. On 26 September 2026 the
 * owner's Maya screenshots came back "nothing readable" from a model that
 * could not see, then "Every model in the chain failed": two of the three
 * vision models left were rate limited and the third timed out. Free vision
 * models are few, slow and rationed, and a screenshot of a wallet app is
 * mostly clean printed text. So the device reads the text itself, in under a
 * second, and the fast text models turn the text into entries. The picture
 * goes to a vision model only when the device finds too little in it.
 *
 * Pure functions on pixels and strings, so they are tested without a browser
 * (`data/ocr.ts` does the drawing and runs the reader).
 */

/**
 * Black text on white, whatever the picture looked like.
 *
 * An adaptive threshold (Bradley and Roth): each pixel is compared with the
 * average brightness around it rather than with one fixed cut. On a wallet
 * screenshot that turns the grey labels ("Fee applied", the times) black,
 * which a plain reading missed, and on a photo of a receipt it copes with a
 * shadow across half the paper, which a fixed cut turns into a black block.
 * White text on a dark pill stays white on black, which the reader inverts
 * by itself.
 *
 * In place, on RGBA bytes as a canvas holds them.
 */
export function binarize(rgba: Uint8ClampedArray, width: number, height: number): void {
  const n = width * height;
  const lum = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    lum[i] = 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!;
  }

  // Sums over any rectangle in constant time.
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let row = 0;
    for (let x = 1; x <= width; x += 1) {
      row += lum[(y - 1) * width + (x - 1)]!;
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x]! + row;
    }
  }

  // An eighth of the narrow side: wider than a letter, narrower than a row of them.
  const half = Math.max(8, Math.round(Math.min(width, height) / 16));
  const darker = 0.15;

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(height, y + half + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(width, x + half + 1);
      const area = (x1 - x0) * (y1 - y0);
      const sum =
        integral[y1 * (width + 1) + x1]! -
        integral[y0 * (width + 1) + x1]! -
        integral[y1 * (width + 1) + x0]! +
        integral[y0 * (width + 1) + x0]!;
      const i = y * width + x;
      const value = lum[i]! * area < sum * (1 - darker) ? 0 : 255;
      rgba[i * 4] = value;
      rgba[i * 4 + 1] = value;
      rgba[i * 4 + 2] = value;
      rgba[i * 4 + 3] = 255;
    }
  }
}

/**
 * The reading, tidied for the model.
 *
 * The peso sign is not in the reader's alphabet, so it comes back as P, $,
 * £, € or two of them ("-$£2,000.00" off a Maya screenshot). Every amount in
 * this app is pesos, so a currency mark straight before a figure is written
 * as one. Blank lines and stray edges go.
 */
export function tidyReading(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/(^|[\s(:-])(?:PHP|Php|php|[P£$€¥₱]{1,2})\s?(?=\d)/g, "$1₱")
        .replace(/[|¦]/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim(),
    )
    .filter((line) => line.length > 1 && /[A-Za-z0-9]/.test(line))
    .join("\n");
}

/**
 * Enough in the reading to be worth sending instead of the picture.
 *
 * An amount, and some words around it. A photo of a sunset reads as a few
 * stray letters, and a receipt the reader could not make out reads as no
 * figure at all: both go to a vision model instead.
 */
export function worthSending(text: string): boolean {
  const amounts = text.match(/\d[\d,]*\.\d{2}\b|\d{1,3}(?:,\d{3})+\b/g) ?? [];
  const words = text.match(/[A-Za-z]{3,}/g) ?? [];
  return amounts.length >= 1 && words.length >= 2;
}

/**
 * Both readings of one picture, written for the model, or null when neither
 * is worth sending and the picture should go to a vision model instead.
 *
 * `room` is this picture's share of what one request may carry, so five
 * screenshots in one message all arrive rather than the first two.
 */
export function readingFor(name: string, reading: { readonly plain: string; readonly raised: string }, room = 5_000): string | null {
  const plain = worthSending(reading.plain) ? reading.plain : "";
  const raised = worthSending(reading.raised) ? reading.raised : "";
  if (!plain && !raised) return null;

  const head = `Read on this device from the picture ${name}. A peso sign may have been misread, and every amount is in Philippine pesos.`;
  if (!plain || !raised || plain === raised) {
    return `${head}\n${(plain || raised).slice(0, room)}`;
  }
  const each = Math.floor(room / 2);
  return [
    `${head} It was read twice, and the two readings can differ where a character was hard to make out. Where they disagree about a figure, use the one that agrees with the rest of the picture, such as items adding up to its total, and set confidence to low when neither does. A line in one reading and not the other is still in the picture.`,
    "Reading 1, as photographed:",
    plain.slice(0, each),
    "Reading 2, contrast raised:",
    raised.slice(0, each),
  ].join("\n");
}
