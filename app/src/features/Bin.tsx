/**
 * Recycle bin: spec 7.8.
 *
 * Deletes are soft. A transaction stays here until it is restored or the user
 * explicitly, typed-confirmation destroys it: money records are never
 * silently gone.
 *
 * ── The width ─────────────────────────────────────────────────────────────
 *
 * A list of 136 rows capped at 1080px left a third of a 1920px screen empty,
 * and the owner asked for the space to be used. Stretching the rows would put
 * each Restore button a hand's width from the item it restores, so the space
 * goes to what the list could not say: how much of each kind is binned, and
 * what bringing rows back would do to each wallet before you do it.
 */

import { useMemo, useState } from "react";

import {
  Alert,
  Button,
  Card,
  EmptyState,
  FlowBadge,
  Money,
  SegmentedControl,
} from "../components/primitives";
import { SearchInput, TextInput } from "../components/forms";
import { binCounts, restoreImpact } from "../domain/binView";
import { formatShort } from "../domain/dates";
import { formatMoney } from "../domain/money";
import { matchesSearch, parseSearch } from "../domain/search";
import type { DeletedTransaction, TransactionType } from "../domain/types";
import type { Flow as FlowTone } from "../components/primitives";

const TONE: Record<TransactionType, FlowTone> = {
  Revenue: "revenue",
  Spending: "spending",
  Transfer: "transfer",
  Debt: "debt",
};

const TYPES: readonly TransactionType[] = ["Revenue", "Spending", "Transfer", "Debt"];

type TypeFilter = "all" | TransactionType;

/** A long bin reads a screenful at a time. */
const PAGE = 50;

