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
  daysWords,
  fromFor,
  inputOfLine,
  lineName,
  linesIn,
  monthAfter,
  monthBefore,
  monthWords,
  paceWords,
  removedIn,
  scheduled,
  scheduledDates,
  spanWords,
  walletNeeds,
  WEEK_ORDER,
  type AllocationChange,
  type AllocationInput,
  type AllocationLine,
  type AllocationStatus,
  type MonthAllocations,
} from "../domain/monthAllocation";
import { WEEKDAY_NAMES } from "../domain/dates";
import type { IsoDate, ReferenceLists } from "../domain/types";
import { useMediaQuery } from "./useMediaQuery";

export function AllocationsCard({
  month,
  lines,
  reference,
  spendingBudget,
  balanceOf,
  asOf,
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
  /** Today: a weekday line made now counts from it. */
  asOf: IsoDate;
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
    // A repeating line removed in a later month stops from this month: the months before keep it (A12).
    const stops = Boolean(s.line.repeat && s.line.month < ym);
    const kept = "It is kept under Removed here and in the Bin, to put back. Entries are not changed.";
    const ok = await confirm({
      title: stops ? `Stop the ${s.name} allocation from ${name}?` : `Remove the ${s.name} allocation?`,
      body: [
        month.phase === "running" ? `It stops holding ${formatMoney(s.held)} now, so safe to spend rises by that.` : "",
        stops ? `${monthWords(s.line.month)} to ${monthWords(monthBefore(ym))} keep it, with what was spent.` : "",
        kept,
        month.phase === "running" && !stops ? "To keep it on the list with what was spent and only free what is left, press Done instead." : "",
      ]
        .filter(Boolean)
        .join(" "),
      confirmLabel: stops ? "Stop it" : "Remove",
      tone: "danger",
    });
    if (ok) run({ kind: "remove", id: s.line.id, month: ym });
  };

  const done = async (s: AllocationStatus): Promise<void> => {
    const ok = await confirm({
      title: `Done with ${s.name} for ${name}?`,
      body: `It stops holding the ${formatMoney(Math.max(0, s.left))} it has left, so safe to spend rises by that today. What was spent stays counted against it, and ${s.line.kind} spent after today is ordinary spending.${s.line.repeat ? ` Next month it holds again as usual.` : ""} Hold it again undoes this.`,
      confirmLabel: "Done for the month",
    });
    if (ok) run({ kind: "done", id: s.line.id, month: ym });
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
              <AllocationRow
                key={s.line.id}
                status={s}
                phase={month.phase}
                ym={ym}
                onEdit={() => setEditing(s.line)}
                onRemove={() => void remove(s)}
                onDone={() => void done(s)}
                onHold={() => run({ kind: "undone", id: s.line.id, month: ym })}
              />
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
                    {l.removedOn ? `, removed ${formatMedium(l.removedOn)}` : l.stoppedFrom ? `, stopped from ${monthWords(l.stoppedFrom)}` : ""}
                  </span>
                  <button type="button" className="t-caption fms-linkbtn" onClick={() => run({ kind: "restore", id: l.id, month: ym })} aria-label={`Put back the ${lineName(l)} allocation`}>
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
          asOf={asOf}
          line={editing === "new" ? null : editing}
          reference={reference}
          onClose={() => setEditing(null)}
          onSave={(input) => {
            const why = onChange(editing === "new" ? { kind: "add", month: ym, input } : { kind: "edit", id: editing.id, input, month: ym });
            if (!why) setRefused("");
            return why;
          }}
        />
      )}
      {dialog}
    </Card>
  );
}

