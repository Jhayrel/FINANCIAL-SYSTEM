/**
 * The Planner: what the owner means to spend later, and what became of it.
 *
 * The owner, 26 October 2026: "add a feature for plan spending like spending
 * planner ... I am planning to pay my tuition next month ... can direct pay
 * like I can click already paid ... make sure user friendly and easy to use
 * interactive and adaptable align to branding in phone and pc". The rules are
 * docs/16-PLANNER.md; the arithmetic is `domain/planner.ts`.
 *
 * One list, by month, overdue first. A plan opens in a sheet (a dialog on a
 * computer) with everything about it and every thing to do with it: record
 * the payment, link one already added, move the date, edit, skip, remove.
 * Nothing here moves money except Record payment, which saves an ordinary
 * entry through the same checks as the Add form.
 */
import { useMemo, useState } from "react";

import { Icon } from "../components/Icon";
import { AmountInput, Field, Switch, TextInput } from "../components/forms";
import { Alert, Button, Card, EmptyState, Money, ProgressBar, SegmentedControl, Tabs } from "../components/primitives";
import { Select } from "../components/Select";
import { Sheet } from "../components/Sheet";
import type { Account } from "../domain/accounts";
import { walletBalance } from "../domain/balances";
import { addDays, formatMedium, lastOfMonth } from "../domain/dates";
import { emptyDraft, type Draft } from "../domain/entry";
import { formatMoney, type Centavos } from "../domain/money";
import { monthBrief } from "../domain/monthPlan";
import {
  checkPlan,
  closedViews,
  coverage,
  editPlan,
  groupOpen,
  isRecurringKind,
  kindFromHistory,
  likelyPayments,
  linkPayments,
  makePlan,
  movePlan,
  movesWords,
  planAgain,
  removePlan,
  reopenPlan,
  skipPlan,
  unlinkPayment,
  viewOf,
  walletToPayFrom,
  type Plan,
  type PlanInput,
  type PlanView,
} from "../domain/planner";
import type { Debt } from "../domain/debt";
import type { Budgets, IsoDate, ReferenceLists, Transaction } from "../domain/types";
import { useMediaQuery } from "./useMediaQuery";

type PlanAction = "plan.create" | "plan.update" | "plan.move" | "plan.paid" | "plan.skip" | "plan.remove" | "plan.restore";

export interface PlannerProps {
  readonly plans: readonly Plan[];
  readonly transactions: readonly Transaction[];
  readonly reference: ReferenceLists;
  readonly accounts: readonly Account[];
  readonly budgets: Budgets;
  readonly debts: readonly Debt[];
  readonly asOf: IsoDate;
  /** Save a plan, new or changed, with a line for the activity trail. */
  readonly onChange: (plan: Plan, action: PlanAction, summary: string) => void;
  /** Save a payment as an entry and link it. Returns what stopped it, or null when saved. */
  readonly onPay: (plan: Plan, draft: Draft, settles: boolean) => string | null;
  /** A goal for a plan, made in Settings' accounts. Returns its id. */
  readonly onMakeGoal: (name: string, target: Centavos, deadline: IsoDate) => string;
  /** Open an entry in the Database. */
  readonly onShowEntry?: ((recordNumber: number) => void) | undefined;
}

type Tab = "open" | "done" | "removed";

const STATE_WORD: Record<PlanView["state"], string> = {
  later: "Planned",
  soon: "Soon",
  today: "Due today",
  overdue: "Overdue",
  partly: "Part paid",
  paid: "Paid",
  skipped: "Skipped",
  removed: "Removed",
};

const STATE_TONE: Record<PlanView["state"], "ok" | "warn" | "over" | "none" | "info"> = {
  later: "none",
  soon: "info",
  today: "warn",
  overdue: "over",
  partly: "info",
  paid: "ok",
  skipped: "none",
  removed: "none",
};

const no = (n: number): string => `#${String(n).padStart(4, "0")}`;

