/**
 * A statement screenshot is one account, all the way down.
 *
 * ── The failure this exists for ───────────────────────────────────────────
 *
 * The owner uploaded `Screenshot_20260905_132223_Maya.jpg`, a Maya
 * transaction list holding eight rows. The first two cards came back with
 * Maya on them. The rest came back with Gcash:
 *
 *   0455  Spotify              PHP    85.00  from Maya    correct
 *   0456  Withdrawal           PHP 2,015.00  from Maya    correct
 *   0458  Retail Store         PHP   223.36  from Gcash   wrong
 *   0459  Bills Payment        PHP 4,021.36  from Gcash   wrong
 *   ....  Received money       PHP 5,004.72  into Gcash   wrong
 *
 * Nothing about the picture changed halfway down. The model simply drifted,
 * which is what a small model does over eight repetitive rows, and every one
 * of those is money booked against the wrong wallet. CLAUDE.md names this as
 * the exact failure the whole reading layer is built to avoid: a wrong wallet
 * is how money lands in the wrong pocket and stays there.
 *
 * ── Why the file name is evidence ─────────────────────────────────────────
 *
 * A phone names a screenshot after the app it was taken in. That name is not
 * a guess about the contents, it is a fact recorded by the device at the
 * moment the picture was taken, and it says Maya. When it says nothing, the
 * rows themselves vote: eight rows off one statement that mostly say Maya are
 * a Maya statement with a few misreadings in it, not a mixture.
 *
 * ── What this does and does not do ────────────────────────────────────────
 *
 * It fills a blank and it flags a disagreement. It never silently rewrites a
 * wallet the model was confident about, because integrity checks report and
 * never auto-correct, and because a statement genuinely can contain a
 * transfer whose other end is a different account. Only the side of the row
 * that belongs to this account is examined: what a transfer went *to* is
 * nobody's business but the transfer's.
 */

import type { Draft } from "./entry";

/** The end of a row that belongs to the account the statement is for. */
export function ownSide(flow: Draft["flow"]): "fromWallet" | "toWallet" {
  return flow === "Revenue" ? "toWallet" : "fromWallet";
}

const clean = (value: string): string => value.trim().toLowerCase();

/**
 * An account named in a file name.
 *
 * Longest first, so "Maya Bank (Personal savings)" is preferred over "Maya"
 * when a name contains both. Matched on the letters and digits alone, because
 * a phone writes `Screenshot_20260905_132223_Maya.jpg` and a person writes
 * "maya statement.png", and the punctuation between is noise either way.
 */
export function accountNamedIn(fileName: string, accounts: readonly string[]): string {
  const haystack = clean(fileName).replace(/[^a-z0-9]+/g, " ");
  const byLength = [...accounts].sort((a, b) => b.length - a.length);

  for (const account of byLength) {
    const needle = clean(account).replace(/[^a-z0-9]+/g, " ").trim();
    if (!needle) continue;
    if (haystack.includes(needle)) return account;
  }
  return "";
}

/**
 * Which account these rows came off, when they plainly came off one.
 *
 * The file name wins, because the device wrote it. Failing that the rows
 * vote, and only a clear majority counts: four rows saying Maya and four
 * saying Gcash is a mixture this cannot resolve, and guessing between them
 * would be inventing the answer rather than reading it.
 */
export function statementAccount(
  fileName: string,
  drafts: readonly Draft[],
  accounts: readonly string[],
): string {
  const named = accountNamedIn(fileName, accounts);
  if (named) return named;

  const votes = new Map<string, number>();
  for (const draft of drafts) {
    const wallet = draft[ownSide(draft.flow)].trim();
    if (wallet) votes.set(wallet, (votes.get(wallet) ?? 0) + 1);
  }

  let best = "";
  let most = 0;
  let total = 0;
  for (const [wallet, count] of votes) {
    total += count;
    if (count > most) {
      most = count;
      best = wallet;
    }
  }

  // More than half, and at least two, so one row never decides for the rest.
  return most >= 2 && most * 2 > total ? best : "";
}

export interface Reading {
  readonly draft: Draft;
  /** Empty when nothing was changed or worth saying. */
  readonly note: string;
}

/**
 * Every row read against the account the statement belongs to.
 *
 * A blank is filled, which is the ordinary case and the reason "same for all"
 * existed as a button. A disagreement is left exactly as the model read it
 * and said out loud, because this cannot know whether row six is a drift or a
 * genuine transfer into another pocket, and the owner can tell at a glance.
 */
export function readAgainst(account: string, drafts: readonly Draft[]): Reading[] {
  if (!account) return drafts.map((draft) => ({ draft, note: "" }));

  return drafts.map((draft) => {
    const side = ownSide(draft.flow);
    const has = draft[side].trim();

    if (!has) {
      return {
        draft: { ...draft, [side]: account },
        note: `Filled in ${account}, which is the account this statement is for.`,
      };
    }

    if (clean(has) !== clean(account)) {
      return {
        draft,
        note: `This came off a ${account} statement but reads as ${has}. Check it before adding.`,
      };
    }

    return { draft, note: "" };
  });
}
