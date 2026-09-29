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

import { binarize, cutRows, darkBars, invertBoxes, joinPieces, skewAngle, tidyReading } from "../domain/ocrText";

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

/** The tilt of a photo's print, measured on a small copy (`skewAngle`). */
function tiltOf(image: CanvasImageSource, width: number, height: number): number {
  const small = Math.min(1, 480 / width);
  const w = Math.max(1, Math.round(width * small));
  const h = Math.max(1, Math.round(height * small));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;
  ctx.drawImage(image, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h);
  return skewAngle(pixels.data, w, h);
}

/**
 * One reading of a picture, turned by `tilt` degrees first when it is not
 * zero, with how sure the reader was of it (0 to 100, the mean over the
 * words). `setLimit` is told how long a picture of this many pieces may take.
 */
async function readCanvas(
  image: CanvasImageSource,
  width: number,
  height: number,
  tilt: number,
  setLimit: (ms: number) => void,
): Promise<(Reading & { readonly confidence: number }) | null> {
  const whole = document.createElement("canvas");
  whole.width = width;
  whole.height = height;
  const all = whole.getContext("2d", { willReadFrequently: true });
  if (!all) return null;
  if (tilt !== 0) {
    all.fillStyle = "white";
    all.fillRect(0, 0, width, height);
    all.translate(width / 2, height / 2);
    all.rotate((-tilt * Math.PI) / 180);
    all.drawImage(image, -width / 2, -height / 2, width, height);
    all.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    all.drawImage(image, 0, 0, width, height);
  }

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
  setLimit(10_000 + pieces * 3_500);
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
        const px = ctx.getImageData(0, 0, width, tall);
        binarize(px.data, width, tall);
        ctx.putImageData(px, 0, 0);
      }
      return c;
    };
    jobs.push(Promise.all([
      both ? scheduler.addJob("recognize", piece(false)).then((r) => ({ text: r.data.text, sure: r.data.confidence })) : Promise.resolve({ text: "", sure: 0 }),
      scheduler.addJob("recognize", piece(true)).then((r) => ({ text: r.data.text, sure: r.data.confidence })),
    ]));
  }
  const read = await Promise.all(jobs);
  const sure = read.flatMap(([p, r]) => (both ? [p.sure, r.sure] : [r.sure]));
  return {
    plain: both ? tidyReading(joinPieces(read.map(([p]) => tidyReading(p.text)))) : "",
    raised: tidyReading(joinPieces(read.map(([, r]) => tidyReading(r.text)))),
    confidence: sure.length > 0 ? sure.reduce((a, b) => a + b, 0) / sure.length : 0,
  };
}

async function readOnce(src: string): Promise<Reading | null> {
  let limitMs = 12_000;
  const work = (async () => {
    warmReader();
    const image = await drawn(src);
    const natural = image.naturalWidth || image.width;
    const scale = natural > MAX_WIDTH ? MAX_WIDTH / natural : 1;
    const width = Math.max(1, Math.round(natural * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));

    /*
     * A camera photo tilted in the hand is read twice: as it is, and
     * straightened by the tilt its print shows (domain/ocrText.ts,
     * `skewAngle`). The reading the reader is surer of is kept, so
     * straightening can only ever help: a level slip photographed over a
     * zebra crossing measured 14 degrees off its stripes before the measure
     * looked only at printed paper, and read as it was, it stays as it was.
     * A screenshot is square to its own pixels and is read once.
     */
    const tilt = height <= width * TALL ? tiltOf(image, width, height) : 0;
    const first = await readCanvas(image, width, height, 0, (ms) => (limitMs = ms));
    if (!first || Math.abs(tilt) < 2) return first ? { plain: first.plain, raised: first.raised } : null;
    limitMs += 12_000;
    const turned = await readCanvas(image, width, height, tilt, () => undefined);
    const best = turned && turned.confidence > first.confidence + 2 ? turned : first;
    return { plain: best.plain, raised: best.raised };
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