export function Planner(props: PlannerProps) {
  const { plans, transactions, reference, accounts, asOf } = props;
  const phone = useMediaQuery("(max-width: 639px)");
  const [tab, setTab] = useState<Tab>("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ editing: Plan | null } | null>(null);
  const [paying, setPaying] = useState<Plan | null>(null);
  const [moving, setMoving] = useState<Plan | null>(null);
  const [linking, setLinking] = useState<Plan | null>(null);
  const [closing, setClosing] = useState<{ plan: Plan; how: "skip" | "remove" } | null>(null);

  const views = useMemo(() => plans.map((p) => viewOf(p, { transactions, accounts, asOf })), [plans, transactions, accounts, asOf]);
  const groups = useMemo(() => groupOpen(views, asOf), [views, asOf]);
  const closed = useMemo(() => closedViews(views), [views]);

  // What the wallets hold after the bills and debt payments, before any plan: what the plans this month are set against (P4.4).
  const brief = useMemo(
    () => monthBrief({ transactions, reference, budgets: props.budgets, debts: props.debts, year: Number(asOf.slice(0, 4)), month: Number(asOf.slice(5, 7)), asOf }),
    [transactions, reference, props.budgets, props.debts, asOf],
  );
  const freeBeforePlans = brief.safe ? brief.safe.free + brief.safe.reservedPlans : null;
  const short = useMemo(() => (freeBeforePlans === null ? new Map<string, Centavos>() : coverage(views, freeBeforePlans)), [views, freeBeforePlans]);

  const openCount = groups.reduce((n, g) => n + g.views.length, 0);
  const overdue = groups.find((g) => g.key === "0-overdue");
  const thisMonth = groups.find((g) => g.key.startsWith("1-"));
  const setAside = brief.safe?.reservedPlans ?? 0;
  const current = openId ? views.find((v) => v.plan.id === openId) ?? null : null;

  const addButton = (
    <Button variant="primary" iconLeft={<Icon name="add" size={16} />} onClick={() => setForm({ editing: null })}>
      Plan something
    </Button>
  );

  return (
    <div className="fms-planner">
      <Card page title="Planner" subtitle="What you mean to pay later, and whether the money is there." action={addButton}>
        {/* A phone has no card heading, so the button sits at the top of the list. */}
        <div className="fms-planner-top">
          {phone && addButton}
          {openCount + closed.done.length + closed.removed.length > 0 && (
            <dl className="fms-planner-sum">
              <div>
                <dt className="t-micro">This month</dt>
                <dd className="t-num-l">
                  <Money value={thisMonth?.left ?? 0} />
                </dd>
              </div>
              <div>
                <dt className="t-micro">Set aside from safe to spend</dt>
                <dd className="t-num-l">
                  <Money value={setAside} />
                </dd>
              </div>
              <div>
                <dt className="t-micro">Overdue</dt>
                <dd className="t-num-l" style={{ color: overdue ? "var(--over)" : undefined }}>
                  {overdue ? overdue.views.length : 0}
                </dd>
              </div>
              <div>
                <dt className="t-micro">Open plans</dt>
                <dd className="t-num-l">{openCount}</dd>
              </div>
            </dl>
          )}
        </div>

        <Tabs
          tabs={[
            { id: "open" as const, label: "Coming up", count: openCount },
            { id: "done" as const, label: "Done", count: closed.done.length },
            { id: "removed" as const, label: "Removed", count: closed.removed.length },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "open" &&
          (openCount === 0 ? (
            <EmptyState
              message="Nothing planned. Plan something you mean to pay later, like tuition next month or a phone next year, and it shows here with its date and whether the money is there."
              action={addButton}
            />
          ) : (
            <div className="fms-planlist">
              {groups.map((g) => (
                <section key={g.key} aria-label={g.title}>
                  <h3 className="t-label fms-plangroup">
                    <span>{g.title}</span>
                    <span className="t-num-s">
                      <Money value={g.left} size="s" />
                    </span>
                  </h3>
                  <ul className="fms-planrows">
                    {g.views.map((v) => (
                      <PlanRow key={v.plan.id} view={v} short={short.get(v.plan.id) ?? 0} onOpen={() => setOpenId(v.plan.id)} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ))}

        {tab !== "open" &&
          ((tab === "done" ? closed.done : closed.removed).length === 0 ? (
            <EmptyState message={tab === "done" ? "Nothing paid or skipped yet. A plan comes here when it is paid or you skip it." : "Nothing removed. A plan you take off the list comes here, and can be put back."} />
          ) : (
            <ul className="fms-planrows fms-planlist">
              {(tab === "done" ? closed.done : closed.removed).map((v) => (
                <PlanRow key={v.plan.id} view={v} short={0} onOpen={() => setOpenId(v.plan.id)} />
              ))}
            </ul>
          ))}
      </Card>

      {current && !form && !paying && !moving && !linking && !closing && (
        <PlanSheet
          view={current}
          short={short.get(current.plan.id) ?? 0}
          dialog={!phone}
          transactions={transactions}
          plans={plans}
          onClose={() => setOpenId(null)}
          onEdit={() => setForm({ editing: current.plan })}
          onPay={() => setPaying(current.plan)}
          onMove={() => setMoving(current.plan)}
          onLink={() => setLinking(current.plan)}
          onSkip={() => setClosing({ plan: current.plan, how: "skip" })}
          onRemove={() => setClosing({ plan: current.plan, how: "remove" })}
          onReopen={() => props.onChange(reopenPlan(current.plan), "plan.restore", `Put "${current.plan.title}" back on the plan list.`)}
          onAgain={() => {
            const next = planAgain(current.plan, addDays(asOf, 30) > current.plan.due ? addDays(asOf, 30) : addDays(current.plan.due, 30), asOf, "owner");
            props.onChange(next, "plan.create", `Planned "${next.title}" again, ${formatMoney(next.amount)} by ${formatMedium(next.due)}.`);
            setOpenId(next.id);
            setForm({ editing: next });
          }}
          onUnlink={(id) => props.onChange(unlinkPayment(current.plan, id, transactions), "plan.update", `Unlinked a payment from "${current.plan.title}".`)}
          onLinkOne={(id) => props.onChange(linkPayments(current.plan, [id], transactions, asOf), "plan.paid", `Linked a payment to "${current.plan.title}".`)}
          onShowEntry={props.onShowEntry}
        />
      )}

      {form && (
        <PlanForm
          editing={form.editing}
          plans={plans}
          transactions={transactions}
          reference={reference}
          accounts={accounts}
          asOf={asOf}
          dialog={!phone}
          onClose={() => setForm(null)}
          onMakeGoal={props.onMakeGoal}
          onSave={(input) => {
            if (form.editing && plans.some((p) => p.id === form.editing?.id)) {
              const was = form.editing;
              const next = editPlan(was, input, asOf);
              const changed: string[] = [];
              if (was.amount !== next.amount) changed.push(`amount ${formatMoney(was.amount)} to ${formatMoney(next.amount)}`);
              if (was.due !== next.due) changed.push(`date ${formatMedium(was.due)} to ${formatMedium(next.due)}`);
              if (was.title !== next.title) changed.push(`name to "${next.title}"`);
              props.onChange(next, was.due !== next.due && changed.length === 1 ? "plan.move" : "plan.update", `Edited "${next.title}"${changed.length > 0 ? `: ${changed.join(", ")}` : ""}.`);
              setOpenId(next.id);
            } else {
              const next = makePlan(input, asOf, "owner");
              props.onChange(next, "plan.create", `Planned "${next.title}", ${formatMoney(next.amount)} by ${formatMedium(next.due)}.`);
              setOpenId(next.id);
            }
            setForm(null);
          }}
        />
      )}

      {paying && (
        <PaySheet
          plan={paying}
          view={views.find((v) => v.plan.id === paying.id) ?? viewOf(paying, { transactions, accounts, asOf })}
          reference={reference}
          accounts={accounts}
          transactions={transactions}
          asOf={asOf}
          dialog={!phone}
          onClose={() => setPaying(null)}
          onPay={(draft, settles) => {
            const stopped = props.onPay(paying, draft, settles);
            if (!stopped) setPaying(null);
            return stopped;
          }}
        />
      )}

      {moving && (
        <MoveSheet
          plan={moving}
          asOf={asOf}
          dialog={!phone}
          onClose={() => setMoving(null)}
          onMove={(to) => {
            props.onChange(movePlan(moving, to, asOf), "plan.move", `Moved "${moving.title}" from ${formatMedium(moving.due)} to ${formatMedium(to)}.`);
            setMoving(null);
          }}
        />
      )}

      {linking && (
        <LinkSheet
          plan={linking}
          plans={plans}
          transactions={transactions}
          dialog={!phone}
          onClose={() => setLinking(null)}
          onLink={(ids, settles) => {
            props.onChange(linkPayments(linking, ids, transactions, asOf, settles), "plan.paid", `Linked ${ids.map((id) => no(transactions.find((t) => t.id === id)?.recordNumber ?? 0)).join(", ")} to "${linking.title}" as its payment.`);
            setLinking(null);
          }}
        />
      )}

      {closing && (
        <CloseSheet
          plan={closing.plan}
          how={closing.how}
          dialog={!phone}
          onClose={() => setClosing(null)}
          onDone={(reason) => {
            const p = closing.plan;
            if (closing.how === "skip") props.onChange(skipPlan(p, asOf, reason), "plan.skip", `Skipped "${p.title}"${reason ? `: ${reason}` : ""}.`);
            else props.onChange(removePlan(p, asOf, reason), "plan.remove", `Removed "${p.title}" from the plan list${reason ? `: ${reason}` : ""}. It can be put back.`);
            setClosing(null);
            setOpenId(null);
          }}
        />
      )}
    </div>
  );
}

function PlanRow({ view: v, short, onOpen }: { view: PlanView; short: Centavos; onOpen: () => void }) {
  const p = v.plan;
  const meta = [p.item, p.wallet && `from ${p.wallet}`, formatMedium(p.due)].filter(Boolean).join(" · ");
  return (
    <li>
      <button type="button" className="fms-planrow" onClick={onOpen}>
        <span className="fms-planrow-main">
          <span className="t-body-strong fms-planrow-title">{p.title}</span>
          <span className="t-caption fms-planrow-meta">{meta}</span>
          <span className="t-caption fms-planrow-words" style={{ color: v.state === "overdue" || short > 0 ? "var(--over)" : "var(--ink-2)" }}>
            {v.words}
            {short > 0 ? `. ${formatMoney(short)} short` : ""}
            {v.goal && !v.goal.missing ? ` · ${v.goal.name} holds ${formatMoney(v.goal.holds)}` : ""}
          </span>
        </span>
        <span className="fms-planrow-side">
          <Money value={v.state === "paid" ? v.paid || p.amount : v.left || p.amount} />
          <span className="t-micro fms-badge" style={{ background: `var(--${STATE_TONE[v.state]}-bg)`, color: `var(--${STATE_TONE[v.state]})` }}>
            {STATE_WORD[v.state]}
          </span>
        </span>
      </button>
    </li>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fms-pdetail fms-pdetail--wide">
      <dt className="t-micro">{label}</dt>
      <dd className="t-caption">{children}</dd>
    </div>
  );
}

function PlanSheet(props: {
  view: PlanView;
  short: Centavos;
  dialog: boolean;
  transactions: readonly Transaction[];
  plans: readonly Plan[];
  onClose: () => void;
  onEdit: () => void;
  onPay: () => void;
  onMove: () => void;
  onLink: () => void;
  onSkip: () => void;
  onRemove: () => void;
  onReopen: () => void;
  onAgain: () => void;
  onUnlink: (id: string) => void;
  onLinkOne: (id: string) => void;
  onShowEntry?: ((recordNumber: number) => void) | undefined;
}) {
  const { view: v, transactions } = props;
  const p = v.plan;
  const open = v.state !== "paid" && v.state !== "skipped" && v.state !== "removed";
  const paidRows = p.entryIds.map((id) => transactions.find((t) => t.id === id)).filter((t): t is Transaction => t !== undefined);
  // A payment added by hand that looks like this one (P4.9): asked, never linked by itself.
  const maybe = open ? likelyPayments(p, transactions, props.plans).slice(0, 2) : [];

  const actions = open ? (
    <>
      <Button onClick={props.onEdit}>Edit</Button>
      <Button onClick={props.onMove}>Move the date</Button>
      <Button variant="primary" onClick={props.onPay}>
        {v.paid > 0 ? "Record another payment" : "Record payment"}
      </Button>
    </>
  ) : v.state === "removed" ? (
    <Button variant="primary" onClick={props.onReopen}>
      Put it back
    </Button>
  ) : (
    <>
      <Button onClick={props.onReopen}>{v.state === "skipped" ? "Put it back" : "Open it again"}</Button>
      <Button variant="primary" onClick={props.onAgain}>
        Plan it again
      </Button>
    </>
  );

  return (
    <Sheet title={p.title} subtitle={v.words} onClose={props.onClose} actions={actions} dialog={props.dialog}>
      <div className="fms-plansheet">
        <div className="fms-plansheet-figure">
          <Money value={open ? v.left : v.paid || p.amount} size="l" />
          <span className="t-caption" style={{ color: "var(--ink-3)" }}>
            {open ? (v.paid > 0 ? `left of ${formatMoney(p.amount)}` : "planned") : v.state === "paid" ? "paid" : `was planned`}
          </span>
        </div>
        {v.paid > 0 && open && <ProgressBar value={v.paid} max={p.amount} label="paid so far" />}

        {props.short > 0 && (
          <Alert status="over" title={`${formatMoney(props.short)} short for it`}>
            After the bills and debt payments still due and the plans before it, the spending wallets do not cover all of it. Pay part now, move the date, or pay it from savings.
          </Alert>
        )}
        {v.goneNote && <Alert status="warn" title="A payment is gone">{v.goneNote}</Alert>}

        <dl className="fms-pdetails">
          <Detail label="Pay by">{formatMedium(p.due)}</Detail>
          {p.item && <Detail label="Kind">{p.item}</Detail>}
          {p.wallet && <Detail label="From">{p.wallet}</Detail>}
          <Detail label="Need">{p.need ? "A need" : "A want"}</Detail>
          <Detail label="Safe to spend">{p.goalId ? "Not counted: saved in a goal" : p.setAside ? (v.counts ? "Set aside this month" : "Counted in its month") : "Not counted"}</Detail>
          {v.goal && (
            <Detail label="Goal">
              {v.goal.missing
                ? "Its goal is no longer in Settings"
                : `${v.goal.name} holds ${formatMoney(v.goal.holds)}${v.goal.perMonth > 0 ? `, ${formatMoney(v.goal.perMonth)} a month to have it by then` : v.goal.holds >= v.left && open ? ", enough for it" : ""}`}
            </Detail>
          )}
          {v.perMonth > 0 && <Detail label="To save">{`${formatMoney(v.perMonth)} a month to have it by then`}</Detail>}
          {p.moves.length > 0 && <Detail label="Moved">{movesWords(p)}</Detail>}
          {p.notes && <Detail label="Notes">{p.notes}</Detail>}
          <Detail label="Planned">{`${formatMedium(p.createdOn)}${p.createdBy === "ai" ? ", from the chat" : ""}`}</Detail>
        </dl>

        {paidRows.length > 0 && (
          <div className="fms-plansheet-part">
            <h4 className="t-label">Payments</h4>
            <ul className="fms-planpays">
              {paidRows.map((t) => (
                <li key={t.id}>
                  <button type="button" className="fms-linkbutton t-caption" onClick={() => props.onShowEntry?.(t.recordNumber)}>
                    {no(t.recordNumber)} · {formatMedium(t.date)} · {t.fromWallet || "no wallet"}
                  </button>
                  <Money value={t.total} size="s" />
                  {open && (
                    <Button size="sm" variant="ghost" onClick={() => props.onUnlink(t.id)}>
                      Unlink
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {maybe.length > 0 && (
          <div className="fms-plansheet-part">
            <h4 className="t-label">Already paid it?</h4>
            {maybe.map((t) => (
              <div key={t.id} className="fms-planmaybe">
                <span className="t-caption">
                  {no(t.recordNumber)} · {t.item}
                  {t.description && t.description !== t.item ? ` (${t.description.slice(0, 40)})` : ""} · {formatMedium(t.date)}
                </span>
                <Money value={t.total} size="s" />
                <Button size="sm" onClick={() => props.onLinkOne(t.id)}>
                  This is it
                </Button>
              </div>
            ))}
          </div>
        )}

        {open && (
          <div className="fms-plansheet-more">
            <Button size="sm" variant="ghost" onClick={props.onLink}>
              Link one I already added
            </Button>
            <Button size="sm" variant="ghost" onClick={props.onSkip}>
              Skip it
            </Button>
            <Button size="sm" variant="ghost" tone="danger" onClick={props.onRemove}>
              Remove
            </Button>
          </div>
        )}
        {v.state !== "removed" && !open && (
          <div className="fms-plansheet-more">
            <Button size="sm" variant="ghost" tone="danger" onClick={props.onRemove}>
              Remove
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

const NO_GOAL = "Not saved in a goal";
const NEW_GOAL = "Make a goal for it";
const NO_KIND = "Not said";
const NO_WALLET = "Not decided";

function PlanForm(props: {
  editing: Plan | null;
  plans: readonly Plan[];
  transactions: readonly Transaction[];
  reference: ReferenceLists;
  accounts: readonly Account[];
  asOf: IsoDate;
  dialog: boolean;
  onClose: () => void;
  onSave: (input: PlanInput) => void;
  onMakeGoal: (name: string, target: Centavos, deadline: IsoDate) => string;
}) {
  const { editing, reference, accounts, asOf } = props;
  const goals = accounts.filter((a) => a.kind === "goal" && !a.archived);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [amount, setAmount] = useState<Centavos | null>(editing ? editing.amount : null);
  const [due, setDue] = useState<IsoDate>(editing?.due ?? lastOfMonth(Number(asOf.slice(0, 4)) + (Number(asOf.slice(5, 7)) === 12 ? 1 : 0), (Number(asOf.slice(5, 7)) % 12) + 1));
  const [item, setItem] = useState(editing?.item ?? "");
  const [wallet, setWallet] = useState(editing?.wallet ?? "");
  const [goalId, setGoalId] = useState(editing?.goalId ?? "");
  const [need, setNeed] = useState(editing?.need ?? true);
  const [setAside, setSetAside] = useState(editing ? editing.setAside : true);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [tried, setTried] = useState(false);

  const kinds = [...new Set([...reference.spendingTypes.map((s) => s.name), ...reference.bills, ...reference.subscriptions])];
  // What the name usually is, from the entries ("Tuition" is School), until a kind is picked.
  const [picked, setPicked] = useState(Boolean(editing?.item));
  const suggested = !picked && !item ? kindFromHistory(title, props.transactions, kinds) : null;
  const kind = item || suggested || "";
  const recurring = isRecurringKind(kind, reference);
  const input: PlanInput = { title, amount, due, item: kind, wallet, goalId: goalId || undefined, need, setAside: setAside && !goalId && !recurring, notes };
  const check = checkPlan({ ...input, setAside }, { plans: props.plans, reference, asOf, editing: editing?.id });
  const goalName = goals.find((g) => g.id === goalId)?.name ?? "";

  const save = (): void => {
    setTried(true);
    if (check.problems.length > 0) return;
    props.onSave(input);
  };

  return (
    <Sheet
      title={editing && props.plans.some((p) => p.id === editing.id) ? `Edit "${editing.title}"` : "Plan something"}
      subtitle="Nothing moves until it is paid."
      onClose={props.onClose}
      dialog={props.dialog}
      actions={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {editing && props.plans.some((p) => p.id === editing.id) ? "Save changes" : "Add to the planner"}
          </Button>
        </>
      }
    >
      <div className="fms-planform">
        <Field label="What is it for" htmlFor="plan-title" error={tried && !title.trim() ? "Say what it is for." : undefined}>
          <TextInput id="plan-title" value={title} onChange={setTitle} placeholder="Tuition, new phone, a trip" maxLength={80} />
        </Field>
        <div className="fms-planform-pair">
          <Field label="How much" htmlFor="plan-amount" error={tried && (amount === null || amount <= 0) ? "Put in how much it will cost." : undefined}>
            <AmountInput id="plan-amount" value={amount} onChange={setAmount} />
          </Field>
          <Field label="Pay by" htmlFor="plan-due">
            <input id="plan-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="t-body fms-control" />
          </Field>
        </div>
        <div className="fms-planform-pair">
          <Field label="Kind" help={suggested ? `${suggested}, as your entries about it are.` : "The same list as entries, so it is counted under it when paid."}>
            <Select
              value={kind || NO_KIND}
              onChange={(v) => {
                setPicked(true);
                setItem(v === NO_KIND ? "" : v);
              }}
              options={[NO_KIND, ...kinds]}
              ariaLabel="Kind of spending"
              searchable
            />
          </Field>
          <Field label="Pay from">
            <Select
              value={wallet || NO_WALLET}
              onChange={(v) => setWallet(v === NO_WALLET ? "" : v)}
              options={[NO_WALLET, ...reference.wallets, ...reference.savings]}
              ariaLabel="Pay from"
            />
          </Field>
        </div>
        <Field label="Need or want" help="When money is short, the wants give way first.">
          <SegmentedControl
            options={[
              { id: "need", label: "A need" },
              { id: "want", label: "A want" },
            ]}
            value={need ? "need" : "want"}
            onChange={(v) => setNeed(v === "need")}
          />
        </Field>
        <Field label="Saving for it" help={goalId ? `${goalName} is where its money is kept. Paying it comes out of the goal.` : "Link a goal from Settings, or make one for it."}>
          <Select
            value={goalName || NO_GOAL}
            onChange={(v) => {
              if (v === NEW_GOAL) {
                if (!title.trim() || amount === null || amount <= 0) {
                  setTried(true);
                  return;
                }
                const id = props.onMakeGoal(title.trim(), amount, due);
                setGoalId(id);
                setWallet(title.trim());
                return;
              }
              const g = goals.find((x) => x.name === v);
              setGoalId(g?.id ?? "");
              if (g) setWallet(g.name);
            }}
            options={[NO_GOAL, ...goals.map((g) => g.name), NEW_GOAL]}
            ariaLabel="Saving for it in a goal"
          />
        </Field>
        <div className="fms-planform-switch">
          <span className="fms-planform-switchtext">
            <span className="t-body">Count it in safe to spend</span>
            <span className="t-caption" style={{ color: "var(--ink-3)" }}>
              {goalId
                ? "Its money is in the goal already, so it is not counted."
                : recurring
                  ? "Bills and subscriptions are set aside already every month."
                  : "Set aside in its month like a bill still to pay, so today's figure stays honest."}
            </span>
          </span>
          <Switch checked={setAside && !goalId && !recurring} onChange={setSetAside} label="Count it in safe to spend" />
        </div>
        <Field label="Notes" optional>
          <TextInput value={notes} onChange={setNotes} maxLength={300} placeholder="Where, what for, anything to remember" />
        </Field>
        {check.notes.map((n) => (
          <Alert key={n} status="info">
            {n}
          </Alert>
        ))}
      </div>
    </Sheet>
  );
}

function PaySheet(props: {
  plan: Plan;
  view: PlanView;
  reference: ReferenceLists;
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  asOf: IsoDate;
  dialog: boolean;
  onClose: () => void;
  onPay: (draft: Draft, settles: boolean) => string | null;
}) {
  const { plan, view, reference, asOf, transactions } = props;
  const [date, setDate] = useState<IsoDate>(asOf);
  const [amount, setAmount] = useState<Centavos | null>(view.left > 0 ? view.left : plan.amount);
  const goal = plan.goalId ? props.accounts.find((a) => a.id === plan.goalId)?.name : undefined;
  const kinds = [...new Set([...reference.spendingTypes.map((s) => s.name), ...reference.bills, ...reference.subscriptions])];
  const [item, setItem] = useState(plan.item || (kindFromHistory(plan.title, transactions, kinds) ?? ""));
  // The goal it is saved in, else the plan's wallet, else the one this kind usually comes from or that holds enough.
  const [from, setFrom] = useState(goal ?? walletToPayFrom({ wallet: plan.wallet, item: plan.item || item }, view.left || plan.amount, transactions, reference.wallets));
  const [stopped, setStopped] = useState<string | null>(null);

  const category = reference.bills.some((b) => b === item) ? "Bills" : reference.subscriptions.some((b) => b === item) ? "Subscriptions" : "Spending";
  const draft: Draft = {
    ...emptyDraft(date),
    flow: "Spending",
    date,
    fromWallet: from,
    category,
    item,
    description: plan.title,
    amount,
    status: "Paid",
    notes: `Paid from the Planner: ${plan.title}.`,
  };
  const holds = from ? walletBalance(transactions, from) : null;
  const less = amount !== null && amount < view.left;
  const pay = (settles: boolean): void => setStopped(props.onPay(draft, settles));

  return (
    <Sheet
      title={`Pay "${plan.title}"`}
      subtitle="Saved as an entry, with the same checks as the Add form, and linked to the plan."
      onClose={props.onClose}
      dialog={props.dialog}
      actions={
        less ? (
          <>
            <Button onClick={() => pay(false)}>Save, more to pay later</Button>
            <Button variant="primary" onClick={() => pay(true)}>
              Save, that settles it
            </Button>
          </>
        ) : (
          <>
            <Button onClick={props.onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => pay(true)}>
              Save payment
            </Button>
          </>
        )
      }
    >
      <div className="fms-planform">
        <div className="fms-planform-pair">
          <Field label="Amount paid" htmlFor="pay-amount">
            <AmountInput id="pay-amount" value={amount} onChange={setAmount} />
          </Field>
          <Field label="Paid on" htmlFor="pay-date">
            <input id="pay-date" type="date" value={date} max={asOf} onChange={(e) => setDate(e.target.value)} className="t-body fms-control" />
          </Field>
        </div>
        <div className="fms-planform-pair">
          <Field label="Paid from" help={holds !== null ? `${from} holds ${formatMoney(holds)}.` : undefined}>
            <Select value={from || NO_WALLET} onChange={(v) => setFrom(v === NO_WALLET ? "" : v)} options={[NO_WALLET, ...reference.wallets, ...reference.savings]} ariaLabel="Paid from" />
          </Field>
          <Field label="Kind">
            <Select value={item || NO_KIND} onChange={(v) => setItem(v === NO_KIND ? "" : v)} options={[NO_KIND, ...kinds]} ariaLabel="Kind of spending" searchable />
          </Field>
        </div>
        {less && (
          <Alert status="info">
            {`${formatMoney(view.left - (amount ?? 0))} less than is left of it. "More to pay later" keeps it open as part paid; "that settles it" marks it paid for less.`}
          </Alert>
        )}
        {amount !== null && amount > view.left && view.left > 0 && <Alert status="info">{`${formatMoney(amount - view.left)} more than was planned. It is marked paid, and says so.`}</Alert>}
        {holds !== null && amount !== null && holds < amount && (
          <Alert status="warn" title={`${from} holds ${formatMoney(holds)}`}>
            Paying {formatMoney(amount)} from it takes it below zero. Pay from another wallet, pay part now, or move the date.
          </Alert>
        )}
        {stopped && (
          <Alert status="over" title="Not saved">
            {stopped}
          </Alert>
        )}
      </div>
    </Sheet>
  );
}

function MoveSheet(props: { plan: Plan; asOf: IsoDate; dialog: boolean; onClose: () => void; onMove: (to: IsoDate) => void }) {
  const { plan, asOf } = props;
  const base = plan.due > asOf ? plan.due : asOf;
  const [to, setTo] = useState<IsoDate>(addDays(base, 7));
  const quick: [string, IsoDate][] = [
    ["A week later", addDays(base, 7)],
    ["Two weeks later", addDays(base, 14)],
    ["A month later", addDays(base, 30)],
  ];
  return (
    <Sheet
      title={`Move "${plan.title}"`}
      subtitle={`Now by ${formatMedium(plan.due)}. Every move is kept.`}
      onClose={props.onClose}
      dialog={props.dialog}
      actions={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => props.onMove(to)} disabled={to === plan.due}>
            Move to {formatMedium(to)}
          </Button>
        </>
      }
    >
      <div className="fms-planform">
        <SegmentedControl options={quick.map(([label, d]) => ({ id: d, label }))} value={quick.find(([, d]) => d === to)?.[1] ?? ""} onChange={(d) => setTo(d)} />
        <Field label="Or a day" htmlFor="move-to">
          <input id="move-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="t-body fms-control" />
        </Field>
        {movesWords(plan) && <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>{movesWords(plan)}.</p>}
      </div>
    </Sheet>
  );
}

function LinkSheet(props: { plan: Plan; plans: readonly Plan[]; transactions: readonly Transaction[]; dialog: boolean; onClose: () => void; onLink: (ids: string[], settles: boolean) => void }) {
  const { plan, transactions } = props;
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const linked = new Set(props.plans.flatMap((p) => p.entryIds));
  const likely = likelyPayments(plan, transactions, props.plans);
  const found = query.trim()
    ? transactions
        .filter((t) => t.type === "Spending" && !linked.has(t.id))
        .filter((t) => {
          const q = query.trim().toLowerCase().replace(/^#/, "");
          return String(t.recordNumber) === q.replace(/^0+/, "") || `${t.item} ${t.description}`.toLowerCase().includes(q);
        })
        .slice(-8)
        .reverse()
    : likely;
  const toggle = (id: string): void => setPicked((was) => (was.includes(id) ? was.filter((x) => x !== id) : [...was, id]));
  const sum = picked.reduce((s, id) => s + (transactions.find((t) => t.id === id)?.total ?? 0), 0);
  return (
    <Sheet
      title={`Link a payment to "${plan.title}"`}
      subtitle="For a payment already in your entries, so it is not entered twice."
      onClose={props.onClose}
      dialog={props.dialog}
      actions={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          {sum > 0 && sum < plan.amount && (
            <Button onClick={() => props.onLink(picked, true)}>Link, that settles it</Button>
          )}
          <Button variant="primary" disabled={picked.length === 0} onClick={() => props.onLink(picked, false)}>
            Link {picked.length > 0 ? formatMoney(sum) : ""}
          </Button>
        </>
      }
    >
      <div className="fms-planform">
        <Field label="Find it" help={query.trim() ? undefined : likely.length > 0 ? "The likely ones, by kind, words and amount." : "Nothing looks like it yet. Search by its record number or words."}>
          <TextInput value={query} onChange={setQuery} placeholder="Entry number or words, like tuition" />
        </Field>
        <ul className="fms-planpick">
          {found.map((t) => (
            <li key={t.id}>
              <label className="fms-planpick-row">
                <input type="checkbox" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} />
                <span className="t-caption">
                  {no(t.recordNumber)} · {formatMedium(t.date)} · {t.item}
                  {t.description && t.description !== t.item ? ` (${t.description.slice(0, 40)})` : ""}
                </span>
                <Money value={t.total} size="s" />
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

function CloseSheet(props: { plan: Plan; how: "skip" | "remove"; dialog: boolean; onClose: () => void; onDone: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const skip = props.how === "skip";
  return (
    <Sheet
      title={skip ? `Skip "${props.plan.title}"?` : `Remove "${props.plan.title}"?`}
      subtitle={skip ? "It goes under Done as skipped, and can be put back or planned again." : "It goes under Removed and can be put back. Nothing is deleted."}
      onClose={props.onClose}
      dialog={props.dialog}
      actions={
        <>
          <Button onClick={props.onClose}>Keep it</Button>
          {skip ? (
            <Button variant="primary" onClick={() => props.onDone(reason)}>
              Skip it
            </Button>
          ) : (
            <Button variant="danger" onClick={() => props.onDone(reason)}>
              Remove it
            </Button>
          )}
        </>
      }
    >
      <Field label="Why" optional>
        <TextInput value={reason} onChange={setReason} maxLength={120} placeholder={skip ? "Changed my mind, found it cheaper" : "Added by mistake"} />
      </Field>
    </Sheet>
  );
}
