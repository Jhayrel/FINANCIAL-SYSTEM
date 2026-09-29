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
        // Any mix of case: a receipt photo's "Total pHP 109.00" (28 September 2026).
        .replace(/(^|[\s(:-])(?:[Pp][Hh][Pp]|[P£$€¥₱]{1,2})\s?(?=\d)/g, "$1₱")
        /*
         * A label run into its figure, "CASH200.00" and "VAT AMT11.68" on the
         * same receipt: the thermal print leaves no gap the reader can see.
         * Split only before a figure with its two decimals, so a code such
         * as SH01 or 50ML is left alone.
         */
        .replace(/([A-Za-z])(?=\d[\d,]*\.\d{2}(?!\d))/g, "$1 ")
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

/**
 * Where to cut a tall picture into pieces the reader can take, one row of
 * pixels each: the emptiest row near every `tile` pixels.
 *
 * A stitched screenshot of a wallet's history can be seven screens tall. Read
 * whole, it is shrunk until the text is a few pixels high; cut blindly, a line
 * is sliced in half and read as two wrong ones. So each cut goes through the
 * gap between two lines: the row with the least ink within `search` pixels
 * above where a piece would end, the lowest of equals so pieces stay large.
 *
 * `ink[y]` is how much of row y differs from its own background. Returns the
 * cut rows, starting with 0 and ending with the height.
 */
export function cutRows(ink: readonly number[], tile = 1600, search = 240): number[] {
  const height = ink.length;
  const cuts = [0];
  let top = 0;
  while (height - top > tile) {
    const end = top + tile;
    let best = end;
    let least = Infinity;
    for (let y = end; y >= Math.max(top + tile / 2, end - search); y -= 1) {
      const v = ink[y] ?? 0;
      if (v < least) {
        least = v;
        best = y;
      }
    }
    cuts.push(best);
    top = best;
  }
  cuts.push(height);
  return cuts;
}

/** The readings of the pieces of one picture, top to bottom, as one text. */
export function joinPieces(pieces: readonly string[]): string {
  const lines: string[] = [];
  for (const piece of pieces) {
    for (const line of piece.split("\n")) {
      // A line read at the very foot of one piece and again at the head of the next is one line.
      if (line && line !== lines[lines.length - 1]) lines.push(line);
    }
  }
  return lines.join("\n");
}

export interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * The dark bars a wallet app writes its dates in: white on black, in a pill.
 *
 * The reader takes dark text on light and found only four of twelve such
 * dates on a long Maya history (27 September 2026), and a date is what every
 * row under it needs. A pill row is told from a line of text by how solid it
 * is: a run a fifth of the width or more, a third of it dark or more. A
 * line of text is wide but mostly gaps.
 */
export function darkBars(rgba: Uint8ClampedArray, width: number, height: number): Box[] {
  const rows: ({ left: number; right: number } | null)[] = [];
  const from = Math.floor(width * 0.1);
  const to = Math.ceil(width * 0.9);
  for (let y = 0; y < height; y += 1) {
    let left = -1;
    let right = -1;
    let dark = 0;
    for (let x = from; x < to; x += 1) {
      const i = (y * width + x) * 4;
      if (0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]! < 80) {
        if (left < 0) left = x;
        right = x;
        dark += 1;
      }
    }
    const span = right - left + 1;
    // Rows through the white letters are only partly dark, so a third is enough; lines of text sit near a tenth.
    rows.push(left >= 0 && span >= width * 0.2 && dark / span > 0.33 ? { left, right } : null);
  }

  const bars: Box[] = [];
  let y = 0;
  while (y < height) {
    if (!rows[y]) {
      y += 1;
      continue;
    }
    const top = y;
    let left = width;
    let right = 0;
    let gap = 0;
    while (y < height && gap <= 8) {
      const r = rows[y];
      if (r) {
        left = Math.min(left, r.left);
        right = Math.max(right, r.right);
        gap = 0;
      } else gap += 1;
      y += 1;
    }
    const bottom = y - gap;
    const tall = bottom - top;
    // A pill's height, not a divider line and not a block of colour.
    if (tall >= width * 0.015 && tall <= width * 0.12) bars.push({ top, bottom, left, right });
  }
  return bars;
}

