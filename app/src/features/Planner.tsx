/**
 * The Planner: what the owner means to spend later, and what became of it.
 *
 * The owner, 26 October 2026: "add a feature for plan spending like spending
 * planner ... I am planning to pay my tuition next month ... can direct pay
 * like I can click already paid ... make sure user friendly and easy to use
 * interactive and adaptable align to branding in phone and pc". The rules are
 * docs/16-PLANNER.md; the arithmetic is `domain/planner.ts`.
 *
 * Laid out as the Bin and Activity are (owner, the next day: "more cleaner ui
 * like the rest of the system"): one list card, by month, overdue first, and
 * from 1280px a side panel with what is due against what is safe to spend
 * and what is further ahead. Narrower, the same figures head the list. A row
 * is a button with its name, its day and its kind; a pill only when the
 * state needs one, and a short line with an icon when the money is short.
 * A plan opens in a sheet (a dialog on a computer) with its facts laid out as
 * a Database row's are, and every thing to do with it. Nothing here moves
 * money except Record payment, which saves an ordinary entry through the
 * same checks as the Add form.
 *
 * Class names are `fms-plans` and `fms-plan*`: `fms-planner` is the Budget
 * screen's panel, and sharing it squeezed that panel's figures.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { Icon, type IconName } from "../components/Icon";
import { AmountInput, Field, Switch, TextInput } from "../components/forms";
import { Alert, Button, Card, EmptyState, Money, ProgressBar, SegmentedControl, StatusPill, Tabs } from "../components/primitives";
import { Select } from "../components/Select";
import { Sheet } from "../components/Sheet";
import { useConfirm } from "../components/Confirm";
import type { Account } from "../domain/accounts";
import { walletBalance } from "../domain/balances";
import { addDays, formatMedium, lastOfMonth, MONTH_NAMES } from "../domain/dates";
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
  byWhen,
  countedWords,
  dueFor,
  dueKindOf,
  NO_DATE,
  nextMonthEnd,
  whenOf,
  type DueKind,
  planAgain,
  planKinds,
  plannedForBudget,
  planWallets,
  removePlan,
  reopenPlan,
  skipPlan,
  unlinkPayment,
  viewOf,
  walletToPayFrom,
  type Plan,
  type PlanGroup,
  type PlanInput,
  type PlanView,
} from "../domain/planner";
import type { Debt } from "../domain/debt";
import { limitLines, planLimitNote } from "../domain/limitAsk";
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
  /** A plan another screen sent here: opened, or opened to record its payment (the Dashboard's and Insights' Pay). */
  readonly focus?: { readonly id: string; readonly pay: boolean; readonly at: number } | null | undefined;
}

type Tab = "open" | "done" | "removed";

/** A pill only where the state needs saying: a plan that is simply later has none. */
const PILL: Record<PlanView["state"], { word: string; status: "ok" | "warn" | "over" | "none" | "info" } | null> = {
  later: null,
  soon: { word: "Due soon", status: "warn" },
  today: { word: "Due today", status: "warn" },
  overdue: { word: "Overdue", status: "over" },
  partly: { word: "Part paid", status: "info" },
  paid: { word: "Paid", status: "ok" },
  skipped: { word: "Skipped", status: "none" },
  removed: { word: "Removed", status: "none" },
};

const no = (n: number): string => `#${String(n).padStart(4, "0")}`;
const isOpen = (v: PlanView): boolean => v.state !== "paid" && v.state !== "skipped" && v.state !== "removed";
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "Oct 28", or "Mar 31, 2027" in another year. */
function dayWords(day: IsoDate, asOf: IsoDate): string {
  const short = `${MONTH_NAMES[Number(day.slice(5, 7)) - 1]?.slice(0, 3) ?? ""} ${Number(day.slice(8, 10))}`;
  return day.slice(0, 4) === asOf.slice(0, 4) ? short : `${short}, ${day.slice(0, 4)}`;
}

/** The row's when: "Oct 28, in 2 days", "Oct 22, 4 days late"; a closed plan says how it closed. */
function whenWords(v: PlanView, asOf: IsoDate): string {
  if (!isOpen(v)) return v.words;
  // A month, a year or no date says so, never a day nobody chose.
  if (v.plan.due === NO_DATE) return "No date yet";
  if (dueKindOf(v.plan) !== "day" && v.daysTo >= 0) return v.words.startsWith("Paid") ? whenOf(v.plan) : v.words;
  const day = dayWords(v.plan.due, asOf);
  if (v.daysTo < 0) return `${day}, ${plural(-v.daysTo, "day")} late`;
  if (v.daysTo === 0) return `${day}, today`;
  if (v.daysTo === 1) return `${day}, tomorrow`;
  return v.daysTo <= 60 ? `${day}, in ${v.daysTo} days` : day;
}

/** What the screen sums up: due by the month's end against what is safe to spend, and further ahead. */
interface Outlook {
  readonly monthEnd: IsoDate;
  readonly dueNow: Centavos;
  readonly counted: Centavos;
  readonly free: Centavos | null;
  readonly overdue: number;
  readonly open: number;
  readonly ahead: readonly PlanGroup[];
  readonly aheadTotal: Centavos;
  readonly perMonth: Centavos;
  readonly wants: Centavos;
}

