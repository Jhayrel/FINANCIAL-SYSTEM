/**
 * Reading the text in a picture, on this device.
 *
 * Step one of three, in the owner's own order (26 September 2026): read it,
 * then the AI analyses it, then the system checks it. The reading used to be
 * a free vision model's job, and those are few, slow and rationed: the last
 * screenshots came back "nothing readable", then "Every model in the chain
 * failed" with two of three rate limited. Reading here takes under a second
 * on a laptop and a few on a phone, costs nothing, and the picture never
 * leaves the device when this works.
 *
 * Two readings of each picture, side by side, and both go to the model:
 *
 *   as it is          right on dark print, but misses grey labels and the
 *                     dates on a wallet app's dark pills
 *   contrast raised   catches those, but once read a receipt total of 219.00
 *                     as 219.60 under a shadow
 *
 * Neither is safe alone. Together, the model sees where they disagree and
 * can check a figure against the others (items adding up to the total).
 *
 * The engine and its English data are served from this site (see
 * `tools/ocrAssets.ts`), loaded the first time a picture is attached, and
 * kept by the browser after that.
 */

import type { Scheduler } from "tesseract.js";

import { binarize, cutRows, darkBars, invertBoxes, joinPieces, tidyReading } from "../domain/ocrText";

/** Kept in step with `OCR_BASE` in tools/ocrAssets.ts, which serves the files. */
const BASE = "/ocr/v7";

let starting: Promise<Scheduler> | null = null;

async function start(): Promise<Scheduler> {
  const { createScheduler, createWorker, OEM, PSM } = await import("tesseract.js");
  const scheduler = createScheduler();
  // Two readers work side by side where the device has the cores for it, one otherwise.
  const count = (typeof navigator !== "undefined" ? navigator.hardwareConcurrency ?? 2 : 2) >= 4 ? 2 : 1;
  const workers = await Promise.all(
    Array.from({ length: count }, () =>
      createWorker("eng", OEM.LSTM_ONLY, {
        workerPath: `${BASE}/worker.min.js`,
        corePath: `${BASE}/core`,
        langPath: `${BASE}/lang`,
        gzip: true,
      }),
    ),
  );
  for (const worker of workers) {
    /*
     * One column of lines of any size, read top to bottom. The automatic
     * layout split a wallet screen into two columns, every label and then
     * every amount, and the model could not pair them back up.
     */
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN, preserve_interword_spaces: "1" });
    scheduler.addWorker(worker);
  }
  return scheduler;
}

/** Load the reader ahead of need, so the first picture does not wait for it. */
export function warmReader(): void {
  if (starting) return;
  starting = start();
  starting.catch(() => {
    // A failed load is tried again next time rather than remembered.
    starting = null;
  });
}

const drawn = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("not an image"));
    image.src = src;
  });

type Reading = { readonly plain: string; readonly raised: string };

/**
 * Readings already made, by picture.
 *
 * A picture is read the moment it is attached, while the owner is still
 * typing, so pressing Send finds the reading done. The same picture sent
 * twice is read once.
 */
const readings = new Map<string, Promise<Reading | null>>();

function remember(key: string, reading: Promise<Reading | null>): Promise<Reading | null> {
  readings.set(key, reading);
  // A failed reading is not kept, so the next try reads again.
  void reading.then((r) => {
    if (!r) readings.delete(key);
  });
  // A handful is plenty: one message carries five at most.
  if (readings.size > 10) {
    const oldest = readings.keys().next().value;
    if (oldest !== undefined) readings.delete(oldest);
  }
  return reading;
}

/**
 * Read a picture from the file as it arrived, before it is shrunk to be sent.
 *
 * A stitched wallet history seven screens tall is shrunk to 1,568 pixels on
 * its long side, about 230 wide, where no letter is legible. The original is
 * read instead, and `readPicture` finds the reading under the same key.
 */
export function readOriginal(key: string, file: Blob): Promise<Reading | null> {
  const known = readings.get(key);
  if (known) return known;
  const url = URL.createObjectURL(file);
  const reading = readOnce(url);
  void reading.finally(() => URL.revokeObjectURL(url));
  return remember(key, reading);
}

/** The text in one picture, both readings, tidied; null when nothing could be read. */
export function readPicture(dataUrl: string, key?: string): Promise<Reading | null> {
  const known = (key ? readings.get(key) : undefined) ?? readings.get(dataUrl);
  if (known) return known;
  return remember(key ?? dataUrl, readOnce(dataUrl));
}