/** Each box turned light for dark, so white-on-black text reads as black on white. */
export function invertBoxes(rgba: Uint8ClampedArray, width: number, boxes: readonly Box[]): void {
  for (const b of boxes) {
    for (let y = b.top; y < b.bottom; y += 1) {
      for (let x = b.left; x <= b.right; x += 1) {
        const i = (y * width + x) * 4;
        rgba[i] = 255 - rgba[i]!;
        rgba[i + 1] = 255 - rgba[i + 1]!;
        rgba[i + 2] = 255 - rgba[i + 2]!;
      }
    }
  }
}

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
/** A line that dates the rows under it: "September 24, 2026", "24 Sep 2026", "2026-09-24", "Today". */
export const DATE_LINE = new RegExp(
  `\\b${MONTH}\\.?\\s+\\d{1,2},?\\s+\\d{4}\\b|\\b\\d{1,2}\\s+${MONTH}\\.?,?\\s+\\d{4}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|^\\W*(?:today|yesterday)\\W*$`,
  "i",
);
/** A figure in pesos and centavos, which is what closes a row. */
export const ROW_AMOUNT = /\d[\d,]*\.\d{2}(?!\d)/;

/** How many rows of a list the text holds, going by the figures in it. */
export function rowsIn(text: string): number {
  return text.split("\n").filter((line) => ROW_AMOUNT.test(line)).length;
}

/**
 * A long list, in parts a model can answer whole.
 *
 * The owner's Maya history on 27 September 2026 was twenty four rows on one
 * stitched screenshot. One reply with a row for each runs past what a free
 * model will write in one go, and a reply cut off halfway is not JSON at
 * all, so the whole list was lost rather than its tail. In parts of about
 * `rows` rows each, every reply is short, and the parts are read side by side.
 *
 * Cut between rows, never through one (a row ends at its figure), and at a
 * date line where one is near, so a borrowing and the fees charged on it
 * stay together. A part that starts in the middle of a day opens with that
 * day's date line again, because a row with no date above it would be read
 * as dated today. A short list comes back as it is.
 */
export function piecesOf(text: string, rows = 8): string[] {
  if (rowsIn(text) <= rows + Math.ceil(rows / 2)) return [text];

  // Rows, each ending at its figure and knowing the date it sits under.
  interface Row { readonly lines: string[]; readonly date: string; readonly opensDay: boolean }
  const list: Row[] = [];
  let lines: string[] = [];
  let date = "";
  let opensDay = false;
  for (const line of text.split("\n")) {
    const dated = DATE_LINE.test(line) && !ROW_AMOUNT.test(line);
    if (dated) {
      date = line.trim();
      opensDay = true;
    }
    lines.push(line);
    if (ROW_AMOUNT.test(line)) {
      list.push({ lines, date, opensDay });
      lines = [];
      opensDay = false;
    }
  }
  // Whatever trails the last figure belongs with the last row.
  const last = list[list.length - 1];
  if (last && lines.some((l) => l.trim())) last.lines.push(...lines);

  const parts: string[][] = [];
  let part: string[] = [];
  let count = 0;
  for (const row of list) {
    const full = count >= rows;
    const nearlyFull = count >= Math.ceil(rows * 0.75) && row.opensDay;
    if (count > 0 && (full || nearlyFull)) {
      parts.push(part);
      part = [];
      count = 0;
    }
    if (count === 0 && !row.opensDay && row.date) part.push(row.date);
    part.push(...row.lines);
    count += 1;
  }
  if (part.length > 0) parts.push(part);
  return parts.map((p) => p.join("\n"));
}