function outlookOf(groups: readonly PlanGroup[], counted: Centavos, free: Centavos | null, asOf: IsoDate): Outlook {
  const now = groups.filter((g) => g.key === "0-overdue" || g.key.startsWith("1-"));
  const ahead = groups.filter((g) => !(g.key === "0-overdue" || g.key.startsWith("1-")));
  const all = groups.flatMap((g) => g.views);
  return {
    monthEnd: lastOfMonth(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7))),
    dueNow: now.reduce((s, g) => s + g.left, 0),
    counted,
    free,
    overdue: groups.find((g) => g.key === "0-overdue")?.views.length ?? 0,
    open: all.length,
    ahead,
    aheadTotal: ahead.reduce((s, g) => s + g.left, 0),
    perMonth: all.reduce((s, v) => s + v.perMonth + (v.goal && !v.goal.missing ? v.goal.perMonth : 0), 0),
    wants: all.filter((v) => !v.plan.need).reduce((s, v) => s + v.left, 0),
  };
}

/** One line on whether safe to spend covers what is set aside, with the icon as the only colour (style guide 3.7). */
function CoverLine({ o }: { o: Outlook }) {
  if (o.free === null || o.dueNow === 0) return null;
  const after = o.free - o.counted;
  const [status, words] =
    o.counted === 0
      ? (["info", "None of it is set aside from safe to spend."] as const)
      : after < 0
        ? (["over", `${formatMoney(-after)} short. Safe to spend holds ${formatMoney(Math.max(0, o.free))} after the bills.`] as const)
        : (["ok", `Safe to spend covers it, ${formatMoney(after)} left after it.`] as const);
  return (
    <p className="t-caption fms-plannote">
      <span className="fms-plannote-icon" style={{ color: `var(--${status})` }} aria-hidden>
        <Icon name={status === "over" ? "statusOver" : status === "ok" ? "statusOk" : "statusInfo"} size={16} />
      </span>
      <span>{words}</span>
    </p>
  );
}

/** Narrower than 1280px, the figures head the list. */
function OutlookHead({ o, asOf }: { o: Outlook; asOf: IsoDate }) {
  const extra = [plural(o.open, "open plan"), o.overdue > 0 ? `${o.overdue} overdue` : "", o.aheadTotal > 0 ? `${formatMoney(o.aheadTotal)} further ahead` : ""].filter(Boolean).join(" · ");
  return (
    <div className="fms-planshead">
      <span className="t-label fms-planshead-label">Due by {dayWords(o.monthEnd, asOf)}</span>
      <Money value={o.dueNow} size="l" />
      <CoverLine o={o} />
      <span className="t-caption fms-planshead-extra">{extra}</span>
    </div>
  );
}

/** From 1280px: the side panel, as the Bin's and Activity's are. */
const AHEAD_SHOWN = 6;

function OutlookRail({ o, asOf }: { o: Outlook; asOf: IsoDate }) {
  const after = o.free === null ? null : o.free - o.counted;
  return (
    <aside className="fms-plansrail" aria-label="What the plans need">
      <Card title={`Due by ${dayWords(o.monthEnd, asOf)}`} subtitle="This month's plans and the overdue ones">
        <Money value={o.dueNow} size="l" />
        {o.free !== null && o.dueNow > 0 && (
          <ul className="fms-binsum fms-plansrail-sum">
            <li>
              <span className="t-body">Safe to spend before plans</span>
              <Money value={o.free} size="s" />
            </li>
            <li>
              <span className="t-body">Set aside for plans</span>
              <Money value={-o.counted} size="s" signed />
            </li>
            <li>
              <span className="t-body-strong">{after !== null && after < 0 ? "Short" : "Left after them"}</span>
              <Money value={after !== null && after < 0 ? -after : after ?? 0} size="s" tone={after !== null && after < 0 ? "var(--over)" : undefined} />
            </li>
          </ul>
        )}
        <p className="t-caption fms-plansrail-foot">
          {o.dueNow === 0
            ? "Nothing due this month."
            : o.overdue > 0
              ? `${plural(o.overdue, "plan")} overdue. Record the payment, move the date, or skip ${o.overdue === 1 ? "it" : "them"}.`
              : o.dueNow > o.counted
                ? `${formatMoney(o.dueNow - o.counted)} of it is not counted in safe to spend.`
                : "Counted plans are set aside from safe to spend until they are paid."}
        </p>
      </Card>
      {o.ahead.length > 0 && (
        <Card title="Further ahead" subtitle="Open plans after this month">
          <ul className="fms-binsum">
            {/* Six months by name, the rest as one line, so a long Planner never makes a panel taller than the screen. */}
            {o.ahead.slice(0, AHEAD_SHOWN).map((g) => (
              <li key={g.key}>
                <span className="fms-binsum-type">
                  <span className="t-body">{g.title}</span>
                  <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                    {plural(g.views.length, "plan")}
                  </span>
                </span>
                <Money value={g.left} size="s" />
              </li>
            ))}
            {o.ahead.length > AHEAD_SHOWN && (
              <li>
                <span className="fms-binsum-type">
                  <span className="t-body">Later</span>
                  <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                    {plural(o.ahead.slice(AHEAD_SHOWN).reduce((n, g) => n + g.views.length, 0), "plan")}, {plural(o.ahead.length - AHEAD_SHOWN, "month")}
                  </span>
                </span>
                <Money value={o.ahead.slice(AHEAD_SHOWN).reduce((n, g) => n + g.left, 0)} size="s" />
              </li>
            )}
            {o.perMonth > 0 && (
              <li>
                <span className="t-body-strong">To save a month</span>
                <Money value={o.perMonth} size="s" />
              </li>
            )}
          </ul>
          {o.wants > 0 && (
            <p className="t-caption fms-plansrail-foot">
              {formatMoney(o.wants)} of the open plans are wants. When money is short, put these off first.
            </p>
          )}
        </Card>
      )}
    </aside>
  );
}