/**
 * Wide enough for the reader, narrow enough to be quick: a phone screenshot
 * as it is, and a photo large enough for a receipt's small print.
 *
 * It was 1,240. The owner's receipt photo of 28 September 2026 read at that
 * width turned 97.32 into 91.32 and lost the subtotal; at 1,600 every figure
 * on it was right, for about the same time (1.1 against 1.1 seconds on a
 * laptop, measured). A screenshot is narrower than either and is never
 * enlarged, so only photos read differently.
 */
const MAX_WIDTH = 1600;
/** The height of one piece: about one screen of a phone's history. */
const PIECE = 1600;
/** Taller than this many widths is a screenshot or a scroll capture, and is read in pieces. */
const TALL = 1.9;

async function readOnce(src: string): Promise<Reading | null> {
  let limitMs = 12_000;
  const work = (async () => {
    warmReader();
    const image = await drawn(src);
    const natural = image.naturalWidth || image.width;
    const scale = natural > MAX_WIDTH ? MAX_WIDTH / natural : 1;
    const width = Math.max(1, Math.round(natural * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));

    const whole = document.createElement("canvas");
    whole.width = width;
    whole.height = height;
    const all = whole.getContext("2d", { willReadFrequently: true });
    if (!all) return null;
    all.drawImage(image, 0, 0, width, height);

    // White-on-black date pills turned dark-on-light, so the date is read in its place (domain/ocrText.ts).
    const pixels = all.getImageData(0, 0, width, height);
    invertBoxes(pixels.data, width, darkBars(pixels.data, width, height));
    all.putImageData(pixels, 0, 0);

    // Where to cut: the emptiest row near each screen's worth.
    let cuts = [0, height];
    /*
     * Only a picture much taller than it is wide is cut: a phone screenshot
     * or a stitched history. A camera photo of a receipt is at most 16:9, and
     * cut in two it lost every figure between SUBTOTAL and CHANGE, because
     * the cut went through them (28 September 2026). Whole, it read right.
     */
    if (height > PIECE && height > width * TALL) {
      const px = pixels.data;
      const ink: number[] = new Array(height);
      for (let y = 0; y < height; y += 1) {
        const row = y * width * 4;
        const bg = 0.299 * px[row]! + 0.587 * px[row + 1]! + 0.114 * px[row + 2]!;
        let count = 0;
        for (let x = 0; x < width; x += 2) {
          const i = row + x * 4;
          if (Math.abs(0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]! - bg) > 40) count += 1;
        }
        ink[y] = count;
      }
      cuts = cutRows(ink, PIECE);
    }
    const pieces = cuts.length - 1;
    // A long history gets more time, and only the reading that caught every line on a wallet screen.
    limitMs = 10_000 + pieces * 3_500;
    const both = pieces <= 2;

    const scheduler = await starting;
    if (!scheduler) return null;

    const jobs = [];
    for (let i = 0; i < pieces; i += 1) {
      const top = cuts[i]!;
      const tall = cuts[i + 1]! - top;
      const piece = (raise: boolean): HTMLCanvasElement => {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = tall;
        const ctx = c.getContext("2d", { willReadFrequently: raise });
        if (!ctx) return c;
        ctx.drawImage(whole, 0, top, width, tall, 0, 0, width, tall);
        if (raise) {
          const pixels = ctx.getImageData(0, 0, width, tall);
          binarize(pixels.data, width, tall);
          ctx.putImageData(pixels, 0, 0);
        }
        return c;
      };
      jobs.push(Promise.all([
        both ? scheduler.addJob("recognize", piece(false)).then((r) => r.data.text) : Promise.resolve(""),
        scheduler.addJob("recognize", piece(true)).then((r) => r.data.text),
      ]));
    }
    const read = await Promise.all(jobs);
    return {
      plain: both ? tidyReading(joinPieces(read.map(([p]) => tidyReading(p)))) : "",
      raised: tidyReading(joinPieces(read.map(([, r]) => tidyReading(r)))),
    };
  })();

  // The limit is read when it fires, so a long picture's larger allowance counts.
  const begun = Date.now();
  const timeout = new Promise<null>((resolve) => {
    const check = (): void => {
      setTimeout(() => (Date.now() - begun >= limitMs ? resolve(null) : check()), 1_000);
    };
    check();
  });
  try {
    return await Promise.race([work, timeout]);
  } catch {
    return null;
  }
}
