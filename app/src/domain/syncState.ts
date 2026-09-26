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

export interface ConnectionInput {
  /** Signed in, so saves go to the database rather than this browser alone. */
  readonly signedIn: boolean;
  readonly online: boolean;
  readonly pending: number;
}

export interface ConnectionNote {
  readonly tone: "ok" | "busy" | "warn" | "local";
  readonly text: string;
}

/**
 * Where a save goes, in a few words beside the form.
 *
 * The owner asked for the form to connect better to the database. It saved to
 * it all along, but nothing on the form said so, or said when it could not:
 * offline, a save looked exactly like one that had arrived.
 */
export function connectionWords({ signedIn, online, pending }: ConnectionInput): ConnectionNote {
  if (!signedIn) return { tone: "local", text: "Saving on this device only" };
  if (!online) {
    return { tone: "warn", text: pending > 0 ? `Offline: ${changes(pending)} kept here` : "Offline: saves kept on this device" };
  }
  if (pending > 0) return { tone: "busy", text: `Saving ${changes(pending)}` };
  return { tone: "ok", text: "Connected to the database" };
}

export function syncWords({ online, pending, error }: SyncInput): SyncNotice | null {
  if (error) {
    const signIn = /permission|insufficient|unauthenticated|unauthorized|auth/i.test(error);
    return {
      level: "over",
      title: "A change did not save",
      detail: `${
        signIn
          ? "The database refused it. Either you are signed out, so sign in again as the owner, or the database's rules are older than this version of the app, so publish the latest firestore.rules in the Firebase console."
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

/**
 * Why kept entries did not reach the database, from what it answered.
 *
 * The notice used to say the same three sentences whatever happened, and one
 * of them was a guess ("if the rules in Firebase are older than this app").
 * When the database gave a reason it was thrown away, so the owner could not
 * tell a rules problem from a signed-out tab from a bug. It says what the
 * database said now, and what to do about that one.
 */
export function refusalWords(error: string | null, count: number): string {
  const them = count === 1 ? "it" : "them";
  const kept = `${count === 1 ? "It is" : "They are"} kept on this device, so nothing is lost.`;
  if (!error) return `The database refused ${them}. ${kept}`;
  if (/permission|insufficient/i.test(error)) {
    return `The database's rules refused ${them}. Publish the latest firestore.rules in the Firebase console, check you are signed in as the owner, then press Try again. ${kept}`;
  }
  if (/unauthenticated|unauthorized|sign.?in|auth/i.test(error)) {
    return `You are signed out, so the database would not take ${them}. Sign in again, then press Try again. ${kept}`;
  }
  if (/offline|unavailable|network|deadline/i.test(error)) {
    return `The connection dropped before ${them} arrived. Press Try again once you are back online. ${kept}`;
  }
  return `The database answered: ${error.replace(/\.+$/, "")}. ${kept}`;
}
