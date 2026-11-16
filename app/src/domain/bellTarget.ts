/**
 * Where on a screen a finding from the bell is about, and which findings
 * the owner has put away.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * The owner, 14 November 2026: "it just show the same thing everytime and I
 * cannot see them properly like if I click insight or click open budget ...
 * it doesn't show it where or what is that". A finding opened a screen and
 * left the owner to find the part it meant, and the same list came back
 * every time with nothing to do about it.
 *
 * So the finding travels with the tap: the screen it opens says which
 * finding brought it there, and the part of the screen that names the same
 * thing is outlined. A finding can be hidden; it comes back only when what
 * it says has changed, since a changed figure is news.
 */

/** The words to look for on the screen a finding opens, most telling first. */
export function bellNeedles(finding: { readonly title: string; readonly detail: string }, names: readonly string[]): string[] {
  const text = ` ${finding.title} ${finding.detail} `.toLowerCase();
  const said = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3))]
    .filter((n) => new RegExp(`(?<![a-z0-9])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(text))
    .sort((a, b) => b.length - a.length);
  return [finding.title, ...said].filter(Boolean);
}

export interface Hidden {
  /** The finding's id, and what it said when it was hidden. */
  readonly [id: string]: string;
}

/** What a finding says, for telling whether it has changed since it was hidden. */
export const sayingOf = (finding: { readonly title: string; readonly detail: string }): string => `${finding.title}|${finding.detail}`;

/** The findings to show, and how many are put away: one hidden comes back when what it says changes. */
export function splitHidden<F extends { readonly id: string; readonly title: string; readonly detail: string }>(
  findings: readonly F[],
  hidden: Hidden,
): { readonly shown: F[]; readonly away: F[] } {
  const shown: F[] = [];
  const away: F[] = [];
  for (const f of findings) (hidden[f.id] === sayingOf(f) ? away : shown).push(f);
  return { shown, away };
}

/** The hidden list with only findings still there, so it never grows without end. */
export function prunedHidden(findings: readonly { readonly id: string; readonly title: string; readonly detail: string }[], hidden: Hidden): Hidden {
  const live = new Map(findings.map((f) => [f.id, sayingOf(f)]));
  return Object.fromEntries(Object.entries(hidden).filter(([id, saying]) => live.get(id) === saying));
}

/**
 * A notification that stays until what it says is dealt with: it cannot be
 * cleared, only resolved, as a phone keeps an ongoing notification until the
 * app that posted it takes it away.
 *
 * The owner, 17 November 2026: "make it act like notification like it can be
 * clear or removed but if its important it canot". Money already gone wrong
 * or due today: a wallet below zero, a bill past due or due today, a debt
 * payment late, a plan past its date. Everything else is cleared with Clear,
 * and comes back only if its figures change.
 */
export function mustStay(finding: { readonly id: string; readonly level: "over" | "warn" | "info" }): boolean {
  const id = finding.id;
  if (id === "bills-overdue" || id === "bills-today") return true;
  if (id.startsWith("negative-") || id.startsWith("plan-overdue-")) return true;
  if (id.startsWith("debt-") && !id.startsWith("debt-below-zero-")) return finding.level === "over";
  return false;
}

/** New ones first, each part kept in its own order (worst first), so the one the badge counted is the first seen. */
export function newFirst<F extends { readonly id: string }>(findings: readonly F[], seen: ReadonlySet<string>): F[] {
  return [...findings.filter((f) => !seen.has(f.id)), ...findings.filter((f) => seen.has(f.id))];
}
