/**
 * What the app says about saving, in words.
 *
 * ── The question it answers ────────────────────────────────────────────────
 *
 * The owner asked what happens when the database connection cuts off. The
 * data was safe: the offline cache keeps every write and sends it when the
 * connection returns. But a write made offline does not fail, it waits, so
 * nothing on screen said anything, and there was no way to tell a saved entry
 * from one still sitting on the device. A refused write, the one case where
 * something really did not save, raised a banner that ended mid-sentence.
 *
 * Three states, said once each: offline with changes waiting, a save that is
 * taking a while, and a save the database refused.
 */

export interface SyncInput {
  readonly online: boolean;
  /** Writes sent that the database has not confirmed yet. */
  readonly pending: number;
  /** The last write the database refused, if any. */
  readonly error: string | null;
}

export interface SyncNotice {
  readonly level: "over" | "warn" | "info";
  readonly title: string;
  readonly detail: string;
}

const changes = (n: number): string => `${n} ${n === 1 ? "change" : "changes"}`;

export function syncWords({ online, pending, error }: SyncInput): SyncNotice | null {
  if (error) {
    const signIn = /permission|insufficient|unauthenticated|unauthorized|auth/i.test(error);
    return {
      level: "over",
      title: "A change did not save",
      detail: `${
        signIn
          ? "The database refused it: sign in again as the owner."
          : `The database answered: ${error.replace(/\.+$/, "")}.`
      } That change is not in the database, so add it again once this is put right. Everything saved before it is safe.`,
    };
  }

  if (!online) {
    return pending > 0
      ? {
          level: "warn",
          title: `Offline, ${changes(pending)} waiting`,
          detail:
            "They are kept on this device and go to the database by themselves when the connection is back. Keep using the app as usual.",
        }
      : {
          level: "info",
          title: "Offline",
          detail: "Anything you add is kept on this device and sent when the connection is back.",
        };
  }

  if (pending > 0) {
    return {
      level: "info",
      title: `Saving ${changes(pending)}`,
      detail: "The connection is slow. Nothing is lost while this finishes.",
    };
  }

  return null;
}
