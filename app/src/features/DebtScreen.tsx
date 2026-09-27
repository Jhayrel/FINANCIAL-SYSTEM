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
  feesCountedTwice,
  owedParts,
  movementsOf,
  owedChange,
  paymentsFiledAsSpending,
  positionsOf,
  rowsFor,
  type Debt,
  type DebtDue,
  type DebtEffect,
} from "../domain/debt";
import {
  creditRoom,
  LIMIT_COUNTS_LABEL,
  limitOn,
  limitSteps,
  takesLimit,
  usedAfterEach,
  withLimit,
  withoutStep,
  type CreditRoom,
  type LimitCounts,
  type LimitStep,
} from "../domain/creditLimit";
import { DEBT_FORM_LABEL, loanSchedule } from "../domain/debtForms";
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

  // Room left under each line's limit, for the lines whose lender sets one.
  const rooms = live
    .map((d) => ({ name: d.name, room: creditRoom(d, transactions, asOf) }))
    .filter((r): r is { name: string; room: CreditRoom } => r.room !== null);
  const roomLeft = rooms.reduce((s, r) => s + r.room.available, 0);
  const roomLimit = rooms.reduce((s, r) => s + r.room.limit, 0);
  const full = rooms.filter((r) => r.room.state === "reached" || r.room.state === "over");
  // The payment falling due first, of the debts you owe.
  const nextOwed = dues
    .filter((d) => d.position.debt.kind === "payable" && d.position.outstanding > 0 && d.nextDue)
    .sort((a, b) => ((a.nextDue ?? "") < (b.nextDue ?? "") ? -1 : 1))[0];
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
      onOpenRow={onEditRow}
      onFind={onShowRows}
    />
  );

  return (
    <div className="fms-dash">
      <div className="fms-debtsum">
        <Figure label="You owe" value={owe} tone="var(--flow-debt-text)" />
        {rooms.length > 0 && (
          <Figure
            label="Left to borrow"
            value={roomLeft}
            caption={full.length > 0 ? `${full.map((r) => r.name).join(", ")}: limit ${full.some((r) => r.room.state === "over") ? "passed" : "reached"}` : `of ${formatMoney(roomLimit)} in limits`}
            captionTone={full.length > 0 ? "var(--warn)" : undefined}
          />
        )}
        {nextOwed?.nextDue && (
          <Figure
            label="Next payment"
            value={nextOwed.amountDue || nextOwed.position.outstanding}
            caption={`${formatMedium(nextOwed.nextDue)}, ${whenWords(nextOwed.daysToDue).toLowerCase()}`}
            captionTone={(nextOwed.daysToDue ?? 99) < 0 ? "var(--over)" : (nextOwed.daysToDue ?? 99) <= 7 ? "var(--warn)" : undefined}
          />
        )}
        <Figure label={`Interest and fees, ${year}`} value={costThisYear} />
        {owedToYou > 0 && <Figure label="Owed to you" value={owedToYou} />}
        {owedToYou > 0 && <Figure label="Net" value={owedToYou - owe} signed />}
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

      <p className="t-caption fms-debtfoot">
        <span>
          {archived > 0 ? `${archived} archived, kept with their history. ` : ""}
          Adding, archiving and removing debts is in Settings.
        </span>
        <button type="button" className="t-caption fms-linkbtn" onClick={onManage}>
          Open Credit and loans
        </button>
      </p>

      {selected && <History due={selected} transactions={transactions} onEditRow={onEditRow} />}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
  signed,
  caption,
  captionTone,
}: {
  label: string;
  value: Centavos;
  tone?: string;
  signed?: boolean;
  caption?: string;
  captionTone?: string | undefined;
}) {
  return (
    <div className="fms-debtfig">
      <span className="t-label" style={{ color: "var(--ink-2)" }}>
        {label}
      </span>
      <Money value={value} size="l" signed={signed} tone={value === 0 ? "var(--ink-3)" : tone} />
      {caption && (
        <span className="t-caption fms-debtfig-caption" style={{ color: captionTone ?? "var(--ink-3)" }}>
          {caption}
        </span>
      )}
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
  onOpenRow,
  onFind,
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
  /** A saved row into the Add form, to correct it. */
  onOpenRow: (row: Transaction) => void;
  /** The Database, searched for these words. */
  onFind: (query: string) => void;
}) {
  const { position } = due;
  const { debt } = position;
  const owed = debt.kind === "payable";
  const form = debt.form ?? "credit-line";
  const through = form === "pass-through";
  const late = due.daysToDue !== undefined && due.daysToDue < 0;
  const settled = position.outstanding <= 0;
  const room = through ? null : creditRoom(debt, transactions, asOf);
  const canLimit = takesLimit(debt);
  const schedule = form === "term-loan" ? loanSchedule(position, asOf) : null;
  const pace = debtPace(position, transactions, asOf);
  /** What is owed in its two parts, what was borrowed and the interest and fees the lender added (`owedParts`). */
  const split = owedParts(transactions, debt.id, asOf);
  /** Payments saved with the lender's fees counted again as interest (`feesCountedTwice`). */
  const twice = through || debt.kind !== "payable" ? [] : feesCountedTwice(transactions, debt.id);

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
    /*
     * The limit and the date together, which is the pair that matters: the
     * owner, 27 September 2026, "you reach your credit limit and the
     * deadline is nearing".
     */
    if (room && (room.state === "reached" || room.state === "over")) {
      const when = due.nextDue ? ` ${formatMoney(due.amountDue || position.outstanding)} is due ${formatMedium(due.nextDue)} (${whenWords(due.daysToDue).toLowerCase()}).` : "";
      notes.unshift({
        key: "limit",
        text:
          room.state === "over"
            ? `${formatMoney(room.over)} past the ${formatMoney(room.limit)} limit, so nothing more can be borrowed.${when} Paying it down makes room again.`
            : `The ${formatMoney(room.limit)} limit is used up, so nothing more can be borrowed.${when} Paying it down makes room again.`,
        warn: true,
      });
    } else if (room && room.state === "near") {
      notes.unshift({
        key: "limit",
        text: `Only ${formatMoney(room.available)} is left to borrow before the ${formatMoney(room.limit)} limit.`,
        warn: true,
      });
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
      action={
        <span className="fms-debtpills">
          {room && room.state !== "ok" && (
            <StatusPill status={room.state === "over" ? "over" : "warn"}>
              {room.state === "over" ? "Past the limit" : room.state === "reached" ? "Limit reached" : "Near the limit"}
            </StatusPill>
          )}
          <StatusPill status={state.status}>{state.words}</StatusPill>
        </span>
      }
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

          {room ? (
            <div className="fms-debthero-side">
              <span className="t-label" style={{ color: "var(--ink-2)" }}>
                Left to borrow
              </span>
              <Money value={room.available} size="l" tone={room.available === 0 ? "var(--ink-3)" : undefined} />
              <ProgressBar value={room.used} max={room.limit} tone="var(--flow-debt)" label="of the limit used" />
              <span className="t-caption" style={{ color: room.state === "ok" ? "var(--ink-3)" : room.state === "over" ? "var(--over)" : "var(--warn)" }}>
                {formatMoney(Math.min(room.used, room.limit))} of the {formatMoney(room.limit)} limit used
                {room.state === "over" ? `, ${formatMoney(room.over)} past it` : room.state === "reached" ? ", nothing left" : ""}
              </span>
              {room.lastChange && (
                <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                  {room.lastChange.amount > room.lastChange.before ? "Raised" : "Lowered"} from {formatMoney(room.lastChange.before)} on{" "}
                  {formatMedium(room.lastChange.from)}
                </span>
              )}
              <LimitQuick debt={debt} asOf={asOf} current={room.limit} onSave={onSave} />
            </div>
          ) : canLimit ? (
            <div className="fms-debthero-side">
              <span className="t-label" style={{ color: "var(--ink-2)" }}>
                Credit limit
              </span>
              <LimitQuick debt={debt} asOf={asOf} current={null} onSave={onSave} />
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
              note={
                settled
                  ? "Nothing"
                  : due.basis === "schedule"
                    ? "This instalment"
                    : split.fees > 0
                      ? `${formatMoney(split.borrowed)} borrowed + ${formatMoney(split.fees)} interest and fees`
                      : "Everything owed now"
              }
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

        {/*
          The lender's fees counted twice: once when they were added, and
          again as interest on the payment that cleared them. It moved the
          owner's Maya Credit to PHP 604.12 owed after they had paid it off
          (27 September 2026). Reported with the rows to open, never
          corrected for them.
        */}
        {twice.map((t) => {
          const n = (row: Transaction): string => `#${String(row.recordNumber).padStart(4, "0")}`;
          const meant = t.paid + t.interest.amount === t.leftShown + t.payment.amount ? t.paid + t.interest.amount : t.paid;
          return (
            <div key={t.payment.id} className="fms-debttwice" role="note">
              <p className="t-caption" style={{ margin: 0 }}>
                <span className="t-body-strong">{formatMoney(t.interest.amount)} was counted twice</span> on {formatMedium(t.payment.date)}. It is the fees{" "}
                {debt.name} added when you borrowed, already in what you owed, and {n(t.payment)} saved it again as interest. That is why{" "}
                {formatMoney(t.leftShown)} looked owed after you paid.
              </p>
              <p className="t-caption" style={{ margin: 0, color: "var(--ink-2)" }}>
                To put it right{t.followUp ? ", first bin " : ": "}
                {t.followUp ? (
                  <>
                    {n(t.followUp)} ({formatMoney(t.followUp.amount)}, paid on that figure) if that payment did not really happen. Then
                  </>
                ) : null}{" "}
                open {n(t.payment)} and save it again: {formatMoney(meant - t.interest.amount)} with {formatMoney(t.interest.amount)} of interest and fees now reads as one payment of{" "}
                {formatMoney(meant)}.
              </p>
              <div className="fms-debttwice-actions">
                {t.followUp && (
                  <Button size="sm" onClick={() => onFind(n(t.followUp!))}>
                    Show {n(t.followUp)}
                  </Button>
                )}
                <Button size="sm" onClick={() => onOpenRow(t.payment)}>
                  Correct {n(t.payment)}
                </Button>
              </div>
            </div>
          );
        })}

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

        {editing && !through && <DebtDetails debt={debt} asOf={asOf} onSave={onSave} onCancel={onEdit} />}
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
 * The credit limit, set or changed on the card itself.
 *
 * It lived under Details, and the owner never found it: on 27 September 2026,
 * with the limit feature live, their Maya Credit still had none, the card
 * said nothing about one, and they wrote "you didnt fix the debt". A line
 * that takes a limit now asks for it where the figures are, and a line that
 * has one offers "Limit changed?" for the day the lender raises it. The
 * first limit counts from the day the line opened; a change counts from the
 * day it is said to have happened. Every step stays in Details, with its
 * date, to correct.
 */
function LimitQuick({
  debt,
  asOf,
  current,
  onSave,
}: {
  debt: Debt;
  asOf: string;
  /** The limit now, or null when none is set. */
  current: Centavos | null;
  onSave: (next: Debt) => void;
}) {
  const [open, setOpen] = useState(current === null);
  const [amount, setAmount] = useState<Centavos | null>(current);
  const [from, setFrom] = useState(asOf);
  const first = current === null;
  // A line set up without a real opening day counts its first limit from today.
  const opened = debt.openedDate && debt.openedDate >= "2000-01-01" && debt.openedDate <= asOf ? debt.openedDate : asOf;
  const since = first ? opened : from || asOf;
  const ready = amount !== null && amount > 0 && amount !== current;

  if (!open) {
    return (
      <button type="button" className="t-caption fms-linkish fms-limitquick-open" onClick={() => setOpen(true)}>
        Limit changed?
      </button>
    );
  }

  return (
    <div className="fms-limitquick">
      {first && (
        <span className="t-caption" style={{ color: "var(--ink-3)" }}>
          Not set. Put in what {debt.counterparty || debt.name} lets you borrow, and this shows what is left, and warns you before you reach it.
        </span>
      )}
      <div className="fms-limitquick-row">
        <label className="fms-debtfield">
          <span className="t-label" style={{ color: "var(--ink-2)" }}>
            {first ? "What they let you borrow" : "New limit"}
          </span>
          <AmountInput value={amount} onChange={setAmount} ariaLabel={`${first ? "Credit limit" : "New limit"} for ${debt.name}`} />
        </label>
        {!first && (
          <label className="fms-debtfield">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>
              Changed on
            </span>
            <input type="date" className="t-body fms-control" value={from} max={asOf} onChange={(e) => setFrom(e.target.value)} />
          </label>
        )}
      </div>
      <div className="fms-limitquick-actions">
        <Button
          size="sm"
          variant="primary"
          disabled={!ready}
          onClick={() => {
            if (!ready) return;
            onSave(withLimit(debt, amount, since));
            setOpen(false);
          }}
        >
          {first ? "Set limit" : "Save new limit"}
        </Button>
        {!first && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAmount(current);
              setFrom(asOf);
              setOpen(false);
            }}
          >
            Cancel
          </Button>
        )}
      </div>
      {first && (
        <span className="t-micro" style={{ color: "var(--ink-3)" }}>
          Counted from {formatMedium(since)}{since === debt.openedDate ? ", when it opened" : ""}. When {debt.counterparty || "the lender"} raises it, say so here and the old limit is kept for the months it applied.
        </span>
      )}
    </div>
  );
}

/**
 * The facts the arithmetic needs and nothing could set.
 *
 * A due day makes the next payment exact rather than worked out. A limit
 * turns a credit line's figure into "left to borrow", judged against the
 * limit each borrowing had on its day. A loan's amount and term give it a
 * schedule. Each is optional, and clearing one goes back to working it out.
 *
 * Only a credit line from a lender takes a limit (owner, 2026-09-27: "only
 * in certain bank", never a personal or a business one). A lender raises
 * it over time, so a new figure is a new step from the day it changed, and
 * the old one stays for the months it applied to.
 */
function DebtDetails({
  debt,
  asOf,
  onSave,
  onCancel,
}: {
  debt: Debt;
  asOf: string;
  onSave: (next: Debt) => void;
  onCancel: () => void;
}) {
  const form = debt.form ?? "credit-line";
  const limited = takesLimit(debt);
  const [day, setDay] = useState(debt.dueDay ? String(debt.dueDay) : NO_DAY);
  const [steps, setSteps] = useState<readonly LimitStep[]>(() => limitSteps(debt));
  const last = steps.length > 0 ? steps[steps.length - 1]!.amount : null;
  const [limit, setLimit] = useState<Centavos | null>(limited ? last : (debt.creditLimit ?? null));
  const [since, setSince] = useState<string>(steps.length > 0 ? asOf : debt.openedDate || asOf);
  const [counts, setCounts] = useState<LimitCounts>(debt.limitCounts ?? "owed");
  const [term, setTerm] = useState(debt.termMonths ? String(debt.termMonths) : NO_TERM);
  const changing = limited && (limit ?? 0) > 0 && limit !== last;

  const save = (): void => {
    let next: Debt = {
      ...debt,
      dueDay: day === NO_DAY ? undefined : Number(day),
      termMonths: form === "term-loan" ? (term === NO_TERM ? undefined : Number(term)) : debt.termMonths,
    };
    if (limited) {
      const kept: Debt =
        steps.length > 0 ? { ...next, limits: steps, creditLimit: steps[steps.length - 1]!.amount } : withLimit(next, null, asOf);
      next = limit !== last ? withLimit(kept, limit, since || asOf) : kept;
      if (next.creditLimit) next = { ...next, limitCounts: counts };
    } else if (form === "term-loan") {
      next = { ...next, creditLimit: limit !== null && limit > 0 ? limit : undefined };
    }
    onSave(withoutBlanks(next));
  };

  const remove = (from: string): void => {
    const left = limitSteps(withoutStep({ ...debt, limits: steps, creditLimit: last ?? undefined }, from));
    setSteps(left);
    setLimit(left.length > 0 ? left[left.length - 1]!.amount : null);
  };

  return (
    <div className="fms-debtdetails">
      <label className="fms-debtfield">
        <span className="t-label" style={{ color: "var(--ink-2)" }}>
          {debt.kind === "payable" ? "Payment due on day" : "They pay back on day"}
        </span>
        <Select value={day} onChange={setDay} options={DAYS} ariaLabel={`Due day for ${debt.name}`} />
      </label>

      {limited && (
        <div className="fms-debtlimit">
          <div className="fms-debtlimit-row">
            <label className="fms-debtfield">
              <span className="t-label" style={{ color: "var(--ink-2)" }}>
                Credit limit
              </span>
              <AmountInput value={limit} onChange={setLimit} ariaLabel={`Credit limit for ${debt.name}`} />
            </label>
            {changing && (
              <label className="fms-debtfield">
                <span className="t-label" style={{ color: "var(--ink-2)" }}>
                  {steps.length === 0 ? "Since" : "Changed on"}
                </span>
                <input
                  type="date"
                  value={since}
                  max={asOf}
                  onChange={(e) => setSince(e.target.value)}
                  className="t-body fms-control"
                  aria-label={`When the limit on ${debt.name} became this`}
                />
              </label>
            )}
            {(limit ?? 0) > 0 && (
              <label className="fms-debtfield">
                <span className="t-label" style={{ color: "var(--ink-2)" }}>
                  What counts against it
                </span>
                <Select
                  value={LIMIT_COUNTS_LABEL[counts]}
                  onChange={(v) => setCounts(v === LIMIT_COUNTS_LABEL.borrowed ? "borrowed" : "owed")}
                  options={[LIMIT_COUNTS_LABEL.owed, LIMIT_COUNTS_LABEL.borrowed]}
                  ariaLabel={`What counts against the limit on ${debt.name}`}
                />
              </label>
            )}
          </div>
          {steps.length > 0 && (
            <ul className="fms-debtsteps" aria-label="The limit over time">
              {steps.map((st, i) => (
                <li key={st.from} className="fms-debtstep">
                  <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                    {i === 0 ? "From" : st.amount >= (steps[i - 1]?.amount ?? 0) ? "Raised" : "Lowered"} {formatMedium(st.from)}
                  </span>
                  <Money value={st.amount} size="s" />
                  <button type="button" className="t-caption fms-linkbtn" onClick={() => remove(st.from)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="t-caption fms-debtdetails-note">
            {(limit ?? 0) > 0
              ? "A new figure is kept as a step from the day it changed, so earlier borrowing is judged by the limit it had. Pick what your lender's app counts as used: if it let you borrow again while its fees were still owed, it counts only what was borrowed."
              : "Leave it empty if this lender sets no limit."}
          </p>
        </div>
      )}

      {form === "term-loan" && (
        <label className="fms-debtfield">
          <span className="t-label" style={{ color: "var(--ink-2)" }}>
            Amount of the loan
          </span>
          <AmountInput value={limit} onChange={setLimit} ariaLabel={`Loan amount for ${debt.name}`} />
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

/** One line of a debt's history: a movement, or the lender changing the limit. */
type HistoryLine =
  | {
      readonly kind: "move";
      readonly key: string;
      readonly date: string;
      readonly m: ReturnType<typeof movementsOf>[number];
      readonly owedAfter: Centavos;
      /** Left under the limit after it, negative when past it; null without a limit. */
      readonly leftAfter: Centavos | null;
      /** Of a payment, how much cleared fees the lender had already added. */
      readonly feesCovered?: Centavos;
    }
  | { readonly kind: "limit"; readonly key: string; readonly date: string; readonly step: LimitStep; readonly before: Centavos | null };

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
  const steps = limitSteps(debt);
  const limited = steps.length > 0;

  /**
   * One line per movement, with its part folded in, and a line wherever the
   * lender changed the limit.
   *
   * "Interest ₱188.79" and "Paid back ₱2,500.00" were two lines with nothing
   * to say they were one ₱2,688.79 payment, and a borrowing with fees added
   * would have been two lines as well. What is owed after each line moves by
   * both rows, by the rules in `owedChange`. What is left to borrow after it
   * is judged by the limit of that day (`creditLimit.ts`).
   */
  const lines = useMemo((): HistoryLine[] => {
    const rows = rowsFor(transactions, debt.id);
    const used = usedAfterEach(debt, rows);
    // Where each row falls, so a movement reads what was used after the later of its two rows.
    const order = new Map([...used.keys()].map((id, i) => [id, i]));
    let balance = 0;
    /*
     * The lender's fees still owed, which a payment clears before what was
     * borrowed (`unpaidCharges`), so a payment can say what it covered: the
     * owner's PHP 302.06 of fees had nowhere to show but "interest".
     */
    let fees = 0;
    const moves: HistoryLine[] = movementsOf(rows).map((m) => {
      for (const t of m.part ? [m.row, m.part] : [m.row]) if (t.debtEffect === "charge") fees += t.amount;
      const feesCovered = m.row.debtEffect === "repay" || m.row.debtEffect === "writeoff" ? Math.min(fees, m.row.amount) : 0;
      fees -= feesCovered;
      balance += owedChange(m.row) + (m.part ? owedChange(m.part) : 0);
      if (balance <= 0) fees = 0;
      const lastId = m.part && (order.get(m.part.id) ?? -1) > (order.get(m.row.id) ?? -1) ? m.part.id : m.row.id;
      const after = used.get(lastId) ?? 0;
      const limit = limitOn(debt, m.row.date);
      return { kind: "move", key: m.row.id, date: m.row.date, m, owedAfter: balance, leftAfter: limit === null ? null : limit - after, feesCovered };
    });
    const changes: HistoryLine[] = steps.map((step, i) => ({
      kind: "limit",
      key: `limit-${step.from}`,
      date: step.from,
      step,
      before: i > 0 ? (steps[i - 1]?.amount ?? null) : null,
    }));
    // Oldest first with a change before the day's movements, then newest first.
    return [...changes, ...moves]
      .map((line, i) => ({ line, i }))
      .sort((a, b) => (a.line.date === b.line.date ? a.i - b.i : a.line.date < b.line.date ? -1 : 1))
      .map((x) => x.line)
      .reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, debt]);

  const what = (line: Extract<HistoryLine, { kind: "move" }>) => {
    const t = line.m.row;
    return t.debtEffect ? effectLabel(t.debtEffect, debt) : "Debt";
  };
  const partText = (line: Extract<HistoryLine, { kind: "move" }>): string => {
    const { m } = line;
    const covered = line.feesCovered ?? 0;
    if (!m.part) {
      return covered > 0 && m.row.debtEffect === "repay"
        ? `${covered < m.row.amount ? `${formatMoney(m.row.amount - covered)} of what you borrowed, ` : ""}${formatMoney(covered)} of fees already added`
        : "";
    }
    return m.row.debtEffect === "draw"
      ? `${formatMoney(m.row.amount)} received, ${formatMoney(m.part.amount)} ${partWords(m.row.debtEffect)}`
      : `${formatMoney(m.row.amount)} off the balance, ${formatMoney(m.part.amount)} ${partWords(m.row.debtEffect)}`;
  };
  const limitText = (line: Extract<HistoryLine, { kind: "limit" }>): string =>
    line.before === null
      ? `Limit of ${formatMoney(line.step.amount)}`
      : `Limit ${line.step.amount >= line.before ? "raised" : "lowered"} from ${formatMoney(line.before)} to ${formatMoney(line.step.amount)}`;
  const left = (value: Centavos | null) =>
    value === null ? null : value < 0 ? (
      <span className="t-num-s" style={{ color: "var(--over)" }}>
        {formatMoney(-value)} past
      </span>
    ) : (
      <Money value={value} size="s" tone={value === 0 ? "var(--ink-3)" : undefined} />
    );
  const owedLabel = owed ? "Owed after" : "Owed to you after";

  return (
    <Card
      title={`${debt.name} history`}
      subtitle={`Every movement, newest first, with what was ${owed ? "owed" : "owed to you"} after it${
        limited ? " and what was left to borrow" : ""
      }. Interest and fees show inside the movement they came with.`}
      padded={false}
    >
      {/* One height with one row or fifty: the rows scroll inside it (layout.css, `.fms-tablebox`). */}
      <div className="fms-tablebox">
        {lines.length === 0 ? (
          <EmptyState message="Nothing recorded against it yet. Borrowing, charges and payments show here once they are added." />
        ) : (
          <>
            <div className="fms-rtable-wrap fms-debthist-table">
              <table className="fms-rtable">
                <thead>
                  <tr>
                    <th className="t-th fms-debthist-date">Date</th>
                    <th className="t-th">What</th>
                    <th className="t-th">Note</th>
                    <th className="t-th">Wallet</th>
                    <th className="t-th fms-rnum">Amount</th>
                    <th className="t-th fms-rnum">{owedLabel}</th>
                    {limited && <th className="t-th fms-rnum">Left to borrow</th>}
                    <th className="t-th" aria-label="Correct" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) =>
                    line.kind === "limit" ? (
                      <tr key={line.key} className="fms-debthist-limit">
                        <td className="t-num-s">{formatShort(line.date)}</td>
                        <td>
                          <StatusPill status="info">Limit</StatusPill>
                        </td>
                        <td className="t-caption" colSpan={4}>
                          {limitText(line)}
                        </td>
                        {limited && (
                          <td className="fms-rnum">
                            <Money value={line.step.amount} size="s" tone="var(--ink-3)" />
                          </td>
                        )}
                        <td />
                      </tr>
                    ) : (
                      <tr key={line.key}>
                        <td className="t-num-s">{formatShort(line.date)}</td>
                        <td>
                          <span className="fms-debtwhat">
                            <StatusPill status={line.m.row.debtEffect ? EFFECT_STATUS[line.m.row.debtEffect] : "none"}>{what(line)}</StatusPill>
                            {partText(line) && (
                              <span className="t-micro" style={{ color: "var(--ink-3)" }}>
                                {partText(line)}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="t-caption fms-debtnotecell" title={line.m.row.description || line.m.row.notes}>
                          {line.m.row.description || line.m.row.notes}
                        </td>
                        <td className="t-caption">{line.m.row.fromWallet || line.m.row.toWallet || "None"}</td>
                        <td className="fms-rnum">
                          <Money value={line.m.total} size="s" />
                        </td>
                        <td className="fms-rnum">
                          <Money value={line.owedAfter} size="s" tone={line.owedAfter > 0 && owed ? "var(--flow-debt-text)" : undefined} />
                        </td>
                        {limited && <td className="fms-rnum">{left(line.leftAfter)}</td>}
                        <td className="fms-rnum">
                          <button type="button" className="t-caption fms-linkbtn" onClick={() => onEditRow(line.m.row)}>
                            Correct
                          </button>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>

            {/*
              The same lines as a phone list: what it was and the amount on
              the first line, the date, wallet and what it left on the
              second. The row is tapped to correct it (owner, 2026-09-27:
              "fix the debt ui in phone ... also the table fix it").
            */}
            <ul className="fms-debthist-list">
              {lines.map((line) =>
                line.kind === "limit" ? (
                  <li key={line.key} className="fms-debthist-item fms-debthist-item--limit">
                    <div className="fms-debthist-line">
                      <StatusPill status="info">Limit</StatusPill>
                      <Money value={line.step.amount} size="s" tone="var(--ink-2)" />
                    </div>
                    <div className="fms-debthist-line t-caption">
                      <span>
                        {formatMedium(line.date)} · {limitText(line)}
                      </span>
                    </div>
                  </li>
                ) : (
                  <li key={line.key}>
                    <button type="button" className="fms-debthist-item" onClick={() => onEditRow(line.m.row)} aria-label={`Correct ${what(line)} ${formatMoney(line.m.total)} on ${formatMedium(line.date)}`}>
                      <span className="fms-debthist-line">
                        <StatusPill status={line.m.row.debtEffect ? EFFECT_STATUS[line.m.row.debtEffect] : "none"}>{what(line)}</StatusPill>
                        <Money value={line.m.total} size="m" />
                      </span>
                      <span className="fms-debthist-line t-caption">
                        <span className="fms-debthist-meta">
                          {formatMedium(line.date)} · {line.m.row.fromWallet || line.m.row.toWallet || "No wallet"}
                        </span>
                        <span className="fms-debthist-after">
                          {owed ? "Owed" : "Owed to you"}{" "}
                          <Money value={line.owedAfter} size="s" tone={line.owedAfter > 0 && owed ? "var(--flow-debt-text)" : undefined} />
                        </span>
                      </span>
                      {(partText(line) || line.leftAfter !== null) && (
                        <span className="fms-debthist-line t-caption">
                          <span className="fms-debthist-meta">{partText(line)}</span>
                          {line.leftAfter !== null && <span className="fms-debthist-after">Left {left(line.leftAfter)}</span>}
                        </span>
                      )}
                      {(line.m.row.description || line.m.row.notes) && (
                        <span className="fms-debthist-note t-caption">{line.m.row.description || line.m.row.notes}</span>
                      )}
                    </button>
                  </li>
                ),
              )}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}
