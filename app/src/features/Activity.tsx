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
import { Alert, Button, Card, EmptyState } from "../components/primitives";
import { FilterChip } from "../components/FilterChip";
import { LoadingRows } from "../components/LoadingScreen";
import { activityStore } from "../data/activityStore";
import { saveFile } from "../data/download";
import type { ActivityEvent, Actor } from "../domain/activity";
import { factChanges, readRow } from "../domain/activityRead";
import { eventDetails, trailFilename, trailSummary } from "../domain/activityExport";
import { inPeriod, matchesSearch, PERIODS, type Period } from "../domain/activityFilter";
import { SearchInput } from "../components/forms";

type Who = Actor | "all";
type Kind = "all" | "added" | "changed" | "binned" | "budget" | "planner" | "settings";

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
  // The Planner: plans added, moved, paid, skipped or removed (docs/16-PLANNER.md).
  { id: "planner", label: "Planner", phrase: "Nothing planned or changed in the Planner", match: (a) => a.startsWith("plan.") },
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
  if (action.startsWith("plan.")) return "planner";
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
  // A date range is kept as "2026-10-09 to 2026-10-11": each end said as a date.
  const days = facts.date ? facts.date.split(" to ").map((d) => shortDate(d.trim())).join(" to ") : "";
  return [facts.type, where, days && `for ${days}`].filter(Boolean).join(" · ");
}

