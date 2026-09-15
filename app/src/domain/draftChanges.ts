/**
 * What a correction changes, field by field.
 *
 * Correcting a row from the Database opened it in the Add form and saved over
 * it with nothing on screen saying what was about to be different, so a slip
 * in a field you did not mean to touch was saved without a word. The owner
 * asked to see the edit clearly. The form lists these above Save, and the
 * button counts them.
 *
 * Words, not values: an amount reads as money, a blank reads as "none", and
 * spaces around a name are not a change.
 */

import type { Draft } from "./entry";
import { formatMoney, type Centavos } from "./money";

export interface DraftChange {
  readonly field: string;
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

const money = (v: Centavos | null): string => (v === null ? "none" : formatMoney(v));
const words = (v: string | undefined): string => (v ?? "").trim() || "none";
const destination = (d: Draft): string => (d.flow === "Transfer" && d.sentOut ? "Someone else" : words(d.toWallet));

/** The fields that differ, in the order the form shows them. */
export function draftChanges(before: Draft, after: Draft): DraftChange[] {
  const pairs: readonly (readonly [string, string, string, string])[] = [
    ["flow", "Type", words(before.flow), words(after.flow)],
    ["debtId", "Debt", words(before.debtId), words(after.debtId)],
    ["debtEffect", "Effect", words(before.debtEffect), words(after.debtEffect)],
    ["amount", "Amount", money(before.amount), money(after.amount)],
    ["fee", "Fee", money(before.fee), money(after.fee)],
    ["category", "Category", words(before.category), words(after.category)],
    ["item", "Item", words(before.item), words(after.item)],
    ["description", "Description", words(before.description), words(after.description)],
    ["fromWallet", "From", words(before.fromWallet), words(after.fromWallet)],
    ["toWallet", "To", destination(before), destination(after)],
    ["date", "Date", words(before.date), words(after.date)],
    ["status", "Status", words(before.status), words(after.status)],
    ["notes", "Notes", words(before.notes), words(after.notes)],
  ];
  return pairs
    .filter(([, , was, now]) => was !== now)
    .map(([field, label, was, now]) => ({ field, label, before: was, after: now }));
}
