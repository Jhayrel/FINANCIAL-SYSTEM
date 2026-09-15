/**
 * The activity trail: what happened, when, and who did it.
 *
 * Newest first and grouped by day, filterable by who did it and what kind of
 * change it was, with an edit shown field by field. Nothing on this screen
 * writes: the collection is append only at the database, so there is no
 * button here that could change the record even if one were wanted.
 */

import { useEffect, useMemo, useState } from "react";

import { Icon, type IconName } from "../components/Icon";
import { Alert, Button, Card, EmptyState, Placeholder } from "../components/primitives";
import { activityStore } from "../data/activityStore";
import type { ActivityEvent, Actor } from "../domain/activity";
import { factChanges, readRow } from "../domain/activityRead";

type Who = Actor | "all";
type Kind = "all" | "added" | "changed" | "binned" | "budget" | "settings";

/** Enough to scan in one go. Three hundred rows at once was a wall. */
const PAGE = 50;

const WHO: readonly { id: Who; label: string; phrase: string }[] = [
  { id: "all", label: "Everyone", phrase: "" },
  { id: "owner", label: "You", phrase: " by you" },
  { id: "ai", label: "Assistant", phrase: " by the assistant" },
];

const KIND: readonly {
  id: Kind;
  label: string;
  phrase: string;
  match: (action: string) => boolean;
}[] = [
  { id: "all", label: "All", phrase: "Nothing done", match: () => true },
  { id: "added", label: "Added", phrase: "Nothing added", match: (a) => a === "transaction.create" },
  { id: "changed", label: "Changed", phrase: "Nothing changed", match: (a) => a === "transaction.update" },
  {
    id: "binned",
    label: "Bin",
    phrase: "Nothing binned or restored",
    match: (a) => a === "transaction.bin" || a === "transaction.restore",
  },
  // Budgets and limits: set, changed, corrected once closed, or undone.
  { id: "budget", label: "Budget", phrase: "No budget changed", match: (a) => a === "budget.update" },
  { id: "settings", label: "Settings", phrase: "No settings changed", match: (a) => a.startsWith("settings.") },
];