function binnedOn(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

export function Bin({
  deleted,
  onRestore,
  onRestoreMany,
  onPurge,
}: {
  deleted: readonly DeletedTransaction[];
  onRestore: (id: string) => void;
  /** Several at once, as one move with one record of it. */
  onRestoreMany?: ((ids: readonly string[]) => void) | undefined;
  /** Absent when the ledger is in Firestore, where nothing can be destroyed. */
  onPurge?: ((id: string) => void) | undefined;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [limit, setLimit] = useState(PAGE);

  const counts = useMemo(() => binCounts(deleted), [deleted]);

  const matching = useMemo(() => {
    const terms = parseSearch(query);
    return deleted.filter((t) => (type === "all" || t.type === type) && matchesSearch(t, terms));
  }, [deleted, query, type]);

  const shown = matching.slice(0, limit);
  const filtered = type !== "all" || query.trim() !== "";

  const toggle = (id: string): void =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chosen = deleted.filter((t) => picked.has(t.id));
  const chosenTotal = chosen.reduce((sum, t) => sum + t.total, 0);
  const allPicked = matching.length > 0 && matching.every((t) => picked.has(t.id));
  const somePicked = matching.some((t) => picked.has(t.id));

  /** What the side panel describes: the rows ticked, or else the rows shown. */
  const impact = restoreImpact(chosen.length > 0 ? chosen : matching);

  const lastBinned = deleted.reduce((latest, t) => (t.deletedAt && t.deletedAt > latest ? t.deletedAt : latest), "");

  const target = deleted.find((d) => d.id === confirming);
  const expected = target ? String(target.recordNumber).padStart(4, "0") : "";

  const filterOptions: { id: TypeFilter; label: string }[] = [
    { id: "all", label: `All ${counts.all.count}` },
    ...TYPES.filter((k) => counts[k].count > 0).map((k) => ({ id: k as TypeFilter, label: `${k} ${counts[k].count}` })),
  ];

  const restoreChosen = (): void => {
    if (!onRestoreMany || chosen.length === 0) return;
    onRestoreMany(chosen.map((t) => t.id));
    setPicked(new Set());
  };

  const clearFilters = (): void => {
    setQuery("");
    setType("all");
    setLimit(PAGE);
  };

  return (
    <div className="fms-bin">
      <Card
        title="Recycle bin"
        subtitle="Deleted transactions stay here until you restore them"
        action={
          deleted.length > 0 ? (
            <span className="t-micro fms-badge fms-badge--count">
              {filtered ? `${matching.length} of ${deleted.length}` : `${deleted.length} rows`}
            </span>
          ) : undefined
        }
        padded={false}
      >
        {deleted.length > 0 && (
          <div className="fms-dbtools">
            <SearchInput
              value={query}
              onChange={(v) => {
                setQuery(v);
                setLimit(PAGE);
              }}
              placeholder="Search words, #0442, >1000, P500"
            />
            <SegmentedControl
              options={filterOptions}
              value={type}
              onChange={(id) => {
                setType(id);
                setLimit(PAGE);
              }}
              scroll
              label="Type"
            />
          </div>
        )}

        {onRestoreMany && matching.length > 0 && (
          /*
           * Restoring in bulk needs no confirmation.
           *
           * It puts money records back where they were, which is the
           * direction of this screen that cannot lose anything. Deleting
           * forever still asks, one row at a time, and still wants the
           * record number typed.
           */
          <div className="fms-bulkbar">
            <label className="fms-dbpick t-caption">
              <input
                type="checkbox"
                checked={allPicked}
                ref={(el) => {
                  if (el) el.indeterminate = somePicked && !allPicked;
                }}
                onChange={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    for (const t of matching) {
                      if (allPicked) next.delete(t.id);
                      else next.add(t.id);
                    }
                    return next;
                  })
                }
                aria-label={allPicked ? "Clear selection" : filtered ? "Select every row shown" : "Select everything in the bin"}
              />
              {chosen.length > 0 ? (
                <span className="t-body-strong">
                  {chosen.length} selected
                  <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                    {" "}
                    · {formatMoney(chosenTotal)}
                  </span>
                </span>
              ) : (
                <span style={{ color: "var(--ink-2)" }}>{filtered ? "Select all shown" : "Select all"}</span>
              )}
            </label>
            {chosen.length > 0 && (
              <span className="fms-bulkbar-actions">
                <Button size="sm" onClick={() => setPicked(new Set())}>
                  Clear
                </Button>
                <Button size="sm" variant="primary" onClick={restoreChosen}>
                  Restore {chosen.length}
                </Button>
              </span>
            )}
          </div>
        )}

        {deleted.length === 0 ? (
          <EmptyState message="Nothing deleted. Deleted transactions stay here until you clear them." />
        ) : matching.length === 0 ? (
          <EmptyState
            message={
              query.trim()
                ? `No binned row matches "${query.trim()}". Check the spelling or clear the filters.`
                : `No ${type} rows in the bin.`
            }
            action={<Button onClick={clearFilters}>Clear filters</Button>}
          />
        ) : (
          <>
            <ul className="fms-binlist" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {shown.map((t) => (
                <li key={t.id} className="fms-dbrow">
                  <div className="fms-dbrow-main">
                    {onRestoreMany && (
                      <label className="fms-dbpick">
                        <input
                          type="checkbox"
                          checked={picked.has(t.id)}
                          onChange={() => toggle(t.id)}
                          aria-label={`Select record ${t.recordNumber}`}
                        />
                      </label>
                    )}
                    <div className="fms-dbrow-text">
                      <div className="fms-dbrow-title">
                        <span className="t-body-strong fms-truncate">{t.item || "Uncategorised"}</span>
                        <FlowBadge flow={TONE[t.type]} />
                      </div>
                      <div className="t-caption fms-truncate" style={{ color: "var(--ink-2)" }}>
                        {t.description || "No description"}
                      </div>
                      <div className="t-micro" style={{ color: "var(--ink-3)" }}>
                        #{String(t.recordNumber).padStart(4, "0")} · {formatShort(t.date)}
                        {t.deletedAt && ` · deleted ${t.deletedAt.slice(0, 10)}`}
                      </div>
                    </div>

                    <div className="fms-binactions">
                      <Money value={t.total} />
                      <Button size="sm" variant="primary" onClick={() => onRestore(t.id)}>
                        Restore
                      </Button>
                      {onPurge && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            setConfirming(t.id);
                            setTyped("");
                          }}
                        >
                          Delete forever
                        </Button>
                      )}
                    </div>
                  </div>

                  {confirming === t.id && onPurge && (
                    <div style={{ marginTop: "var(--space-3)" }}>
                      <Alert status="over" title={`Permanently delete record #${expected}?`}>
                        This cannot be undone. Type <strong>{expected}</strong> to confirm.
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "var(--space-2)",
                            marginTop: "var(--space-3)",
                            maxWidth: 420,
                          }}
                        >
                          <span style={{ flex: "1 1 8rem", minWidth: 0 }}>
                            <TextInput
                              value={typed}
                              onChange={setTyped}
                              placeholder={expected}
                              ariaLabel={`Type ${expected} to confirm`}
                            />
                          </span>
                          <Button
                            variant="danger"
                            disabled={typed.trim() !== expected}
                            onClick={() => {
                              onPurge(t.id);
                              setConfirming(null);
                            }}
                          >
                            Delete
                          </Button>
                          <Button onClick={() => setConfirming(null)}>Cancel</Button>
                        </div>
                      </Alert>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {matching.length > shown.length && (
              <div className="fms-binmore">
                <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                  Showing {shown.length} of {matching.length}
                </span>
                <Button size="sm" onClick={() => setLimit((n) => n + PAGE)}>
                  Show {Math.min(PAGE, matching.length - shown.length)} more
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      {deleted.length > 0 && (
        <aside className="fms-binrail" aria-label="About the bin">
          <Card title="In the bin" subtitle="None of these count toward a balance or a total until restored">
            <ul className="fms-binsum">
              {TYPES.filter((k) => counts[k].count > 0).map((k) => (
                <li key={k}>
                  <span className="fms-binsum-type">
                    <FlowBadge flow={TONE[k]} />
                    <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                      {counts[k].count} {counts[k].count === 1 ? "row" : "rows"}
                    </span>
                  </span>
                  <Money value={counts[k].total} size="s" />
                </li>
              ))}
            </ul>
            {lastBinned && (
              <p className="t-caption" style={{ margin: "var(--space-3) 0 0", color: "var(--ink-3)" }}>
                Last binned {binnedOn(lastBinned)}
              </p>
            )}
          </Card>

          <Card
            title={
              chosen.length > 0
                ? `Restoring ${chosen.length} selected`
                : filtered
                  ? `Restoring the ${matching.length} shown`
                  : "Restoring everything"
            }
            subtitle="What each wallet's balance would move by"
          >
            {impact.length === 0 ? (
              <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
                No wallet would move.
              </p>
            ) : (
              <ul className="fms-binsum">
                {impact.map((m) => (
                  <li key={m.wallet}>
                    <span className="t-body fms-truncate">{m.wallet}</span>
                    <Money value={m.change} size="s" signed />
                  </li>
                ))}
              </ul>
            )}
            {chosen.length > 0 && onRestoreMany ? (
              <div style={{ marginTop: "var(--space-4)" }}>
                <Button variant="primary" fullWidth onClick={restoreChosen}>
                  Restore {chosen.length}
                </Button>
              </div>
            ) : (
              <p className="t-caption" style={{ margin: "var(--space-3) 0 0", color: "var(--ink-3)" }}>
                Tick rows to see what bringing back just those would do.
              </p>
            )}
          </Card>
        </aside>
      )}
    </div>
  );
}
