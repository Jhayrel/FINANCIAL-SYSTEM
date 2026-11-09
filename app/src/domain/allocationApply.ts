/**
 * Every change to the allocations, worked out once (docs/17 A7, A12): add,
 * edit, remove, put back, done, hold again and copy. Budget and the chat both
 * go through here, so the card the chat shows before a change and the list
 * App saves after it are the same list. Pure: no storage, no React.
 */
import { spreadCovered } from "./covers";
import {
  allocatableKinds,
  checkAllocation,
  checkRestore,
  copyLines,
  covers,
  editAllocation,
  fromFor,
  lineName,
  linesIn,
  makeAllocation,
  monthAllocations,
  monthBefore,
  monthWords,
  type AllocationChange,
  type AllocationLine,
} from "./monthAllocation";
import type { IsoDate, ReferenceLists, Transaction } from "./types";

export interface ApplyContext {
  readonly reference: Pick<ReferenceLists, "spendingTypes" | "bills" | "subscriptions" | "wallets" | "savings">;
  readonly transactions: readonly Transaction[];
  readonly asOf: IsoDate;
  readonly newId: () => string;
}

export type Applied =
  | {
      readonly ok: true;
      readonly lines: AllocationLine[];
      /** The line as it was, for edit, remove, put back, done and hold again. */
      readonly was?: AllocationLine;
      /** The line made or changed. */
      readonly line?: AllocationLine;
      /** A repeating line changed or stopped from this month on; the months before keep it. */
      readonly from?: string;
      /** A line put back that had been stopped from a month, not removed whole. */
      readonly unstopped?: boolean;
      /** What a line marked done had left, now free. */
      readonly freed?: number;
      /** Lines copied. */
      readonly copied?: readonly AllocationLine[];
    }
  | { readonly ok: false; readonly why: string };

const without = <K extends keyof AllocationLine>(l: AllocationLine, key: K): AllocationLine => {
  const { [key]: _gone, ...rest } = l;
  return rest as AllocationLine;
};

export function applyAllocationChange(all: readonly AllocationLine[], change: AllocationChange, ctx: ApplyContext): Applied {
  const { reference, asOf } = ctx;
  if (change.kind === "add") {
    const why = checkAllocation(change.input, change.month, all, reference, fromFor(change.input, change.month, asOf));
    if (why) return { ok: false, why };
    const line = makeAllocation(change.input, change.month, asOf, ctx.newId());
    return { ok: true, lines: [...all, line], line };
  }
  if (change.kind === "copy") {
    const kinds = new Set(allocatableKinds(reference).map((k) => k.toLowerCase()));
    const copied = copyLines(all, change.from, change.to, asOf, ctx.newId).filter((l) => kinds.has(l.kind.trim().toLowerCase()));
    if (copied.length === 0) {
      return {
        ok: false,
        why: linesIn(all, change.from).length === 0 ? `${monthWords(change.from)} has no allocations to copy.` : `Every allocation in ${monthWords(change.from)} is in ${monthWords(change.to)} already.`,
      };
    }
    return { ok: true, lines: [...all, ...copied], copied };
  }
  const was = all.find((l) => l.id === change.id);
  if (!was) return { ok: false, why: "That allocation is not there any more: it was removed, perhaps on another device." };
  const put = (line: AllocationLine): AllocationLine[] => all.map((l) => (l.id === was.id ? line : l));

  if (change.kind === "edit") {
    // A repeating line changed in a later month changes from that month on (A12).
    const from = change.month && change.month > was.month && was.repeat ? change.month : null;
    if (from) {
      // Never an empty list: what is saved reads back the same (stress test, 9 November 2026).
      const before = was.done?.filter((d) => d.month < from) ?? [];
      const kept: AllocationLine = { ...without(was, "done"), until: monthBefore(from), ...(before.length > 0 ? { done: before } : {}) };
      const why = checkAllocation(change.input, from, [...all.filter((l) => l.id !== was.id), kept], reference);
      if (why) return { ok: false, why };
      const made = makeAllocation(change.input, from, asOf, ctx.newId(), undefined);
      const moved = was.done?.filter((d) => d.month >= from) ?? [];
      const line: AllocationLine = moved.length > 0 ? { ...made, done: moved } : made;
      return { ok: true, lines: [...put(kept), line], was, line, from };
    }
    const why = checkAllocation(change.input, was.month, all.filter((l) => l.id !== was.id), reference, change.input.per === "day" ? was.from : undefined);
    if (why) return { ok: false, why };
    const line = { ...editAllocation(was, change.input), ...(was.removedOn ? { removedOn: was.removedOn } : {}) };
    return { ok: true, lines: put(line), was, line };
  }

  if (change.kind === "done" || change.kind === "undone") {
    // Only a month it holds in, and one that has started: a month ahead holds nothing yet, so there is nothing to free.
    if (!covers(was, change.month)) return { ok: false, why: `${lineName(was)} is not an allocation for ${monthWords(change.month)}.` };
    if (change.month > asOf.slice(0, 7)) return { ok: false, why: `${monthWords(change.month)} has not started, so ${lineName(was)} holds nothing yet to free.` };
    const status = monthAllocations([was], spreadCovered(ctx.transactions), change.month, asOf).lines[0];
    const others = (was.done ?? []).filter((d) => d.month !== change.month);
    if (change.kind === "done") {
      if (status?.done) return { ok: false, why: `${status.name} is done for ${monthWords(change.month)} already.` };
      const line: AllocationLine = { ...was, done: [...others, { month: change.month, on: asOf }] };
      return { ok: true, lines: put(line), was, line, freed: Math.max(0, status?.left ?? 0) };
    }
    if (!status?.done) return { ok: false, why: `${status?.name ?? "That allocation"} is not marked done for ${monthWords(change.month)}, so it holds already.` };
    const line = others.length > 0 ? { ...was, done: others } : without(was, "done");
    return { ok: true, lines: put(line), was, line };
  }

  if (change.kind === "restore") {
    if (!was.removedOn && !was.stoppedFrom) return { ok: false, why: "That allocation is not removed, so there is nothing to put back." };
    const why = checkRestore(was, all);
    if (why) return { ok: false, why };
    const unstopped = Boolean(was.stoppedFrom && !was.removedOn);
    const line = unstopped ? without(was, "stoppedFrom") : without(was, "removedOn");
    return { ok: true, lines: put(line), was, line, unstopped };
  }

  // Remove: a repeating line removed in a later month stops from it; otherwise it is removed whole. Kept either way (A7).
  if (was.removedOn) return { ok: false, why: "That allocation is removed already. It is under Removed on Budget and in the Bin." };
  const from = change.month && change.month > was.month && was.repeat ? change.month : null;
  if (from) {
    if (was.stoppedFrom && was.stoppedFrom <= from) return { ok: false, why: `It is stopped from ${monthWords(was.stoppedFrom)} already.` };
    const line: AllocationLine = { ...was, stoppedFrom: from };
    return { ok: true, lines: put(line), was, line, from };
  }
  const line: AllocationLine = { ...was, removedOn: asOf };
  return { ok: true, lines: put(line), was, line };
}

/** What a change does to what is set aside this month: held before and after. */
export function heldChange(before: readonly AllocationLine[], after: readonly AllocationLine[], transactions: readonly Transaction[], asOf: IsoDate): { readonly before: number; readonly after: number } {
  const rows = spreadCovered(transactions);
  const ym = asOf.slice(0, 7);
  return { before: monthAllocations(before, rows, ym, asOf).held, after: monthAllocations(after, rows, ym, asOf).held };
}