export function Planner(props: PlannerProps) {
  const { plans, transactions, reference, accounts, asOf } = props;
  const phone = useMediaQuery("(max-width: 639px)");
  const wide = useMediaQuery("(min-width: 1280px)");
  const [tab, setTab] = useState<Tab>("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ editing: Plan | null } | null>(null);
  const [paying, setPaying] = useState<Plan | null>(null);
  const [moving, setMoving] = useState<Plan | null>(null);
  const [linking, setLinking] = useState<Plan | null>(null);
  const [closing, setClosing] = useState<{ plan: Plan; how: "skip" | "remove" } | null>(null);

  const views = useMemo(() => plans.map((p) => viewOf(p, { transactions, accounts, asOf })), [plans, transactions, accounts, asOf]);

  // Sent here from another screen: that plan, and its payment when Pay was pressed.
  const focusAt = props.focus?.at ?? 0;
  useEffect(() => {
    const f = props.focus;
    if (!f) return;
    const plan = plans.find((p) => p.id === f.id);
    if (!plan) return;
    setTab(plan.status === "removed" ? "removed" : plan.status === "open" ? "open" : "done");
    setOpenId(plan.id);
    if (f.pay && plan.status === "open") setPaying(plan);
    // Once per press: the plans changing after it must not open it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAt]);
  const groups = useMemo(() => groupOpen(views, asOf), [views, asOf]);
  const closed = useMemo(() => closedViews(views), [views]);

  // What the wallets hold after the bills and debt payments, before any plan: what the plans this month are set against (P4.4).
  const brief = useMemo(
    () => monthBrief({ transactions, reference, budgets: props.budgets, debts: props.debts, year: Number(asOf.slice(0, 4)), month: Number(asOf.slice(5, 7)), asOf }),
    [transactions, reference, props.budgets, props.debts, asOf],
  );
  const freeBeforePlans = brief.safe ? brief.safe.free + brief.safe.reservedPlans : null;
  const short = useMemo(() => (freeBeforePlans === null ? new Map<string, Centavos>() : coverage(views, freeBeforePlans)), [views, freeBeforePlans]);
  const outlook = useMemo(() => outlookOf(groups, brief.safe?.reservedPlans ?? 0, freeBeforePlans, asOf), [groups, brief.safe?.reservedPlans, freeBeforePlans, asOf]);

  const openCount = outlook.open;
  const anything = plans.length > 0;
  const current = openId ? views.find((v) => v.plan.id === openId) ?? null : null;

  const addButton = (
    <Button variant="primary" iconLeft={<Icon name="add" size={16} />} onClick={() => setForm({ editing: null })} fullWidth={phone}>
      Plan something
    </Button>
  );

  const shown = tab === "done" ? closed.done : closed.removed;

  return (
    <div className="fms-plans">
      {/* One primary per region: with nothing planned, the empty state carries the button. */}
      <Card page title="Plans" subtitle="Payments you plan to make. No money moves until you pay." action={anything ? addButton : undefined}>
        {anything && openCount > 0 && !wide && <OutlookHead o={outlook} asOf={asOf} />}
        {/* A phone has no card heading, so the button sits under the figures, above the list. */}
        {phone && anything && <div className="fms-plans-add">{addButton}</div>}

        {anything && (
          <Tabs
            tabs={[
              { id: "open" as const, label: "Coming up", count: openCount },
              { id: "done" as const, label: "Done", count: closed.done.length },
              { id: "removed" as const, label: "Removed", count: closed.removed.length },
            ]}
            value={tab}
            onChange={setTab}
          />
        )}

        {tab === "open" &&
          (openCount === 0 ? (
            <EmptyState
              message={
                anything
                  ? "Nothing coming up. Add the next payment you plan to make, and it shows here with its date and whether you have the money."
                  : "Nothing planned yet. Add a payment you plan to make, such as tuition next month or a phone next year. It shows here with its date and whether you have the money."
              }
              action={anything ? undefined : addButton}
            />
          ) : (
            <div className="fms-planlist">
              {groups.map((g) => (
                <section key={g.key} aria-label={g.title}>
                  <h3 className="t-micro fms-plangroup">
                    <span>
                      {g.title}
                      <span className="fms-plangroup-count"> · {g.views.length}</span>
                    </span>
                    <Money value={g.left} size="s" tone="var(--ink-3)" />
                  </h3>
                  <ul className="fms-planrows">
                    {g.views.map((v) => (
                      <PlanRow key={v.plan.id} view={v} asOf={asOf} short={short.get(v.plan.id) ?? 0} onOpen={() => setOpenId(v.plan.id)} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ))}

        {tab !== "open" &&
          (shown.length === 0 ? (
            <EmptyState message={tab === "done" ? "Nothing paid or skipped yet. A plan comes here when it is paid or you skip it." : "Nothing removed. A plan you take off the list comes here, and can be put back."} />
          ) : (
            <div className="fms-planlist">
              <ul className="fms-planrows">
                {shown.map((v) => (
                  <PlanRow key={v.plan.id} view={v} asOf={asOf} short={0} onOpen={() => setOpenId(v.plan.id)} />
                ))}
              </ul>
            </div>
          ))}
      </Card>

      {wide && anything && openCount > 0 && <OutlookRail o={outlook} asOf={asOf} />}

      {current && !form && !paying && !moving && !linking && !closing && (
        <PlanSheet
          view={current}
          asOf={asOf}
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
            props.onChange(next, "plan.create", `Planned "${next.title}" again, ${formatMoney(next.amount)} ${byWhen(next)}.`);
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
          budgets={props.budgets}
          debts={props.debts}
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
              if (was.due !== next.due || was.dueKind !== next.dueKind) changed.push(`when ${whenOf(was)} to ${whenOf(next)}`);
              if (was.title !== next.title) changed.push(`name to "${next.title}"`);
              props.onChange(next, was.due !== next.due && changed.length === 1 ? "plan.move" : "plan.update", `Edited "${next.title}"${changed.length > 0 ? `: ${changed.join(", ")}` : ""}.`);
              setOpenId(next.id);
            } else {
              const next = makePlan(input, asOf, "owner");
              props.onChange(next, "plan.create", `Planned "${next.title}", ${formatMoney(next.amount)} ${byWhen(next)}.`);
              setOpenId(next.id);
              setTab("open");
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
          onMove={(to, kind) => {
            const next = movePlan(moving, to, asOf, kind);
            props.onChange(next, "plan.move", `Moved "${moving.title}" from ${whenOf(moving).replace(/^S/, "s")} to ${whenOf(next).replace(/^S/, "s")}.`);
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

/**
 * A plan in the list: its name and amount, then its day, kind and wallet, and
 * a line under them only when there is something to act on (money short, a
 * part paid, what it takes a month). The pill says the state in words.
 */
function PlanRow({ view: v, asOf, short, onOpen }: { view: PlanView; asOf: IsoDate; short: Centavos; onOpen: () => void }) {
  const p = v.plan;
  const open = isOpen(v);
  const meta = [whenWords(v, asOf), p.item, p.wallet].filter(Boolean).join(" · ");
  const pill = PILL[v.state];
  const note =
    short > 0
      ? { status: "over" as const, words: `${formatMoney(short)} more than safe to spend` }
      : v.goneNote && open
        ? { status: "warn" as const, words: "A payment linked to it is in the bin" }
        : v.paid > 0 && open
          ? { status: null, words: `${formatMoney(v.paid)} paid of ${formatMoney(p.amount)}` }
          : v.goal && !v.goal.missing && open
            ? { status: null, words: `${v.goal.name} holds ${formatMoney(v.goal.holds)}${v.goal.perMonth > 0 ? `, ${formatMoney(v.goal.perMonth)} a month to go` : ""}` }
            : v.perMonth > 0
              ? { status: null, words: `${formatMoney(v.perMonth)} a month to have it by then` }
              : null;
  return (
    <li>
      <button type="button" className="fms-planrow" onClick={onOpen}>
        <span className="fms-planrow-main">
          <span className="t-body-strong fms-planrow-title">{p.title}</span>
          <span className="t-caption fms-planrow-meta">{meta}</span>
          {note && (
            <span className="t-caption fms-plannote">
              {note.status && (
                <span className="fms-plannote-icon" style={{ color: `var(--${note.status})` }} aria-hidden>
                  <Icon name={note.status === "over" ? "statusOver" : "statusWarn"} size={14} />
                </span>
              )}
              <span>{note.words}</span>
            </span>
          )}
        </span>
        <span className="fms-planrow-side">
          <Money value={open ? v.left : v.state === "paid" ? v.paid || p.amount : p.amount} />
          {pill && <StatusPill status={pill.status}>{pill.word}</StatusPill>}
        </span>
      </button>
    </li>
  );
}

/** A fact in the plan's sheet, laid out as a Database row's (label left, value right). */
function Fact({ label, children, long = false }: { label: string; children: React.ReactNode; long?: boolean }) {
  return (
    <div className={long ? "fms-rowfacts-long" : undefined}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

interface SheetAction {
  readonly label: string;
  readonly icon: IconName;
  readonly run: () => void;
  readonly danger?: boolean;
}

/**
 * More, on a dialog's footer: the rarer actions in a short menu that opens
 * upward, closed by a choice, a click outside or Escape.
 */
function MoreMenu({ items }: { items: readonly SheetAction[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);
  return (
    <div className="fms-moremenu" ref={box}>
      <Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="more" size={18} />
        More
      </Button>
      {open && (
        <div className="fms-moremenu-list" role="menu">
          {items.map((r) => (
            <button
              key={r.label}
              type="button"
              role="menuitem"
              className={r.danger ? "fms-actionrow fms-actionrow--danger" : "fms-actionrow"}
              onClick={() => {
                setOpen(false);
                r.run();
              }}
            >
              <Icon name={r.icon} size={18} />
              <span className="t-body">{r.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PlanSheet(props: {
  view: PlanView;
  asOf: IsoDate;
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
  // A one-tap link marks a plan paid: asked first (owner, 27 October 2026: "Add validation to button").
  const { confirm, dialog: confirmDialog } = useConfirm();
  const open = isOpen(v);
  const pill = PILL[v.state];
  const paidRows = p.entryIds.map((id) => transactions.find((t) => t.id === id)).filter((t): t is Transaction => t !== undefined);
  // A payment added by hand that looks like this one (P4.9): asked, never linked by itself.
  const maybe = open ? likelyPayments(p, transactions, props.plans).slice(0, 2) : [];

  /*
   * One button at the foot, the thing most often done next, and every other
   * action as a list of rows above it, the way the phone's More sheet lists
   * screens. Two rows of buttons of every width, with labels wrapping onto
   * two lines, read as clutter (owner, 27 October 2026: "The buttons are so
   * ugly ang messy even in pc").
   */
  const primary =
    open ? (
      <Button variant="primary" onClick={props.onPay}>
        {v.paid > 0 ? "Pay the rest" : "Record payment"}
      </Button>
    ) : v.state === "removed" ? (
      <Button variant="primary" onClick={props.onReopen}>
        Put it back
      </Button>
    ) : (
      <Button variant="primary" onClick={props.onAgain}>
        Plan it again
      </Button>
    );
  const rows: SheetAction[] = open
    ? [
        { label: "Edit", icon: "edit", run: props.onEdit },
        { label: "Move the date", icon: "planner", run: props.onMove },
        { label: "Link a payment I added", icon: "ledger", run: props.onLink },
        { label: "Skip it", icon: "close", run: props.onSkip },
        { label: "Remove", icon: "bin", run: props.onRemove, danger: true },
      ]
    : v.state === "removed"
      ? []
      : [
          // A paid or skipped plan can still be edited, and stays paid or skipped (16-PLANNER.md P10).
          { label: "Edit", icon: "edit", run: props.onEdit },
          { label: v.state === "skipped" ? "Put it back" : "Open it again", icon: "planner", run: props.onReopen },
          { label: "Remove", icon: "bin", run: props.onRemove, danger: true },
        ];
  /*
   * A phone lists the actions above one wide button. A computer's dialog
   * keeps them on its footer line: the two most used as buttons, the rest
   * under More, the main one on the right. The phone's list in a dialog read
   * as a page of rows (owner, 27 October 2026: "good in phone but messy in pc").
   */
  const actions = props.dialog ? (
    <>
      {rows.length > 3 && <MoreMenu items={rows.slice(2)} />}
      {/* One more is a button of its own, not a menu of one. */}
      {rows.length === 3 && (
        <Button {...(rows[2]!.danger ? { variant: "ghost" as const, tone: "danger" as const } : {})} onClick={rows[2]!.run}>
          {rows[2]!.label}
        </Button>
      )}
      {rows.slice(0, 2).map((r) => (
        <Button key={r.label} onClick={r.run}>
          {r.label}
        </Button>
      ))}
      <span className="fms-actspacer" aria-hidden />
      {primary}
    </>
  ) : (
    primary
  );

  return (
    <>
    {/* Outside the sheet, so the question sits over it rather than inside its scrolling. */}
    {confirmDialog}
    <Sheet title={p.title} subtitle={open ? whenWords(v, props.asOf) : v.words} onClose={props.onClose} actions={actions} dialog={props.dialog}>
      <div className="fms-plansheet">
        <div className="fms-plansheet-figure">
          <Money value={open ? v.left : v.paid || p.amount} size="l" />
          <span className="t-caption" style={{ color: "var(--ink-3)" }}>
            {open ? (v.paid > 0 ? `left of ${formatMoney(p.amount)}` : "planned") : v.state === "paid" ? "paid" : "was planned"}
          </span>
          {pill && <StatusPill status={pill.status}>{pill.word}</StatusPill>}
        </div>
        {v.paid > 0 && open && <ProgressBar value={v.paid} max={p.amount} label="paid so far" />}

        {/* Not while an entry looks like its payment already: the money may have gone, not be short. */}
        {props.short > 0 && !(v.state === "overdue" && maybe.length > 0) && (
          <Alert status="over" title={`${formatMoney(props.short)} short for it`}>
            After the bills and debt payments still due and the plans before it, safe to spend does not cover all of it. Pay part now, move the date, or pay it from savings.
          </Alert>
        )}
        {v.goneNote && <Alert status="warn" title="A payment is gone">{v.goneNote}</Alert>}
        {/* Past its day and open: what to do, the already-paid case first, so nothing is entered twice. */}
        {v.state === "overdue" && (
          <Alert status="warn" title={`${formatMedium(p.due)} has passed`}>
            {maybe.length > 0
              ? `Already paid? ${no(maybe[0]!.recordNumber)} on ${formatMedium(maybe[0]!.date)} looks like it: link it below, so it is not entered twice. Not paid yet? Move the date or skip it.`
              : "Already paid and in your entries? Link a payment I added, so it is not entered twice. Paid and not entered? Record payment, with the day you paid. Not paid yet? Move the date or skip it."}
          </Alert>
        )}

        <dl className="fms-rowfacts">
          <Fact label="Pay by">{whenOf(p)}</Fact>
          {p.item && <Fact label="Kind">{p.item}</Fact>}
          {p.wallet && <Fact label="Pay from">{p.wallet}</Fact>}
          <Fact label="Need or want">{p.need ? "A need" : "A want"}</Fact>
          <Fact label="Safe to spend">{!open ? (v.state === "paid" ? "Nothing set aside: it is paid" : "Not counted") : p.goalId ? "Not counted, saved in a goal" : p.setAside && v.counts ? "Set aside now" : countedWords(p).replace(/^Counted in its month$/, "Set aside in its month").replace(/^Counted in /, "Set aside in ")}</Fact>
          {v.goal && (
            <Fact label="Goal">
              {v.goal.missing
                ? "No longer in Settings"
                : `${v.goal.name} holds ${formatMoney(v.goal.holds)}${v.goal.perMonth > 0 ? `, ${formatMoney(v.goal.perMonth)} a month to go` : v.goal.holds >= v.left && open ? ", enough for it" : ""}`}
            </Fact>
          )}
          {v.perMonth > 0 && <Fact label="To save">{`${formatMoney(v.perMonth)} a month`}</Fact>}
          {p.moves.length > 0 && <Fact label="Moved">{movesWords(p)}</Fact>}
          {p.notes && (
            <Fact label="Notes" long>
              {p.notes}
            </Fact>
          )}
          <Fact label="Planned on">{`${formatMedium(p.createdOn)}${p.createdBy === "ai" ? ", from the chat" : ""}`}</Fact>
        </dl>

        {paidRows.length > 0 && (
          <div className="fms-plansheet-part">
            <h4 className="t-label">{paidRows.length === 1 ? "Its payment" : "Its payments"}</h4>
            <ul className="fms-planpays">
              {paidRows.map((t) => (
                <li key={t.id}>
                  <button type="button" className="fms-linkbutton t-caption" onClick={() => props.onShowEntry?.(t.recordNumber)}>
                    {no(t.recordNumber)} · {formatMedium(t.date)} · {t.fromWallet || "no wallet"}
                  </button>
                  <Money value={t.total} size="s" />
                  {open && (
                    <Button size="sm" onClick={() => props.onUnlink(t.id)}>
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
            <ul className="fms-planpays">
              {maybe.map((t) => (
                <li key={t.id}>
                  <span className="t-caption">
                    {no(t.recordNumber)} · {formatMedium(t.date)} · {t.description && t.description !== t.item ? t.description.slice(0, 48) : t.item}
                  </span>
                  <Money value={t.total} size="s" />
                  <Button
                    size="sm"
                    onClick={() =>
                      void confirm({
                        title: `Link ${no(t.recordNumber)} as its payment?`,
                        body: `${no(t.recordNumber)}, ${formatMoney(t.total)} on ${formatMedium(t.date)}, counts as paying "${p.title}"${t.total >= v.left ? ", and the plan is marked paid" : `, ${formatMoney(v.left - t.total)} still to pay`}. No money moves: the entry is already in your records. Unlink puts it back.`,
                        confirmLabel: "Link it",
                        tone: "normal",
                      }).then((ok) => {
                        if (ok) props.onLinkOne(t.id);
                      })
                    }
                  >
                    Link this entry
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/*
          Outlined, not bare text: on the dark theme the three read as words,
          not buttons (owner, 27 October 2026: "i CANNOT SEE THE BUTTONS FIX IT
          MAKE IT GOOD"). Remove keeps the danger outline; it can be put back.
        */}
        {!props.dialog && rows.length > 0 && (
          <div className="fms-actionlist" role="group" aria-label="More for this plan">
            {rows.map((r) => (
              <button key={r.label} type="button" className={r.danger ? "fms-actionrow fms-actionrow--danger" : "fms-actionrow"} onClick={r.run}>
                <Icon name={r.icon} size={18} />
                <span className="t-body">{r.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
    </>
  );
}

/** When a plan is to be paid: a day, a month, or no date yet (`DueKind`). */
interface When {
  readonly kind: DueKind;
  readonly due: IsoDate;
}

const WHEN_KINDS: { id: "day" | "month" | "none"; label: string }[] = [
  { id: "day", label: "A day" },
  { id: "month", label: "A month" },
  { id: "none", label: "No date yet" },
];

const monthLabel = (date: IsoDate): string => `${MONTH_NAMES[Number(date.slice(5, 7)) - 1] ?? ""} ${date.slice(0, 4)}`;

/** This month and the next two years, plus the plan's own month when it is outside them. */
function monthsFrom(asOf: IsoDate, keep: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  let y = Number(asOf.slice(0, 4));
  let m = Number(asOf.slice(5, 7));
  for (let i = 0; i < 25; i += 1) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  if (keep !== NO_DATE && /^\d{4}-\d{2}/.test(keep) && !out.some((d) => d.slice(0, 7) === keep.slice(0, 7))) out.unshift(`${keep.slice(0, 7)}-01`);
  return out;
}

/**
 * The owner, 27 October 2026: "WHAT IF I DONT HAVE A DAY SPECIFICS YET LIKE
 * NO DATE LIKE NO IDEA WHEN". A day, a month ("sometime in November", counted
 * in November), or no date at all (counted nowhere until it has one).
 */
function WhenPicker({ value, onChange, asOf, id, error }: { value: When; onChange: (w: When) => void; asOf: IsoDate; id: string; error?: string | undefined }) {
  const kind = value.kind === "year" ? "month" : value.kind;
  const fallback = value.due !== NO_DATE ? value.due : nextMonthEnd(asOf);
  return (
    <div className="fms-planwhen">
      <SegmentedControl
        options={WHEN_KINDS}
        value={kind}
        onChange={(k) => onChange({ kind: k, due: k === "none" ? NO_DATE : dueFor(k, fallback) })}
      />
      {kind === "day" && (
        <Field label="Pay by" htmlFor={id} error={error}>
          <input id={id} type="date" value={value.due === NO_DATE ? "" : value.due} onChange={(e) => onChange({ kind: "day", due: e.target.value })} className="t-body fms-control" />
        </Field>
      )}
      {kind === "month" && (
        // A list of months, not <input type="month">, which desktop Safari and Firefox show as a bare text box.
        <Field label="Sometime in" htmlFor={id} error={error}>
          <Select
            id={id}
            value={monthLabel(value.due === NO_DATE ? fallback : value.due)}
            onChange={(v) => {
              const m = monthsFrom(asOf, value.due).find((x) => monthLabel(x) === v);
              if (m) onChange({ kind: "month", due: dueFor("month", m) });
            }}
            options={monthsFrom(asOf, value.due).map(monthLabel)}
          />
        </Field>
      )}
      {kind === "none" && (
        <p className="t-caption fms-planform-hint" style={{ margin: 0 }}>
          Kept on the Planner, counted nowhere until you give it a month or a day.
        </p>
      )}
    </div>
  );
}

const NO_GOAL = "Not saved in a goal";
const NEW_GOAL = "Make a goal for it";
const NO_KIND = "Not said";
const NO_WALLET = "Not decided";

/**
 * The plan form: the Planner's own, and the chat's Edit on a Planner card
 * (owner, 27 October 2026: "add manually edit ... make it sync like the
 * add"), so a plan is filled in the same way wherever it is made.
 */
export function PlanForm(props: {
  editing: Plan | null;
  plans: readonly Plan[];
  transactions: readonly Transaction[];
  budgets: Budgets;
  debts: readonly Debt[];
  reference: ReferenceLists;
  accounts: readonly Account[];
  asOf: IsoDate;
  dialog: boolean;
  onClose: () => void;
  onSave: (input: PlanInput) => void;
  /** Making a goal for it from the form; absent where that cannot be done (the chat). */
  onMakeGoal?: ((name: string, target: Centavos, deadline: IsoDate) => string) | undefined;
}) {
  const { editing, reference, accounts, asOf } = props;
  const isEdit = Boolean(editing && props.plans.some((p) => p.id === editing.id));
  const goals = accounts.filter((a) => a.kind === "goal" && !a.archived);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [amount, setAmount] = useState<Centavos | null>(editing ? editing.amount : null);
  // A new plan starts as "sometime next month"; the day, or no date at all, is a tap away.
  const [when, setWhen] = useState<When>(editing ? { kind: dueKindOf(editing), due: editing.due } : { kind: "month", due: nextMonthEnd(asOf) });
  const due = when.due;
  const [item, setItem] = useState(editing?.item ?? "");
  const [wallet, setWallet] = useState(editing?.wallet ?? "");
  const [goalId, setGoalId] = useState(editing?.goalId ?? "");
  const [need, setNeed] = useState(editing?.need ?? true);
  const [setAside, setSetAside] = useState(editing ? editing.setAside : true);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [tried, setTried] = useState(false);

  // Grouped as the Add form files spending: kinds, bills, subscriptions; none stopped, no Unknown.
  const kindChoices = planKinds(reference, editing?.item ?? "");
  const kinds = kindChoices.options;
  // A wallet the plan has that is not listed any more is kept, under its own heading: "Goal" only when it is one.
  const walletChoices = planWallets(reference, editing?.wallet ?? "", goals.some((g) => g.name === editing?.wallet) ? "Goal" : "This plan's");
  // What the name usually is, from the entries ("Tuition" is School), until a kind is picked.
  const [picked, setPicked] = useState(Boolean(editing?.item));
  const suggested = !picked && !item ? kindFromHistory(title, props.transactions, kinds) : null;
  const kind = item || suggested || "";
  const recurring = isRecurringKind(kind, reference);
  const input: PlanInput = { title, amount, due, dueKind: when.kind, item: kind, wallet, goalId: goalId || undefined, need, setAside: setAside && !goalId && !recurring, notes };
  const check = checkPlan({ ...input, setAside }, { plans: props.plans, reference, asOf, editing: editing?.id, closed: Boolean(isEdit && editing && editing.status !== "open") });
  const goalName = goals.find((g) => g.id === goalId)?.name ?? "";
  const counted = setAside && !goalId && !recurring;

  /*
   * The kind's limit in the plan's month, with what is spent and the other
   * plans still to pay, as the Budget screen counts them. A plan already
   * late counts in this month, as it does there.
   */
  const { transactions, budgets, debts, plans } = props;
  const limitNote = useMemo(() => {
    if (!kind || recurring || amount === null || amount <= 0 || when.kind === "none" || when.kind === "year" || !/^\d{4}-\d{2}/.test(due)) return null;
    const at = due.slice(0, 7) < asOf.slice(0, 7) ? asOf : due;
    const year = Number(at.slice(0, 4));
    const month = Number(at.slice(5, 7));
    const line = limitLines(transactions, budgets, debts, year, month).find((l) => l.kind === kind);
    if (!line) return null;
    const others = plans.filter((p) => p.id !== editing?.id).map((p) => viewOf(p, { transactions, accounts, asOf }));
    const planned = plannedForBudget(others, year, month, reference, asOf)
      .spendingViews.filter((v) => v.plan.item.trim() === kind)
      .reduce((sum, v) => sum + v.left, 0);
    // An edited plan's payments are in what is spent already; only what is left of it is still to come.
    const paid = editing && isEdit ? viewOf(editing, { transactions, accounts, asOf }).paid : 0;
    return planLimitNote(line, planned, Math.max(0, amount - paid), month);
  }, [kind, recurring, amount, when.kind, due, asOf, transactions, budgets, debts, plans, editing, isEdit, accounts, reference]);

  // The rest folds under More details, as on the Add form; open when something in it is set.
  const [moreOpen, setMoreOpen] = useState(Boolean(editing && (!editing.need || editing.goalId || !editing.setAside || editing.notes)));
  const moreSummary = [need ? "A need" : "A want", goalName ? `saved in ${goalName}` : "", counted ? (when.kind === "none" ? "counted once it has a date" : "counted in safe to spend") : "not counted", notes ? "a note" : ""].filter(Boolean).join(", ");

  const save = (): void => {
    setTried(true);
    if (check.problems.length > 0) return;
    props.onSave(input);
  };

  return (
    <Sheet
      title={isEdit && editing ? `Edit "${editing.title}"` : "Plan something"}
      subtitle={isEdit && editing && editing.status !== "open" ? `It stays ${editing.status === "done" ? "paid" : "skipped"}; its payments are not changed.` : "No money moves until you pay."}
      onClose={props.onClose}
      dialog={props.dialog}
      actions={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {isEdit ? "Save changes" : "Add to the planner"}
          </Button>
        </>
      }
    >
      <div className="fms-planform">
        <Field label="What is it for" htmlFor="plan-title" error={tried && !title.trim() ? "Say what it is for." : undefined}>
          <TextInput id="plan-title" value={title} onChange={setTitle} placeholder="Tuition, new phone, a trip" maxLength={80} />
        </Field>
        <Field label="How much" htmlFor="plan-amount" error={tried && (amount === null || amount <= 0) ? "Put in how much it will cost." : undefined}>
          <AmountInput id="plan-amount" value={amount} onChange={setAmount} />
        </Field>
        <div className="fms-planform-when">
          <span className="t-label fms-planform-whenlabel">When</span>
          <WhenPicker
            value={when}
            onChange={setWhen}
            asOf={asOf}
            id="plan-due"
            error={tried && when.kind !== "none" && !/^\d{4}-\d{2}-\d{2}$/.test(due) ? (when.kind === "month" ? "Pick the month." : "Pick the day it is to be paid by.") : undefined}
          />
        </div>
        <div className="fms-planform-pair">
          <Field label="Kind">
            <Select
              value={kind || NO_KIND}
              onChange={(v) => {
                setPicked(true);
                setItem(v === NO_KIND ? "" : v);
              }}
              options={[NO_KIND, ...kinds]}
              groups={kindChoices.groups}
              ariaLabel="Kind of spending"
              searchable
            />
          </Field>
          <Field label="Pay from">
            <Select
              value={wallet || NO_WALLET}
              onChange={(v) => setWallet(v === NO_WALLET ? "" : v)}
              options={[NO_WALLET, ...walletChoices.options, ...(wallet && !walletChoices.options.includes(wallet) ? [wallet] : [])]}
              groups={wallet && !walletChoices.options.includes(wallet) ? { ...walletChoices.groups, [wallet]: "Goal" } : walletChoices.groups}
              ariaLabel="Pay from"
            />
          </Field>
        </div>
        {suggested && (
          <p className="t-caption fms-planform-hint">
            {suggested}, as your entries about it are. Counted under it when it is paid.
          </p>
        )}

        <button type="button" className="fms-more" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
          <span className="t-body-strong">More details</span>
          <span className="t-caption fms-more-sum fms-truncate">{moreSummary}</span>
        </button>

        {moreOpen && (
          <>
            <Field label="Need or want" help="When money is short, put wants off first.">
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
                  if (v === NEW_GOAL && props.onMakeGoal) {
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
                options={[NO_GOAL, ...goals.map((g) => g.name), ...(props.onMakeGoal ? [NEW_GOAL] : [])]}
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
                      : when.kind === "none"
                        ? "Once it has a month or a day, it is set aside like a bill still to pay."
                        : "Set aside in its month like a bill still to pay, so safe to spend stays accurate."}
                </span>
              </span>
              <Switch checked={counted} onChange={setSetAside} label="Count it in safe to spend" />
            </div>
            <Field label="Notes" optional>
              <TextInput value={notes} onChange={setNotes} maxLength={300} placeholder="Where, what for, anything to remember" />
            </Field>
          </>
        )}
        {limitNote && <Alert status={limitNote.over ? "warn" : "info"}>{limitNote.text}</Alert>}
        {check.notes.filter((n) => !n.startsWith("With no date")).map((n) => (
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
  const kindChoices = planKinds(reference, plan.item);
  const kinds = kindChoices.options;
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
            <Select
              value={from || NO_WALLET}
              onChange={(v) => setFrom(v === NO_WALLET ? "" : v)}
              options={[NO_WALLET, ...planWallets(reference, goal ?? "").options]}
              groups={planWallets(reference, goal ?? "").groups}
              ariaLabel="Paid from"
            />
          </Field>
          <Field label="Kind">
            <Select value={item || NO_KIND} onChange={(v) => setItem(v === NO_KIND ? "" : v)} options={[NO_KIND, ...kinds]} groups={kindChoices.groups} ariaLabel="Kind of spending" searchable />
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

function MoveSheet(props: { plan: Plan; asOf: IsoDate; dialog: boolean; onClose: () => void; onMove: (to: IsoDate, kind: DueKind) => void }) {
  const { plan, asOf } = props;
  const undated = plan.due === NO_DATE;
  const base = !undated && plan.due > asOf ? plan.due : asOf;
  const [when, setWhen] = useState<When>(undated ? { kind: "month", due: nextMonthEnd(asOf) } : { kind: "day", due: addDays(base, 7) });
  const to = when.due;
  // The quick steps move a day; a plan with no date, or only a month, picks one below.
  const quick: [string, IsoDate][] = undated || dueKindOf(plan) !== "day"
    ? []
    : [
        ["A week later", addDays(base, 7)],
        ["Two weeks later", addDays(base, 14)],
        ["A month later", addDays(base, 30)],
      ];
  const valid = when.kind === "none" || /^\d{4}-\d{2}-\d{2}$/.test(to);
  const same = to === plan.due && when.kind === dueKindOf(plan);
  return (
    <Sheet
      title={`Move "${plan.title}"`}
      subtitle={`Now ${byWhen(plan)}. Each date change is kept in its history.`}
      onClose={props.onClose}
      dialog={props.dialog}
      actions={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          {/* A cleared date picker gives "": never saved as a day (27 October 2026 error pass). */}
          <Button variant="primary" onClick={() => props.onMove(to, when.kind)} disabled={same || !valid}>
            {!valid ? "Pick a day" : when.kind === "none" ? "Save with no date" : `Move to ${whenOf({ due: to, dueKind: when.kind })}`}
          </Button>
        </>
      }
    >
      <div className="fms-planform">
        {quick.length > 0 && (
          <SegmentedControl options={quick.map(([label, d]) => ({ id: d, label }))} value={when.kind === "day" ? (quick.find(([, d]) => d === to)?.[1] ?? "") : ""} onChange={(d) => setWhen({ kind: "day", due: d })} />
        )}
        <WhenPicker value={when} onChange={setWhen} asOf={asOf} id="move-to" />
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
