/**
 * A file handed to this device's own downloads, and nowhere else.
 *
 * One place for it: the Statements screen had its own, and the Activity
 * screen's PDF needs the same (26 October 2026). App's backups, spreadsheets
 * and the files the chat makes come through here too.
 *
 * ── A file made after the tap has gone ────────────────────────────────────
 *
 * A browser saves a file a page hands it only while the tap that asked for it
 * still counts, a few seconds. Making a long statement, or reading every
 * record for a backup, can take longer on a phone, and then the browser
 * blocks the download as one the site started by itself and says nothing:
 * "For some reason I cannot download backup" (owner, 4 November 2026). So a
 * file finished after the tap is kept here, and the app shows "Your file is
 * ready" with a Save button (`FileWaiting` in App), one more tap.
 */

export interface WaitingFile {
  readonly name: string;
  readonly data: BlobPart;
  readonly type: string;
}

let waiting: WaitingFile | null = null;
const listeners = new Set<(file: WaitingFile | null) => void>();

const tell = (): void => {
  for (const listen of listeners) listen(waiting);
};

/** Whether the tap that asked for this still counts. Where the browser cannot say, it is taken to. */
function tapStillCounts(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return activation === undefined || activation.isActive;
}

function writeNow(name: string, data: BlobPart, type: string): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked a moment later: a phone can still be reading it when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Saved now while the tap still counts; else kept for one more tap, and
 * "waiting" is returned so the caller can say so rather than "saved".
 */
export function saveFile(name: string, data: BlobPart, type: string): "saved" | "waiting" {
  if (tapStillCounts()) {
    writeNow(name, data, type);
    return "saved";
  }
  waiting = { name, data, type };
  tell();
  return "waiting";
}

/** The file kept for one more tap, saved by that tap. */
export function saveWaitingFile(): void {
  const file = waiting;
  waiting = null;
  tell();
  if (file) writeNow(file.name, file.data, file.type);
}

/** Let the waiting file go without saving it. */
export function dropWaitingFile(): void {
  waiting = null;
  tell();
}

/** Told when a file starts or stops waiting. Returns the unsubscribe. */
export function onWaitingFile(listen: (file: WaitingFile | null) => void): () => void {
  listeners.add(listen);
  listen(waiting);
  return () => {
    listeners.delete(listen);
  };
}
