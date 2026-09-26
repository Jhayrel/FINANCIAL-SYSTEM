/**
 * Photos and files on their way to the assistant.
 *
 * ── Why the work happens here and not on the server ───────────────────────
 *
 * A phone photo is three to eight megabytes of mostly sky. Sending that costs
 * the owner's data, the request's time budget, and eventually the free tier,
 * and none of it helps a model read a receipt: the text is legible far below
 * the size the camera produced. So an image is measured, downscaled and
 * re-encoded before anything leaves the device, and a file that is still too
 * big afterwards is refused by name with its size, never silently dropped.
 *
 * ── Why text files are read here too ──────────────────────────────────────
 *
 * A CSV or a bank statement pasted as .txt does not need a vision model at
 * all. Reading it here turns it into ordinary context, which is cheaper, more
 * accurate, and works when no vision model is available.
 *
 * Everything is redacted on the way through. A statement is exactly the kind
 * of file that could have a key in a footer.
 */

import { redact } from "../domain/aiRedact";

export const LIMITS = {
  /** Matches what the free vision models accept in one request. */
  maxCount: 5,
  /** The most one picture may weigh once shrunk, which is what is sent. Settings can lower it. */
  maxBytes: 4 * 1024 * 1024,
  /** Compressed down to about this. Receipts stay legible well below it. */
  targetBytes: 1_500_000,
  /**
   * What one message's pictures may weigh together once shrunk.
   *
   * The endpoint takes 6,000,000 characters of pictures per request
   * (functions/api/ai.ts, MAX_IMAGE_CHARS), and base64 is four characters
   * for every three bytes, so 4.5 MB. This leaves room for the data URL
   * headers. Five photos at 1.5 MB each were 7.5 MB and refused there.
   */
  totalBytes: 4_200_000,
  /** Longest edge after downscaling, then smaller steps if a picture still does not fit. */
  maxEdge: 1568,
  edges: [1568, 1280, 1024, 800],
  /** A text file is context, and context is bounded like all the rest. */
  maxTextChars: 12_000,
  /** How much of a text file is read: enough for maxTextChars in any encoding. */
  textReadBytes: 64 * 1024,
} as const;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Read as text rather than looked at. Matched on extension too, because
    Windows hands over an empty type for .csv often enough to matter. */
const TEXT_EXTENSIONS = [".csv", ".txt", ".md", ".json", ".tsv"] as const;

export interface Attachment {
  readonly id: string;
  readonly name: string;
  readonly kind: "image" | "text";
  /** Size after compression, which is what will actually be sent. */
  readonly bytes: number;
  /** Images only: a data URL, ready for the endpoint and for the thumbnail. */
  readonly dataUrl?: string;
  /** Text files only: the redacted contents. */
  readonly text?: string;
  /**
   * A short fingerprint of the file as it arrived, before any shrinking.
   *
   * Two attachments with the same digest are the same picture, whatever they
   * are called. Names are worthless for this: the recorded history has one
   * message carrying three files all called `image.png`, all 32,562 bytes,
   * all the same screenshot, and a fourth `image.png` at 34,184 bytes that
   * was a different one. Only the content can tell those apart.
   */
  readonly digest?: string;
}

export interface Rejection {
  readonly name: string;
  readonly reason: string;
}

export interface ReadResult {
  readonly attachments: readonly Attachment[];
  readonly rejected: readonly Rejection[];
}

const isTextName = (name: string): boolean =>
  TEXT_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

const isImageType = (type: string): boolean =>
  (IMAGE_TYPES as readonly string[]).includes(type);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Can this file be sent at all, before any work is done on it.
 *
 * Pure and separate from the reading so it can be tested without a browser,
 * and so the message says what happened and what to do (rule D8) rather than
 * the file simply not appearing.
 *
 * ── No size is refused here ────────────────────────────────────────────────
 *
 * A 4.9 MB phone photo was refused with "the limit is 4.0 MB, try a smaller
 * photo" (owner, 26 September 2026), though it would have been shrunk to
 * about 1.5 MB before sending, and nothing is ever stored: the file is read
 * and let go. The limit belongs to what is sent, so it is applied after the
 * shrinking, in `readFiles`. A text file is only read as far as it is used.
 */
