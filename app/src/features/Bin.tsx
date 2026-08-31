/**
 * Recycle bin: spec 7.8.
 *
 * Deletes are soft. A transaction stays here until it is restored or the user
 * explicitly, typed-confirmation destroys it: money records are never
 * silently gone.
 */

import { useState } from "react";

import { Alert, Button, Card, EmptyState, FlowBadge, Money } from "../components/primitives";
import { TextInput } from "../components/forms";
import { formatShort } from "../domain/dates";
import { formatMoney } from "../domain/money";
import type { DeletedTransaction, TransactionType } from "../domain/types";
import type { Flow as FlowTone } from "../components/primitives";

const TONE: Record<TransactionType, FlowTone> = {
  Revenue: "revenue",
  Spending: "spending",
  Transfer: "transfer",
  Debt: "debt",
};

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

  const toggle = (id: string): void =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chosen = deleted.filter((t) => picked.has(t.id));
  const chosenTotal = chosen.reduce((sum, t) => sum + t.total, 0);
  const allPicked = deleted.length > 0 && chosen.length === deleted.length;

  const target = deleted.find((d) => d.id === confirming);
  const expected = target ? String(target.recordNumber).padStart(4, "0") : "";

  return (
    <div className="fms-db">
      <Card
        title="Recycle bin"
        subtitle="Deleted transactions stay here until you clear them"
        padded={false}
      >
        {onRestoreMany && deleted.length > 0 && (
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
                  if (el) el.indeterminate = chosen.length > 0 && !allPicked;
                }}
                onChange={() => setPicked(allPicked ? new Set() : new Set(deleted.map((t) => t.id)))}
                aria-label={allPicked ? "Clear selection" : "Select everything in the bin"}
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
                <span style={{ color: "var(--ink-2)" }}>Select all</span>
              )}
            </label>
            {chosen.length > 0 && (
              <span className="fms-bulkbar-actions">
                <Button size="sm" onClick={() => setPicked(new Set())}>
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    onRestoreMany(chosen.map((t) => t.id));
                    setPicked(new Set());
                  }}
                >
                  Restore {chosen.length}
                </Button>
              </span>
            )}
          </div>
        )}

        {deleted.length === 0 ? (
          <EmptyState message="Nothing deleted. Deleted transactions stay here until you clear them." />
        ) : (
          <ul className="fms-binlist" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {deleted.map((t) => (
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
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
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
                    <Button size="sm" variant="primary" onClick={() => onRestore(t.id)}>Restore</Button>
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
                      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)", maxWidth: 380 }}>
                        <TextInput value={typed} onChange={setTyped} placeholder={expected} />
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
        )}
      </Card>
    </div>
  );
}
