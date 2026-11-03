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
import { goalForPlan, goalParents, type GoalForPlan } from "../domain/planGoal";
import { useConfirm } from "../components/Confirm";
import type { Account } from "../domain/accounts";
import { walletBalance } from "../domain/balances";
import { addDays, formatMedium, lastOfMonth, MONTH_NAMES } from "../domain/dates";
import { emptyDraft, type Draft } from "../domain/entry";
import { formatMoney, type Centavos } from "../domain/money";
import { monthBrief } from "../domain/monthPlan";
import { asSaving, asSavingWords, misfiledSaving, paidSoFar, paysPlan, checkPlan, closedViews, coverage, editPlan, groupOpen, isRecurringKind, kindFromHistory, likelyPayments, linkPayments, makePlan, movePlan, movesWords, byWhen, countedWords, dueFor, dueKindOf, NO_DATE, nextMonthEnd, whenOf, type DueKind, planAgain, planKinds, plannedForBudget, planWallets, planInto, isSave, savesOutOfSpending, removePlan, reopenPlan, skipPlan, unlinkPayment, viewOf, walletToPayFrom, type Plan, type PlanGroup, type PlanInput, type PlanView, paysDebt } from "../domain/planner";
import { dueDayIn, planDebtLines } from "../domain/planDebt";
import { ordinalDay } from "../domain/debtWords";
import { asAmountAndFees } from "../domain/debt";
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
  /** A goal for a plan, made in Settings' accounts as worked out (`planGoal.ts`), or the one already there. Returns its id and name. */
  readonly onMakeGoal: (goal: GoalForPlan) => { readonly id: string; readonly name: string };
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

