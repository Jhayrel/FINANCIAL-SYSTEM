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

/**
 * What the app was doing when the database said no.
 *
 * On 26 September 2026 the owner saw "A change did not save ... add it again"
 * with no way to tell which change: an entry, a setting, a budget, or a read
 * that was never a change at all. Each one now says what it was, and whether
 * the entries are affected, because that is the first thing anyone asks.
 */
export type Problem = "entries" | "settings" | "budget" | "settings-read" | "ledger-read" | "activity" | "upload";

export interface SyncInput {
  readonly online: boolean;
  /** Writes sent that the database has not confirmed yet. */
  readonly pending: number;
  /** The last write the database refused, if any. */
  readonly error: string | null;
  /** What was being saved or read. Left out, it is read as an entry. */
  readonly what?: Problem;
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

/** The title, the level, and what is and is not affected, for each kind of refusal. */
const PROBLEM: Record<Problem, { readonly level: SyncNotice["level"]; readonly title: string; readonly tail: string }> = {
  entries: { level: "over", title: "An entry did not save", tail: "Add it again once this is put right. Everything saved before it is safe." },
  settings: { level: "over", title: "A settings change did not save", tail: "Your entries are saving normally. Make the change again once this is put right." },
  budget: { level: "over", title: "A budget change did not save", tail: "Your entries are saving normally. Set it again once this is put right." },
  "settings-read": { level: "warn", title: "Your settings could not be loaded", tail: "The app is using the copy on this device, and your entries are safe." },
  "ledger-read": { level: "over", title: "The ledger could not be loaded", tail: "What is on screen is the copy on this device. Nothing is lost." },
  activity: { level: "info", title: "The activity trail is not recording", tail: "Your entries, settings and budget save normally." },
  upload: { level: "over", title: "The upload did not finish", tail: "Nothing already in the database was changed. Try again once this is put right." },
};

/** Why, in one sentence, from what the database answered. */
function causeOf(error: string): string {
  if (/permission|insufficient/i.test(error)) {
    return "The rules published in Firebase are older than this app: publish the latest firestore.rules in the Firebase console.";
  }
  if (/unauthenticated|unauthorized|sign.?in|auth/i.test(error)) return "You are signed out: sign in again as the owner.";
  if (/offline|unavailable|network|deadline/i.test(error)) return "The connection dropped before it arrived.";
  return `The database answered: ${error.replace(/\.+$/, "")}.`;
}

export function syncWords({ online, pending, error, what = "entries" }: SyncInput): SyncNotice | null {
  if (error) {
    const kind = PROBLEM[what];
    return { level: kind.level, title: kind.title, detail: `${causeOf(error)} ${kind.tail}` };
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
export function refusalWords(
  error: string | null,
  count: number,
  /**
   * The kept rows, when the caller has them, so a refusal the rules explain
   * can name its cause. A lender's charge (`debtEffect: "charge"`) was added
   * to the rules on 17 September 2026, and rules published before then
   * refuse every one: no row of that kind has ever reached the owner's
   * database, which is the tell.
   */
  rows: readonly { readonly debtEffect?: string | undefined }[] = [],
): string {
  const them = count === 1 ? "it" : "them";
  const kept = `${count === 1 ? "It is" : "They are"} kept on this device, so nothing is lost.`;
  if (!error) return `The database refused ${them}. ${kept}`;
  if (/permission|insufficient/i.test(error)) {
    if (rows.some((r) => r.debtEffect === "charge")) {
      return `The rules published in Firebase are older than this app and do not know a charge added to a debt. Publish the latest firestore.rules in the Firebase console, then press Try again. ${kept}`;
    }
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
