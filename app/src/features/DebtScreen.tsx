/**
 * Debt: spec 7.5.
 *
 * ── What changed on 2026-09-15 ────────────────────────────────────────────
 *
 * Each debt showed its balance and a date it did not judge: Maya Credit read
 * "next due September 3, 2026" on September 15, twelve days after. Nothing on
 * the screen could record a payment, nothing said whether a debt was growing
 * or shrinking, and the history only covered the year its first row was in.
 * Now each debt says when its next payment is due and whether that has passed
 * (`debtDue`), how much, what was last paid, and how it moved over the last
 * month. The due day, limit and term are set under Details.
 *
 * ── What changed on 2026-09-17 ────────────────────────────────────────────
 *
 * The owner looked at the card and said it looked vibe coded, and it did: an
 * amber rail down a rounded card, uppercase eyebrow labels, and a green bar
 * for "paid back of borrowed" that coloured a liability as a gain. Every one
 * of those is on the style guide's "Don't" list. A debt is now an ordinary
 * card like every other screen's: its name and state in the header, what is
 * owed now as the figure, and plain labels over the facts.
 *
 * What is owed now includes charges the lender added (see `charge` in
 * `debt.ts`), so it reads the same as the lender's own app. And money that
 * only passes through, held for someone or sent for someone, has its own
 * section, because none of it is borrowing.
 */

import { useMemo, useState } from "react";

import { Alert, Button, Card, EmptyState, Money, ProgressBar, StatusPill, type Status } from "../components/primitives";
import { AmountInput, Select } from "../components/forms";
import { formatMedium, formatShort, getYear } from "../domain/dates";
import {
  basisWords,
  debtDue,
  debtPace,
  duesWithin,
  movementsOf,
  owedChange,
  paymentsFiledAsSpending,
  positionsOf,
  rowsFor,
  type Debt,
  type DebtDue,
  type DebtEffect,
} from "../domain/debt";
import { creditLineState, DEBT_FORM_LABEL, loanSchedule } from "../domain/debtForms";
import { effectLabel, partWords } from "../domain/debtWords";
import { formatMoney, type Centavos } from "../domain/money";
import type { Transaction } from "../domain/types";
import { whenWords } from "./Dashboard";
import { useReportScreen } from "./screenReport";

/** How each movement is marked in the history: by which way it moves what is owed. */
const EFFECT_STATUS: Record<DebtEffect, Status> = {
  draw: "warn",
  lend: "warn",
  charge: "warn",
  repay: "ok",
  collect: "ok",
  interest: "info",
  fee: "info",
  writeoff: "none",
};

const passing = (debt: Debt): boolean => debt.form === "pass-through";

/** Interest, fees and charges: what borrowing cost, in a year. */
const COST: ReadonlySet<DebtEffect> = new Set(["interest", "fee", "charge"]);

