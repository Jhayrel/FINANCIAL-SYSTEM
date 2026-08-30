import { useMemo, useState } from "react";

import { Badge, Card, EmptyState, Money } from "../components/ui";
import { formatShort } from "../domain/dates";
import { formatMoney } from "../domain/money";
import { checkIntegrity, type Issue } from "../domain/integrity";
import type { Ledger } from "../data/localSource";
import type { Transaction, TransactionType } from "../domain/types";

const TYPES: (TransactionType | "All")[] = ["All", "Spending", "Revenue", "Transfer"];

const typeTone = (t: TransactionType) =>
  t === "Revenue" ? "good" : t === "Transfer" ? "neutral" : "warn";

export function LedgerView({ ledger }: { ledger: Ledger }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TransactionType | "All">("All");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [limit, setLimit] = useState(60);

  /** Issues indexed by transaction id, so rows can show their own flags. */
  const issuesById = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of checkIntegrity(ledger.transactions)) {
      if (issue.severity === "info") continue;
      for (const id of issue.ids) {
        const list = map.get(id);
        if (list) list.push(issue);
        else map.set(id, [issue]);
      }
    }
    return map;
  }, [ledger.transactions]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();

    return ledger.transactions
      .filter((t) => {
        if (type !== "All" && t.type !== type) return false;
        if (flaggedOnly && !issuesById.has(t.id)) return false;
        if (!q) return true;
        return (
          t.item.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.fromWallet.toLowerCase().includes(q) ||
          t.toWallet.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          t.notes.toLowerCase().includes(q) ||
          String(t.recordNumber) === q
        );
      })
      .sort((a, b) => (a.date === b.date ? b.recordNumber - a.recordNumber : b.date.localeCompare(a.date)));
  }, [ledger.transactions, query, type, flaggedOnly, issuesById]);

  const shown = rows.slice(0, limit);
  const flaggedCount = issuesById.size;

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(60);
          }}
          placeholder="Search item, description, wallet…"
          aria-label="Search transactions"
          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border)",
            color: "var(--text)",
          }}
        />
        <div
          className="flex overflow-hidden rounded-lg border"
          style={{ borderColor: "var(--border)" }}
        >
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => {
                setType(t);
                setLimit(60);
              }}
              className="px-3 py-2 text-xs font-medium transition-colors"
              style={{
                background: type === t ? "var(--color-brand-700)" : "var(--surface)",
                color: type === t ? "#fff" : "var(--text-2)",
              }}
            >
              {t}
            </button>
          ))}
        </div>
        {flaggedCount > 0 && (
          <button
            onClick={() => {
              setFlaggedOnly((v) => !v);
              setLimit(60);
            }}
            className="rounded-lg border px-3 py-2 text-xs font-medium"
            style={{
              background: flaggedOnly ? "var(--warn-bg)" : "var(--surface)",
              borderColor: flaggedOnly ? "var(--warn)" : "var(--border)",
              color: flaggedOnly ? "var(--warn)" : "var(--text-2)",
            }}
          >
            ⚠ {flaggedCount} flagged
          </button>
        )}
      </div>

      <p className="text-xs" style={{ color: "var(--text-3)" }}>
        {rows.length.toLocaleString()} of {ledger.transactions.length.toLocaleString()}{" "}
        records
      </p>

      <Card className="overflow-hidden">
        {shown.length === 0 ? (
          <EmptyState title="Nothing matches those filters" />
        ) : (
          <>
            {/* Phone: stacked rows. Desktop: real table. */}
            <ul className="lg:hidden">
              {shown.map((t) => (
                <MobileRow key={t.id} t={t} issues={issuesById.get(t.id)} />
              ))}
            </ul>

            <div className="scroll-slim hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-xs uppercase tracking-wide"
                    style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
                  >
                    <th className="px-3 py-2 font-semibold">#</th>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">From → To</th>
                    <th className="px-3 py-2 font-semibold">Item</th>
                    <th className="px-3 py-2 font-semibold">Description</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="px-3 py-2 text-right font-semibold">Fee</th>
                    <th className="px-3 py-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => {
                    const issues = issuesById.get(t.id);
                    return (
                      <tr
                        key={t.id}
                        className="border-t"
                        style={{
                          borderColor: "var(--border)",
                          background: issues ? "var(--warn-bg)" : undefined,
                        }}
                        title={issues?.map((i) => i.message).join("\n")}
                      >
                        <td className="tnum px-3 py-2" style={{ color: "var(--text-3)" }}>
                          {String(t.recordNumber).padStart(4, "0")}
                        </td>
                        <td className="tnum px-3 py-2 whitespace-nowrap">
                          {formatShort(t.date)}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={typeTone(t.type)}>{t.type}</Badge>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-2)" }}>
                          {t.fromWallet || "—"}
                          {t.toWallet && ` → ${t.toWallet}`}
                        </td>
                        <td className="px-3 py-2">
                          {t.item || <span style={{ color: "var(--text-3)" }}>—</span>}
                        </td>
                        <td
                          className="max-w-xs truncate px-3 py-2"
                          style={{ color: "var(--text-2)" }}
                          title={t.description}
                        >
                          {t.description}
                        </td>
                        <td className="tnum px-3 py-2 text-right">
                          {formatMoney(t.amount, { symbol: false })}
                        </td>
                        <td
                          className="tnum px-3 py-2 text-right"
                          style={{ color: t.fee ? "var(--warn)" : "var(--text-3)" }}
                        >
                          {t.fee ? formatMoney(t.fee, { symbol: false }) : "—"}
                        </td>
                        <td className="tnum px-3 py-2 text-right font-semibold">
                          {formatMoney(t.total, { symbol: false })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {rows.length > shown.length && (
              <button
                onClick={() => setLimit((n) => n + 100)}
                className="w-full border-t px-4 py-3 text-sm font-medium"
                style={{ borderColor: "var(--border)", color: "var(--color-brand-600)" }}
              >
                Show {Math.min(100, rows.length - shown.length)} more
              </button>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function MobileRow({ t, issues }: { t: Transaction; issues: Issue[] | undefined }) {
  return (
    <li
      className="border-b px-4 py-3 last:border-b-0"
      style={{
        borderColor: "var(--border)",
        background: issues ? "var(--warn-bg)" : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{t.item || "Uncategorised"}</span>
            <Badge tone={typeTone(t.type)}>{t.type}</Badge>
          </div>
          <p className="truncate text-xs" style={{ color: "var(--text-2)" }}>
            {t.description || "No description"}
          </p>
          <p className="tnum mt-0.5 text-xs" style={{ color: "var(--text-3)" }}>
            {formatShort(t.date)} · {t.fromWallet || "—"}
            {t.toWallet && ` → ${t.toWallet}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Money
            value={t.type === "Revenue" ? t.total : -t.total}
            signed
            className="text-sm font-semibold"
          />
          {t.fee > 0 && (
            <p className="tnum text-xs" style={{ color: "var(--warn)" }}>
              +{formatMoney(t.fee, { symbol: false })} fee
            </p>
          )}
        </div>
      </div>
      {issues?.map((i) => (
        <p key={i.code} className="mt-1.5 text-xs" style={{ color: "var(--warn)" }}>
          ⚠ {i.message}
        </p>
      ))}
    </li>
  );
}