function AllocationRow({
  status: s,
  phase,
  ym,
  onEdit,
  onRemove,
  onDone,
  onHold,
}: {
  status: AllocationStatus;
  phase: MonthAllocations["phase"];
  ym: string;
  onEdit: () => void;
  onRemove: () => void;
  onDone: () => void;
  onHold: () => void;
}) {
  const pace = paceWords(s.line);
  const what = [
    s.line.name.trim() && s.line.name.trim() !== s.line.kind ? `${s.line.kind}${s.line.words ? `, entries that say ${s.line.words}` : ""}` : s.line.words ? `Entries that say ${s.line.words}` : "",
    pace,
    s.line.repeat ? spanWords(s.line) : "",
    s.line.wallet ? `from ${s.line.wallet}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
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
      {s.days && (
        <span className={s.days.today && s.days.today.left < 0 ? "t-caption fms-note-over" : "t-caption"} style={s.days.today && s.days.today.left < 0 ? undefined : { color: "var(--ink-2)" }}>
          {s.days.today
            ? `Today, ${daysWords(s.line.days ?? [])}: ${formatMoney(s.days.today.spent)} of ${formatMoney(s.days.today.share)}${s.days.today.left < 0 ? `, ${formatMoney(-s.days.today.left)} past it` : `, ${formatMoney(s.days.today.left)} left today`}`
            : s.days.next
              ? `Next: ${formatMedium(s.days.next)}, ${s.days.toCome} ${s.days.toCome === 1 ? "day" : "days"} to come`
              : `No ${daysWords(s.line.days ?? [])} left in ${monthWords(ym)}`}
          {s.line.from && s.line.month === ym ? `. Counts from ${formatMedium(s.line.from)}, the day it was made.` : ""}
        </span>
      )}
      {s.done && (
        <span className="t-caption" style={{ color: "var(--ink-2)" }}>
          Done on {formatMedium(s.done)}{s.left > 0 ? `: the ${formatMoney(s.left)} it had left is free, in safe to spend.` : "."}
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
          {s.timesUsed !== null && s.line.times ? `, ${s.timesUsed} of ${s.line.times} ${s.line.per === "day" ? "days" : "times"}` : ""}
        </span>
        {/* Quiet links, as "Set a limit" is on the card below it: one family on Budget, on the phone and the computer. */}
        <span className="fms-alloc-acts">
          {phase === "running" &&
            (s.done ? (
              <button type="button" className="t-caption fms-linkbtn" onClick={onHold} aria-label={`Hold the ${s.name} allocation again for ${monthWords(ym)}`}>
                Hold it again
              </button>
            ) : (
              s.left > 0 && (
                <button type="button" className="t-caption fms-linkbtn" onClick={onDone} aria-label={`Done with the ${s.name} allocation for ${monthWords(ym)}: free what it has left`}>
                  Done
                </button>
              )
            ))}
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

type Shape = "month" | "week" | "time" | "day";
type Span = "once" | "every" | "until";

/** The months a repeating line can end with: the next twelve after it starts. */
function monthsAfter(ym: string, count: number): string[] {
  const out: string[] = [];
  for (let m = monthAfter(ym), i = 0; i < count; i += 1, m = monthAfter(m)) out.push(m);
  return out;
}

function AllocationSheet({
  ym,
  asOf,
  line,
  reference,
  onClose,
  onSave,
}: {
  ym: string;
  asOf: IsoDate;
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
  const [times, setTimes] = useState(String(start?.per === "day" ? 4 : (start?.times ?? (start?.per === "time" ? 8 : 4))));
  const [days, setDays] = useState<readonly number[]>(start?.days ?? []);
  const [span, setSpan] = useState<Span>(start?.repeat ? (start.until ? "until" : "every") : "once");
  const ends = useMemo(() => monthsAfter(ym, 12), [ym]);
  const [until, setUntil] = useState(start?.until ?? ends[2] ?? ends[0] ?? ym);
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
    ...(shape === "month" ? {} : shape === "day" ? { each, per: "day" as const, days } : { each, times: Number.isInteger(count) ? count : null, per: shape }),
    ...(span === "once" ? {} : { repeat: true, ...(span === "until" ? { until } : {}) }),
    wallet,
  };
  /*
   * A weekday line counts from the day it is made, in the month that is
   * running; edited, from where it counted before. The same rule the save
   * uses (`fromFor`), so the figure here is the figure saved.
   */
  const from = shape === "day" ? (line ? (line.per === "day" && line.month === ym ? line.from : undefined) : fromFor(input, ym, asOf)) : undefined;
  const said = scheduled(input, ym, from);
  const total = amountOf(said);
  const dates = shape === "day" ? scheduledDates(ym, days, from) : [];

  const toggleDay = (d: number): void => setDays((now) => (now.includes(d) ? now.filter((x) => x !== d) : [...now, d]));

  const save = (): void => {
    const why = onSave(input);
    if (why) setError(why);
    else onClose();
  };

  const repeatingFromBefore = Boolean(line?.repeat && line.month < ym);

  return (
    <Sheet
      title={line ? `Edit the ${lineName(line)} allocation` : `Allocate for ${monthWords(ym)}`}
      subtitle={
        repeatingFromBefore
          ? `It repeats from ${monthWords(line!.month)}. A change here applies from ${monthWords(ym)} on; the months before keep what they had.`
          : "Set aside for one kind of spending. Every entry of that kind this month counts against it by itself."
      }
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
              { id: "day", label: "Set days" },
            ]}
            value={shape}
            onChange={(next) => {
              setShape(next);
              if (next === "time" && times === "4") setTimes("8");
              if (next === "week" && times === "8") setTimes("4");
            }}
          />
        </Field>
        {shape === "day" && (
          <Field label="On these days" required help="Only these days of the week: the gym on Tuesday and Thursday. The amount is worked out from how many of them the month has.">
            <div className="fms-pills" role="group" aria-label="Days of the week">
              {WEEK_ORDER.map((d) => (
                <button key={d} type="button" aria-pressed={days.includes(d)} className={days.includes(d) ? "t-caption fms-pill fms-pill--on" : "t-caption fms-pill"} onClick={() => toggleDay(d)} aria-label={WEEKDAY_NAMES[d]}>
                  {WEEKDAY_NAMES[d]!.slice(0, 3)}
                </button>
              ))}
            </div>
          </Field>
        )}
        {shape === "month" ? (
          <Field label={`Amount for ${monthWords(ym)}`} required htmlFor="alloc-amount">
            <AmountInput id="alloc-amount" value={amount} onChange={setAmount} ariaLabel="Amount for the month" />
          </Field>
        ) : shape === "day" ? (
          <Field label="Each day" required htmlFor="alloc-each">
            <AmountInput id="alloc-each" value={each} onChange={setEach} ariaLabel="Amount each day" />
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
          {shape === "day" && days.length === 0
            ? "Pick the days of the week."
            : shape === "day" && dates.length === 0
              ? `None of those days is left in ${monthWords(ym)}.`
              : total !== null
                ? `${formatMoney(total)} for ${monthWords(ym)}.${
                    shape === "day"
                      ? ` ${dates.length} ${dates.length === 1 ? "day" : "days"}, ${daysWords(days)}${from ? ` from ${formatMedium(from)}` : ""}: ${dates.map((d) => Number(d.slice(8, 10))).join(", ")}.`
                      : ""
                  }`
                : shape === "day"
                  ? `${dates.length} ${dates.length === 1 ? "day" : "days"} in ${monthWords(ym)}${from ? ` from ${formatMedium(from)}` : ""}. Say how much each day.`
                  : "Say how much."}
        </p>
        <Field label="How long" help={span === "once" ? `For ${monthWords(ym)} only. Next month starts with none, unless you copy it.` : span === "every" ? "Every month from this one, until you stop it. Each month counts on its own: what one leaves unused is free money in the next." : `Every month from this one to the month picked, then it stops by itself.`}>
          <SegmentedControl
            label="How long"
            options={[
              { id: "once", label: "This month only" },
              { id: "every", label: "Every month" },
              { id: "until", label: "Until a month" },
            ]}
            value={span}
            onChange={setSpan}
          />
        </Field>
        {span === "until" && (
          <Field label="Last month" htmlFor="alloc-until">
            <Select id="alloc-until" value={monthWords(until)} onChange={(v) => setUntil(ends.find((m) => monthWords(m) === v) ?? until)} options={ends.map(monthWords)} ariaLabel="Last month" />
          </Field>
        )}
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
