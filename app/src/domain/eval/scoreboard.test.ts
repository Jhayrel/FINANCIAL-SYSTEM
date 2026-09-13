/**
 * The scoreboard.
 *
 * Every sentence in `corpus.ts`, read the way the app reads it, and compared
 * with what should have happened. A case that passes today must pass forever:
 * that is the regression guard. A case marked as a gap is still scored, so a
 * fix shows up as a better number rather than going unnoticed.
 *
 * Run it on its own with:  npx vitest run src/domain/eval
 */

import { afterAll, describe, expect, it } from "vitest";

import { CORPUS, REFERENCE, TODAY, type Case, type Tag } from "./corpus";
import { comparesMonths, wantsChart } from "../charts";
import { isAdvice, isQuestion } from "../intent";
import { readEntry, splitEntries } from "../readEntry";
import { detectRecall, wantsDiscardOpen } from "../recall";

const read = (text: string) => readEntry(text, [], REFERENCE, TODAY);

/**
 * What the app would do with this sentence, and whether that is right.
 *
 * Mirrors the order `AskPanel` decides in, using the same pure functions, so
 * this measures the real behaviour rather than an idealised one. Returns why
 * it failed, in words, so a red test explains itself.
 */
export function judge(c: Case): string | null {
  const e = c.expect;

  switch (e.kind) {
    case "entry": {
      const r = read(c.said);
      if (r.readsAsDebt) return "read as borrowing";
      if (isQuestion(c.said) && !r.worthOffering) return "read as a question";
      if (!r.worthOffering) return "read as nothing";
      const d = r.draft;
      if (d.flow !== e.flow) return `flow ${d.flow || "blank"}, wanted ${e.flow}`;
      if (e.item !== undefined && d.item !== e.item) return `item ${d.item || "blank"}, wanted ${e.item}`;
      if (e.pesos !== undefined && d.amount !== Math.round(e.pesos * 100)) {
        return `amount ${d.amount === null ? "blank" : d.amount / 100}, wanted ${e.pesos}`;
      }
      if (e.from !== undefined && d.fromWallet !== e.from) return `from ${d.fromWallet || "blank"}, wanted ${e.from}`;
      if (e.to !== undefined && d.toWallet !== e.to) return `to ${d.toWallet || "blank"}, wanted ${e.to}`;
      if (e.sentOut === true && d.sentOut !== true) return "not read as leaving the accounts";
      if (e.status !== undefined && d.status !== e.status) return `status ${d.status || "blank"}, wanted ${e.status}`;
      return null;
    }

    case "split": {
      const parts = splitEntries(c.said);
      if (parts.length !== e.parts) return `${parts.length} parts, wanted ${e.parts}`;
      const unread = parts.filter((p) => {
        const r = read(p);
        return !r.readsAsDebt && !r.worthOffering;
      });
      return unread.length > 0 ? `a part read as nothing: "${unread[0]}"` : null;
    }

    case "debt": {
      const r = read(c.said);
      if (!r.readsAsDebt) return `not read as borrowing (flow ${r.draft.flow || "blank"})`;
      if (isQuestion(c.said)) return "read as a question";
      if (e.credit !== undefined && r.draft.debtId !== e.credit) {
        return `credit line ${r.draft.debtId ?? "blank"}, wanted ${e.credit}`;
      }
      return null;
    }

    case "question": {
      if (!isQuestion(c.said)) return "not recognised as a question";
      /**
       * A question that also reads as an entry is filed as one, because the
       * app checks for an entry first. That is exactly the failure that turned
       * advice into two PHP 20,000 rows, so it is scored as a failure here.
       */
      const r = read(c.said);
      // Advice outranks an entry reading, exactly as `AskPanel` decides it.
      if (r.worthOffering && !r.readsAsDebt && !isAdvice(c.said)) {
        return `would be filed as a ${r.draft.flow} entry`;
      }
      return null;
    }

    case "delete":
      return detectRecall(c.said)?.action === "bin" ? null : "not read as a delete";

    case "restore":
      return detectRecall(c.said)?.action === "restore" ? null : "not read as a restore";

    case "discard":
      return wantsDiscardOpen(c.said) ? null : "not read as a discard";

    case "chart":
      if (!wantsChart(c.said) && !comparesMonths(c.said)) return "not read as a chart";
      if (e.compares && !comparesMonths(c.said)) return "not read as a comparison";
      return null;
  }
}

const tally = new Map<Tag, { passed: number; total: number }>();
const failures: string[] = [];

describe("the scoreboard", () => {
  for (const c of CORPUS) {
    const why = judge(c);
    const row = tally.get(c.tag) ?? { passed: 0, total: 0 };
    row.total += 1;
    if (why === null) row.passed += 1;
    else failures.push(`[${c.tag}] ${c.said}  =>  ${why}${c.gap ? "  (known gap)" : ""}`);
    tally.set(c.tag, row);

    const run = c.gap ? it.skip : it;
    run(`${c.tag}: ${c.said}`, () => {
      expect(why, why ?? "").toBeNull();
    });
  }

  afterAll(() => {
    const lines: string[] = ["", "── Scoreboard ─────────────────────────────────────────"];
    let passed = 0;
    let total = 0;
    for (const [tag, row] of tally) {
      passed += row.passed;
      total += row.total;
      lines.push(`  ${tag.padEnd(26)} ${String(row.passed).padStart(3)} / ${row.total}`);
    }
    lines.push(`  ${"TOTAL".padEnd(26)} ${String(passed).padStart(3)} / ${total}  (${Math.round((passed / total) * 100)}%)`);
    if (failures.length > 0) {
      lines.push("", "  Failing:");
      for (const f of failures) lines.push(`    ${f}`);
    }
    console.log(lines.join("\n"));
  });
});
