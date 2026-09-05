/**
 * Nearly right, which is worse than plainly wrong.
 *
 * ── Why a typo costs more here than elsewhere ─────────────────────────────
 *
 * A name that does not match any list is obvious: the card flags it, the
 * owner sees it, and it gets fixed. A name that is one letter off is not.
 * "Gcash " with a trailing space, "Foood", "Maya Bank (personal savings)"
 * with a small p: each of those saves without complaint and then quietly
 * splits a total in two. Two items called Food and Foood both look right in
 * the ledger and neither adds up to what was spent on food.
 *
 * The ledger already carries this damage: "Repairs" is filed with the remark
 * "Technical and mechanincal repairs", which nobody will ever notice, because
 * a remark is never totalled.
 *
 * ── What it does, and what it refuses to do ───────────────────────────────
 *
 * It reports. It never rewrites, because a name that is one letter from
 * another name might be a new one the owner means to add, and silently
 * folding "Gas" into "Gcash" would be inventing a transaction's wallet.
 * CLAUDE.md is explicit: integrity checks report and never auto-correct.
 *
 * The distance is capped hard. One edit on a short word, two on a long one,
 * because past that the words are simply different: "Food" and "Fun" are two
 * edits apart and are two real, distinct items on this owner's own list.
 */

/**
 * Edits between two words, stopping early once it is past caring.
 *
 * The classic two-row Levenshtein. `limit` is not an optimisation here so
 * much as a statement of intent: anything further apart is a different word
 * and the exact figure is of no interest.
 */
export function editsBetween(a: string, b: string, limit = 3): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();

  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > limit) return limit + 1;

  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);

  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let best = i;

    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      current.push(value);
      if (value < best) best = value;
    }

    // Every path through this row already costs more than we care about.
    if (best > limit) return limit + 1;
    previous = current;
  }

  return previous[right.length] ?? limit + 1;
}

/** How far apart two names may be and still be worth mentioning. */
const allowed = (word: string): number => (word.length <= 5 ? 1 : 2);

export interface NearMiss {
  /** What was written. */
  readonly written: string;
  /** The name on the list it is nearly. */
  readonly meant: string;
  /** Why it is suspicious, in words for the card. */
  readonly note: string;
}

/**
 * A name that is nearly one on the list, but not on it.
 *
 * Exact matches return nothing: those are correct, not near. A name that
 * matches once the case and spacing are ignored is reported, because "gcash"
 * and "Gcash" are the same wallet written two ways and only one of them is
 * the one every total groups by.
 */
export function nearestName(written: string, known: readonly string[]): NearMiss | null {
  const trimmed = written.trim();
  if (!trimmed) return null;

  // Already exactly right. Nothing to say.
  if (known.includes(trimmed)) return null;

  const loose = (v: string): string => v.toLowerCase().replace(/\s+/g, " ").trim();

  const sameWords = known.find((name) => loose(name) === loose(trimmed));
  if (sameWords) {
    return {
      written: trimmed,
      meant: sameWords,
      note: `"${trimmed}" is on your list as "${sameWords}". Written differently it counts as a separate thing in every total.`,
    };
  }

  let best: string | null = null;
  let bestDistance = Number.MAX_SAFE_INTEGER;

  for (const name of known) {
    const distance = editsBetween(loose(name), loose(trimmed));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }

  if (!best || bestDistance === 0) return null;
  if (bestDistance > allowed(trimmed)) return null;

  return {
    written: trimmed,
    meant: best,
    note: `"${trimmed}" is one letter or two from "${best}". If it is the same thing, use the name on your list, or it will total separately.`,
  };
}

const squashed = (v: string): string => v.toLowerCase().replace(/\s+/g, "");

/**
 * Two names that look like one name typed twice.
 *
 * ── Why distance alone is the wrong test here ─────────────────────────────
 *
 * Both names are already on the owner's list, so both were typed on purpose
 * and the benefit of the doubt belongs to them. "Gcash" and "Cash" are one
 * edit apart and are two real, different wallets: flagging that pair would be
 * telling somebody their own accounts are a mistake, every time they open the
 * screen, until they stopped reading the warnings.
 *
 * So this looks for the shapes a slip actually makes, not for closeness:
 *
 *   same letters, different case or spacing   Gcash / GCash, Home Needs / HomeNeeds
 *   a doubled letter                          Food / Foood
 *   two neighbours swapped                    Travel / Travle
 *
 * Every one of those is a hand, not a decision. "Cash" is not one of them.
 */
function looksLikeASlip(a: string, b: string): boolean {
  // The same word wearing different capitals or spacing.
  if (squashed(a) === squashed(b)) return true;

  const left = squashed(a);
  const right = squashed(b);

  // A doubled letter: the longer one has a run of two where the shorter has one.
  if (Math.abs(left.length - right.length) === 1) {
    const long = left.length > right.length ? left : right;
    const short = left.length > right.length ? right : left;
    for (let i = 0; i < long.length; i += 1) {
      if (long.slice(0, i) + long.slice(i + 1) !== short) continue;
      // Only a repeat of the letter beside it counts. Dropping a letter that
      // is not a repeat makes a different word, which is a decision.
      if (long[i] === long[i - 1] || long[i] === long[i + 1]) return true;
    }
    return false;
  }

  // Two neighbours swapped.
  if (left.length === right.length) {
    for (let i = 0; i < left.length - 1; i += 1) {
      if (left[i] === right[i]) continue;
      const swapped = left.slice(0, i) + left[i + 1] + left[i] + left.slice(i + 2);
      return swapped === right;
    }
  }

  return false;
}

/**
 * Two names on the same list that are really one name typed twice.
 *
 * A list holding both "Food" and "Foood" is a list where every food total is
 * wrong and always will be, and neither entry looks wrong on its own. Only
 * the settings screen can fix that, so it is reported there rather than on a
 * card.
 */
export function confusablePairs(names: readonly string[]): NearMiss[] {
  const found: NearMiss[] = [];

  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = names[i];
      const b = names[j];
      if (!a || !b || a === b) continue;
      if (!looksLikeASlip(a, b)) continue;

      found.push({
        written: b,
        meant: a,
        note: `"${a}" and "${b}" are nearly the same name. Anything filed under one will not be counted under the other.`,
      });
    }
  }

  return found;
}
