/**
 * Add / edit a transaction: style guide §3.3.
 *
 * Everything on one page, like the Excel INPUT PAGE it replaces: flow tiles
 * across the top, a two-column field grid, and a live balances panel beside
 * it. No scrolling on a desktop viewport.
 *
 * Flow first: the one choice at the top decides which fields exist. All the
 * rules live in `domain/entry.ts`; this file renders and decides nothing.
 */

import { useMemo, useState } from "react";

import {
  Alert,
  Button,
  FlowBadge,
  Money,
  StatusPill,
  type Flow as FlowTone,
} from "../components/primitives";
import { AmountInput, Select, TextInput } from "../components/forms";
import { suggest } from "../domain/autofill";
import type { Debt, DebtEffect } from "../domain/debt";
import { outstandingOf } from "../domain/debt";
import { formatMoney } from "../domain/money";
import {
  categoriesFor,
  checkDraft,
  draftToTransactions,
  emptyDraft,
  itemsFor,
  needs,
  runningBalance,
  type Draft,
  type Flow,
} from "../domain/entry";
import type { AiSettings } from "../domain/settings";
import { describeDraft, suggestCategory } from "../data/aiClient";
import type { CategoryResult } from "../data/aiClient";
import { billsToLog, predictAmount, reasons, type DueBill } from "../domain/predict";
import type { ReferenceLists, Transaction, TransactionCategory, WalletBalance } from "../domain/types";

const FLOWS: { id: Flow; tone: FlowTone; glyph: string; hint: string }[] = [
  { id: "Revenue", tone: "revenue", glyph: "↓", hint: "Money in" },
  { id: "Spending", tone: "spending", glyph: "↑", hint: "Money out" },
  { id: "Transfer", tone: "transfer", glyph: "⇄", hint: "Between wallets" },
  { id: "Debt", tone: "debt", glyph: "◑", hint: "Borrow or repay" },
  // Money you already had. Not income, and the reason the Excel needed a
  // "Transfer of balance" revenue category it should never have had.
  { id: "Opening", tone: "transfer", glyph: "◉", hint: "What you already had" },
];

const EFFECTS: DebtEffect[] = ["draw", "repay", "interest", "writeoff"];
const EFFECT_LABEL: Record<string, string> = {
  draw: "Draw: borrow more",
  repay: "Repay: pay it down",
  interest: "Interest or fee",
  writeoff: "Write-off: forgiven",
};

const STATUSES = ["Paid", "Done", "Received", "Transferred", "Withdrawn"];

/** Destination option meaning the money leaves your accounts entirely. */
const SOMEONE_ELSE = "Someone else";