export function checkFile(
  file: { readonly name: string; readonly type: string; readonly size: number },
  alreadyAttached: number,
  /** From Settings. Absent means the defaults above. */
  limits: { readonly maxCount?: number; readonly maxSizeMB?: number } = {},
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const maxCount = limits.maxCount ?? LIMITS.maxCount;

  if (alreadyAttached >= maxCount) {
    return {
      ok: false,
      reason: `${maxCount} files is the most that can go in one message. Send these, then attach the rest.`,
    };
  }

  const text = isTextName(file.name);
  const image = isImageType(file.type);

  if (!text && !image) {
    return {
      ok: false,
      reason: "Only JPEG, PNG and WebP pictures, and CSV or text files, can be read.",
    };
  }

  if (file.size === 0) {
    return { ok: false, reason: "The file is empty." };
  }

  return { ok: true };
}

/**
 * A short fingerprint of a file's contents.
 *
 * Two passes with different constants, printed together. One 32-bit hash over
 * a two-megabyte data URL collides often enough to matter when the answer is
 * "you have already attached this"; two independent ones and the length do
 * not, and the whole thing is still a single walk of the string.
 *
 * Not a security hash and never used as one. It answers "is this the same
 * file I already have", nothing else.
 */
export function digestOf(content: string): string {
  let a = 0x811c9dc5;
  let b = 5381;

  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b, 33) ^ code;
  }

  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, "0");
  return `${hex(a)}${hex(b)}-${content.length.toString(16)}`;
}

/**
 * Downscale and re-encode, stepping the quality and then the size down until it fits.
 *
 * A screenshot that is already small keeps its original bytes: re-encoding a
 * crisp PNG of text as JPEG makes it blurrier and no smaller.
 *
 * The picture is decoded from an object URL, not a data URL, so a 20 MB
 * photo is never turned into a 27 million character string just to be drawn
 * smaller. Null when even the smallest step is over `target`, which only a
 * message already full of pictures can cause.
 */
async function shrink(file: File, target: number): Promise<{ dataUrl: string; bytes: number } | null> {
  if (file.size <= target && file.type === "image/png") {
    return { dataUrl: await asDataUrl(file), bytes: file.size };
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await load(url);
    const longest = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return null;

    let drawn = "";
    for (const edge of LIMITS.edges) {
      const scale = longest > edge ? edge / longest : 1;
      const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
      const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
      // A picture already under this edge is the same drawing again: no smaller, no point.
      if (`${width}x${height}` === drawn) continue;
      drawn = `${width}x${height}`;
      canvas.width = width;
      canvas.height = height;
      context.drawImage(image, 0, 0, width, height);

      // Down from good to acceptable. Receipt text survives 0.6 comfortably.
      for (const quality of [0.82, 0.72, 0.62, 0.5]) {
        const encoded = canvas.toDataURL("image/jpeg", quality);
        const bytes = Math.round((encoded.length - encoded.indexOf(",") - 1) * 0.75);
        if (bytes <= target) return { dataUrl: encoded, bytes };
      }
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const asDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("could not read"));
    reader.readAsDataURL(file);
  });

const load = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("not an image"));
    image.src = src;
  });

let counter = 0;

/**
 * Read a picked set of files, keeping what can be sent and saying why for the rest.
 *
 * `already` is what is on the message now, so the same picture picked twice is
 * refused by name the second time instead of being sent twice, read twice, and
 * turned into two identical cards. That is not hypothetical: the owner's
 * history has one message carrying three byte-identical copies of the same
 * screenshot, which produced three identical PHP 1,447.90 cards and no word
 * anywhere about them being the same picture.
 *
 * Refused, not silently dropped. A file that vanishes without a line looks
 * like the upload failing.
 */