/** The badge, in a plan to save's own words: money is moved, not paid (P11). */
const pillOf = (v: PlanView): (typeof PILL)[PlanView["state"]] => {
  const pill = PILL[v.state];
  if (!pill || !isSave(v.plan)) return pill;
  return v.state === "partly" ? { ...pill, word: "Part moved" } : v.state === "paid" ? { ...pill, word: "Done" } : pill;
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
          debts={props.debts}
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
          onReopen={() => {
            const back = reopenPlan(current.plan);
            props.onChange(back, "plan.restore", `Put "${current.plan.title}" back on the plan list.`);
            // Its day gone, it would come back overdue: a new day is offered, Cancel keeps it as it was.
            if (back.due !== NO_DATE && dueFor(dueKindOf(back), back.due) < asOf) setMoving(back);
          }}
          onAgain={() => {
            const next = planAgain(current.plan, addDays(asOf, 30) > current.plan.due ? addDays(asOf, 30) : addDays(current.plan.due, 30), asOf, "owner");
            props.onChange(next, "plan.create", `Planned "${next.title}" again, ${formatMoney(next.amount)} ${byWhen(next)}.`);
            setOpenId(next.id);
            setForm({ editing: next });
          }}
          onUnlink={(id) => props.onChange(unlinkPayment(current.plan, id, transactions), "plan.update", `Unlinked a payment from "${current.plan.title}".`)}
          onLinkOne={(id) => props.onChange(linkPayments(current.plan, [id], transactions, asOf), "plan.paid", `Linked a payment to "${current.plan.title}".`)}
          accounts={accounts.filter((a) => !a.archived).map((a) => a.name)}
          onMakeSaving={(into, link) => {
            const next = asSaving(current.plan, into, reference.wallets, transactions, asOf, link?.id);
            props.onChange(next, link ? "plan.paid" : "plan.update", asSavingWords(current.plan, next, transactions, link));
          }}
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
              const next = editPlan(was, input, asOf, transactions);
              const changed: string[] = [];
              if (was.amount !== next.amount) changed.push(`amount ${formatMoney(was.amount)} to ${formatMoney(next.amount)}`);
              if (was.due !== next.due || was.dueKind !== next.dueKind) changed.push(`when ${whenOf(was)} to ${whenOf(next)}`);
              if (was.title !== next.title) changed.push(`name to "${next.title}"`);
              const settled = was.status === "open" && next.status === "done";
              props.onChange(next, settled ? "plan.paid" : was.due !== next.due && changed.length === 1 ? "plan.move" : "plan.update", `Edited "${next.title}"${changed.length > 0 ? `: ${changed.join(", ")}` : ""}${settled ? ", paid in full" : ""}.`);
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
          debts={props.debts}
          asOf={asOf}
          dialog={!phone}
          plans={plans}
          onClose={() => setPaying(null)}
          onPay={(draft, settles, makesSaving) => {
            const stopped = props.onPay(makesSaving ? asSaving(paying, makesSaving, reference.wallets, transactions, asOf) : paying, draft, settles);
            if (!stopped) setPaying(null);
            return stopped;
          }}
          onCount={(entry, makesSaving) => {
            if (makesSaving) {
              const next = asSaving(paying, makesSaving, reference.wallets, transactions, asOf, entry.id);
              props.onChange(next, "plan.paid", asSavingWords(paying, next, transactions, entry));
            } else {
              const next = linkPayments(paying, [entry.id], transactions, asOf);
              props.onChange(next, "plan.paid", `Counted ${no(entry.recordNumber)} as the ${isSave(paying) ? "money moved" : "payment"} for "${paying.title}", from its Pay sheet: no new entry added.`);
            }
            setPaying(null);
          }}
          onEdit={() => {
            setForm({ editing: paying });
            setPaying(null);
          }}
        />
      )}

      {moving && (
        <MoveSheet
          plan={moving}
          view={views.find((v) => v.plan.id === moving.id)}
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
          accounts={accounts.filter((a) => !a.archived).map((a) => a.name)}
          dialog={!phone}
          onClose={() => setLinking(null)}
          onLink={(ids, settles, makesSaving) => {
            const base = makesSaving ? asSaving(linking, makesSaving, reference.wallets, transactions, asOf) : linking;
            const nos = ids.map((id) => no(transactions.find((t) => t.id === id)?.recordNumber ?? 0)).join(", ");
            props.onChange(
              linkPayments(base, ids, transactions, asOf, settles),
              "plan.paid",
              `${makesSaving ? `Made "${linking.title}" a plan to save into ${makesSaving}. ` : ""}Linked ${nos} to "${linking.title}" as its ${isSave(base) ? "money moved" : "payment"}.`,
            );
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
  // A plan to save says where the money goes (P11).
  const meta = (isSave(p) ? [whenWords(v, asOf), `Into ${p.into}`, p.wallet ? `from ${p.wallet}` : ""] : paysDebt(p) ? [whenWords(v, asOf), "Debt payment", p.wallet ? `from ${p.wallet}` : ""] : [whenWords(v, asOf), p.item, p.wallet]).filter(Boolean).join(" · ");
  const pill = pillOf(v);
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
  /** The debt lines, for a plan to pay one (P12). */
  debts?: readonly Debt[] | undefined;
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
  /** The open accounts' names, for a plan named as a saving but saved as spending (`misfiledSaving`). */
  accounts: readonly string[];
  /** Make it a plan to save into `into`, and count `link` as the money moved. */
  onMakeSaving: (into: string, link: Transaction | null) => void;
  onShowEntry?: ((recordNumber: number) => void) | undefined;
}) {
  const { view: v, transactions } = props;
  const p = v.plan;
  // A one-tap link marks a plan paid: asked first (owner, 27 October 2026: "Add validation to button").
  const { confirm, dialog: confirmDialog } = useConfirm();
  const open = isOpen(v);
  const pill = pillOf(v);
  const paidRows = p.entryIds.map((id) => transactions.find((t) => t.id === id)).filter((t): t is Transaction => t !== undefined);
  // A payment added by hand that looks like this one (P4.9): asked, never linked by itself.
  const maybe = open ? likelyPayments(p, transactions, props.plans).slice(0, 2) : [];
  // Named as a saving into an account, saved as spending: said, and one press makes it a saving.
  const misfiled = open ? misfiledSaving(p, props.accounts, transactions, props.plans) : null;

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
        {isSave(p) || misfiled?.into ? (v.paid > 0 ? "Move the rest" : "Record the move") : v.paid > 0 ? "Pay the rest" : "Record payment"}
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
            {open ? (v.paid > 0 ? `left of ${formatMoney(p.amount)}` : "planned") : v.state === "paid" ? (isSave(p) ? "moved" : "paid") : "was planned"}
          </span>
          {pill && <StatusPill status={pill.status}>{pill.word}</StatusPill>}
        </div>
        {v.paid > 0 && open && <ProgressBar value={v.paid} max={p.amount} label={isSave(p) ? "moved so far" : "paid so far"} />}

        {/* Not while an entry looks like its payment already: the money may have gone, not be short. */}
        {props.short > 0 && !(v.state === "overdue" && maybe.length > 0) && (
          <Alert status="over" title={`${formatMoney(props.short)} short for it`}>
            {isSave(p)
              ? "After the bills and debt payments still due and the plans before it, safe to spend does not cover all of it. Move part now, or move the date."
              : "After the bills and debt payments still due and the plans before it, safe to spend does not cover all of it. Pay part now, move the date, or pay it from savings."}
          </Alert>
        )}
        {v.goneNote && !misfiled && <Alert status="warn" title={v.goneNote.includes("edited") ? "A payment changed" : "A payment is gone"}>{v.goneNote}</Alert>}
        {/*
          Its words say a saving, its kind says spending (owner, 3 November
          2026: "i allready transfer to my bank then it didnt recognize it").
          Said, with the change one press away; nothing changes by itself.
        */}
        {misfiled && (
          <Alert
            status="warn"
            title={misfiled.fits ? `${no(misfiled.fits.recordNumber)} is not counted: this plan is set as spending` : "This plan is set as spending"}
            action={
              misfiled.into ? (
                <Button
                  size="sm"
                  onClick={() => {
                    const into = misfiled.into!;
                    const fits = misfiled.fits;
                    void confirm({
                      title: fits ? `Make it a saving and count ${no(fits.recordNumber)}?` : `Make it a saving into ${into}?`,
                      body: `"${p.title}" becomes a plan to save into ${into}: it shows Record the move, and is not counted as spending in Budget or Insights.${
                        fits ? ` ${no(fits.recordNumber)}, ${formatMoney(fits.amount)} moved on ${formatMedium(fits.date)}, counts as the money moved${fits.amount >= p.amount ? ", and the plan is done" : `, ${formatMoney(p.amount - fits.amount)} still to move`}.` : ""
                      }${v.goneNote ? " The payment linked to it from the bin is let go: spending does not pay a saving." : ""} No entry is added or changed. Edit changes it back.`,
                      confirmLabel: fits ? "Make it a saving and count it" : "Make it a saving",
                      tone: "normal",
                    }).then((ok) => {
                      if (ok) props.onMakeSaving(into, fits);
                    });
                  }}
                >
                  {misfiled.fits ? `Make it a saving and count ${no(misfiled.fits.recordNumber)}` : "Make it a saving"}
                </Button>
              ) : (
                <Button size="sm" onClick={props.onEdit}>
                  Edit
                </Button>
              )
            }
          >
            {`Its words say the money goes into ${misfiled.into ?? misfiled.options.join(" or ")}, but it is saved as a plan to spend${
              misfiled.fits ? `, so ${no(misfiled.fits.recordNumber)}, ${formatMoney(misfiled.fits.amount)} moved into ${misfiled.into} on ${formatMedium(misfiled.fits.date)}, is not seen as its money` : ", so it shows Pay and is counted as planned spending"
            }.${v.goneNote ? ` ${v.goneNote}` : ""}${misfiled.into ? "" : " Edit it, pick To save or move, and the account."}`}
          </Alert>
        )}
        {/* Past its day and open: what to do, the already-paid case first, so nothing is entered twice. */}
        {v.state === "overdue" && (
          <Alert status="warn" title={`${formatMedium(p.due)} has passed`}>
            {maybe.length > 0
              ? `Already paid? ${no(maybe[0]!.recordNumber)} on ${formatMedium(maybe[0]!.date)} looks like it: link it below, so it is not entered twice. Not paid yet? Move the date or skip it.`
              : "Already paid and in your entries? Link a payment I added, so it is not entered twice. Paid and not entered? Record payment, with the day you paid. Not paid yet? Move the date or skip it."}
          </Alert>
        )}

        <dl className="fms-rowfacts">
          {paysDebt(p) ? (
            <>
              <Fact label="Pay by">{whenOf(p)}</Fact>
              <Fact label="Paid to">{props.debts?.find((d) => d.id === p.debtId)?.name ?? "A debt no longer in Settings"}</Fact>
              {p.wallet && <Fact label="Pay from">{p.wallet}</Fact>}
              <Fact label="Safe to spend">{!open ? "Nothing held back: it is paid" : v.counts ? "Held back now" : countedWords(p)}</Fact>
              <Fact label="Budget">Not counted: a repayment is not spending</Fact>
            </>
          ) : isSave(p) ? (
            <>
              <Fact label="Move by">{whenOf(p)}</Fact>
              <Fact label="Into">{p.into}</Fact>
              {p.wallet && <Fact label="From">{p.wallet}</Fact>}
              <Fact label="Safe to spend">{!open ? (v.state === "paid" ? "Nothing held back: it is moved" : "Not held back") : v.counts ? "Held back now" : countedWords(p)}</Fact>
              <Fact label="Budget">Not counted: it is saving, not spending</Fact>
            </>
          ) : (
            <>
              <Fact label="Pay by">{whenOf(p)}</Fact>
              {p.item && <Fact label="Kind">{p.item}</Fact>}
              {p.wallet && <Fact label="Pay from">{p.wallet}</Fact>}
              <Fact label="Need or want">{p.need ? "A need" : "A want"}</Fact>
              <Fact label="Safe to spend">{!open ? (v.state === "paid" ? "Nothing set aside: it is paid" : "Not counted") : p.goalId ? "Not counted, saved in a goal" : p.setAside && v.counts ? "Set aside now" : countedWords(p).replace(/^Counted in its month$/, "Set aside in its month").replace(/^Counted in /, "Set aside in ")}</Fact>
            </>
          )}
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
                    {no(t.recordNumber)} · {formatMedium(t.date)} · {isSave(p) ? `${t.fromWallet || "income"} to ${t.toWallet}` : t.fromWallet || "no wallet"}
                  </button>
                  <Money value={isSave(p) ? t.amount : t.total} size="s" />
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
            <h4 className="t-label">{isSave(p) ? "Moved it already?" : "Already paid it?"}</h4>
            <ul className="fms-planpays">
              {maybe.map((t) => (
                <li key={t.id}>
                  <span className="t-caption">
                    {no(t.recordNumber)} · {formatMedium(t.date)} · {t.description && t.description !== t.item ? t.description.slice(0, 48) : t.item}
                  </span>
                  <Money value={isSave(p) ? t.amount : t.total} size="s" />
                  <Button
                    size="sm"
                    onClick={() =>
                      void confirm({
                        title: `Link ${no(t.recordNumber)} as its payment?`,
                        body: (() => {
                          const got = isSave(p) ? t.amount : t.total;
                          return `${no(t.recordNumber)}, ${formatMoney(got)} on ${formatMedium(t.date)}, counts as ${isSave(p) ? "moving the money for" : "paying"} "${p.title}"${got >= v.left ? `, and the plan is marked ${isSave(p) ? "done" : "paid"}` : `, ${formatMoney(v.left - got)} still to ${isSave(p) ? "move" : "pay"}`}. No money moves: the entry is already in your records. Unlink puts it back.`;
                        })(),
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
function WhenPicker({ value, onChange, asOf, id, error, dayLabel = "Pay by" }: { value: When; onChange: (w: When) => void; asOf: IsoDate; id: string; error?: string | undefined; dayLabel?: string }) {
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
        <Field label={dayLabel} htmlFor={id} error={error}>
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
const NO_INTO = "Pick one";

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
  onMakeGoal?: ((goal: GoalForPlan) => { readonly id: string; readonly name: string }) | undefined;
  /** A new plan opened as one to save or move money (P11). */
  saving?: boolean | undefined;
}) {
  const { editing, reference, accounts, asOf } = props;
  /*
   * To spend, or to save or move money into an account or goal (P11; owner,
   * 2 November 2026: "what if I plan to save like deposit to bank or wallet
   * or goal ... what if I edited a plan to buy to plan to save").
   */
  /*
   * And to pay a debt (P12; owner, 3 November 2026: "what about if I want to
   * pay a loan"): a repayment on a loan or credit line, not spending.
   */
  const [planType, setPlanType] = useState<"spend" | "save" | "debt">(editing ? (paysDebt(editing) ? "debt" : isSave(editing) ? "save" : "spend") : props.saving ? "save" : "spend");
  const saving = planType === "save";
  const paying = planType === "debt";
  const [into, setInto] = useState(editing?.into ?? "");
  const [debtId, setDebtId] = useState(editing?.debtId ?? "");
  const debtLines = useMemo(() => planDebtLines(props.debts, props.transactions, asOf), [props.debts, props.transactions, asOf]);
  const line = debtLines.find((d) => d.id === debtId);
  const isEdit = Boolean(editing && props.plans.some((p) => p.id === editing.id));
  const goals = accounts.filter((a) => a.kind === "goal" && !a.archived);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [amount, setAmount] = useState<Centavos | null>(editing ? editing.amount : null);
  // A new plan starts as "sometime next month"; the day, or no date at all, is a tap away.
  const [when, setWhen] = useState<When>(editing ? { kind: dueKindOf(editing), due: editing.due } : { kind: "month", due: nextMonthEnd(asOf) });
  // Picked by hand: a debt picked later does not move it to the line's due day.
  const [whenTouched, setWhenTouched] = useState(Boolean(editing));
  const due = when.due;
  const [item, setItem] = useState(editing?.item ?? "");
  const [wallet, setWallet] = useState(editing?.wallet ?? "");
  const [goalId, setGoalId] = useState(editing?.goalId ?? "");
  /*
   * "Make a goal for it" is made when the plan is saved, never on the pick:
   * picked and then cancelled, or picked twice, it made a goal each time
   * ("Motorcylce setup and repair" and "... fund", owner 27 October 2026).
   */
  const [newGoal, setNewGoal] = useState(false);
  const goalHomes = goalParents(accounts);
  const [goalHome, setGoalHome] = useState(goalHomes[0]?.id ?? "");
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
  const recurring = planType === "spend" && isRecurringKind(kind, reference);
  // Held back only when the money leaves the spending wallets: into savings or a goal, from a spending wallet or none said.
  const outOfSpending = savesOutOfSpending({ into, wallet }, reference.wallets);
  const intoChoices = planInto(reference, accounts, editing?.into ?? "");
  const input: PlanInput = saving
    ? { title, amount, due, dueKind: when.kind, item: "", wallet, into, saving: true, need: true, setAside: setAside && outOfSpending, notes }
    : paying
      ? // A line whose payment safe to spend holds back already is never held back twice.
        { title, amount, due, dueKind: when.kind, item: "", wallet, debtId: debtId || undefined, paying: true, need: true, setAside: setAside && !line?.scheduled, notes }
      : { title, amount, due, dueKind: when.kind, item: kind, wallet, goalId: goalId || undefined, need, setAside: setAside && !goalId && !newGoal && !recurring, notes };
  // The payments linked to the plan being edited: of the other kind, they stop a change between spending and saving.
  const linkedRows = useMemo(() => (editing && isEdit ? props.transactions.filter((t) => editing.entryIds.includes(t.id)) : []), [editing, isEdit, props.transactions]);
  // What is paid on it already: its amount may not go below that, and at exactly that it is paid in full.
  const paidOn = useMemo(() => (editing && isEdit ? viewOf(editing, { transactions: props.transactions, accounts, asOf }).paid : 0), [editing, isEdit, props.transactions, accounts, asOf]);
  const check = checkPlan(
    { ...input, setAside: saving || paying ? input.setAside : setAside },
    {
      plans: props.plans,
      debtLines,
      wasPaying: isEdit && editing ? paysDebt(editing) : undefined,
      reference,
      asOf,
      linked: linkedRows,
      wasSaving: isEdit && editing ? isSave(editing) : undefined,
      closedAccounts: accounts.filter((a) => a.archived).map((a) => a.name),
      editing: isEdit ? editing?.id : undefined,
      closed: Boolean(isEdit && editing && editing.status !== "open"),
      paid: paidOn,
      was: isEdit && editing ? { due: editing.due, dueKind: editing.dueKind } : undefined,
    },
  );
  const paidProblem = check.problems.find((p) => p.includes("is paid on it already"));
  const { confirm, dialog: confirmDialog } = useConfirm();
  // The goal it would get, or the one picked, checked and said before anything is made (`planGoal.ts`).
  const goalPlan = newGoal || goalId ? goalForPlan({ id: editing?.id, title, amount, due, dueKind: when.kind }, { accounts, plans: props.plans, transactions: props.transactions, asOf, parentId: goalHome, goalId: newGoal ? undefined : goalId }) : null;
  const goalName = newGoal ? (goalPlan?.name ?? title.trim()) : (goals.find((g) => g.id === goalId)?.name ?? "");
  const counted = saving ? setAside && outOfSpending : paying ? setAside && !line?.scheduled : setAside && !goalId && !newGoal && !recurring;
  const debtProblem = check.problems.find((x) => x.startsWith("Pick the loan") || x.includes("debt line is no longer") || x.includes("not a repayment") || x.includes("are not repayments") || x.includes("repayments on a debt") || x.includes("is a repayment on a debt"));
  const intoProblem = check.problems.find((x) => x.startsWith("Pick the account") || x.includes(" and comes from ") || x.includes("is closed in Settings"));
  const kindProblem = check.problems.find((x) => x.includes("linked as its payment"));

  /*
   * The kind's limit in the plan's month, with what is spent and the other
   * plans still to pay, as the Budget screen counts them. A plan already
   * late counts in this month, as it does there.
   */
  const { transactions, budgets, debts, plans } = props;
  const limitNote = useMemo(() => {
    if (saving || paying || !kind || recurring || amount === null || amount <= 0 || when.kind === "none" || when.kind === "year" || !/^\d{4}-\d{2}/.test(due)) return null;
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
    return planLimitNote(line, planned, Math.max(0, amount - paidOn), month);
  }, [saving, paying, kind, recurring, amount, when.kind, due, asOf, transactions, budgets, debts, plans, editing, accounts, reference, paidOn]);

  // The rest folds under More details, as on the Add form; open when something in it is set.
  const [moreOpen, setMoreOpen] = useState(Boolean(editing && (!editing.need || editing.goalId || !editing.setAside || editing.notes)));
  const moreSummary = saving
    ? [counted ? (when.kind === "none" ? "held back once it has a date" : "held back from safe to spend") : "not held back", notes ? "a note" : ""].filter(Boolean).join(", ")
    : paying
      ? [!line ? "pick the debt first" : line.scheduled ? "its payment is held back already" : counted ? "counted in safe to spend" : "not counted", notes ? "a note" : ""].filter(Boolean).join(", ")
      : [need ? "A need" : "A want", goalName ? `saved in ${goalName}` : "", counted ? (when.kind === "none" ? "counted once it has a date" : "counted in safe to spend") : "not counted", notes ? "a note" : ""].filter(Boolean).join(", ");

  const save = async (): Promise<void> => {
    setTried(true);
    if (check.problems.length > 0 || (planType === "spend" && newGoal && (goalPlan?.problems.length ?? 0) > 0)) return;
    /*
     * A new plan for a day already gone (owner, 27 October 2026: "what if I
     * create a plan but in the past?"): asked, since it is either a payment
     * still owed, overdue from the day it is added, or one already made,
     * which is an entry, not a plan.
     */
    const day = dueFor(when.kind, due);
    if (!isEdit && when.kind !== "none" && day < asOf) {
      const ok = await confirm({
        title: `${whenOf({ due: day, dueKind: when.kind })} has passed`,
        body: (
          <>
            <p style={{ margin: 0 }}>{saving ? "Still to move: add it, and it shows as overdue until the money is moved." : "Still to pay: add it, and it shows as overdue and is counted in safe to spend until it is paid."}</p>
            <p style={{ margin: "var(--space-2) 0 0" }}>{saving ? "Moved already: add it, then on its sheet link the transfer, so nothing is entered twice. Or pick a later day." : "Paid already: add it, then on its sheet link the entry, or record the payment with the day you paid, so nothing is entered twice. Or pick a later day."}</p>
          </>
        ),
        confirmLabel: "Add it",
        cancelLabel: "Go back",
      });
      if (!ok) return;
    }
    // The goal, made now that the plan is saved: by its day, or with no deadline when the plan has no date (never the year 9999).
    if (planType === "spend" && newGoal && props.onMakeGoal && goalPlan) {
      if (goalPlan.problems.length > 0) return;
      const made = props.onMakeGoal(goalPlan);
      props.onSave({ ...input, goalId: made.id, wallet: made.name, setAside: false });
      return;
    }
    props.onSave(input);
  };

  return (
    <Sheet
      title={isEdit && editing ? `Edit "${editing.title}"` : "Plan something"}
      subtitle={isEdit && editing && editing.status !== "open" ? `It stays ${editing.status === "done" ? "paid" : "skipped"}; its payments are not changed.` : saving ? "No money moves until you move it." : paying ? "No money moves until you record the repayment." : "No money moves until you pay."}
      onClose={props.onClose}
      dialog={props.dialog}
      actions={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>
            {isEdit ? "Save changes" : "Add to the planner"}
          </Button>
        </>
      }
    >
      <div className="fms-planform">
        <Field label="This plan is" help={saving ? "Money you will put into savings, a goal or another wallet. It is moved, not spent." : paying ? "A payment on a loan or credit line. It lowers what you owe; it is not spending." : undefined}>
          <SegmentedControl
            options={[
              { id: "spend", label: "To spend" },
              { id: "save", label: "To save or move" },
              { id: "debt", label: "To pay a debt" },
            ]}
            value={planType}
            onChange={(v) => setPlanType(v === "save" ? "save" : v === "debt" ? "debt" : "spend")}
          />
        </Field>
        {/* The debt first: picking it fills the name, the amount, the day and the account (3 November 2026). */}
        {paying && debtLines.some((d) => !d.archived) && (
          <div className="fms-planform-pair">
            <Field label="Which debt" error={tried || debtId ? debtProblem : undefined}>
              <Select
                value={line?.name ?? NO_INTO}
                onChange={(v) => {
                  const picked = debtLines.find((d) => d.name === v);
                  setDebtId(picked?.id ?? "");
                  // Filled from the line, only where nothing was typed: its name, and what its next payment is, or all that is owed.
                  if (picked && !title.trim()) setTitle(`Pay ${picked.name}`);
                  if (picked && (amount === null || amount <= 0)) setAmount(picked.scheduled?.amount ?? (picked.owed > 0 ? picked.owed : null));
                  // Its due day, unless a time was picked: "sometime in December" when Maya Credit is due December 6 (3 November 2026).
                  if (picked?.scheduled && !whenTouched) setWhen({ kind: "day", due: picked.scheduled.on });
                  // Nothing due yet, but a payment day set: that day in the month shown ("December 6", not "sometime in December").
                  else if (picked?.dueDay && !whenTouched && when.kind === "month") setWhen({ kind: "day", due: dueDayIn(when.due, picked.dueDay) });
                  // The account it is paid from, unless one was picked.
                  const account = picked ? props.debts.find((d) => d.id === picked.id)?.wallet : undefined;
                  if (account && !wallet && reference.wallets.concat(reference.savings).includes(account)) setWallet(account);
                }}
                options={[NO_INTO, ...debtLines.filter((d) => !d.archived || d.id === debtId).map((d) => d.name)]}
                ariaLabel="Which debt"
              />
            </Field>
            <Field label="Pay from">
              <Select
                value={wallet || NO_WALLET}
                onChange={(v) => setWallet(v === NO_WALLET ? "" : v)}
                options={[NO_WALLET, ...walletChoices.options, ...(wallet && !walletChoices.options.includes(wallet) ? [wallet] : [])]}
                groups={walletChoices.groups}
                ariaLabel="Pay from"
              />
            </Field>
          </div>
        )}
        {paying && !debtLines.some((d) => !d.archived) && (
          <Alert status="info">No loan or credit line is in Settings yet. Add one in Settings, Credit and loans, then plan its payment here.</Alert>
        )}
        <Field label="What is it for" htmlFor="plan-title" error={tried && !title.trim() ? "Say what it is for." : undefined}>
          <TextInput id="plan-title" value={title} onChange={setTitle} placeholder={saving ? "Deposit to savings, money for a trip" : paying ? "Pay Maya Credit, loan payment" : "Tuition, new phone, a trip"} maxLength={80} />
        </Field>
        <Field
          label={saving ? "How much to move" : paying ? "How much to pay" : "How much"}
          htmlFor="plan-amount"
          help={paying && line ? `Owed on ${line.name} now: ${formatMoney(line.owed)}${line.scheduled ? `; its next payment, ${formatMoney(line.scheduled.amount)}, is due ${formatMedium(line.scheduled.on)}` : line.owed <= 0 && line.dueDay ? `; payments fall due on the ${ordinalDay(line.dueDay)}` : ""}.` : undefined}
          error={tried && (amount === null || amount <= 0) ? (saving ? "Put in how much to move." : paying ? "Put in how much you will pay." : "Put in how much it will cost.") : paidProblem}
        >
          <AmountInput id="plan-amount" value={amount} onChange={setAmount} />
        </Field>
        <div className="fms-planform-when">
          <span className="t-label fms-planform-whenlabel">When</span>
          <WhenPicker
            value={when}
            onChange={(w) => {
              setWhenTouched(true);
              setWhen(w);
            }}
            asOf={asOf}
            id="plan-due"
            dayLabel={saving ? "Move by" : "Pay by"}
            error={tried && when.kind !== "none" && !/^\d{4}-\d{2}-\d{2}$/.test(due) ? (when.kind === "month" ? "Pick the month." : "Pick the day it is to be paid by.") : undefined}
          />
        </div>
        {paying ? null : saving ? (
          <div className="fms-planform-pair">
            <Field label="Into" error={tried || into ? intoProblem : undefined}>
              <Select value={into || NO_INTO} onChange={(v) => setInto(v === NO_INTO ? "" : v)} options={[NO_INTO, ...intoChoices.options]} groups={intoChoices.groups} ariaLabel="Into" />
            </Field>
            <Field label="From">
              <Select
                value={wallet || NO_WALLET}
                onChange={(v) => setWallet(v === NO_WALLET ? "" : v)}
                options={[NO_WALLET, ...walletChoices.options, ...(wallet && !walletChoices.options.includes(wallet) ? [wallet] : [])]}
                groups={walletChoices.groups}
                ariaLabel="From"
              />
            </Field>
          </div>
        ) : (
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
        )}
        {planType === "spend" && suggested && (
          <p className="t-caption fms-planform-hint">
            {suggested}, as your entries about it are. Counted under it when it is paid.
          </p>
        )}

        <button type="button" className="fms-more" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
          <span className="t-body-strong">More details</span>
          <span className="t-caption fms-more-sum fms-truncate">{moreSummary}</span>
        </button>

        {moreOpen && saving && (
          <>
            <div className="fms-planform-switch">
              <span className="fms-planform-switchtext">
                <span className="t-body">Hold it back from safe to spend</span>
                <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                  {!into
                    ? "Pick where it goes first."
                    : !outOfSpending
                      ? reference.wallets.some((w) => w.toLowerCase() === into.toLowerCase())
                        ? `${into} is a spending wallet too, so nothing leaves your spending money and nothing is held back.`
                        : `It comes from ${wallet}, not a spending wallet, so nothing is held back.`
                      : when.kind === "none"
                        ? "Once it has a month or a day, safe to spend holds the money back then."
                        : counted
                          ? "On: safe to spend holds the money back in its month, so it is there to move."
                          : "Off: safe to spend does not hold it back; move it when the money is there."}
                </span>
              </span>
              {into && outOfSpending && <Switch checked={counted} onChange={setSetAside} label="Hold it back from safe to spend" />}
            </div>
            <Field label="Notes" optional>
              <TextInput value={notes} onChange={setNotes} maxLength={300} placeholder="Why, what it is for, anything to remember" />
            </Field>
          </>
        )}
        {moreOpen && paying && (
          <>
            <div className="fms-planform-switch">
              <span className="fms-planform-switchtext">
                <span className="t-body">Count it in safe to spend</span>
                <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                  {!line
                    ? "Pick the debt first."
                    : line.scheduled
                      ? `${line.name}'s payment of ${formatMoney(line.scheduled.amount)}, due ${formatMedium(line.scheduled.on)}, is held back already as a debt payment due, so this plan is not counted again.`
                      : when.kind === "none"
                        ? "Once it has a month or a day, safe to spend holds it back then."
                        : counted
                          ? line.dueDay
                            ? `On: nothing is due on ${line.name} yet, so safe to spend holds this payment back in its month.`
                            : `On: ${line.name} has no due day, so safe to spend holds this payment back in its month.`
                          : "Off: safe to spend does not hold it back; pay it when the money is there."}
                </span>
              </span>
              {line && !line.scheduled && <Switch checked={counted} onChange={setSetAside} label="Count it in safe to spend" />}
            </div>
            <Field label="Notes" optional>
              <TextInput value={notes} onChange={setNotes} maxLength={300} placeholder="What it is for, anything to remember" />
            </Field>
          </>
        )}
        {moreOpen && planType === "spend" && (
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
            <Field
              label="Saving for it"
              help={goalPlan ? goalPlan.notes.join(" ") : "Link a goal from Settings, or make one for it when you save."}
              error={newGoal && goalPlan && goalPlan.problems.length > 0 ? goalPlan.problems[0] : undefined}
            >
              <Select
                value={newGoal ? NEW_GOAL : goalName || NO_GOAL}
                onChange={(v) => {
                  if (v === NEW_GOAL && props.onMakeGoal) {
                    // Only marked here; made on save. What is missing is said under it, not silently refused.
                    setNewGoal(true);
                    setGoalId("");
                    return;
                  }
                  setNewGoal(false);
                  const g = goals.find((x) => x.name === v);
                  setGoalId(g?.id ?? "");
                  if (g) setWallet(g.name);
                }}
                options={[NO_GOAL, ...goals.map((g) => g.name), ...(props.onMakeGoal ? [NEW_GOAL] : [])]}
                ariaLabel="Saving for it in a goal"
              />
            </Field>
            {newGoal && goalPlan && !goalPlan.reuse && goalHomes.length > 1 && (
              <Field label="Kept inside" help="The savings account the goal's money sits in, as on Settings, Goals.">
                <Select value={goalHomes.find((h) => h.id === goalHome)?.name ?? goalHomes[0]?.name ?? ""} onChange={(v) => setGoalHome(goalHomes.find((h) => h.name === v)?.id ?? goalHome)} options={goalHomes.map((h) => h.name)} ariaLabel="Account the goal sits in" />
              </Field>
            )}
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
                        : counted
                          ? "On: set aside in its month like a bill still to pay, so safe to spend leaves its money alone until it is paid."
                          : "Off: safe to spend does not hold its money back, so that money can go on other things. The Budget still counts it as planned spending in its month."}
                </span>
              </span>
              <Switch checked={counted} onChange={setSetAside} label="Count it in safe to spend" />
            </div>
            <Field label="Notes" optional>
              <TextInput value={notes} onChange={setNotes} maxLength={300} placeholder="Where, what for, anything to remember" />
            </Field>
          </>
        )}
        {/*
          A saved plan's goal changed, to another or to none: what happens to
          the money already in the old one (owner, 27 October 2026: "what if
          the plan i made is connected to a goal then I edit the goal change
          it to none goal"). The money never moves by itself.
        */}
        {(() => {
          const was = editing?.goalId ? accounts.find((a) => a.id === editing.goalId) : undefined;
          if (!was || was.id === goalId || (newGoal && !was)) return null;
          const holds = walletBalance(props.transactions, was.name);
          const now = newGoal ? goalName || "a new goal" : goals.find((g) => g.id === goalId)?.name;
          const kept = holds > 0 ? `${was.name} keeps its ${formatMoney(holds)}: it does not move by itself. To use it for this plan, move the goal's money in Settings, Goals, taking the plan with it, or pay the plan from ${was.name}.` : `${was.name} holds nothing, so no money is left behind.`;
          return (
            <Alert status="info">
              {now ? `It will save in ${now} from now, not ${was.name}. ` : `It will no longer save in ${was.name}, so it is ${counted ? "counted in safe to spend again" : "not counted in safe to spend, as the switch is off"}. `}
              {kept}
            </Alert>
          );
        })()}
        {/*
          Changed between spending and saving (P11): what that does, and
          what stops it while payments of the other kind are linked.
        */}
        {isEdit && editing && !paying && !paysDebt(editing) && isSave(editing) !== saving && editing.status === "open" && (
          <Alert status={kindProblem ? "over" : "info"} {...(kindProblem ? { title: "Cannot change it yet" } : {})}>
            {kindProblem ??
              (saving
                ? `It was a plan to spend. As a plan to save it leaves the budget's planned spending, is paid by moving money into ${into || "the account you pick"}, and ${into && outOfSpending && setAside ? "safe to spend still holds the money back" : "safe to spend holds nothing back for it"}.`
                : `It was a plan to save into ${editing.into}. As a plan to spend it counts in its month's planned spending, is paid by spending, not by moving money, and ${setAside ? "safe to spend holds it back" : "safe to spend does not hold it back"}.`)}
          </Alert>
        )}
        {isEdit && editing && paying !== paysDebt(editing) && editing.status === "open" && (
          <Alert status={debtProblem && debtId ? "over" : "info"} {...(debtProblem && debtId ? { title: "Cannot change it yet" } : {})}>
            {debtProblem && debtId
              ? debtProblem
              : paying
                ? "As a plan to pay a debt it leaves the budget's planned spending, and is paid by recording a repayment on the line you pick."
                : "It was a plan to pay a debt. As this kind it is paid by spending or by moving money, not by a repayment."}
          </Alert>
        )}
        {limitNote && <Alert status={limitNote.over ? "warn" : "info"}>{limitNote.text}</Alert>}
        {check.notes.filter((n) => !n.startsWith("With no date") && !(paying && n.includes("is held back in safe to spend already"))).map((n) => (
          <Alert key={n} status="info">
            {n}
          </Alert>
        ))}
      </div>
      {confirmDialog}
    </Sheet>
  );
}

function PaySheet(props: {
  plan: Plan;
  view: PlanView;
  reference: ReferenceLists;
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  debts?: readonly Debt[] | undefined;
  asOf: IsoDate;
  dialog: boolean;
  /** Every plan, so an entry counted for another is not offered here. */
  plans: readonly Plan[];
  onClose: () => void;
  /** `makesSaving`: saved as spending, its words name this account; it is made a plan to save first (`misfiledSaving`). */
  onPay: (draft: Draft, settles: boolean, makesSaving?: string) => string | null;
  /** Count an entry already in the ledger instead of adding one (owner, 3 November 2026: "I go to plan to confirm it but the plan recorded new entry"). */
  onCount: (entry: Transaction, makesSaving?: string) => void;
  onEdit: () => void;
}) {
  const { plan: stored, view, reference, asOf, transactions } = props;
  /*
   * Named as a saving into an account, saved as spending: paid, it booked
   * ₱1,500.00 of "Random necessities" for money moved into the bank, and the
   * transfer already made for it was never seen (3 November 2026). The sheet
   * moves the money instead, and the plan is made a saving when it is saved.
   */
  const misfit = misfiledSaving(stored, props.accounts.filter((a) => !a.archived).map((a) => a.name), transactions, props.plans);
  const makesSaving = misfit?.into ?? undefined;
  const plan: Plan = makesSaving ? { ...stored, into: makesSaving, item: "" } : stored;
  // A plan to pay a debt (P12): a repayment on its line, from the line's own wallet unless the plan says one.
  const debt = paysDebt(plan) ? props.debts?.find((d) => d.id === plan.debtId) : undefined;
  const [date, setDate] = useState<IsoDate>(asOf);
  const [amount, setAmount] = useState<Centavos | null>(view.left > 0 ? view.left : plan.amount);
  const goal = plan.goalId ? props.accounts.find((a) => a.id === plan.goalId)?.name : undefined;
  const kindChoices = planKinds(reference, plan.item);
  const kinds = kindChoices.options;
  const guessed = plan.item ? "" : (kindFromHistory(plan.title, transactions, kinds) ?? "");
  const [item, setItem] = useState(plan.item || guessed);
  // The goal it is saved in, else the plan's wallet, else the one this kind usually comes from or that holds enough.
  const [from, setFrom] = useState(goal ?? (debt && !plan.wallet && debt.wallet ? debt.wallet : walletToPayFrom({ wallet: plan.wallet, item: plan.item || item }, view.left || plan.amount, transactions, reference.wallets)));
  const [stopped, setStopped] = useState<string | null>(null);

  const category = reference.bills.some((b) => b === item) ? "Bills" : reference.subscriptions.some((b) => b === item) ? "Subscriptions" : "Spending";
  /*
   * A plan to save is done by moving the money, saved as a transfer into its
   * account: the same row the Add form makes, linked to the plan (P11). It is
   * not spending, so it has no kind.
   */
  const saving = isSave(plan);
  const repaying = paysDebt(plan);
  const draft: Draft = repaying
    ? // The Debt screen's own repayment: what the line owes broken into borrowed and its fees (`asAmountAndFees`).
      asAmountAndFees(
        {
          ...emptyDraft(date),
          flow: "Debt",
          date,
          debtId: plan.debtId,
          debtEffect: "repay",
          fromWallet: from,
          toWallet: "",
          description: plan.title,
          amount,
          notes: `Paid from the Planner: ${plan.title}.`,
        },
        transactions,
      )
    : saving
    ? {
        ...emptyDraft(date),
        flow: "Transfer",
        date,
        fromWallet: from,
        toWallet: plan.into ?? "",
        description: plan.title,
        amount,
        status: "Transferred",
        notes: `Moved from the Planner: ${plan.title}.`,
      }
    : {
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
  const pay = (settles: boolean): void => setStopped(props.onPay(draft, settles, makesSaving));
  /*
   * Already in the entries: the money moved or paid, added from the chat or
   * the Add form. Offered first, so confirming the plan counts that entry
   * rather than adding a second one.
   */
  const counted = (t: Transaction): Centavos => (saving ? t.amount : t.total);
  const already = misfit && !makesSaving ? null : (likelyPayments(plan, transactions, props.plans)[0] ?? null);
  const exact = already !== null && counted(already) === view.left;
  // Its words fit more than one account and nothing tells them apart: nothing is booked until it says which.
  const unsure = misfit !== null && !makesSaving;

  return (
    <Sheet
      title={saving ? `Move money for "${plan.title}"` : `Pay "${plan.title}"`}
      subtitle={
        saving
          ? `Saved as a transfer into ${plan.into}, with the same checks as the Add form, and linked to the plan.`
          : repaying
            ? `Saved as a repayment on ${debt?.name ?? "the debt"}, as the Debt screen saves one, and linked to the plan. It lowers what you owe; it is not spending.`
            : "Saved as an entry, with the same checks as the Add form, and linked to the plan."
      }
      onClose={props.onClose}
      dialog={props.dialog}
      actions={
        unsure ? (
          <>
            <Button onClick={props.onClose}>Cancel</Button>
            <Button variant="primary" onClick={props.onEdit}>
              Edit the plan
            </Button>
          </>
        ) : exact && already ? (
          <>
            <Button onClick={() => pay(true)}>{saving ? "Add a new move anyway" : "Add a new payment anyway"}</Button>
            <Button variant="primary" onClick={() => props.onCount(already, makesSaving)}>
              Count {no(already.recordNumber)}
            </Button>
          </>
        ) : less ? (
          <>
            <Button onClick={() => pay(false)}>{saving ? "Save, more to move later" : "Save, more to pay later"}</Button>
            <Button variant="primary" onClick={() => pay(true)}>
              Save, that settles it
            </Button>
          </>
        ) : (
          <>
            <Button onClick={props.onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => pay(true)}>
              {saving ? "Save the move" : "Save payment"}
            </Button>
          </>
        )
      }
    >
      <div className="fms-planform">
        {unsure && misfit && (
          <Alert status="warn" title="Which account does it go into?">
            {`"${stored.title}" says the money goes into ${misfit.options.join(" or ")}, but it is saved as a plan to spend. Paying it would book spending for money you moved. Edit it, pick To save or move, and the account; then record the move, or count the transfer you already added.`}
          </Alert>
        )}
        {makesSaving && (
          <Alert status="info" title={`Saved as a transfer into ${makesSaving}`}>
            {`"${stored.title}" was saved as a plan to spend, but its words say the money goes into ${makesSaving}. It is recorded as money moved, not spending, and the plan is made a plan to save.${view.goneNote ? " The payment linked to it from the bin is let go." : ""}`}
          </Alert>
        )}
        {already && !unsure && (
          <Alert status={exact ? "warn" : "info"} title={exact ? `${no(already.recordNumber)} is already in your entries` : `Is ${no(already.recordNumber)} this ${saving ? "move" : "payment"}?`} action={exact ? undefined : <Button size="sm" onClick={() => props.onCount(already, makesSaving)}>Count it</Button>}>
            {`${no(already.recordNumber)}, ${formatMoney(counted(already))} on ${formatMedium(already.date)}${already.description ? `, "${already.description.slice(0, 48)}"` : ""}${saving ? `, ${already.fromWallet || "income"} to ${already.toWallet}` : already.fromWallet ? `, from ${already.fromWallet}` : ""}, looks like it. ${exact ? `Count it, and no second entry is added. Add a new one only if you ${saving ? "moved the money" : "paid"} twice.` : "Count it instead of adding a new entry, or save below if this is another one."}`}
          </Alert>
        )}
        <div className="fms-planform-pair">
          <Field label={saving ? "Amount moved" : "Amount paid"} htmlFor="pay-amount">
            <AmountInput id="pay-amount" value={amount} onChange={setAmount} />
          </Field>
          <Field label={saving ? "Moved on" : "Paid on"} htmlFor="pay-date">
            <input id="pay-date" type="date" value={date} max={asOf} onChange={(e) => setDate(e.target.value)} className="t-body fms-control" />
          </Field>
        </div>
        <div className="fms-planform-pair">
          <Field label={saving ? "From" : "Paid from"} help={holds !== null ? `${from} holds ${formatMoney(holds)}.` : undefined}>
            <Select
              value={from || NO_WALLET}
              onChange={(v) => setFrom(v === NO_WALLET ? "" : v)}
              options={[NO_WALLET, ...planWallets(reference, goal ?? "").options]}
              groups={planWallets(reference, goal ?? "").groups}
              ariaLabel="Paid from"
            />
          </Field>
          {saving || repaying ? (
            <Field label={saving ? "Into" : "Paid to"}>
              <p className="t-body" style={{ margin: 0, padding: "var(--space-2) 0" }}>
                {saving ? plan.into : (debt?.name ?? "A debt no longer in Settings")}
              </p>
            </Field>
          ) : (
            <Field label="Kind" help={!plan.item && item && item === guessed ? "Picked from your past entries like it, as the plan has no kind. Check it." : undefined}>
              <Select value={item || NO_KIND} onChange={(v) => setItem(v === NO_KIND ? "" : v)} options={[NO_KIND, ...kinds]} groups={kindChoices.groups} ariaLabel="Kind of spending" searchable />
            </Field>
          )}
        </div>
        {less && (
          <Alert status="info">
            {saving
              ? `${formatMoney(view.left - (amount ?? 0))} less than is left of it. "More to move later" keeps it open; "that settles it" marks it done for less.`
              : `${formatMoney(view.left - (amount ?? 0))} less than is left of it. "More to pay later" keeps it open as part paid; "that settles it" marks it paid for less.`}
          </Alert>
        )}
        {amount !== null && amount > view.left && view.left > 0 && <Alert status="info">{`${formatMoney(amount - view.left)} more than was planned. It is marked paid, and says so.`}</Alert>}
        {holds !== null && amount !== null && holds < amount && (
          <Alert status="warn" title={`${from} holds ${formatMoney(holds)}`}>
            {saving ? "Moving" : "Paying"} {formatMoney(amount)} from it takes it below zero. {saving ? "Move it from another wallet, move part now, or move the date." : "Pay from another wallet, pay part now, or move the date."}
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

function MoveSheet(props: { plan: Plan; view?: PlanView | undefined; asOf: IsoDate; dialog: boolean; onClose: () => void; onMove: (to: IsoDate, kind: DueKind) => void }) {
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
  /*
   * A move is to a later day: one already gone leaves it overdue, which is no
   * move at all. To say it was really due earlier, Edit it (27 October 2026).
   */
  const gone = valid && when.kind !== "none" && dueFor(when.kind, to) < asOf;
  const late = !undated && dueFor(dueKindOf(plan), plan.due) < asOf;
  return (
    <Sheet
      title={`Move "${plan.title}"`}
      subtitle={late ? `It was due ${whenOf(plan).replace(/^S/, "s")}, which has passed${props.view?.state === "overdue" || plan.status === "open" ? ", so it shows as overdue" : ""}. Pick today or a later day; Cancel keeps it as it is.` : `Now ${byWhen(plan)}. Each date change is kept in its history.`}
      onClose={props.onClose}
      dialog={props.dialog}
      actions={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          {/* A cleared date picker gives "": never saved as a day (27 October 2026 error pass). */}
          <Button variant="primary" onClick={() => props.onMove(to, when.kind)} disabled={same || !valid || gone}>
            {!valid ? "Pick a day" : gone ? "Pick today or later" : when.kind === "none" ? "Save with no date" : `Move to ${whenOf({ due: to, dueKind: when.kind })}`}
          </Button>
        </>
      }
    >
      <div className="fms-planform">
        {quick.length > 0 && (
          <SegmentedControl options={quick.map(([label, d]) => ({ id: d, label }))} value={when.kind === "day" ? (quick.find(([, d]) => d === to)?.[1] ?? "") : ""} onChange={(d) => setWhen({ kind: "day", due: d })} />
        )}
        <WhenPicker value={when} onChange={setWhen} asOf={asOf} id="move-to" error={gone ? `${whenOf({ due: dueFor(when.kind, to), dueKind: when.kind })} has passed. Pick today or a later day, or Edit the plan to change when it was due.` : undefined} />
        {movesWords(plan) && <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>{movesWords(plan)}.</p>}
      </div>
    </Sheet>
  );
}

/**
 * "Link a payment I added": an entry already in the ledger counted as the
 * plan's. Only entries of its own kind are listed and found: spending for a
 * plan to spend, money moved into its account for a saving, a repayment on
 * its line for a debt. It listed spending only, so a plan to save could not
 * find the transfer made for it (owner, 3 November 2026: "make sure this
 * buttons works"). A plan saved as spending whose words name the account
 * (`misfiledSaving`) lists the money moved there, and is made a saving when
 * it is linked.
 */
function LinkSheet(props: {
  plan: Plan;
  plans: readonly Plan[];
  transactions: readonly Transaction[];
  /** The open accounts' names (`misfiledSaving`). */
  accounts: readonly string[];
  dialog: boolean;
  onClose: () => void;
  onLink: (ids: string[], settles: boolean, makesSaving?: string) => void;
}) {
  const { transactions } = props;
  const misfit = misfiledSaving(props.plan, props.accounts, transactions, props.plans);
  const makesSaving = misfit?.into ?? undefined;
  const plan: Plan = makesSaving ? { ...props.plan, into: makesSaving, item: "" } : props.plan;
  const saving = isSave(plan);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const linked = new Set(props.plans.flatMap((p) => p.entryIds));
  const ofKind = (t: Transaction): boolean => (saving ? (t.type === "Transfer" || t.type === "Revenue") && paysPlan(plan, t) : paysDebt(plan) ? paysPlan(plan, t) : t.type === "Spending");
  // What one entry counts for it: what was moved, the whole repayment with its interest row, or the entry with its fee.
  const countOf = (t: Transaction): Centavos => paidSoFar({ ...plan, entryIds: [t.id] }, transactions).amount;
  const left = Math.max(0, plan.amount - paidSoFar(plan, transactions).amount) || plan.amount;
  const likely = likelyPayments(plan, transactions, props.plans);
  const found = query.trim()
    ? transactions
        .filter((t) => ofKind(t) && !linked.has(t.id))
        .filter((t) => {
          const q = query.trim().toLowerCase().replace(/^#/, "");
          return String(t.recordNumber) === q.replace(/^0+/, "") || `${t.item} ${t.description} ${t.fromWallet} ${t.toWallet}`.toLowerCase().includes(q);
        })
        .slice(-8)
        .reverse()
    : likely;
  const toggle = (id: string): void => setPicked((was) => (was.includes(id) ? was.filter((x) => x !== id) : [...was, id]));
  const sum = picked.reduce((s, id) => {
    const t = transactions.find((x) => x.id === id);
    return s + (t ? countOf(t) : 0);
  }, 0);
  const what = (t: Transaction): string => (saving ? `${t.fromWallet || "Income"} to ${t.toWallet}` : t.type === "Debt" ? `Repayment from ${t.fromWallet || "no wallet"}` : t.item || "No kind");
  return (
    <Sheet
      title={`Link ${saving ? "money moved" : "a payment"} to "${plan.title}"`}
      subtitle={`For ${saving ? `a transfer into ${plan.into}` : paysDebt(plan) ? "a repayment" : "a payment"} already in your entries, so it is not entered twice.`}
      onClose={props.onClose}
      dialog={props.dialog}
      actions={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          {sum > 0 && sum < left && (
            <Button onClick={() => props.onLink(picked, true, makesSaving)}>Link, that settles it</Button>
          )}
          <Button variant="primary" disabled={picked.length === 0} onClick={() => props.onLink(picked, false, makesSaving)}>
            Link {picked.length > 0 ? formatMoney(sum) : ""}
          </Button>
        </>
      }
    >
      <div className="fms-planform">
        {makesSaving && (
          <Alert status="info" title={`Linked, it becomes a plan to save into ${makesSaving}`}>
            {`"${props.plan.title}" was saved as a plan to spend, but its words say the money goes into ${makesSaving}, so money moved there is listed. Linking one makes it a plan to save.${paidSoFar(props.plan, transactions).gone.length > 0 ? " The payment linked to it from the bin is let go." : ""}`}
          </Alert>
        )}
        {misfit && !makesSaving && (
          <Alert status="warn" title="Which account does it go into?">
            {`Its words say ${misfit.options.join(" or ")}, but it is saved as a plan to spend, so only spending is listed. Edit it first, pick To save or move and the account, then link the transfer.`}
          </Alert>
        )}
        <Field label="Find it" help={query.trim() ? undefined : likely.length > 0 ? "The likely ones, by kind, words and amount." : "Nothing looks like it yet. Search by its record number or words."}>
          <TextInput value={query} onChange={setQuery} placeholder={saving ? "Entry number or words, like deposit" : "Entry number or words, like tuition"} />
        </Field>
        <ul className="fms-planpick">
          {found.map((t) => (
            <li key={t.id}>
              <label className="fms-planpick-row">
                <input type="checkbox" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} />
                <span className="t-caption">
                  {no(t.recordNumber)} · {formatMedium(t.date)} · {what(t)}
                  {t.description && t.description !== t.item ? ` (${t.description.slice(0, 40)})` : ""}
                </span>
                <Money value={countOf(t)} size="s" />
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