export function AddTransaction({
  transactions,
  reference,
  debts,
  balances,
  onSave,
  ai,
}: {
  transactions: readonly Transaction[];
  reference: ReferenceLists;
  debts: readonly Debt[];
  balances: readonly WalletBalance[];
  onSave: (rows: Transaction[]) => void;
  ai: AiSettings;
}) {
  /** Chosen "Someone else" as the destination, rather than left it empty. */
  const [sentOut, setSentOut] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [submitted, setSubmitted] = useState(false);

  /**
   * Asked for, never automatic.
   *
   * The VBA filled the description on its own as you tabbed through. That is
   * fine when it reuses your own past wording, and wrong when it invents
   * something: a description you did not write, silently placed in a field you
   * were about to fill, is how a ledger gets entries nobody recognises later.
   * So the ghost hint still appears from history, and the model only runs when
   * the button is pressed.
   */
  const [describing, setDescribing] = useState(false);
  const [categorising, setCategorising] = useState(false);
  const [categoryHint, setCategoryHint] = useState<CategoryResult | null>(null);

  const proposeDescription = async (): Promise<void> => {
    setDescribing(true);
    try {
      const result = await describeDraft(draft, transactions, {
        // Both switches have to be on. Off means the model is not called,
        // not that the button stops working: history still answers.
        allowModel: ai.enabled && ai.features.descriptions,
        tone: ai.tone,
      });
      if (result.text) set("description", result.text);
    } finally {
      setDescribing(false);
    }
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  /**
   * Filled only when the answer is confident, and only from the allowed
   * list. Anything less is shown beside the picker and left alone, because
   * a wrong category does not look like an error once saved: it looks like
   * a fact, and it moves a figure in every report that groups by category.
   */
  const proposeCategory = async (): Promise<void> => {
    setCategorising(true);
    try {
      const result = await suggestCategory(draft, transactions, reference, {
        allowModel: ai.enabled && ai.features.descriptions,
      });

      setCategoryHint(result.category ? result : null);
      if (result.source === "history" || result.confidence === "high") {
        setDraft((d) => ({ ...d, category: result.category as TransactionCategory, item: d.item }));
      }
    } finally {
      setCategorising(false);
    }
  };

  const check = useMemo(
    () => checkDraft(draft, transactions, reference, debts),
    [draft, transactions, reference, debts],
  );
  const ghost = useMemo(() => suggest(draft, transactions), [draft, transactions]);
  const balance = runningBalance(draft, transactions, draft.id);

  /**
   * VBA rule 5a, which was written and never wired up.
   *
   * A bill due today outranks whatever you buy most often. If Globe was paid
   * on the 30th for a year then on the 30th the item is almost certainly
   * Globe, and proposing "Food" because food is more frequent overall is
   * confidently wrong. One tap fills the whole row from last month's.
   */
  const due = useMemo(() => billsToLog(transactions, draft.date), [transactions, draft.date]);

  const guess = useMemo(() => predictAmount(transactions, draft), [transactions, draft]);
  const why = useMemo(() => reasons(draft, transactions), [draft, transactions]);
  const reasonFor = (field: string): string | undefined =>
    why.find((r) => r.field === field)?.why;

  const logBill = (bill: DueBill): void => {
    setDraft((d) => ({
      ...d,
      flow: "Spending",
      category: bill.category,
      item: bill.item,
      // The amount is filled here because the whole point is one tap, and it
      // is visible in the field for checking before anything is saved.
      amount: bill.expected,
      fromWallet: bill.wallet || d.fromWallet,
      status: "Paid",
    }));
  };

  const allWallets = [...reference.wallets, ...reference.savings];
  const items = itemsFor(draft.flow, draft.category, reference);
  const categories = categoriesFor(draft.flow);

  const errorFor = (field: string): string | undefined =>
    submitted ? check.errors.find((e) => e.field === field)?.message : undefined;

  const save = (): void => {
    setSubmitted(true);
    if (!check.ok) return;

    const nextNumber = Math.max(0, ...transactions.map((t) => t.recordNumber)) + 1;
    onSave(draftToTransactions(draft, nextNumber, `t-${Date.now()}`, check.repaymentSplit));
    setDraft(emptyDraft(draft.date));
    setSubmitted(false);
  };

  const tone = FLOWS.find((f) => f.id === draft.flow)?.tone;

  return (
    <div className="fms-entry">
      {/* ── Left: the form ─────────────────────────────────────────────── */}
      <section className="fms-panel">
        {due.length > 0 && (
          <div className="fms-duestrip">
            <div className="t-caption" style={{ color: "var(--ink-3)" }}>
              Due around now, going by last month. One tap fills the row.
            </div>
            <div className="fms-duechips">
              {due.map((bill) => (
                <button
                  key={bill.item}
                  type="button"
                  className="fms-duechip"
                  onClick={() => logBill(bill)}
                  style={{
                    borderColor:
                      bill.daysAway < 0 ? "var(--over)" : "var(--hairline-strong)",
                  }}
                >
                  <span className="t-body-strong">{bill.item}</span>
                  <span className="t-num-s">{formatMoney(bill.expected)}</span>
                  <span
                    className="t-micro"
                    style={{ color: bill.daysAway < 0 ? "var(--over)" : "var(--ink-3)" }}
                  >
                    {bill.why}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Flow tiles */}
        <div className="fms-flowgrid">
          {FLOWS.map((f) => {
            const active = draft.flow === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setDraft({ ...emptyDraft(draft.date), flow: f.id })}
                aria-pressed={active}
                className="fms-flowtile"
                style={{
                  background: active ? `var(--flow-${f.tone}-bg)` : "var(--surface)",
                  borderColor: active ? `var(--flow-${f.tone})` : "var(--hairline-strong)",
                  borderWidth: active ? 2 : 1,
                  color: active ? `var(--flow-${f.tone}-text)` : "var(--ink)",
                }}
              >
                <span className="t-body-strong">
                  <span aria-hidden style={{ marginRight: 5 }}>{f.glyph}</span>
                  {f.id}
                </span>
                <span
                  className="t-micro"
                  style={{ color: active ? `var(--flow-${f.tone}-text)` : "var(--ink-3)" }}
                >
                  {f.hint}
                </span>
              </button>
            );
          })}
        </div>

        {!draft.flow ? (
          <p className="t-caption" style={{ color: "var(--ink-3)", margin: "var(--space-6) 0", textAlign: "center" }}>
            Pick a type above and only the fields it needs will appear.
          </p>
        ) : (
          <>
            <div className="fms-fields">
              <Row label="Date" required error={errorFor("date")}>
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => set("date", e.target.value)}
                  className="t-body fms-control"
                />
              </Row>

              {needs(draft.flow, "debt") && (
                <>
                  <Row label="Debt" required error={errorFor("debt")}>
                    <Select
                      value={draft.debtId ?? ""}
                      onChange={(v) => set("debtId", v || undefined)}
                      options={debts.map((d) => d.name)}
                      placeholder="Pick a debt"
                      invalid={Boolean(errorFor("debt"))}
                    />
                  </Row>
                  <Row label="Effect" required error={errorFor("debtEffect")}>
                    <Select
                      value={draft.debtEffect ?? ""}
                      onChange={(v) => set("debtEffect", (v || undefined) as DebtEffect | undefined)}
                      options={EFFECTS.map((e) => EFFECT_LABEL[e] ?? e)}
                      placeholder="What does this do?"
                      invalid={Boolean(errorFor("debtEffect"))}
                    />
                  </Row>
                </>
              )}

              {needs(draft.flow, "fromWallet") && (
                <Row
                  label="From wallet"
                  required={draft.flow !== "Debt"}
                  error={errorFor("fromWallet")}
                  hint={reasonFor("fromWallet")}
                >
                  <Select
                    value={draft.fromWallet}
                    onChange={(v) => set("fromWallet", v)}
                    options={allWallets}
                    placeholder={ghost.fromWallet ? `${ghost.fromWallet} (suggested)` : "Pick a wallet"}
                    invalid={Boolean(errorFor("fromWallet"))}
                  />
                </Row>
              )}

              {needs(draft.flow, "toWallet") && (
                <Row
                  label={draft.flow === "Transfer" ? "Where to" : "To wallet"}
                  required={draft.flow !== "Debt"}
                  error={errorFor("toWallet")}
                >
                  <Select
                    value={draft.toWallet === "" && sentOut ? SOMEONE_ELSE : draft.toWallet}
                    onChange={(v) => {
                      // "Someone else" is a real choice, not a blank field. The
                      // row is stored with no destination, which is what makes
                      // it spending, so picking it has to be deliberate.
                      if (v === SOMEONE_ELSE) {
                        setSentOut(true);
                        set("toWallet", "");
                      } else {
                        setSentOut(false);
                        set("toWallet", v);
                      }
                    }}
                    options={
                      draft.flow === "Transfer" ? [...allWallets, SOMEONE_ELSE] : allWallets
                    }
                    placeholder={ghost.toWallet ? `${ghost.toWallet} (suggested)` : "Pick a wallet"}
                    invalid={Boolean(errorFor("toWallet"))}
                  />
                </Row>
              )}

              {/* What this row will count as, worked out from the answer above.
                  The Excel asked you to pick "Money Send" or "Transaction Fee"
                  by hand and lost the money whenever you did not. */}
              {draft.flow === "Opening" && (
                <Row label="Counts as">
                  <div className="fms-derived">
                    <StatusPill status="none">Starting balance</StatusPill>
                    <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                      Money you already had. It sets the account's balance without counting as
                      income, so your revenue figures stay true.
                    </span>
                  </div>
                </Row>
              )}

              {draft.flow === "Transfer" && (
                <Row label="Counts as">
                  <div className="fms-derived">
                    <StatusPill status={sentOut ? "over" : "none"}>
                      {sentOut ? "Money Send" : draft.fee > 0 ? "Transaction Fee" : "Not spending"}
                    </StatusPill>
                    <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                      {sentOut
                        ? "The money leaves your accounts, so the whole amount is spending."
                        : draft.fee > 0
                          ? "Still your money, in another pocket. Only the fee is spending."
                          : "Still your money, in another pocket. Nothing here is spending."}
                    </span>
                  </div>
                </Row>
              )}

              {needs(draft.flow, "category") && categories.length > 1 && (
                <Row
                  label="Category"
                  required
                  hint={
                    categoryHint
                      ? categoryHint.source === "history"
                        ? `Filed this way ${categoryHint.seen ?? 0} times before`
                        : `Suggested: ${categoryHint.category} (${categoryHint.confidence} confidence)`
                      : undefined
                  }
                >
                  <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "stretch" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Select
                        value={draft.category}
                        onChange={(v) => {
                          setCategoryHint(null);
                          setDraft((d) => ({ ...d, category: v as TransactionCategory, item: "" }));
                        }}
                        options={categories}
                        placeholder={ghost.category ? `${ghost.category} (suggested)` : "Pick a category"}
                      />
                    </div>
                    <Button
                      loading={categorising}
                      disabled={!draft.item.trim()}
                      onClick={() => void proposeCategory()}
                    >
                      Suggest
                    </Button>
                  </div>
                </Row>
              )}

              {needs(draft.flow, "item") && (
                <Row
                  label="Item"
                  hint={
                    ghost.item && !draft.item
                      ? `Suggested: ${ghost.item}`
                      : reasonFor("item")
                  }
                >
                  <Select
                    value={draft.item}
                    onChange={(v) => set("item", v)}
                    options={items}
                    placeholder="Pick an item"
                  />
                </Row>
              )}

              <Row
                label="Amount"
                required
                error={errorFor("amount")}
                hint={guess && draft.amount === null ? guess.why : undefined}
              >
                <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "stretch" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <AmountInput
                      value={draft.amount}
                      onChange={(v) => set("amount", v)}
                      invalid={Boolean(errorFor("amount"))}
                    />
                  </div>
                  {/*
                    Offered, never filled. An amount that is silently almost
                    right is the one mistake here that quietly corrupts a
                    balance, so this takes a deliberate tap.
                  */}
                  {guess && draft.amount === null && (
                    <Button onClick={() => set("amount", guess.amount)}>
                      {formatMoney(guess.amount)}
                    </Button>
                  )}
                </div>
              </Row>

              {needs(draft.flow, "fee") && (
                <Row label="Fee" hint={ghost.fee ? `Usually ${formatMoney(ghost.fee)}` : undefined}>
                  <AmountInput value={draft.fee} onChange={(v) => set("fee", v ?? 0)} />
                </Row>
              )}

              {needs(draft.flow, "description") && (
                <Row label="Description" span hint={ghost.description && !draft.description ? `Last time: ${ghost.description}` : undefined}>
                  <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "stretch" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <TextInput
                        value={draft.description}
                        onChange={(v) => set("description", v)}
                        placeholder="What was it for?"
                      />
                    </div>
                    <Button
                      loading={describing}
                      disabled={!draft.flow || !draft.item.trim()}
                      onClick={() => void proposeDescription()}
                    >
                      Suggest
                    </Button>
                  </div>
                </Row>
              )}

              {needs(draft.flow, "notes") && (
                <Row label="Notes" span>
                  <TextInput value={draft.notes} onChange={(v) => set("notes", v)} placeholder="Anything worth remembering" />
                </Row>
              )}

              {needs(draft.flow, "status") && (
                <Row label="Status">
                  <Select
                    value={draft.status}
                    onChange={(v) => set("status", v as Draft["status"])}
                    options={STATUSES}
                    placeholder={ghost.status ? `${ghost.status} (suggested)` : "Pick a status"}
                  />
                </Row>
              )}
            </div>

            {/* Warnings sit between the fields and the action, where they
                interrupt without blocking. */}
            <div style={{ display: "grid", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
              {check.warnings.map((w) => (
                <Alert key={w.message} status="warn">{w.message}</Alert>
              ))}
              {check.repaymentSplit && check.repaymentSplit.interest > 0 && (
                <Alert status="info" title="This payment splits in two">
                  Principal <Money value={check.repaymentSplit.principal} size="s" /> · Interest{" "}
                  <Money value={check.repaymentSplit.interest} size="s" tone="var(--flow-debt-text)" />
                </Alert>
              )}
              {submitted && check.errors.length > 0 && (
                <Alert status="over" title={`${check.errors.length} thing${check.errors.length === 1 ? "" : "s"} to fix`}>
                  {check.errors.map((e) => e.message).join(" ")}
                </Alert>
              )}
            </div>

            <div className="fms-actions">
              {tone && <FlowBadge flow={tone} />}
              <span style={{ flex: 1 }} />
              <Button onClick={() => setDraft(emptyDraft(draft.date))}>Clear</Button>
              <Button variant="primary" onClick={save}>Save transaction</Button>
            </div>
          </>
        )}
      </section>

      {/* ── Right: balances, exactly like the Excel INPUT PAGE ──────────── */}
      <aside className="fms-panel fms-side">
        {balance && (
          <div
            style={{
              padding: "var(--space-3)",
              borderRadius: "var(--radius-md)",
              background: balance.goesNegative ? "var(--over-bg)" : "var(--brand-50)",
              marginBottom: "var(--space-4)",
            }}
          >
            <div className="t-label" style={{ color: "var(--ink-2)" }}>{balance.wallet} after this</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", marginTop: 2 }}>
              <Money value={balance.before} size="s" tone="var(--ink-3)" />
              <span aria-hidden style={{ color: "var(--ink-3)" }}>→</span>
              <Money value={balance.after} size="l" tone={balance.goesNegative ? "var(--over)" : "var(--ink)"} />
            </div>
          </div>
        )}

        <div className="t-label" style={{ color: "var(--ink-2)", marginBottom: "var(--space-2)" }}>
          Wallets
        </div>
        {balances.filter((w) => !w.isSavings).map((w) => (
          <BalanceRow key={w.name} wallet={w} />
        ))}

        {balances.some((w) => w.isSavings) && (
          <>
            <div className="t-label" style={{ color: "var(--ink-2)", margin: "var(--space-4) 0 var(--space-2)" }}>
              Savings
            </div>
            {balances.filter((w) => w.isSavings).map((w) => (
              <BalanceRow key={w.name} wallet={w} />
            ))}
          </>
        )}

        {debts.length > 0 && (
          <>
            <div className="t-label" style={{ color: "var(--ink-2)", margin: "var(--space-4) 0 var(--space-2)" }}>
              Owed
            </div>
            {debts.map((d) => (
              <div key={d.id} className="fms-balrow">
                <span className="t-caption">{d.name}</span>
                <Money value={outstandingOf(transactions, d.id)} size="s" tone="var(--flow-debt-text)" />
              </div>
            ))}
          </>
        )}
      </aside>
    </div>
  );
}

function BalanceRow({ wallet }: { wallet: WalletBalance }) {
  const empty = wallet.balance === 0;
  return (
    <div className="fms-balrow">
      <span className="t-caption" style={{ color: empty ? "var(--ink-3)" : "var(--ink)" }}>
        {wallet.name}
      </span>
      <Money value={wallet.balance} size="s" tone={empty ? "var(--ink-3)" : undefined} />
    </div>
  );
}

/**
 * One field. Label sits above on a phone and beside the control on desktop,
 * the horizontal form is what lets the whole page fit without scrolling.
 */
function Row({
  label,
  children,
  required,
  error,
  hint,
  span,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  span?: boolean;
}) {
  return (
    <div className={span ? "fms-row fms-row-span" : "fms-row"}>
      <label className="t-label fms-rowlabel">
        {label}
        {required && <span style={{ color: "var(--over)" }}> *</span>}
      </label>
      <div style={{ minWidth: 0 }}>
        {children}
        {(error || hint) && (
          <p
            className="t-micro"
            style={{ margin: "3px 0 0", color: error ? "var(--over)" : "var(--ink-3)" }}
          >
            {error || hint}
          </p>
        )}
      </div>
    </div>
  );
}
