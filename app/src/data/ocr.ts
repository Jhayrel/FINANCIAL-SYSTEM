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

import { binarize, tidyReading } from "../domain/ocrText";

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

/**
 * The text in one picture, both readings, tidied; null when nothing could be read.
 *
 * Gives up after `limitMs`, so a slow first load on a phone falls back to
 * the vision models rather than holding the owner up.
 */
type Reading = { readonly plain: string; readonly raised: string };

/**
 * Readings already made, by picture.
 *
 * A picture is read the moment it is attached, while the owner is still
 * typing, so pressing Send finds the reading done. The same picture sent
 * twice is read once.
 */
const readings = new Map<string, Promise<Reading | null>>();

export function readPicture(dataUrl: string, limitMs = 12_000): Promise<Reading | null> {
  const known = readings.get(dataUrl);
  if (known) return known;
  const reading = readOnce(dataUrl, limitMs);
  readings.set(dataUrl, reading);
  // A failed reading is not kept, so the next try reads again.
  void reading.then((r) => {
    if (!r) readings.delete(dataUrl);
  });
  // A handful is plenty: one message carries five at most.
  if (readings.size > 10) {
    const oldest = readings.keys().next().value;
    if (oldest !== undefined) readings.delete(oldest);
  }
  return reading;
}

async function readOnce(dataUrl: string, limitMs: number): Promise<Reading | null> {
  const work = (async () => {
    warmReader();
    const scheduler = await starting;
    if (!scheduler) return null;

    const image = await drawn(dataUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const plain = document.createElement("canvas");
    plain.width = width;
    plain.height = height;
    plain.getContext("2d")?.drawImage(image, 0, 0);

    const raised = document.createElement("canvas");
    raised.width = width;
    raised.height = height;
    const context = raised.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height);
    binarize(pixels.data, width, height);
    context.putImageData(pixels, 0, 0);

    const [a, b] = await Promise.all([scheduler.addJob("recognize", plain), scheduler.addJob("recognize", raised)]);
    return { plain: tidyReading(a.data.text), raised: tidyReading(b.data.text) };
  })();

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), limitMs));
  try {
    return await Promise.race([work, timeout]);
  } catch {
    return null;
  }
}
