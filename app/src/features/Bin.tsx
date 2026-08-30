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
  onPurge,
}: {
  deleted: readonly DeletedTransaction[];
  onRestore: (id: string) => void;
  /** Absent when the ledger is in Firestore, where nothing can be destroyed. */
  onPurge?: ((id: string) => void) | undefined;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const target = deleted.find((d) => d.id === confirming);
  const expected = target ? String(target.recordNumber).padStart(4, "0") : "";

  return (
    <div className="fms-db">
      <Card
        title="Recycle bin"
        subtitle="Deleted transactions stay here until you clear them"
        padded={false}
      >
        {deleted.length === 0 ? (
          <EmptyState message="Nothing deleted. Deleted transactions stay here until you clear them." />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {deleted.map((t) => (
              <li key={t.id} className="fms-dbrow">
                <div className="fms-dbrow-main">
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

                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flex: "0 0 auto" }}>
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