const MONTHS_LONG = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A date line as YYYY-MM-DD when it reads as one, else its own letters. */
function dayOf(line: string): string {
  const named = new RegExp(`\\b(${MONTH})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "i").exec(line);
  if (named?.[1] && named[2] && named[3]) {
    const month = MONTHS_LONG.indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
    return `${named[3]}-${String(month).padStart(2, "0")}-${named[2].padStart(2, "0")}`;
  }
  return line.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The day a picture was taken, from its file name: `Screenshot_20260927_173618_Maya.jpg`.
 * Null when the name carries no date a phone would write.
 */
export function dayInFileName(name: string): string | null {
  const m = /(20\d{2})(\d{2})(\d{2})/.exec(name);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const at = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(at) || new Date(at).toISOString().slice(0, 10) !== iso ? null : iso;
}

export interface DatedRow {
  /** The row's figure, in centavos. */
  readonly amount: number;
  /** The day of the heading above it, or "" when no heading came before it. */
  readonly date: string;
}

/**
 * Every row of a history list with the day of the heading above it.
 *
 * 28 September 2026, the owner's Maya history: the rows under "Today" came
 * back dated the 26th, those under "September 26, 2026" the 24th, and those
 * under "September 24, 2026" the 23rd. Each group had the date of the heading
 * below it. A heading dates the rows under it, until the next heading, and
 * "Today" is the day the picture was taken: its "As of" line says so when it
 * has one, else the file name, else the day it was read.
 */
export function rowDatesIn(text: string, takenOn: string): DatedRow[] {
  const shift = (iso: string, days: number): string => {
    const at = new Date(`${iso}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + days);
    return at.toISOString().slice(0, 10);
  };
  let today = takenOn;
  let current = "";
  const rows: DatedRow[] = [];
  for (const line of text.split("\n")) {
    const hasAmount = ROW_AMOUNT.test(line);
    if (/\bas\s+of\b/i.test(line) && !hasAmount) {
      const said = dayOf(line);
      if (/^\d{4}-\d{2}-\d{2}$/.test(said)) today = said;
      continue;
    }
    if (DATE_LINE.test(line) && !hasAmount) {
      const word = line.trim().toLowerCase().replace(/[^a-z]/g, "");
      const said = dayOf(line);
      current = word === "today" ? today : word === "yesterday" ? shift(today, -1) : /^\d{4}-\d{2}-\d{2}$/.test(said) ? said : current;
      continue;
    }
    if (!hasAmount) continue;
    const figures = [...line.matchAll(/\d[\d,]*\.\d{2}(?!\d)/g)];
    const last = figures[figures.length - 1]?.[0];
    if (!last) continue;
    const [whole, cents] = last.replace(/,/g, "").split(".");
    rows.push({ amount: Number(whole) * 100 + Number(cents), date: current });
  }
  return rows;
}

/**
 * A stitched screenshot's rows, each once.
 *
 * The owner's Maya history on 27 September 2026 was a scroll capture that
 * showed 13, 12 and 11 September twice, where two captures overlapped. Read
 * as it was, the same Jollibee lunch, the same cash back and the same Globe
 * bill each became two cards, and the model dated the second copy by the
 * wrong heading. A row here is its label, its time, its name and its amount
 * under the day it sits in; the same row under the same day a second time is
 * the overlap, not a second payment. Two payments of the same amount to the
 * same place on the same day differ in their time, so they stay.
 */
export function dropRepeats(text: string): { readonly text: string; readonly dropped: number } {
  const lines = text.split("\n");
  const kept: string[] = [];
  const seen = new Set<string>();
  let day = "";
  let pending: string[] = [];
  let dropped = 0;
  const squash = (l: string): string => l.toLowerCase().replace(/[^a-z0-9.:]/g, "");
  for (const line of lines) {
    if (DATE_LINE.test(line) && !ROW_AMOUNT.test(line)) day = dayOf(line);
    pending.push(line);
    if (!ROW_AMOUNT.test(line)) continue;
    // The row: what came since the last figure, less any date line, which says where it sits rather than what it is.
    const rows = pending.filter((l) => !(DATE_LINE.test(l) && !ROW_AMOUNT.test(l))).map(squash).filter(Boolean);
    const body = rows.join("|");
    const key = `${day}|${body}`;
    // Where two captures meet, a row can lose its label line; with no time to tell it apart, its name and amount decide.
    const named = `${day}|${rows[rows.length - 1] ?? ""}`;
    const timed = /\d{1,2}:\d{2}/.test(body);
    const repeat = body !== "" && (seen.has(key) || (!timed && seen.has(named)));
    seen.add(named);
    if (repeat) {
      dropped += 1;
      // Keep a date line it carried, so the rows after it still sit under the right day.
      kept.push(...pending.filter((l) => DATE_LINE.test(l) && !ROW_AMOUNT.test(l)));
    } else {
      seen.add(key);
      kept.push(...pending);
    }
    pending = [];
  }
  kept.push(...pending);
  return { text: kept.join("\n"), dropped };
}

