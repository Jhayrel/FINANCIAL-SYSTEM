/**
 * Allocations on the Budget screen (docs/17-ALLOCATIONS.md, A8): money set
 * aside for a kind of spending this month, each line with what is spent,
 * what is left and this week's share; Add, Edit, Remove and Put back; a month
 * copied from the one before; and what to withdraw into a wallet.
 *
 * Every change goes through App's one path (`handleAllocation`), which checks
 * it again and keeps it in Activity, so this screen and the chat agree.
 */
import { useMemo, useState } from "react";

import { AmountInput, Field, TextInput } from "../components/forms";
import { Button, Card, EmptyState, Money, ProgressBar, SegmentedControl } from "../components/primitives";
import { Select } from "../components/Select";
import { Sheet } from "../components/Sheet";
import { useConfirm } from "../components/Confirm";
import { formatMedium } from "../domain/dates";
import { formatMoney, type Centavos } from "../domain/money";
import {
  allocatableKinds,
  amountOf,
  inputOfLine,
  lineName,
  linesIn,
  monthBefore,
  monthWords,
  paceWords,
  removedIn,
  walletNeeds,
  type AllocationChange,
  type AllocationInput,
  type AllocationLine,
  type AllocationStatus,
  type MonthAllocations,
} from "../domain/monthAllocation";
import type { ReferenceLists } from "../domain/types";
import { useMediaQuery } from "./useMediaQuery";