export async function readFiles(
  files: readonly File[],
  already: readonly Attachment[] | number = [],
  limits: { readonly maxCount?: number; readonly maxSizeMB?: number } = {},
): Promise<ReadResult> {
  const attachments: Attachment[] = [];
  const rejected: Rejection[] = [];

  // A count is still accepted, for callers that hold no list.
  const existing = typeof already === "number" ? [] : already;
  const alreadyAttached = typeof already === "number" ? already : already.length;
  const seen = new Map<string, string>();
  for (const a of existing) if (a.digest) seen.set(a.digest, a.name);

  /*
   * What the pictures may weigh, shared out.
   *
   * Each picture gets its share of what the message has left, so five photos
   * fit together where five at full size would be refused by the endpoint.
   * Settings can lower the most any one picture weighs; nothing raises it past
   * what the endpoint takes.
   */
  const perPicture = Math.min(LIMITS.targetBytes, (limits.maxSizeMB ?? LIMITS.maxBytes / (1024 * 1024)) * 1024 * 1024);
  let budget = LIMITS.totalBytes - existing.filter((a) => a.kind === "image").reduce((sum, a) => sum + a.bytes, 0);
  let picturesLeft = files.filter((f) => isImageType(f.type)).length;

  for (const file of files) {
    const image = isImageType(file.type);
    const check = checkFile(file, alreadyAttached + attachments.length, limits);
    if (!check.ok) {
      rejected.push({ name: file.name, reason: check.reason });
      if (image) picturesLeft -= 1;
      continue;
    }

    counter += 1;
    const id = `a-${Date.now()}-${counter}`;

    try {
      if (image) {
        const share = Math.min(perPicture, Math.floor(budget / Math.max(1, picturesLeft)));
        picturesLeft -= 1;
        const shrunk = share >= 40_000 ? await shrink(file, share) : null;
        if (!shrunk) {
          rejected.push({
            name: file.name,
            reason: "This message has no room left for another picture. Send what is attached, then attach this one.",
          });
          continue;
        }
        // The fingerprint of what is sent: the same photo shrinks to the same bytes.
        const digest = digestOf(shrunk.dataUrl);
        const twin = seen.get(digest);
        if (twin !== undefined) {
          rejected.push({ name: file.name, reason: twinReason(twin, file.name) });
          continue;
        }
        seen.set(digest, file.name);
        budget -= shrunk.bytes;
        attachments.push({ id, name: file.name, kind: "image", bytes: shrunk.bytes, dataUrl: shrunk.dataUrl, digest });
        continue;
      }

      // Only as much as is used is read, so a file of any size opens at once.
      const content = redact(await file.slice(0, LIMITS.textReadBytes).text());
      const digest = digestOf(content);

      const twin = seen.get(digest);
      if (twin !== undefined) {
        rejected.push({ name: file.name, reason: twinReason(twin, file.name) });
        continue;
      }
      seen.set(digest, file.name);

      const text = content.slice(0, LIMITS.maxTextChars);
      attachments.push({
        id,
        name: file.name,
        kind: "text",
        bytes: text.length,
        text,
        digest,
      });
    } catch {
      rejected.push({ name: file.name, reason: "It could not be opened on this device." });
    }
  }

  return { attachments, rejected };
}

/** Why a second copy of a file was not added. */
function twinReason(twin: string, name: string): string {
  return twin === name
    ? "It is the same file as the one already attached, so it was not added twice."
    : `It is the same file as ${twin}, already attached, so it was not added twice.`;
}

/** What the whole message will weigh, for the readout under the composer. */
export const totalBytes = (attachments: readonly Attachment[]): number =>
  attachments.reduce((sum, a) => sum + a.bytes, 0);
