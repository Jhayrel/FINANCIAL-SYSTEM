/**
 * Debt: spec 7.5.
 *
 * ── What changed on 2026-09-15 ────────────────────────────────────────────
 *
 * Each debt showed its balance and a date it did not judge: Maya Credit read
 * "next due September 3, 2026" on September 15, twelve days after. Nothing on
 * the screen could record a payment, nothing said whether a debt was growing
 * or shrinking, the history only covered the year its first row was in, and
 * "Add a debt" opened the Add form, which cannot add one.
 *
 * Now each debt says when its next payment is due and whether that has passed
 * (`debtDue`), how much, what was last paid, and how it moved over the last
 * month. A payment or a new draw is one tap to the Add form with the debt
 * filled in. The due day, limit and term, which nothing could set, are set
 * under Details. The history runs across every year, newest first, and each
 * row opens for correcting.
 *
 * Rule 5.6.2 is untouched: outstanding is still draws less repayments and
 * write-offs, with interest as spending.
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
  paymentsFiledAsSpending,
  positionsOf,
  rowsFor,
  type Debt,
  type DebtDue,
  type DebtEffect,
} from "../domain/debt";
import { creditLineState, DEBT_FORM_LABEL, loanSchedule } from "../domain/debtForms";
import { formatMoney, type Centavos } from "../domain/money";
import type { Transaction } from "../domain/types";
import { whenWords } from "./Dashboard";
import { useReportScreen } from "./screenReport";

const EFFECT_WORD: Record<DebtEffect, string> = {
  draw: "Borrowed",
  repay: "Paid back",
  interest: "Interest",
  fee: "Fee",
  writeoff: "Written off",
  lend: "Lent",
  collect: "Collected",
};

const EFFECT_STATUS: Record<DebtEffect, Status> = {
  draw: "warn",
  lend: "warn",
  repay: "ok",
  collect: "ok",
  interest: "info",
  fee: "info",
  writeoff: "none",
};

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
  const live = useMemo(() => debts.filter((d) => !d.archived), [debts]);
  const dues = useMemo(
    () => positionsOf(live, transactions, asOf).map((p) => debtDue(p, transactions, asOf)),
    [live, transactions, asOf],
  );
  const misfiled = useMemo(() => paymentsFiledAsSpending(live, transactions), [live, transactions]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const year = getYear(asOf);
  // Every debt, archived ones too: money still owed is owed whether or not the line is in use.
  const everything = positionsOf(debts, transactions, asOf);
  const owe = everything
    .filter((p) => p.debt.kind === "payable")
    .reduce((s, p) => s + Math.max(0, p.outstanding), 0);
  const owedToYou = everything
    .filter((p) => p.debt.kind === "receivable")
    .reduce((s, p) => s + Math.max(0, p.outstanding), 0);
  const interestThisYear = transactions
    .filter((t) => t.type === "Debt" && (t.debtEffect === "interest" || t.debtEffect === "fee") && getYear(t.date) === year)
    .reduce((s, t) => s + t.total, 0);

  const soon = duesWithin(dues, 7);
  const archived = debts.length - live.length;

  useReportScreen(
    () => ({
      screen: "Debt",
      lines: [
        `You owe ${formatMoney(owe)}. Owed to you ${formatMoney(owedToYou)}.`,
        ...dues.map(
          (d) =>
            `${d.position.debt.name}, ${d.position.debt.kind === "payable" ? "owed by the owner" : "owed to the owner"}: ${formatMoney(
              Math.max(0, d.position.outstanding),
            )} outstanding; next payment ${d.nextDue ? `${d.nextDue} (${whenWords(d.daysToDue).toLowerCase()})` : "not dated"}; last payment ${
              d.lastPayment ? `${formatMoney(d.lastPayment.amount)} on ${d.lastPayment.date}` : "none"
            }.`,
        ),
        misfiled.length > 0 ? `${misfiled.length} spending rows name a debt, and may be payments filed as spending.` : "",
      ],
    }),
    [owe, owedToYou, dues, misfiled],
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
                : "No credit lines, loans or money lent are followed yet. Add one in Settings, under Credit and loans, and its balance, payments and due dates show here."
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

  return (
    <div className="fms-dash">
      <div className="fms-debtsum">
        <Figure label="You owe" value={owe} tone="var(--flow-debt-text)" />
        <Figure label="Owed to you" value={owedToYou} />
        <Figure label={`Interest and fees in ${year}`} value={interestThisYear} />
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

      <div className="fms-debtgrid">
        {dues.map((d) => (
          <DebtCard
            key={d.position.debt.id}
            due={d}
            transactions={transactions}
            asOf={asOf}
            selected={selected?.position.debt.id === d.position.debt.id}
            editing={editId === d.position.debt.id}
            onSelect={() => setOpenId(d.position.debt.id)}
            onRecord={(effect, amount) => onRecord(d.position.debt, effect, amount)}
            onEdit={() => setEditId(editId === d.position.debt.id ? null : d.position.debt.id)}
            onSave={(next) => {
              onUpdateDebt(next);
              setEditId(null);
            }}
          />
        ))}
      </div>

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

function DebtCard({
  due,
  transactions,
  asOf,
  selected,
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
  const late = due.daysToDue !== undefined && due.daysToDue < 0;
  const settled = position.outstanding <= 0;
  const credit = creditLineState(position);
  const schedule = form === "term-loan" ? loanSchedule(position, asOf) : null;
  const pace = debtPace(position, transactions, asOf);

  return (
    <article className={["fms-debtcard", selected && "is-selected", late && "is-late"].filter(Boolean).join(" ")}>
      <button type="button" className="fms-debtcard-head" aria-pressed={selected} onClick={onSelect}>
        <span className="fms-debtcard-name">
          <span className="t-body-strong">{debt.name}</span>
          <span className="t-micro" style={{ color: "var(--ink-3)" }}>
            {DEBT_FORM_LABEL[form]} · {owed ? "you owe" : "owed to you"}
            {selected ? " · history below" : ""}
          </span>
        </span>
        <Money
          value={Math.max(0, position.outstanding)}
          size="l"
          tone={settled ? "var(--ink-3)" : late ? "var(--over)" : owed ? "var(--flow-debt-text)" : undefined}
        />
      </button>

      {credit ? (
        <div className="fms-debtbar">
          <ProgressBar value={credit.used} max={credit.limit} />
          <span className="t-micro" style={{ color: "var(--ink-3)" }}>
            {formatMoney(credit.available)} left to draw of the {formatMoney(credit.limit)} limit
          </span>
        </div>
      ) : schedule ? (
        <div className="fms-debtbar">
          <ProgressBar value={schedule.paid} max={schedule.termMonths} />
          <span className="t-micro" style={{ color: "var(--ink-3)" }}>
            {schedule.paid} of {schedule.termMonths} payments made, {formatMoney(schedule.monthlyPayment)} each
          </span>
        </div>
      ) : position.drawn > 0 ? (
        <div className="fms-debtbar">
          <ProgressBar value={position.repaid} max={position.drawn} />
          <span className="t-micro" style={{ color: "var(--ink-3)" }}>
            {formatMoney(position.repaid)} {owed ? "paid back" : "collected"} of {formatMoney(position.drawn)}{" "}
            {owed ? "borrowed" : "lent"}
          </span>
        </div>
      ) : null}

      {/*
        Four facts, each a label, a value and one line under it, so the four
        sit level however their words wrap. The date and its pill shared a
        line and broke onto two when they did not fit, and the column beside
        it no longer lined up.
      */}
      <dl className="fms-debtfacts">
        <div>
          <dt className="t-micro">Next payment</dt>
          <dd className="t-body-strong">
            {settled ? "Nothing owed" : due.nextDue ? formatMedium(due.nextDue) : owed ? "No date to go by" : "No date agreed"}
          </dd>
          <dd>
            {!settled && due.nextDue ? (
              <StatusPill status={late ? "over" : (due.daysToDue ?? 99) <= 7 ? "warn" : "ok"}>
                {whenWords(due.daysToDue)}
              </StatusPill>
            ) : (
              <span className="t-micro" style={{ color: "var(--ink-3)" }}>
                {settled ? "Paid off" : "Set a due day under Details"}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="t-micro">{owed ? "To pay" : "To collect"}</dt>
          <dd>
            <Money value={settled ? 0 : due.amountDue || position.outstanding} size="m" />
          </dd>
          <dd className="t-micro" style={{ color: "var(--ink-3)" }}>
            {settled ? "Nothing" : due.basis === "schedule" ? "This instalment" : "Everything outstanding"}
          </dd>
        </div>
        <div>
          <dt className="t-micro">Last {owed ? "payment" : "repayment"}</dt>
          <dd>
            {due.lastPayment ? (
              <Money value={due.lastPayment.amount} size="m" />
            ) : (
              <span className="t-body-strong">None yet</span>
            )}
          </dd>
          <dd className="t-micro" style={{ color: "var(--ink-3)" }}>
            {due.lastPayment ? formatMedium(due.lastPayment.date) : "Nothing paid back yet"}
          </dd>
        </div>
        <div>
          <dt className="t-micro">Last 30 days</dt>
          <dd className="t-body-strong">
            {owed ? "Borrowed" : "Lent"} {formatMoney(pace.added30)}
          </dd>
          <dd className="t-micro" style={{ color: "var(--ink-3)" }}>
            {owed ? "Paid back" : "Collected"} {formatMoney(pace.paid30)}
          </dd>
        </div>
      </dl>

      {!settled && due.nextDue && (due.basis === "last-payment" || due.basis === "borrowed") && (
        <p className="t-micro fms-debtnote">
          The date is {basisWords(due.basis)}. Set the real due day under Details to make it exact.
        </p>
      )}
      {!settled && !due.nextDue && form !== "informal" && (
        <p className="t-micro fms-debtnote">Set a due day under Details and this says when the next payment is due.</p>
      )}
      {!settled && pace.monthsToClear !== null && (
        <p className="t-caption fms-debtnote">
          At {formatMoney(pace.monthlyPayment)} a month, as over the last three months, it is cleared in about{" "}
          {pace.monthsToClear} {pace.monthsToClear === 1 ? "month" : "months"}.
        </p>
      )}
      {owed && pace.added30 > pace.paid30 && (
        <p className="t-caption fms-debtnote" style={{ color: "var(--warn)" }}>
          More was borrowed than paid back in the last 30 days, so it is growing.
        </p>
      )}

      <div className="fms-debtactions">
        {!settled && (
          <Button size="sm" variant="primary" onClick={() => onRecord(owed ? "repay" : "collect", due.amountDue > 0 ? due.amountDue : null)}>
            {owed ? "Record payment" : "Record what they paid"}
          </Button>
        )}
        <Button size="sm" onClick={() => onRecord(owed ? "draw" : "lend", null)}>
          {owed ? "Record borrowing" : "Record lending"}
        </Button>
        <button type="button" className="t-caption fms-linkbtn" aria-expanded={editing} onClick={onEdit}>
          {editing ? "Close details" : "Details"}
        </button>
      </div>

      {editing && <DebtDetails debt={debt} onSave={onSave} onCancel={onEdit} />}
    </article>
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
 * a credit line's bar into "left to draw". A loan's amount and term give it a
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
      <p className="t-micro" style={{ margin: 0, color: "var(--ink-3)" }}>
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

  const rows = useMemo(() => {
    let balance = 0;
    return rowsFor(transactions, debt.id)
      .map((t) => {
        if (t.debtEffect === "draw" || t.debtEffect === "lend") balance += t.amount;
        else if (t.debtEffect === "repay" || t.debtEffect === "collect" || t.debtEffect === "writeoff") balance -= t.amount;
        return { t, balance };
      })
      .reverse();
  }, [transactions, debt.id]);

  return (
    <Card
      title={`${debt.name} history`}
      subtitle={`Every movement, newest first, with what was ${owed ? "owed" : "owed to you"} after it`}
      padded={false}
    >
      {rows.length === 0 ? (
        <EmptyState message="Nothing recorded against it yet. Borrowing, payments and interest show here once they are added." />
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
              {rows.map(({ t, balance }) => (
                <tr key={t.id}>
                  <td className="t-num-s fms-rhead">{formatShort(t.date)}</td>
                  <td data-label="What">
                    <StatusPill status={t.debtEffect ? EFFECT_STATUS[t.debtEffect] : "none"}>
                      {t.debtEffect ? EFFECT_WORD[t.debtEffect] : "Debt"}
                    </StatusPill>
                  </td>
                  <td className="t-caption" data-label="Wallet">
                    {t.fromWallet || t.toWallet || "None"}
                  </td>
                  <td className="t-caption fms-debtnotecell" data-label="Note" title={t.description || t.notes}>
                    {t.description || t.notes}
                  </td>
                  <td className="fms-rnum" data-label="Amount">
                    <Money value={t.total} size="s" />
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