export function AllocationsCard({
  month,
  lines,
  reference,
  spendingBudget,
  balanceOf,
  onChange,
}: {
  /** The month on screen, worked out against the ledger. */
  month: MonthAllocations;
  /** Every allocation, every month, removed ones too. */
  lines: readonly AllocationLine[];
  reference: ReferenceLists;
  /** The month's spending budget, 0 with none. */
  spendingBudget: Centavos;
  balanceOf: (wallet: string) => Centavos;
  /** App's one path for a change; why it was refused, or null. */
  onChange: (change: AllocationChange) => string | null;
}) {
  const ym = month.month;
  const name = monthWords(ym);
  const [editing, setEditing] = useState<AllocationLine | "new" | null>(null);
  const [refused, setRefused] = useState("");
  const { confirm, dialog } = useConfirm();
  const removed = removedIn(lines, ym);
  const before = monthBefore(ym);
  const canAdd = month.phase !== "past";
  const toCopy = canAdd ? linesIn(lines, before).filter((l) => !month.lines.some((s) => s.line.kind.toLowerCase() === l.kind.toLowerCase() && s.line.words.toLowerCase() === l.words.toLowerCase())) : [];
  const needs = month.phase === "running" ? walletNeeds(month, balanceOf).filter((n) => n.short > 0) : [];

  const run = (change: AllocationChange): void => {
    setRefused(onChange(change) ?? "");
  };

  const remove = async (s: AllocationStatus): Promise<void> => {
    const ok = await confirm({
      title: `Remove the ${s.name} allocation?`,
      body:
        month.phase === "running"
          ? `It stops holding ${formatMoney(s.held)} now, so safe to spend rises by that. It is kept under Removed, to put back. Entries are not changed.`
          : "It is kept under Removed, to put back. Entries are not changed.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (ok) run({ kind: "remove", id: s.line.id });
  };

  const subtitle =
    month.lines.length === 0
      ? month.phase === "past"
        ? `Nothing was allocated in ${name}.`
        : "Money set aside for a kind of spending this month"
      : month.phase === "running"
        ? `${formatMoney(month.held)} set aside of ${formatMoney(month.allocated)} allocated. Safe to spend is what is left after it.`
        : month.phase === "past"
          ? `${formatMoney(month.spent)} spent of ${formatMoney(month.allocated)} allocated${month.unused > 0 ? `, ${formatMoney(month.unused)} not used` : ""}`
          : `${formatMoney(month.allocated)} allocated, held from the 1st`;

  return (
    <Card
      title="Allocations"
      subtitle={subtitle}
      action={
        // While the month has none, the empty state's own button is the one way in: one green button, not two (owner, 9 November 2026).
        canAdd && month.lines.length > 0 ? (
          <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
            Add
          </Button>
        ) : undefined
      }
    >
      <div className="fms-alloc">
        {month.lines.length > 0 && (
          <div className="fms-alloc-sum">
            <ProgressBar value={month.spent} max={month.allocated} height={6} label="of the allocations spent" />
            <p className="t-caption fms-planner-note">
              {spendingBudget > 0
                ? month.allocated > spendingBudget
                  ? `The allocations add up to ${formatMoney(month.allocated - spendingBudget)} more than the ${formatMoney(spendingBudget)} spending budget.`
                  : `${formatMoney(month.allocated)} of the ${formatMoney(spendingBudget)} spending budget is allocated; ${formatMoney(spendingBudget - month.allocated)} is for everything else.`
                : "No spending budget for the month, so the allocations stand on their own."}
              {month.over > 0 ? ` ${formatMoney(month.over)} went past its allocation, out of money that was free.` : ""}
            </p>
          </div>
        )}

        {needs.map((n) => (
          <p key={n.wallet} className="t-caption fms-alloc-need" role="status">
            Withdraw {formatMoney(n.short)} into {n.wallet}: its allocations still hold {formatMoney(n.needs)} and {n.wallet} has {formatMoney(Math.max(0, n.holds))}.
          </p>
        ))}

        {refused && (
          <p className="t-caption fms-note-over" role="alert">
            {refused}
          </p>
        )}

        {month.lines.length === 0 ? (
          <EmptyState
            message={
              month.phase === "past"
                ? `${name} has no allocations. They are made for the month that is running or one ahead.`
                : `No allocations for ${name}. Add one for gas, parking or the gym: that money is set aside, and safe to spend is what is left.`
            }
            action={
              canAdd ? (
                <span className="fms-alloc-emptyacts">
                  <Button variant="primary" onClick={() => setEditing("new")}>
                    Add an allocation
                  </Button>
                  {toCopy.length > 0 && <Button onClick={() => run({ kind: "copy", from: before, to: ym })}>Copy {monthWords(before)}</Button>}
                </span>
              ) : undefined
            }
          />
        ) : (
          <ol className="fms-alloc-list">
            {month.lines.map((s) => (
              <AllocationRow key={s.line.id} status={s} phase={month.phase} onEdit={() => setEditing(s.line)} onRemove={() => void remove(s)} />
            ))}
          </ol>
        )}

        {month.lines.length > 0 && toCopy.length > 0 && (
          <Button size="sm" onClick={() => run({ kind: "copy", from: before, to: ym })}>
            Copy {toCopy.length} from {monthWords(before)}
          </Button>
        )}

        {removed.length > 0 && (
          <div className="fms-alloc-removed">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>
              Removed
            </span>
            <ul className="fms-alloc-removedlist">
              {removed.map((l) => (
                <li key={l.id} className="fms-alloc-removedrow">
                  <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                    {lineName(l)}, {formatMoney(l.amount)}
                    {l.removedOn ? `, removed ${formatMedium(l.removedOn)}` : ""}
                  </span>
                  <button type="button" className="t-caption fms-linkbtn" onClick={() => run({ kind: "restore", id: l.id })} aria-label={`Put back the ${lineName(l)} allocation`}>
                    Put back
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {editing && (
        <AllocationSheet
          ym={ym}
          line={editing === "new" ? null : editing}
          reference={reference}
          onClose={() => setEditing(null)}
          onSave={(input) => {
            const why = onChange(editing === "new" ? { kind: "add", month: ym, input } : { kind: "edit", id: editing.id, input });
            if (!why) setRefused("");
            return why;
          }}
        />
      )}
      {dialog}
    </Card>
  );
}

function AllocationRow({ status: s, phase, onEdit, onRemove }: { status: AllocationStatus; phase: MonthAllocations["phase"]; onEdit: () => void; onRemove: () => void }) {
  const pace = paceWords(s.line);
  const what = [s.line.name.trim() && s.line.name.trim() !== s.line.kind ? `${s.line.kind}${s.line.words ? `, entries that say ${s.line.words}` : ""}` : s.line.words ? `Entries that say ${s.line.words}` : "", pace, s.line.wallet ? `from ${s.line.wallet}` : ""].filter(Boolean).join(" · ");
  /*
   * The same allocation twice (two phones adding it offline): said, never
   * removed by itself. It holds and counts nothing until one is removed.
   */
  if (s.twinOf) {
    return (
      <li className="fms-alloc-row">
        <div className="fms-alloc-head">
          <span className="t-body fms-alloc-name">{s.name}</span>
          <span className="t-micro" style={{ color: "var(--warn)" }}>
            twice
          </span>
        </div>
        <div className="fms-alloc-foot">
          <span className="t-caption fms-note-over" role="status">
            The same as {s.twinOf} above, {formatMoney(s.line.amount)}. Only the first counts; remove one.
          </span>
          <span className="fms-alloc-acts">
            <button type="button" className="t-caption fms-linkbtn fms-linkbtn--danger" onClick={onRemove} aria-label={`Remove this second ${s.name} allocation`}>
              Remove
            </button>
          </span>
        </div>
      </li>
    );
  }
  return (
    <li className="fms-alloc-row">
      <div className="fms-alloc-head">
        <span className="t-body fms-alloc-name">{s.name}</span>
        <span className="fms-alloc-figure">
          {s.over > 0 ? (
            <>
              <Money value={s.over} size="s" tone="var(--over)" />
              <span className="t-micro" style={{ color: "var(--over)" }}>
                over
              </span>
            </>
          ) : (
            <>
              <Money value={Math.max(0, s.left)} size="s" />
              <span className="t-micro" style={{ color: "var(--ink-3)" }}>
                {phase === "past" ? "not used" : "left"}
              </span>
            </>
          )}
        </span>
      </div>
      {what && (
        <span className="t-micro fms-alloc-meta" style={{ color: "var(--ink-3)" }}>
          {what}
        </span>
      )}
      <ProgressBar value={s.spent} max={s.line.amount} height={6} label={`of ${s.name} spent`} />
      {s.week && (
        <span className={s.week.left < 0 ? "t-caption fms-note-over" : "t-caption"} style={s.week.left < 0 ? undefined : { color: "var(--ink-2)" }}>
          Week {s.week.index}, {formatMedium(s.week.from)} to {formatMedium(s.week.to)}: {formatMoney(s.week.spent)} of {formatMoney(s.week.share)}
          {s.week.left < 0 ? `, ${formatMoney(-s.week.left)} past it` : `, ${formatMoney(s.week.left)} left this week`}
        </span>
      )}
      {s.plansInside.length > 0 && (
        <span className="t-caption" style={{ color: "var(--ink-2)" }}>
          Held once with the plan{s.plansInside.length === 1 ? "" : "s"} {s.plansInside.map((p) => `"${p.title}"`).join(", ")}: {formatMoney(s.held)} set aside, the larger of the two.
        </span>
      )}
      {/*
        The figure and the two actions share a line: a row of buttons of its
        own under every allocation doubled each line's height (owner, 9
        November 2026: "fix the ui of the buttons").
      */}
      <div className="fms-alloc-foot">
        <span className="t-caption" style={{ color: "var(--ink-2)" }}>
          {formatMoney(s.spent)} spent of {formatMoney(s.line.amount)}
          {s.timesUsed !== null && s.line.times ? `, ${s.timesUsed} of ${s.line.times} times` : ""}
        </span>
        {/* Quiet links, as "Set a limit" is on the card below it: one family on Budget, on the phone and the computer. */}
        <span className="fms-alloc-acts">
          <button type="button" className="t-caption fms-linkbtn" onClick={onEdit} aria-label={`Edit the ${s.name} allocation`}>
            Edit
          </button>
          <button type="button" className="t-caption fms-linkbtn fms-linkbtn--danger" onClick={onRemove} aria-label={`Remove the ${s.name} allocation`}>
            Remove
          </button>
        </span>
      </div>
    </li>
  );
}

type Shape = "month" | "week" | "time";

function AllocationSheet({
  ym,
  line,
  reference,
  onClose,
  onSave,
}: {
  ym: string;
  line: AllocationLine | null;
  reference: ReferenceLists;
  onClose: () => void;
  onSave: (input: AllocationInput) => string | null;
}) {
  const start = line ? inputOfLine(line) : null;
  const kinds = useMemo(() => allocatableKinds(reference), [reference]);
  const [kind, setKind] = useState(start?.kind ?? "");
  const [words, setWords] = useState(start?.words ?? "");
  const [label, setLabel] = useState(start?.name ?? "");
  const [shape, setShape] = useState<Shape>(start?.per ?? "month");
  const [amount, setAmount] = useState<Centavos | null>(start && !start.per ? start.amount : null);
  const [each, setEach] = useState<Centavos | null>(start?.each ?? null);
  const [times, setTimes] = useState(String(start?.times ?? (start?.per === "time" ? 8 : 4)));
  const [wallet, setWallet] = useState(start?.wallet ?? "");
  const [error, setError] = useState("");
  const dialog = useMediaQuery("(min-width: 900px)");
  const NOT_SAID = "Not said";
  const accounts = [...reference.wallets, ...reference.savings];

  const count = Number(times);
  const input: AllocationInput = {
    name: label,
    kind,
    words,
    amount: shape === "month" ? amount : null,
    ...(shape === "month" ? {} : { each, times: Number.isInteger(count) ? count : null, per: shape }),
    wallet,
  };
  const total = amountOf(input);

  const save = (): void => {
    const why = onSave(input);
    if (why) setError(why);
    else onClose();
  };

  return (
    <Sheet
      title={line ? `Edit the ${lineName(line)} allocation` : `Allocate for ${monthWords(ym)}`}
      subtitle="Set aside for one kind of spending. Every entry of that kind this month counts against it by itself."
      onClose={onClose}
      dialog={dialog}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {line ? "Save changes" : "Add allocation"}
          </Button>
        </>
      }
    >
      <div className="fms-alloc-form">
        <Field label="Kind of spending" required help="Bills and subscriptions are held already, so they are not here." htmlFor="alloc-kind">
          <Select id="alloc-kind" value={kind} onChange={setKind} options={kinds} placeholder="Pick a kind" ariaLabel="Kind of spending" />
        </Field>
        <Field label="Only entries that say" optional help="For one part of a kind: gym, for Self Care entries about the gym. Separate words with commas." htmlFor="alloc-words">
          <TextInput id="alloc-words" value={words} onChange={setWords} placeholder="Every entry of the kind" maxLength={80} />
        </Field>
        <Field label="Name" optional htmlFor="alloc-name">
          <TextInput id="alloc-name" value={label} onChange={setLabel} placeholder={kind || "The kind's name"} maxLength={40} />
        </Field>
        <Field label="How much">
          <SegmentedControl
            label="How much"
            options={[
              { id: "month", label: "For the month" },
              { id: "week", label: "A week" },
              { id: "time", label: "A time" },
            ]}
            value={shape}
            onChange={(next) => {
              setShape(next);
              if (next === "time" && times === "4") setTimes("8");
              if (next === "week" && times === "8") setTimes("4");
            }}
          />
        </Field>
        {shape === "month" ? (
          <Field label={`Amount for ${monthWords(ym)}`} required htmlFor="alloc-amount">
            <AmountInput id="alloc-amount" value={amount} onChange={setAmount} ariaLabel="Amount for the month" />
          </Field>
        ) : (
          <div className="fms-alloc-pair">
            <Field label={shape === "week" ? "A week" : "Each time"} required htmlFor="alloc-each">
              <AmountInput id="alloc-each" value={each} onChange={setEach} ariaLabel={shape === "week" ? "Amount a week" : "Amount each time"} />
            </Field>
            <Field label={shape === "week" ? "Weeks" : "Times"} required htmlFor="alloc-times">
              <input
                id="alloc-times"
                className="t-body fms-input"
                inputMode="numeric"
                pattern="[0-9]*"
                value={times}
                onChange={(e) => setTimes(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                aria-label={shape === "week" ? "How many weeks" : "How many times"}
              />
            </Field>
          </div>
        )}
        <p className="t-caption" style={{ margin: 0, color: "var(--ink-2)" }} role="status">
          {total !== null ? `${formatMoney(total)} for ${monthWords(ym)}.` : "Say how much."}
        </p>
        <Field label="Paid from" optional help="For what to withdraw into it. Entries count whichever wallet paid them." htmlFor="alloc-wallet">
          <Select id="alloc-wallet" value={wallet || NOT_SAID} onChange={(v) => setWallet(v === NOT_SAID ? "" : v)} options={[NOT_SAID, ...accounts]} ariaLabel="Paid from" />
        </Field>
        {error && (
          <p className="t-caption fms-note-over" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