export function DebtScreen({
  transactions,
  debts,
  asOf,
  onRecord,
  onEditRow,
  onUpdateDebt,
  onManage,
  onShowRows,
}: {
  transactions: readonly Transaction[];
  debts: readonly Debt[];
  asOf: string;
  /** The Add form with this movement filled in, amount included when known. */
  onRecord: (debt: Debt, effect: DebtEffect, amount: Centavos | null) => void;
  /** A saved row back into the Add form, to correct it. */
  onEditRow: (row: Transaction) => void;
  /** The due day, limit or term, changed here. */
  onUpdateDebt: (debt: Debt) => void;
  /** Settings, where debts are added, archived and removed. */
  onManage: () => void;
  /** The Database searched for these words. */
  onShowRows: (query: string) => void;
}) {
  /*
   * Debts only: banks, credit lines and loans, with a person or with an
   * institution. Money paid or held on someone's behalf is not a loan, the
   * owner said, and it is followed on the Dashboard under On behalf.
   */
  const live = useMemo(() => debts.filter((d) => !d.archived && !passing(d)), [debts]);
  const dues = useMemo(
    () => positionsOf(live, transactions, asOf).map((p) => debtDue(p, transactions, asOf)),
    [live, transactions, asOf],
  );
  const misfiled = useMemo(() => paymentsFiledAsSpending(live, transactions), [live, transactions]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const year = getYear(asOf);
  // Every debt, archived ones too: money still owed is owed whether or not the line is in use.
  const everything = positionsOf(debts.filter((d) => !passing(d)), transactions, asOf);
  const sum = (keep: (d: Debt) => boolean): Centavos =>
    everything.filter((p) => keep(p.debt)).reduce((s, p) => s + Math.max(0, p.outstanding), 0);
  const owe = sum((d) => d.kind === "payable" && !passing(d));
  const owedToYou = sum((d) => d.kind === "receivable" && !passing(d));
  const costThisYear = transactions
    .filter((t) => t.type === "Debt" && t.debtEffect !== undefined && COST.has(t.debtEffect) && getYear(t.date) === year)
    .reduce((s, t) => s + t.total, 0);

  const lending = dues;
  const soon = duesWithin(lending, 7);
  const archived = debts.filter((d) => d.archived && !passing(d)).length;

  useReportScreen(
    () => ({
      screen: "Debt",
      lines: [
        `You owe ${formatMoney(owe)}. Owed to you ${formatMoney(owedToYou)}. Charges and interest in ${year}: ${formatMoney(costThisYear)}.`,
        ...dues.map(
          (d) =>
            `${d.position.debt.name} (${DEBT_FORM_LABEL[d.position.debt.form ?? "credit-line"]}), ${
              d.position.debt.kind === "payable" ? "owed by the owner" : "owed to the owner"
            }: ${formatMoney(Math.max(0, d.position.outstanding))} now, of which ${formatMoney(d.position.charged)} is charges; next payment ${
              d.nextDue ? `${d.nextDue} (${whenWords(d.daysToDue).toLowerCase()})` : "not dated"
            }; last payment ${d.lastPayment ? `${formatMoney(d.lastPayment.amount)} on ${d.lastPayment.date}` : "none"}.`,
        ),
        misfiled.length > 0 ? `${misfiled.length} spending rows name a debt, and may be payments filed as spending.` : "",
      ],
    }),
    [owe, owedToYou, costThisYear, dues, misfiled],
  );
  const selected = dues.find((d) => d.position.debt.id === openId) ?? dues[0];

  const record = (d: DebtDue): void => {
    const owed = d.position.debt.kind === "payable";
    onRecord(d.position.debt, owed ? "repay" : "collect", d.amountDue > 0 ? d.amountDue : null);
  };

  if (live.length === 0) {
    return (
      <div className="fms-dash">
        <Card title="Debts and loans">
          <EmptyState
            message={
              archived > 0
                ? `Every debt is archived (${archived}). Reopen one in Settings, under Credit and loans, to follow it here again.`
                : "No credit lines, bank loans or personal loans are followed yet. Add one in Settings, under Credit and loans, or record a personal loan from the Add form, and what is owed, the payments and the due dates show here."
            }
            action={
              <Button variant="primary" onClick={onManage}>
                Open Settings
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const misfiledBy = new Map<string, { name: string; count: number; total: Centavos }>();
  for (const { debt, row } of misfiled) {
    const entry = misfiledBy.get(debt.id) ?? { name: debt.name, count: 0, total: 0 };
    misfiledBy.set(debt.id, { ...entry, count: entry.count + 1, total: entry.total + row.total });
  }

  const cardFor = (d: DebtDue, all: readonly DebtDue[]) => (
    <DebtCard
      key={d.position.debt.id}
      due={d}
      transactions={transactions}
      asOf={asOf}
      selected={dues.length > 1 && selected?.position.debt.id === d.position.debt.id}
      selectable={dues.length > 1 && all.length > 0}
      editing={editId === d.position.debt.id}
      onSelect={() => setOpenId(d.position.debt.id)}
      onRecord={(effect, amount) => onRecord(d.position.debt, effect, amount)}
      onEdit={() => setEditId(editId === d.position.debt.id ? null : d.position.debt.id)}
      onSave={(next) => {
        onUpdateDebt(next);
        setEditId(null);
      }}
    />
  );

  return (
    <div className="fms-dash">
      <div className="fms-debtsum">
        <Figure label="You owe" value={owe} tone="var(--flow-debt-text)" />
        <Figure label="Owed to you" value={owedToYou} />
        <Figure label={`Charges and interest in ${year}`} value={costThisYear} />
        <Figure label="Net" value={owedToYou - owe} signed />
      </div>

      {soon.map((d) => {
        const { debt } = d.position;
        const late = (d.daysToDue ?? 0) < 0;
        const owed = debt.kind === "payable";
        return (
          <Alert
            key={`soon-${debt.id}`}
            status={late ? "over" : "warn"}
            title={`${debt.name}: ${whenWords(d.daysToDue).toLowerCase()}`}
            action={
              <Button size="sm" onClick={() => record(d)}>
                {owed ? "Record the payment" : "Record what they paid"}
              </Button>
            }
          >
            {d.nextDue ? `Due ${formatMedium(d.nextDue)}` : ""}
            {d.basis === "last-payment" || d.basis === "borrowed" ? `, ${basisWords(d.basis)}` : ""}.{" "}
            {formatMoney(d.amountDue)} {owed ? "to pay" : "to collect"}. Already paid? Record it and this goes.
          </Alert>
        );
      })}

      {[...misfiledBy.values()].map((m) => (
        <Alert
          key={`misfiled-${m.name}`}
          status="warn"
          title={`${m.count} spending row${m.count === 1 ? "" : "s"} name ${m.name}`}
          action={
            <Button size="sm" onClick={() => onShowRows(m.name)}>
              Show {m.count === 1 ? "it" : "them"} in the Database
            </Button>
          }
        >
          {formatMoney(m.total)} filed as spending went to {m.name}. As spending it never lowered what is owed,
          so the balance here is higher than it really is. Open each one and change its type to Debt.
        </Alert>
      ))}

      {lending.length > 0 && <div className="fms-debtgrid">{lending.map((d) => cardFor(d, lending))}</div>}

      <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
        {archived > 0 ? `${archived} archived, kept with their history. ` : ""}
        Adding, archiving and removing debts is in{" "}
        <button type="button" className="t-caption fms-linkbtn" onClick={onManage}>
          Settings, under Credit and loans
        </button>
        .
      </p>

      {selected && <History due={selected} transactions={transactions} onEditRow={onEditRow} />}
    </div>
  );
}

function Figure({ label, value, tone, signed }: { label: string; value: Centavos; tone?: string; signed?: boolean }) {
  return (
    <div className="fms-debtfig">
      <span className="t-label" style={{ color: "var(--ink-2)" }}>
        {label}
      </span>
      <Money value={value} size="l" signed={signed} tone={value === 0 ? "var(--ink-3)" : tone} />
    </div>
  );
}

/** One fact: a label, its value, and a line saying what it is measured by. */
function Fact({ label, children, note }: { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="fms-debtfact">
      <dt className="t-label">{label}</dt>
      <dd className="fms-debtfact-value">{children}</dd>
      {note !== undefined && <dd className="t-caption fms-debtfact-note">{note}</dd>}
    </div>
  );
}

function DebtCard({
  due,
  transactions,
  asOf,
  selected,
  selectable,
  editing,
  onSelect,
  onRecord,
  onEdit,
  onSave,
}: {
  due: DebtDue;
  transactions: readonly Transaction[];
  asOf: string;
  selected: boolean;
  /**
   * Whether there is a choice of history to show. With one debt its history
   * is the only one, so it needs no button saying so.
   */
  selectable: boolean;
  editing: boolean;
  onSelect: () => void;
  onRecord: (effect: DebtEffect, amount: Centavos | null) => void;
  onEdit: () => void;
  onSave: (next: Debt) => void;
}) {
  const { position } = due;
  const { debt } = position;
  const owed = debt.kind === "payable";
  const form = debt.form ?? "credit-line";
  const through = form === "pass-through";
  const late = due.daysToDue !== undefined && due.daysToDue < 0;
  const settled = position.outstanding <= 0;
  const credit = through ? null : creditLineState(position);
  const schedule = form === "term-loan" ? loanSchedule(position, asOf) : null;
  const pace = debtPace(position, transactions, asOf);

  const state: { status: Status; words: string } = settled
    ? { status: "ok", words: through ? "Settled" : owed ? "Paid off" : "Paid back" }
    : through
      ? { status: "none", words: owed ? "Still to pass on" : "Still to come back" }
      : due.nextDue
        ? { status: late ? "over" : (due.daysToDue ?? 99) <= 7 ? "warn" : "none", words: whenWords(due.daysToDue) }
        : { status: "none", words: "No due date" };

  const owedLabel = through
    ? owed
      ? "Held for them now"
      : "Still to come back"
    : owed
      ? "Owed now"
      : "Owed to you now";

  /** What the figure is made of, so it can be checked against the lender's app. */
  const makeUp = through
    ? `${formatMoney(position.drawn)} ${owed ? "received for them" : "sent for them"}, ${formatMoney(position.repaid)} ${
        owed ? "passed on" : "paid back"
      }`
    : [
        `${formatMoney(position.drawn)} ${owed ? "borrowed" : "lent"}`,
        position.charged > 0 ? `${formatMoney(position.charged)} in charges` : "",
        `${formatMoney(position.repaid)} ${owed ? "paid" : "paid back"}`,
        position.writtenOff > 0 ? `${formatMoney(position.writtenOff)} ${owed ? "waived" : "given up"}` : "",
      ]
        .filter(Boolean)
        .join(", ");

  const notes: { key: string; text: string; warn?: boolean }[] = [];
  if (!through) {
    if (owed && pace.added30 + pace.charged30 > pace.paid30) {
      notes.push({ key: "growing", text: "More was added than paid in the last 30 days, so it is growing.", warn: true });
    }
    if (!settled && pace.monthsToClear !== null) {
      notes.push({
        key: "pace",
        text: `At ${formatMoney(pace.monthlyPayment)} a month, the rate of the last three months, it is cleared in about ${
          pace.monthsToClear
        } ${pace.monthsToClear === 1 ? "month" : "months"}.`,
      });
    }
    if (!settled && due.nextDue && (due.basis === "last-payment" || due.basis === "borrowed")) {
      notes.push({ key: "basis", text: `The date is ${basisWords(due.basis)}. Set the real due day under Details to make it exact.` });
    }
    if (!settled && !due.nextDue && form !== "informal") {
      notes.push({ key: "noday", text: "Set a due day under Details and this says when the next payment is due." });
    }
  }

  // The actions this debt takes, the one most often needed first.
  const actions: { effect: DebtEffect; label: string; amount: Centavos | null; primary?: boolean }[] = through
    ? owed
      ? [
          { effect: "repay", label: "Record passing it on", amount: settled ? null : position.outstanding, primary: !settled },
          { effect: "draw", label: "Record money received for them", amount: null },
        ]
      : [
          { effect: "collect", label: "Record them paying you back", amount: settled ? null : position.outstanding, primary: !settled },
          { effect: "lend", label: "Record money sent for them", amount: null },
        ]
    : owed
      ? [
          ...(settled ? [] : [{ effect: "repay" as const, label: "Record payment", amount: due.amountDue > 0 ? due.amountDue : null, primary: true }]),
          { effect: "draw", label: "Record borrowing", amount: null },
          { effect: "charge", label: "Add a charge", amount: null },
        ]
      : [
          ...(settled ? [] : [{ effect: "collect" as const, label: "Record what they paid", amount: due.amountDue > 0 ? due.amountDue : null, primary: true }]),
          { effect: "lend", label: "Record lending", amount: null },
        ];

  return (
    <Card
      title={debt.name}
      subtitle={`${DEBT_FORM_LABEL[form]} · ${through ? (owed ? "you hold it for them" : "they pay you back") : owed ? "you owe" : "owed to you"}`}
      action={<StatusPill status={state.status}>{state.words}</StatusPill>}
    >
      <div className="fms-debtbody">
        <div className="fms-debthero">
          <div className="fms-debthero-owed">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>
              {owedLabel}
            </span>
            <Money
              value={Math.max(0, position.outstanding)}
              size="xl"
              tone={settled ? "var(--ink-3)" : owed && !through ? "var(--flow-debt-text)" : undefined}
            />
            <span className="t-caption" style={{ color: "var(--ink-3)" }}>
              {makeUp}
            </span>
          </div>

          {credit ? (
            <div className="fms-debthero-side">
              <span className="t-label" style={{ color: "var(--ink-2)" }}>
                Credit limit
              </span>
              <ProgressBar value={credit.used} max={credit.limit} />
              <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                {formatMoney(credit.available)} of {formatMoney(credit.limit)} left to use
              </span>
            </div>
          ) : schedule ? (
            <div className="fms-debthero-side">
              <span className="t-label" style={{ color: "var(--ink-2)" }}>
                Payments made
              </span>
              <ProgressBar value={schedule.paid} max={schedule.termMonths} />
              <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                {schedule.paid} of {schedule.termMonths}, {formatMoney(schedule.monthlyPayment)} each
              </span>
            </div>
          ) : null}
        </div>

        <dl className="fms-debtfacts">
          {!through && (
            <Fact
              label="Next payment"
              note={settled ? "Nothing owed" : due.nextDue ? whenWords(due.daysToDue) : "Set a due day under Details"}
            >
              <span className="t-body-strong">{settled ? "None" : due.nextDue ? formatMedium(due.nextDue) : "No date"}</span>
            </Fact>
          )}
          {!through && (
            <Fact
              label={owed ? "To pay" : "To collect"}
              note={settled ? "Nothing" : due.basis === "schedule" ? "This instalment" : "Everything owed now"}
            >
              <Money value={settled ? 0 : due.amountDue || position.outstanding} size="m" />
            </Fact>
          )}
          <Fact
            label={through ? "Last movement" : `Last ${owed ? "payment" : "repayment"}`}
            note={
              due.lastPayment
                ? `${formatMedium(due.lastPayment.date)}${
                    due.lastPayment.interest > 0 ? `, ${formatMoney(due.lastPayment.interest)} of it interest` : ""
                  }`
                : through
                  ? "Nothing passed on yet"
                  : "Nothing paid yet"
            }
          >
            {due.lastPayment ? <Money value={due.lastPayment.amount} size="m" /> : <span className="t-body-strong">None</span>}
          </Fact>
          <Fact
            label="Last 30 days"
            note={
              through
                ? `${formatMoney(pace.paid30)} ${owed ? "passed on" : "paid back"}`
                : `${formatMoney(pace.paid30)} paid${pace.charged30 > 0 ? `, ${formatMoney(pace.charged30)} in charges` : ""}`
            }
          >
            <span className="t-body-strong">
              {formatMoney(pace.added30)} {through ? (owed ? "received" : "sent") : owed ? "borrowed" : "lent"}
            </span>
          </Fact>
        </dl>

        {notes.length > 0 && (
          <ul className="fms-debtnotes">
            {notes.map((n) => (
              <li key={n.key} className="t-caption" style={n.warn ? { color: "var(--warn)" } : undefined}>
                {n.text}
              </li>
            ))}
          </ul>
        )}

        <div className="fms-debtactions">
          {actions.map((a) => (
            <Button key={a.effect} size="sm" variant={a.primary ? "primary" : "secondary"} onClick={() => onRecord(a.effect, a.amount)}>
              {a.label}
            </Button>
          ))}
          <span className="fms-debtactions-spacer" />
          {selectable && (
            <button type="button" className="t-caption fms-linkbtn" aria-pressed={selected} onClick={onSelect}>
              {selected ? "History shown below" : "Show its history"}
            </button>
          )}
          {!through && (
            <button type="button" className="t-caption fms-linkbtn" aria-expanded={editing} onClick={onEdit}>
              {editing ? "Close details" : "Details"}
            </button>
          )}
        </div>

        {editing && !through && <DebtDetails debt={debt} onSave={onSave} onCancel={onEdit} />}
      </div>
    </Card>
  );
}

const NO_DAY = "No set day";
const DAYS = [NO_DAY, ...Array.from({ length: 31 }, (_, i) => String(i + 1))];
const NO_TERM = "Not set";
const TERMS = [NO_TERM, "3", "6", "9", "12", "18", "24", "36", "48", "60"];

/** Firestore refuses `undefined` in a document, so a cleared field is left out. */
function withoutBlanks(debt: Debt): Debt {
  return Object.fromEntries(Object.entries(debt).filter(([, v]) => v !== undefined)) as unknown as Debt;
}

/**
 * The three facts the arithmetic needs and nothing could set.
 *
 * A due day makes the next payment exact rather than worked out. A limit turns
 * a credit line's bar into "left to use". A loan's amount and term give it a
 * schedule. Each is optional, and clearing one goes back to working it out.
 */
function DebtDetails({ debt, onSave, onCancel }: { debt: Debt; onSave: (next: Debt) => void; onCancel: () => void }) {
  const form = debt.form ?? "credit-line";
  const [day, setDay] = useState(debt.dueDay ? String(debt.dueDay) : NO_DAY);
  const [limit, setLimit] = useState<Centavos | null>(debt.creditLimit ?? null);
  const [term, setTerm] = useState(debt.termMonths ? String(debt.termMonths) : NO_TERM);

  const save = (): void => {
    onSave(
      withoutBlanks({
        ...debt,
        dueDay: day === NO_DAY ? undefined : Number(day),
        creditLimit: limit !== null && limit > 0 ? limit : undefined,
        termMonths: form === "term-loan" ? (term === NO_TERM ? undefined : Number(term)) : debt.termMonths,
      }),
    );
  };

  return (
    <div className="fms-debtdetails">
      <label className="fms-debtfield">
        <span className="t-label" style={{ color: "var(--ink-2)" }}>
          {debt.kind === "payable" ? "Payment due on day" : "They pay back on day"}
        </span>
        <Select value={day} onChange={setDay} options={DAYS} ariaLabel={`Due day for ${debt.name}`} />
      </label>
      {form !== "informal" && (
        <label className="fms-debtfield">
          <span className="t-label" style={{ color: "var(--ink-2)" }}>
            {form === "term-loan" ? "Amount of the loan" : "Credit limit"}
          </span>
          <AmountInput value={limit} onChange={setLimit} ariaLabel={`${form === "term-loan" ? "Loan amount" : "Credit limit"} for ${debt.name}`} />
        </label>
      )}
      {form === "term-loan" && (
        <label className="fms-debtfield">
          <span className="t-label" style={{ color: "var(--ink-2)" }}>
            Monthly payments in all
          </span>
          <Select value={term} onChange={setTerm} options={TERMS} ariaLabel={`Term for ${debt.name}`} />
        </label>
      )}
      <p className="t-caption fms-debtdetails-note">
        {form === "credit-line"
          ? "A payment made in the twenty days before the due day counts for it. Leave the day unset and the date is worked out from the last payment."
          : form === "term-loan"
            ? "With the amount and the number of payments, each instalment and the date of the next are worked out from what has been paid."
            : "Money between people has no schedule unless one was agreed. Set a day only if it was."}
      </p>
      <div className="fms-debtactions">
        <Button size="sm" variant="primary" onClick={save}>
          Save details
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Every movement on one debt across every year, newest first, with what was owed after it. */
function History({
  due,
  transactions,
  onEditRow,
}: {
  due: DebtDue;
  transactions: readonly Transaction[];
  onEditRow: (row: Transaction) => void;
}) {
  const { debt } = due.position;
  const owed = debt.kind === "payable";

  /**
   * One line per movement, with its part folded in.
   *
   * "Interest ₱188.79" and "Paid back ₱2,500.00" were two lines with nothing
   * to say they were one ₱2,688.79 payment, and a borrowing with fees added
   * would have been two lines as well. What is owed after each line moves by
   * both rows, by the rules in `owedChange`.
   */
  const rows = useMemo(() => {
    let balance = 0;
    return movementsOf(rowsFor(transactions, debt.id))
      .map((m) => {
        balance += owedChange(m.row) + (m.part ? owedChange(m.part) : 0);
        return { m, balance };
      })
      .reverse();
  }, [transactions, debt.id]);

  return (
    <Card
      title={`${debt.name} history`}
      subtitle={`Every movement, newest first, with what was ${owed ? "owed" : "owed to you"} after it. Interest and fees show inside the movement they came with.`}
      padded={false}
    >
      {rows.length === 0 ? (
        <EmptyState message="Nothing recorded against it yet. Borrowing, charges and payments show here once they are added." />
      ) : (
        <div className="fms-rtable-wrap">
          <table className="fms-rtable">
            <thead>
              <tr>
                <th className="t-th">Date</th>
                <th className="t-th">What</th>
                <th className="t-th">Wallet</th>
                <th className="t-th">Note</th>
                <th className="t-th fms-rnum">Amount</th>
                <th className="t-th fms-rnum">{owed ? "Owed after" : "Owed to you after"}</th>
                <th className="t-th" aria-label="Correct" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, balance }) => {
                const t = m.row;
                return (
                  <tr key={t.id}>
                    <td className="t-num-s fms-rhead">{formatShort(t.date)}</td>
                    <td data-label="What">
                      <span className="fms-debtwhat">
                        <StatusPill status={t.debtEffect ? EFFECT_STATUS[t.debtEffect] : "none"}>
                          {t.debtEffect ? effectLabel(t.debtEffect, debt) : "Debt"}
                        </StatusPill>
                        {m.part && (
                          <span className="t-micro" style={{ color: "var(--ink-3)" }}>
                            {t.debtEffect === "draw"
                              ? `${formatMoney(t.amount)} received, ${formatMoney(m.part.amount)} ${partWords(t.debtEffect)}`
                              : `${formatMoney(t.amount)} off the balance, ${formatMoney(m.part.amount)} ${partWords(t.debtEffect)}`}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="t-caption" data-label="Wallet">
                      {t.fromWallet || t.toWallet || "None"}
                    </td>
                    <td className="t-caption fms-debtnotecell" data-label="Note" title={t.description || t.notes}>
                      {t.description || t.notes}
                    </td>
                    <td className="fms-rnum" data-label="Amount">
                      <Money value={m.total} size="s" />
                    </td>
                    <td className="fms-rnum" data-label={owed ? "Owed after" : "Owed to you after"}>
                      <Money value={balance} size="s" tone={balance > 0 && owed ? "var(--flow-debt-text)" : undefined} />
                    </td>
                    <td>
                      <button type="button" className="t-caption fms-linkbtn" onClick={() => onEditRow(t)}>
                        Correct
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