export function Activity({
  uid,
  reloadKey,
  onAdd,
  ownerName = "",
}: {
  uid: string | null;
  reloadKey: number;
  /** Where the empty trail sends you: the one thing that fills it. */
  onAdd?: (() => void) | undefined;
  /** Who the PDF is issued to. */
  ownerName?: string;
}) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [who, setWho] = useState<Who>("all");
  const [kind, setKind] = useState<Kind>("all");
  // When and what words: the list and its PDF follow both (owner, 27 October 2026: "the pdf in activity add filter").
  const [period, setPeriod] = useState<Period>("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [attempt, setAttempt] = useState(0);
  const [making, setMaking] = useState(false);
  const [pdfFailed, setPdfFailed] = useState("");

  useEffect(() => {
    let live = true;
    setFailed(null);
    // Signed in: kept up to date as events happen on any device. In the browser alone: read once.
    const stop = activityStore(uid).subscribe(
      (found) => {
        if (live) setEvents(found);
      },
      (e) => {
        if (live) {
          setEvents((was) => was ?? []);
          setFailed(e.message);
        }
      },
    );
    if (stop) {
      return () => {
        live = false;
        stop();
      };
    }
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
  useEffect(() => setLimit(PAGE), [who, kind, period, query]);

  const total = events?.length ?? 0;

  const byWho = useMemo(() => {
    const now = new Date();
    return (events ?? []).filter((e) => (who === "all" || e.actor === who) && inPeriod(e, period, now) && matchesSearch(e, query));
  }, [events, who, period, query]);

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

  const filtered = who !== "all" || kind !== "all" || period !== "all" || query.trim() !== "";

  /*
   * What is shown, every one of it and not only the page on screen, as a PDF
   * (26 October 2026: "i can export it as pdf with all details").
   */
  const savePdf = async (): Promise<void> => {
    setMaking(true);
    setPdfFailed("");
    try {
      const { activityPdf } = await import("../pdf/activityPdf");
      const showing = [
        WHO.find((w) => w.id === who)?.label ?? "Everyone",
        kind === "all" ? "all changes" : (KIND.find((k) => k.id === kind)?.label ?? "").toLowerCase(),
        period === "all" ? "" : (PERIODS.find((p) => p.id === period)?.label ?? "").toLowerCase(),
        query.trim() ? `matching "${query.trim()}"` : "",
      ]
        .filter(Boolean)
        .join(", ");
      const bytes = await activityPdf({ events: shown, showing, issuedTo: ownerName, issuedAt: new Date() });
      saveFile(trailFilename(trailSummary(shown)), bytes as BlobPart, "application/pdf");
    } catch (e) {
      setPdfFailed(`The PDF could not be made (${(e as Error).message || "no reason given"}). Reload the page and try again; nothing in the trail is affected.`);
    } finally {
      setMaking(false);
    }
  };
  const now = new Date();

  const nothingMatches = `${KIND.find((k) => k.id === kind)?.phrase ?? "Nothing done"}${WHO.find((w) => w.id === who)?.phrase ?? ""}${
    period === "all" ? "" : ` ${PERIODS.find((p) => p.id === period)?.phrase ?? ""}`
  }${query.trim() ? ` matching "${query.trim()}"` : ""} in this trail.`;

  return (
    <div className={uid ? "fms-activity" : "fms-activity fms-activity--note"}>
      {!uid && (
        <Alert status="info" title="Kept for this session only">
          You are not signed in, so this trail is gone when the page closes. Signed in, it is
          written to your own database, where it can be added to and never changed.
        </Alert>
      )}

      <Card page
        title="What happened"
        subtitle="Newest first. Nothing here can be edited or deleted, by you or by anything else."
        action={
          total > 0 ? (
            <span className="fms-actactions">
              <span className="t-micro fms-badge fms-badge--count">
                {filtered ? `${shown.length} of ${total}` : `${total} ${total === 1 ? "event" : "events"}`}
              </span>
              {!failed && shown.length > 0 && (
                <Button size="sm" onClick={() => void savePdf()} loading={making} title="Every change shown, with all its details, as a PDF">
                  Save as PDF
                </Button>
              )}
            </span>
          ) : undefined
        }
        padded={false}
      >
        {total > 0 && !failed && (
          <div className="fms-acttools">
            {/*
              One row of dropdowns, on a phone and on a computer, like the
              Database's (style guide 3.14c). The computer also kept its old
              rows of buttons, so it showed every filter twice (owner, 28
              September 2026: "fix the ui it broke like this").
            */}
            <div className="fms-actsearch">
              <SearchInput value={query} onChange={setQuery} placeholder="Search words, #0442 or an amount" />
            </div>
            <div className="fms-dbfilterrow" role="group" aria-label="Filters">
              <FilterChip label="When" value={period} on={period !== "all"} options={PERIODS} onChange={(id) => setPeriod(id as Period)} />
              <FilterChip
                label="Who did it"
                value={who}
                on={who !== "all"}
                options={WHO}
                onChange={(id) => setWho(id as Who)}
              />
              <FilterChip
                label="What kind of change"
                value={kind}
                on={kind !== "all"}
                options={KIND.map((k) => ({ id: k.id, label: `${k.id === "all" ? "All changes" : k.label} (${kindCounts[k.id]})` }))}
                onChange={(id) => setKind(id as Kind)}
              />
            </div>
            {/* A phone has no card heading to hold it, so it sits under the filters there. */}
            {shown.length > 0 && (
              <div className="fms-actpdf-phone">
                <Button size="sm" fullWidth onClick={() => void savePdf()} loading={making}>
                  Save {shown.length === total ? "all" : `these ${shown.length}`} as PDF
                </Button>
              </div>
            )}
          </div>
        )}

        {pdfFailed && (
          <div className="fms-actlist">
            <Alert status="over" title="The PDF was not made">
              {pdfFailed}
            </Alert>
          </div>
        )}
        {events === null ? (
          <div className="fms-actlist">
            <LoadingRows count={6} label="Loading the activity trail" />
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

function EventRow({ event: e }: { event: ActivityEvent }) {
  const changes = e.action === "transaction.update" ? factChanges(e.before, e.after) : [];
  const facts = factsLine(e);
  /*
   * Everything the event holds, opened with a tap on the row: when to the
   * second, how it came in, which model, and the entry field by field
   * (26 October 2026: "add more details"). Closed, the row reads as before.
   */
  const [open, setOpen] = useState(false);

  return (
    <li className="fms-act">
      <span aria-hidden className="fms-acticon">
        <Icon name={iconFor(e.action)} size={16} />
      </span>
      <div className="fms-actmain">
        <button type="button" className="fms-actrow" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="fms-acthead">
            <span className="t-body fms-actsummary">{e.summary}</span>
            <time className="t-caption fms-actwhen" dateTime={e.at}>
              {timeOf(e.at)}
            </time>
          </span>
          <span className="t-caption fms-actmeta">
            <span className={e.actor === "ai" ? "t-micro fms-actor fms-actor--ai" : "t-micro fms-actor"}>
              {e.actor === "ai" ? "Assistant" : "You"}
            </span>
            {facts && <span>{facts}</span>}
            {e.model && <span>{e.model}</span>}
            <span aria-hidden className="fms-actchevron">
              <Icon name="chevronDown" size={14} />
            </span>
          </span>
        </button>
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
        {open && (
          <dl className="t-caption fms-actfacts">
            {eventDetails(e).map((d) => (
              <div key={d.label} className="fms-actfact">
                <dt>{d.label}</dt>
                <dd>{d.value}</dd>
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
