/**
 * The month's plans against what its budget has left, as the Budget screen
 * and Insights both show it (owner, 2 November 2026: "Add the planner too in
 * insight and Budgeting like make sure it fit and accurate also make sure it
 * sync"). One component, fed the same `plannedForBudget` figure, so the two
 * screens cannot disagree.
 */
import { useState } from "react";
import { Icon } from "../components/Icon";
import { Money } from "../components/primitives";
import { MONTH_NAMES } from "../domain/dates";
import { formatMoney, type Centavos } from "../domain/money";
import type { PlannedMonth, PlanView } from "../domain/planner";

/** How many of the month's plans show before Show all: the overdue and the soonest. */
const PLANS_SHOWN = 5;

/**
 * What the Planner has for the month, against what its budget has left: the
 * plans, and how much of the budget they take (27 October 2026, "Add also
 * the planned in budget"). Nothing here is spent yet, so the bars above do
 * not move; this says what is coming out of what they show as left.
 */
export function PlannedInMonth({
  planned,
  undated,
  name,
  noPlan,
  spendingLeft,
  billsLeft,
  room,
  asOf,
  onOpenPlanner,
  where = "budget",
}: {
  planned: PlannedMonth;
  /** Open plans with no date yet, in no month's figure. */
  undated: readonly PlanView[];
  name: string;
  noPlan: boolean;
  spendingLeft: Centavos;
  billsLeft: Centavos;
  /** How far the money lets the spending budget rise (`incomeBudget`), for the month running; null otherwise. */
  room: Centavos | null;
  asOf: string;
  onOpenPlanner?: (() => void) | undefined;
  /** On the Budget screen the budget is set on the right; elsewhere it is set on the Budget screen. */
  where?: "budget" | "elsewhere";
}) {
  // The soonest few, the rest in place on a tap (owner, 27 October 2026: "what if I have a lot of plan").
  const [all, setAll] = useState(false);
  const shown = all ? planned.views : planned.views.slice(0, PLANS_SHOWN);
  /** "Oct 27", "Any day in Oct": short, so a long name keeps its room on a phone. */
  const shortWhen = (v: PlanView): string => {
    const kind = v.plan.dueKind ?? "day";
    const m = (MONTH_NAMES[Number(v.plan.due.slice(5, 7)) - 1] ?? "").slice(0, 3);
    return kind === "month" ? `Any day in ${m}` : kind === "year" ? `Sometime in ${v.plan.due.slice(0, 4)}` : `${m} ${Number(v.plan.due.slice(8, 10))}`;
  };
  // The month's spending plans by how sure they are; together they are `planned.spending`.
  const sumOf = (list: readonly PlanView[]): Centavos => list.reduce((s, v) => s + v.left, 0);
  const sure = sumOf(planned.spendingViews.filter((v) => v.plan.setAside && !v.plan.goalId));
  const maybe = sumOf(planned.spendingViews.filter((v) => !v.plan.setAside && !v.plan.goalId));
  const fromGoal = sumOf(planned.spendingViews.filter((v) => Boolean(v.plan.goalId)));
  const fit = (part: string, plannedPart: Centavos, left: Centavos): string => {
    if (plannedPart <= 0) return "";
    if (left >= plannedPart) return `The ${part} budget has ${formatMoney(left)} left; with ${formatMoney(plannedPart)} planned, ${formatMoney(left - plannedPart)} is free for the rest.`;
    const short = plannedPart - Math.max(0, left);
    /*
     * "Raise it" only as far as the money goes: raised past it, the budget
     * promises what the wallets cannot pay, and "Budget and your money"
     * below said to lower it (27 October 2026).
     */
    if (part === "spending" && room !== null && room < short)
      return `${formatMoney(plannedPart)} planned is ${formatMoney(short)} more than the spending budget has left, and your money ${room > 0 ? `lets it rise by only ${formatMoney(room)}` : "does not let it rise"}. Move a plan to a later month, or skip one.`;
    return `${formatMoney(plannedPart)} planned is ${formatMoney(short)} more than the ${part} budget has left. Raise it ${where === "budget" ? "on the right" : "on the Budget screen"}, or move a plan to another month.`;
  };
  const words = noPlan
    ? `No budget for ${name} yet: "Usual + plans" ${where === "budget" ? "on the right" : "on the Budget screen"} sets one with them in it.`
    : [fit("spending", planned.spending, spendingLeft), fit("bills", planned.billsSubs, billsLeft)].filter(Boolean).join(" ");
  const over = !noPlan && (planned.spending > Math.max(0, spendingLeft) || planned.billsSubs > Math.max(0, billsLeft));
  return (
    <section className={where === "budget" ? "fms-budgetplanned" : "fms-budgetplanned is-own"} aria-label={`Planned in ${name}`}>
      {planned.total > 0 && (
      <div className="fms-budgetplanned-head">
        <span className="t-label">Planned in {name}, not paid yet</span>
        <Money value={planned.total} size="s" />
      </div>
      )}
      <ul className="fms-budgetplanned-rows">
        {shown.map((v) => (
          <li key={v.plan.id}>
            <span className="t-body fms-truncate" title={v.plan.title}>
              {v.plan.title}
            </span>
            {/* Whether safe to spend holds its money back: the Budget counts it either way. */}
            <span className="t-caption fms-budgetplanned-when">
              {v.plan.due < asOf ? `${shortWhen(v)}, overdue` : shortWhen(v)}
              {v.plan.goalId ? ", from its goal" : !v.plan.setAside ? ", not set aside" : ""}
            </span>
            <Money value={v.left} size="s" />
          </li>
        ))}
      </ul>
      {planned.views.length > PLANS_SHOWN && (
        <button type="button" className="t-caption fms-linkbtn fms-budgetplanned-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? "Show the soonest only" : `Show all ${planned.views.length} plans: ${planned.views.length - PLANS_SHOWN} more, ${formatMoney(planned.views.slice(PLANS_SHOWN).reduce((s, v) => s + v.left, 0))}`}
        </button>
      )}
      {/*
        The working, from what the spending budget has left: the plans taken
        off by how sure they are (owner, 27 October 2026: "show also the
        calculation of the one with the planner but be accurate because some
        with no date, no exact goal or really just a plan without making sure
        if we will continue with it"). Set aside is held back in safe to
        spend; not set aside may not go ahead; a goal's is spending all the
        same, paid from money saved for it.
      */}
      {!noPlan && planned.spending > 0 && (
        <dl className="t-caption fms-rowfacts fms-budgetplancalc">
          <div>
            <dt>Left of the spending budget</dt>
            <dd>
              <Money value={spendingLeft} size="s" />
            </dd>
          </div>
          {sure > 0 && (
            <div>
              <dt>Plans set aside in safe to spend</dt>
              <dd>
                <Money value={-sure} size="s" tone="var(--ink-2)" />
              </dd>
            </div>
          )}
          {maybe > 0 && (
            <div>
              <dt>Plans not set aside, may not go ahead</dt>
              <dd>
                <Money value={-maybe} size="s" tone="var(--ink-2)" />
              </dd>
            </div>
          )}
          {fromGoal > 0 && (
            <div>
              <dt>Plans paid from a goal</dt>
              <dd>
                <Money value={-fromGoal} size="s" tone="var(--ink-2)" />
              </dd>
            </div>
          )}
          <div className="fms-budgetplancalc-total">
            <dt>Left after {[sure, maybe, fromGoal].filter((x) => x > 0).length > 1 ? "all of them" : "them"}</dt>
            <dd>
              <Money value={spendingLeft - planned.spending} size="s" />
            </dd>
          </div>
          {maybe > 0 && (
            <div>
              <dt>Left if only the plans set aside go ahead</dt>
              <dd>
                <Money value={spendingLeft - sure - fromGoal} size="s" />
              </dd>
            </div>
          )}
        </dl>
      )}
      {words && (
      <p className="t-caption fms-plannote">
        {over && (
          <span className="fms-plannote-icon" style={{ color: "var(--over)" }} aria-hidden>
            <Icon name="statusOver" size={16} />
          </span>
        )}
        <span>{words}</span>
      </p>
      )}
      {undated.length > 0 && (
        <p className="t-caption fms-plannote" style={{ color: "var(--ink-3)" }}>
          <span>
            Not in any month yet, with no date: {undated.slice(0, 4).map((v) => `${v.plan.title} ${formatMoney(v.left)}`).join(", ")}
            {undated.length > 4 ? `, and ${undated.length - 4} more` : ""}. Give {undated.length === 1 ? "it" : "each"} a month on the Planner and it counts there.
          </span>
        </p>
      )}
      {onOpenPlanner && (
        <button type="button" className="t-caption fms-linkbtn" onClick={onOpenPlanner}>
          Open the Planner
        </button>
      )}
    </section>
  );
}
