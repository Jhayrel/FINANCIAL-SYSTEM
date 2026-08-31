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
  /** Refused above this, before anything is sent. */
  maxBytes: 4 * 1024 * 1024,
  /** Compressed down to about this. Receipts stay legible well below it. */
  targetBytes: 1_500_000,
  /** Longest edge after downscaling. */
  maxEdge: 1568,
  /** A text file is context, and context is bounded like all the rest. */
  maxTextChars: 12_000,
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
 */
export function checkFile(
  file: { readonly name: string; readonly type: string; readonly size: number },
  alreadyAttached: number,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (alreadyAttached >= LIMITS.maxCount) {
    return {
      ok: false,
      reason: `${LIMITS.maxCount} files is the most that can go in one message. Send these, then attach the rest.`,
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

  if (file.size > LIMITS.maxBytes) {
    return {
      ok: false,
      reason: `It is ${formatBytes(file.size)} and the limit is ${formatBytes(LIMITS.maxBytes)}. It was not sent. Try a smaller photo.`,
    };
  }

  if (file.size === 0) {
    return { ok: false, reason: "The file is empty." };
  }

  return { ok: true };
}

/**
 * Downscale and re-encode, stepping the quality down until it fits.
 *
 * A screenshot that is already small keeps its original bytes: re-encoding a
 * crisp PNG of text as JPEG makes it blurrier and no smaller.
 */
async function shrink(file: File): Promise<{ dataUrl: string; bytes: number }> {
  const original = await asDataUrl(file);

  if (file.size <= LIMITS.targetBytes && file.type === "image/png") {
    return { dataUrl: original, bytes: file.size };
  }

  const image = await load(original);
  const longest = Math.max(image.width, image.height);
  const scale = longest > LIMITS.maxEdge ? LIMITS.maxEdge / longest : 1;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext("2d");
  if (!context) return { dataUrl: original, bytes: file.size };
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  // Down from good to acceptable. Receipt text survives 0.6 comfortably; a
  // fifth pass would trade legibility for bytes that are already spent.
  for (const quality of [0.82, 0.72, 0.62, 0.5]) {
    const encoded = canvas.toDataURL("image/jpeg", quality);
    const bytes = Math.round((encoded.length - encoded.indexOf(",") - 1) * 0.75);
    if (bytes <= LIMITS.targetBytes) return { dataUrl: encoded, bytes };
  }

  const last = canvas.toDataURL("image/jpeg", 0.5);
  return { dataUrl: last, bytes: Math.round((last.length - last.indexOf(",") - 1) * 0.75) };
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

/** Read a picked set of files, keeping what can be sent and saying why for the rest. */
export async function readFiles(
  files: readonly File[],
  alreadyAttached = 0,
): Promise<ReadResult> {
  const attachments: Attachment[] = [];
  const rejected: Rejection[] = [];

  for (const file of files) {
    const check = checkFile(file, alreadyAttached + attachments.length);
    if (!check.ok) {
      rejected.push({ name: file.name, reason: check.reason });
      continue;
    }

    counter += 1;
    const id = `a-${Date.now()}-${counter}`;

    try {
      if (isImageType(file.type)) {
        const { dataUrl, bytes } = await shrink(file);
        attachments.push({ id, name: file.name, kind: "image", bytes, dataUrl });
      } else {
        const raw = await file.text();
        const text = redact(raw).slice(0, LIMITS.maxTextChars);
        attachments.push({
          id,
          name: file.name,
          kind: "text",
          bytes: text.length,
          text,
        });
      }
    } catch {
      rejected.push({ name: file.name, reason: "It could not be opened on this device." });
    }
  }

  return { attachments, rejected };
}

/** What the whole message will weigh, for the readout under the composer. */
export const totalBytes = (attachments: readonly Attachment[]): number =>
  attachments.reduce((sum, a) => sum + a.bytes, 0);
