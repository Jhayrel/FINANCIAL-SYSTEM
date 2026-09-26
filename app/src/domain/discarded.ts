/**
 * What a thrown-away card was, in one line.
 *
 * A discarded card used to read "Discarded." and nothing else, so two of them
 * one above the other said nothing about which entries had gone (the owner,
 * 26 September 2026: "add detailed like not just discarded like add info").
 * The line keeps what the card held, so the conversation still reads as a
 * record of what was proposed and turned down.
 */

import type { Draft } from "./entry";
import { MONTH_NAMES } from "./dates";
import { formatMoney } from "./money";

/** "15 Sep 2026", short enough for the line. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${(MONTH_NAMES[m - 1] ?? "").slice(0, 3)} ${y}`;
}

/** Which way the money would have gone, in the card's own words. */
function route(d: Draft): string {
  if (d.flow === "Revenue") return d.toWallet ? `into ${d.toWallet}` : "";
  if (d.flow === "Transfer") {
    const from = d.fromWallet ? `from ${d.fromWallet}` : "";
    const to = d.toWallet ? `to ${d.toWallet}` : "out of your accounts";
    return [from, to].filter(Boolean).join(" ");
  }
  if (d.debtEffect === "draw" || d.debtEffect === "collect") return d.toWallet ? `into ${d.toWallet}` : "";
  return d.fromWallet ? `from ${d.fromWallet}` : "";
}

export function discardedWords(d: Draft): { readonly what: string; readonly detail: string } {
  const amount = d.amount === null ? "no amount" : formatMoney(d.amount + d.fee);
  const kind = d.flow || "Entry";
  const what = [kind, d.item, amount].filter(Boolean).join(", ");
  const described = d.description && d.description.toLowerCase() !== d.item.toLowerCase() ? `"${d.description}"` : "";
  const detail = [route(d), shortDate(d.date), described].filter(Boolean).join(", ");
  return { what, detail };
}
