/**
 * The owner's real record, replayed through the reader. Local only.
 *
 * ── Why this reads a file instead of holding sentences ────────────────────
 *
 * The committed test set is invented, because this repository is public. But
 * invented sentences can only ever test what somebody thought to write down,
 * and the owner types things nobody would think of. Their Coderview export
 * holds every sentence they have ever sent, and replaying all of them is the
 * truest measure there is of how the reader does on real input.
 *
 * So this reads that export straight off the owner's disk, reports, and
 * writes nothing. It is skipped unless pointed at a file, and the export is
 * already excluded by `.gitignore`, so none of it can reach the repository.
 *
 * Run it with, in PowerShell:
 *   $env:CODERVIEW = "C:\path\to\coderview-2026-09-05.txt"; npx vitest run src/domain/eval/replayRecord
 */

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { comparesMonths, wantsChart } from "../charts";
import { isQuestion } from "../intent";
import { readEntry } from "../readEntry";
import { detectRecall, wantsDiscardOpen } from "../recall";
import type { ReferenceLists } from "../types";

const path = process.env["CODERVIEW"] ?? "";
const present = path !== "" && existsSync(path);

interface Settings {
  readonly accounts?: readonly { name: string; kind: string; archived?: boolean }[];
  readonly bills?: readonly string[];
  readonly subscriptions?: readonly string[];
  readonly revenueCategories?: readonly string[];
  readonly spendingTypes?: readonly { name: string; remark: string }[];
  readonly credits?: readonly { name: string; archived?: boolean }[];
}

/** The owner's own lists, rebuilt from the settings document in the export. */
function referenceFrom(settings: Settings): ReferenceLists {
  const names = (kinds: readonly string[]) =>
    (settings.accounts ?? [])
      .filter((a) => kinds.includes(a.kind) && !a.archived)
      .map((a) => a.name);
  return {
    wallets: names(["spending"]),
    savings: names(["savings", "goal", "reserve"]),
    bills: settings.bills ?? [],
    subscriptions: settings.subscriptions ?? [],
    revenueCategories: settings.revenueCategories ?? [],
    spendingTypes: settings.spendingTypes ?? [],
    credits: (settings.credits ?? []).filter((c) => !c.archived).map((c) => c.name),
  };
}

describe.skipIf(!present)("the owner's real record", () => {
  it("replays every sentence they typed", () => {
    const dump = readFileSync(path, "utf-8");
    const section = (name: string): string => {
      const start = dump.indexOf(`── ${name} (`);
      const end = dump.indexOf("\n── ", start + 5);
      return start < 0 ? "" : dump.slice(start, end < 0 ? undefined : end);
    };

    const docs = (name: string): Record<string, unknown>[] =>
      section(name)
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("{"))
        .flatMap((l) => {
          try {
            return [JSON.parse(l) as Record<string, unknown>];
          } catch {
            return [];
          }
        });

    const settings = (docs("meta")[0] ?? {}) as Settings;
    const reference = referenceFrom(settings);

    const sentences = [
      ...new Set(
        docs("chat")
          .filter((d) => d["role"] === "you" && !("card" in d))
          .map((d) => String(d["text"] ?? "").trim())
          .filter((t) => t !== "" && !t.startsWith("//") && t.length <= 200),
      ),
    ];

    const counts = { entry: 0, borrowing: 0, question: 0, delete: 0, discard: 0, chart: 0, nothing: 0 };
    const nothing: string[] = [];

    for (const s of sentences) {
      const r = readEntry(s, [], reference, new Date().toISOString().slice(0, 10));
      if (wantsDiscardOpen(s)) counts.discard += 1;
      else if (detectRecall(s)) counts.delete += 1;
      else if (r.readsAsDebt && !isQuestion(s)) counts.borrowing += 1;
      else if (r.worthOffering && !isQuestion(s)) counts.entry += 1;
      else if (wantsChart(s) || comparesMonths(s)) counts.chart += 1;
      else if (isQuestion(s)) counts.question += 1;
      else {
        counts.nothing += 1;
        nothing.push(s);
      }
    }

    console.log(
      [
        "",
        `── Replay: ${sentences.length} distinct sentences ─────────────────`,
        ...Object.entries(counts).map(([k, v]) => `  ${k.padEnd(10)} ${v}`),
        "",
        "  Read as nothing at all (the list worth reading):",
        ...nothing.map((s) => `    ${s}`),
      ].join("\n"),
    );

    expect(sentences.length).toBeGreaterThan(0);
  });
});