/**
 * How far a photo's lines of print are tilted, in degrees, clockwise.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * A 7-Eleven receipt photographed on a rock, 29 September 2026, tilted a few
 * degrees: the reader kept its header and its VAT lines and lost everything
 * between, the item, "Total Amount Due 25.00", the cash and the date. A line
 * of print that runs downhill crosses the reader's rows, and it reads a
 * slice of two lines as neither. Any photo of any receipt can be tilted, so
 * the photo is straightened before it is read, never the receipt learned.
 *
 * ── How ────────────────────────────────────────────────────────────────────
 *
 * The usual way: tip the dark pixels by each small angle and count how many
 * land on each row. At the angle the print is level, the counts are all
 * lines and gaps, as uneven as they can be, so the angle with the largest
 * sum of squared counts is the tilt, looked for up to 15 degrees either
 * way, a phone held at an angle. Worked on a small copy, a few tens of
 * milliseconds. `rgba` is binarized in place.
 */
export function skewAngle(rgba: Uint8ClampedArray, width: number, height: number, range = 15): number {
  /*
   * Only print on paper counts. The same receipt lay on granite, whose
   * speckle binarized into more dark pixels than the print and hid its tilt.
   * Paper is where a block's middle brightness is near the brightest in the
   * picture: a receipt is mostly white even where it is printed, and a
   * table, a rock or a hand is not.
   */
  const BLOCK = 24;
  const bw = Math.ceil(width / BLOCK);
  const bh = Math.ceil(height / BLOCK);
  const medians = new Float64Array(bw * bh);
  const darkest = new Float64Array(bw * bh);
  for (let by = 0; by < bh; by += 1) {
    for (let bx = 0; bx < bw; bx += 1) {
      const hist = new Uint32Array(256);
      let n = 0;
      for (let y = by * BLOCK; y < Math.min(height, (by + 1) * BLOCK); y += 1) {
        for (let x = bx * BLOCK; x < Math.min(width, (bx + 1) * BLOCK); x += 1) {
          const i = (y * width + x) * 4;
          hist[Math.round(0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!)]! += 1;
          n += 1;
        }
      }
      let seen = 0;
      let m = 0;
      let low = -1;
      while (m < 255 && seen + hist[m]! < n / 2) {
        seen += hist[m]!;
        if (low < 0 && seen >= n * 0.04) low = m;
        m += 1;
      }
      medians[by * bw + bx] = m;
      darkest[by * bw + bx] = low < 0 ? m : low;
    }
  }
  const sorted = [...medians].sort((a, b) => a - b);
  const bright = sorted[Math.floor(sorted.length * 0.9)] ?? 255;
  // Paper, with print on it: near the brightest in the middle, and ink at least half as dark again.
  const paper = (x: number, y: number): boolean => {
    const k = Math.floor(y / BLOCK) * bw + Math.floor(x / BLOCK);
    return medians[k]! >= bright * 0.8 && darkest[k]! <= medians[k]! * 0.5;
  };

  binarize(rgba, width, height);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4]! < 128 && paper(x, y)) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  // Nearly blank, or nearly all ink: nothing to level.
  if (xs.length < 200 || xs.length > width * height * 0.6) return 0;
  const rows = height + width;
  const score = (degrees: number): number => {
    const t = (degrees * Math.PI) / 180;
    const sin = Math.sin(t);
    const cos = Math.cos(t);
    const counts = new Float64Array(rows * 2);
    for (let i = 0; i < xs.length; i += 1) {
      const r = Math.round(ys[i]! * cos - xs[i]! * sin) + rows;
      counts[r] = (counts[r] ?? 0) + 1;
    }
    let sum = 0;
    for (const c of counts) sum += c * c;
    return sum;
  };
  // Whole degrees across the range, then quarter degrees around the best of them.
  let best = 0;
  let bestScore = score(0);
  const tryAngle = (a: number): void => {
    const s = score(a);
    if (s > bestScore * 1.0001) {
      best = a;
      bestScore = s;
    }
  };
  for (let a = -range; a <= range; a += 1) tryAngle(a);
  const coarse = best;
  for (let a = coarse - 0.75; a <= coarse + 0.75 + 1e-9; a += 0.25) tryAngle(a);
  return Math.round(best * 100) / 100;
}