/** The calendar day an event happened on, on this device, as YYYY-MM-DD. */
function dayOf(at: string | Date): string {
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return "";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * "Today", "Yesterday", or the date written out.
 *
 * Measured against the real clock, not the ledger's as-of date: an event is
 * stamped when it happened, so "today" here means the day you are reading it.
 */
function dayLabel(key: string, now: Date): string {
  if (!key) return "Undated";
  if (key === dayOf(now)) return "Today";
  if (key === dayOf(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return new Date(`${key}T00:00:00`).toLocaleDateString("en-PH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** The time of day. The day itself is the heading above. */
function timeOf(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

/** "Sep 6, 2026", for the day an entry is for. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * What kind of change, as a shape. Always grey: colour here would mean
 * direction of money (rule D3), and binning an expense is not a gain.
 */
function iconFor(action: string): IconName {
  if (action === "transaction.create") return "add";
  if (action === "transaction.update") return "edit";
  if (action === "transaction.bin") return "bin";
  if (action === "transaction.restore") return "ledger";
  if (action.startsWith("ai.")) return "ai";
  return "settings";
}

/**
 * Where the money was and which day the entry is for, in words.
 *
 * This used to be the stored line itself under every event, "After
 * 2026-09-06 | Spending | Maya | - | Dito Prepaid | PHP 199.00 | Paid", which
 * repeated the item and amount the summary had just said, in pipes.
 */
function factsLine(e: ActivityEvent): string | null {
  const facts = readRow(e.after ?? e.before);
  if (!facts) return null;
  const where = facts.from && facts.to ? `${facts.from} to ${facts.to}` : facts.from || facts.to;
  return [facts.type, where, facts.date && `for ${shortDate(facts.date)}`].filter(Boolean).join(" · ");
}

export function Activity({
  uid,
  reloadKey,
  onAdd,
}: {
  uid: string | null;
  reloadKey: number;
  /** Where the empty trail sends you: the one thing that fills it. */
  onAdd?: (() => void) | undefined;
}) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [who, setWho] = useState<Who>("all");
  const [kind, setKind] = useState<Kind>("all");
  const [limit, setLimit] = useState(PAGE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setFailed(null);
    activityStore(uid)
      .recent()
      .then((found) => {
        if (live) setEvents(found);
      })
      .catch((e: Error) => {
        if (live) {
          setEvents([]);
          setFailed(e.message);
        }
      });
    return () => {
      live = false;
    };
  }, [uid, reloadKey, attempt]);

  // A new filter starts from the top of its own list.
  useEffect(() => setLimit(PAGE), [who, kind]);

  const total = events?.length ?? 0;

  const byWho = useMemo(
    () => (events ?? []).filter((e) => who === "all" || e.actor === who),
    [events, who],
  );

  /** How many of each kind, for whoever is picked: the filter says what it holds. */
  const kindCounts = useMemo(
    () =>
      Object.fromEntries(KIND.map((k) => [k.id, byWho.filter((e) => k.match(e.action)).length])) as Record<
        Kind,
        number
      >,
    [byWho],
  );

  const shown = useMemo(() => {
    const test = KIND.find((k) => k.id === kind)?.match ?? (() => true);
    return byWho.filter((e) => test(e.action));
  }, [byWho, kind]);

  const visible = shown.slice(0, limit);

  /** Consecutive runs of one day. The store hands them over newest first. */
  const days = useMemo(() => {
    const groups: { key: string; events: ActivityEvent[] }[] = [];
    for (const e of visible) {
      const key = dayOf(e.at);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.events.push(e);
      else groups.push({ key, events: [e] });
    }
    return groups;
    // `visible` is a fresh slice each render; these are what it is made from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, limit]);

  /** The whole trail at a glance, whatever the filters are showing. */
  const summary = useMemo(() => {
    const list = events ?? [];
    const count = (test: (e: ActivityEvent) => boolean): number => list.filter(test).length;
    return {
      added: count((e) => e.action === "transaction.create"),
      changed: count((e) => e.action === "transaction.update"),
      binned: count((e) => e.action === "transaction.bin"),
      restored: count((e) => e.action === "transaction.restore"),
      settings: count((e) => e.action.startsWith("settings.")),
      budget: count((e) => e.action === "budget.update"),
      assistant: count((e) => e.actor === "ai"),
      days: new Set(list.map((e) => dayOf(e.at))).size,
      since: list[list.length - 1]?.at,
    };
  }, [events]);

  const filtered = who !== "all" || kind !== "all";
  const now = new Date();

  const nothingMatches = `${KIND.find((k) => k.id === kind)?.phrase ?? "Nothing done"}${
    WHO.find((w) => w.id === who)?.phrase ?? ""
  } in this trail.`;

  return (
    <div className={uid ? "fms-activity" : "fms-activity fms-activity--note"}>
      {!uid && (
        <Alert status="info" title="Kept for this session only">
          You are not signed in, so this trail is gone when the page closes. Signed in, it is
          written to your own database, where it can be added to and never changed.
        </Alert>
      )}

      <Card
        title="What happened"
        subtitle="Newest first. Nothing here can be edited or deleted, by you or by anything else."
        action={
          total > 0 ? (
            <span className="t-micro fms-badge fms-badge--count">
              {filtered ? `${shown.length} of ${total}` : `${total} ${total === 1 ? "event" : "events"}`}
            </span>
          ) : undefined
        }
        padded={false}
      >
        {total > 0 && !failed && (
          <div className="fms-acttools">
            <Segments label="Who did it" options={WHO} value={who} onChange={setWho} />
            <Segments
              label="What kind of change"
              options={KIND}
              value={kind}
              onChange={setKind}
              counts={kindCounts}
            />
          </div>
        )}

        {events === null ? (
          <div className="fms-actlist" role="status" aria-label="Loading the activity trail">
            <Placeholder height={20} width="55%" />
            <Placeholder height={20} width="80%" />
            <Placeholder height={20} width="40%" />
          </div>
        ) : failed ? (
          <div className="fms-actlist">
            <Alert
              status="over"
              title="The activity trail could not be read"
              action={
                <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
                  Try again
                </Button>
              }
            >
              {failed}. Everything else still works, and no entry has been lost.
            </Alert>
          </div>
        ) : total === 0 ? (
          <EmptyState
            message="Nothing recorded yet. Add, change or bin an entry and it shows here, with the time and whether you typed it or the assistant read it."
            action={
              onAdd ? (
                <Button variant="primary" onClick={onAdd}>
                  Add an entry
                </Button>
              ) : undefined
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState
            message={nothingMatches}
            action={
              <Button
                onClick={() => {
                  setWho("all");
                  setKind("all");
                }}
              >
                Show everything
              </Button>
            }
          />
        ) : (
          <div className="fms-actlist">
            {days.map((group) => {
              const label = dayLabel(group.key, now);
              return (
                <section key={group.key || "undated"} aria-label={label}>
                  <h3 className="t-label fms-actday-title">
                    <span>{label}</span>
                    <span className="t-micro fms-actday-count">{group.events.length}</span>
                  </h3>
                  <ol className="fms-acts">
                    {group.events.map((e) => (
                      <EventRow key={e.id} event={e} />
                    ))}
                  </ol>
                </section>
              );
            })}

            {shown.length > visible.length && (
              <div className="fms-actmore">
                <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                  Showing {visible.length} of {shown.length}
                </span>
                <Button onClick={() => setLimit((n) => n + PAGE)}>
                  Show {Math.min(PAGE, shown.length - visible.length)} more
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/*
        The trail at a glance, in the width a wide screen left empty. Each
        count is also its filter: one click shows just those.
      */}
      {total > 0 && !failed && (
        <aside className="fms-actrail" aria-label="The trail at a glance">
          <Card
            title="At a glance"
            subtitle={`${summary.days} ${summary.days === 1 ? "day" : "days"} with changes${
              summary.since ? `, since ${shortDate(dayOf(summary.since))}` : ""
            }`}
          >
            <ul className="fms-actsum">
              {(
                [
                  ["added", "Added", summary.added, "add"],
                  ["changed", "Changed", summary.changed, "edit"],
                  // One row, because it is one filter: two rows lit up together.
                  ["binned", "Binned or restored", summary.binned + summary.restored, "bin"],
                  ["budget", "Budget changed", summary.budget, "budget"],
                  ["settings", "Settings changed", summary.settings, "settings"],
                ] as const
              ).map(([id, label, n, icon]) => (
                <li key={label}>
                  <button
                    type="button"
                    className="fms-actsum-row"
                    aria-pressed={kind === id}
                    onClick={() => setKind(kind === id ? "all" : id)}
                  >
                    <span aria-hidden className="fms-acticon">
                      <Icon name={icon} size={16} />
                    </span>
                    <span className="t-body fms-actsum-label">{label}</span>
                    <span className="t-num-s">{n}</span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="fms-actwho">
              <div className="fms-actwho-bar" aria-hidden>
                <span style={{ width: `${(summary.assistant / total) * 100}%` }} />
              </div>
              <div className="t-caption fms-actwho-legend">
                <span>Typed by you {total - summary.assistant}</span>
                <span>Read by the assistant {summary.assistant}</span>
              </div>
            </div>
          </Card>
        </aside>
      )}
    </div>
  );
}

/**
 * One filter, with exactly one answer showing.
 *
 * The filters were two rows of loose chips with the chosen one marked by a
 * slightly greener border, so "Everything" and "Settings" both looked picked
 * and nothing said the rows asked two different questions.
 */
function Segments<T extends string>({
  label,
  options,
  value,
  onChange,
  counts,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  counts?: Record<T, number>;
}) {
  return (
    <div className="fms-segmented fms-segmented--scroll" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={`fms-seg ${value === o.id ? "t-body-strong" : "t-body"}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
          {counts && <span className="t-micro fms-segcount">{counts[o.id]}</span>}
        </button>
      ))}
    </div>
  );
}

function EventRow({ event: e }: { event: ActivityEvent }) {
  const changes = e.action === "transaction.update" ? factChanges(e.before, e.after) : [];
  const facts = factsLine(e);

  return (
    <li className="fms-act">
      <span aria-hidden className="fms-acticon">
        <Icon name={iconFor(e.action)} size={16} />
      </span>
      <div className="fms-actmain">
        <div className="fms-acthead">
          <span className="t-body fms-actsummary">{e.summary}</span>
          <time className="t-caption fms-actwhen" dateTime={e.at}>
            {timeOf(e.at)}
          </time>
        </div>
        <div className="t-caption fms-actmeta">
          <span className={e.actor === "ai" ? "t-micro fms-actor fms-actor--ai" : "t-micro fms-actor"}>
            {e.actor === "ai" ? "Assistant" : "You"}
          </span>
          {facts && <span>{facts}</span>}
          {e.model && <span>{e.model}</span>}
        </div>
        {changes.length > 0 && (
          <dl className="t-caption fms-actchanges">
            {changes.map((c) => (
              <div key={c.key} className="fms-actchange">
                <dt>{c.label}</dt>
                <dd>
                  <span className="fms-actold">{c.before || "blank"}</span>
                  <span aria-hidden className="fms-actarrow">
                    →
                  </span>
                  <span>{c.after || "blank"}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </li>
  );
}

/** The button that opens this screen, for use where an event is mentioned. */
export function ActivityHint({ onOpen }: { onOpen: () => void }) {
  return (
    <Button size="sm" onClick={onOpen}>
      See the activity trail
    </Button>
  );
}
