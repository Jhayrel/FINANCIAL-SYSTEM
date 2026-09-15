/**
 * The activity trail: what happened, when, and who did it.
 *
 * Newest first and grouped by day, filterable by who did it and what kind of
 * thing it was, with an edit's before and after both shown. Nothing on this
 * screen writes: the collection is append only at the database, so there is
 * no button here that could change the record even if one were wanted.
 */

import { useEffect, useMemo, useState } from "react";

import {
  Alert,
  Button,
  Card,
  EmptyState,
  Placeholder,
  SegmentedControl,
} from "../components/primitives";
import { activityStore } from "../data/activityStore";
import type { ActivityEvent, Actor } from "../domain/activity";

type Who = Actor | "all";
type Kind = "all" | "added" | "changed" | "binned" | "settings";

/**
 * Two filters, each under a word saying what it filters.
 *
 * They used to be two unlabelled rows of chips with the chosen one marked by
 * a slightly greener border, so "Everything" and "Settings" both looked
 * picked and nothing said the rows were separate questions.
 */
const WHO: readonly { id: Who; label: string; phrase: string }[] = [
  { id: "all", label: "Everyone", phrase: "" },
  { id: "owner", label: "You", phrase: " by you" },
  { id: "ai", label: "The assistant", phrase: " by the assistant" },
];

const KIND: readonly {
  id: Kind;
  label: string;
  phrase: string;
  match: (action: string) => boolean;
}[] = [
  { id: "all", label: "All kinds", phrase: "Nothing done", match: () => true },
  {
    id: "added",
    label: "Added",
    phrase: "Nothing added",
    match: (a) => a === "transaction.create",
  },
  {
    id: "changed",
    label: "Changed",
    phrase: "Nothing changed",
    match: (a) => a === "transaction.update",
  },
  {
    id: "binned",
    label: "Binned and restored",
    phrase: "Nothing binned or restored",
    match: (a) => a === "transaction.bin" || a === "transaction.restore",
  },
  {
    id: "settings",
    label: "Settings",
    phrase: "No settings changed",
    match: (a) => a.startsWith("settings."),
  },
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

  const all = events ?? [];

  const shown = useMemo(() => {
    const test = KIND.find((k) => k.id === kind)?.match ?? (() => true);
    return (events ?? []).filter((e) => (who === "all" || e.actor === who) && test(e.action));
  }, [events, who, kind]);

  /** Consecutive runs of one day. The store hands them over newest first. */
  const days = useMemo(() => {
    const groups: { key: string; events: ActivityEvent[] }[] = [];
    for (const e of shown) {
      const key = dayOf(e.at);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.events.push(e);
      else groups.push({ key, events: [e] });
    }
    return groups;
  }, [shown]);

  const filtered = who !== "all" || kind !== "all";
  const byAi = shown.filter((e) => e.actor === "ai").length;
  const now = new Date();

  const count = filtered
    ? `${shown.length} of ${all.length}`
    : `${all.length} ${all.length === 1 ? "event" : "events"}`;

  const nothingMatches = `${KIND.find((k) => k.id === kind)?.phrase ?? "Nothing done"}${
    WHO.find((w) => w.id === who)?.phrase ?? ""
  } in this trail.`;

  const showEverything = (): void => {
    setWho("all");
    setKind("all");
  };

  return (
    <div className="fms-activity">
      {!uid && (
        <Alert status="info" title="Kept for this session only">
          You are not signed in, so this trail is gone when the page closes. Signed in, it is
          written to your own database, where it can be added to and never changed.
        </Alert>
      )}

      {all.length > 0 && (
        <div className="fms-actfilters">
          <div className="fms-actfilter">
            <span className="t-label fms-actfilter-label">Who</span>
            <SegmentedControl options={WHO} value={who} onChange={setWho} label="Who did it" scroll />
          </div>
          <div className="fms-actfilter">
            <span className="t-label fms-actfilter-label">What</span>
            <SegmentedControl
              options={KIND}
              value={kind}
              onChange={setKind}
              label="What kind of change"
              scroll
            />
          </div>
        </div>
      )}

      <Card
        title="What happened"
        subtitle={
          all.length > 0 && byAi > 0
            ? `Newest first, ${byAi} from the assistant. Nothing here can be edited or deleted.`
            : "Newest first. Nothing here can be edited or deleted, by you or by anything else."
        }
        action={
          all.length > 0 ? <span className="t-micro fms-badge fms-badge--count">{count}</span> : undefined
        }
      >
        {events === null ? (
          <div className="fms-actloading" role="status" aria-label="Loading the activity trail">
            <Placeholder height={20} width="55%" />
            <Placeholder height={20} width="80%" />
            <Placeholder height={20} width="40%" />
          </div>
        ) : failed ? (
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
        ) : all.length === 0 ? (
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
          <EmptyState message={nothingMatches} action={<Button onClick={showEverything}>Show everything</Button>} />
        ) : (
          <div className="fms-actdays">
            {days.map((group) => {
              const label = dayLabel(group.key, now);
              return (
                <section key={group.key || "undated"} className="fms-actday" aria-label={label}>
                  <h3 className="t-label fms-actday-title">
                    <span>{label}</span>
                    <span className="t-micro fms-actday-count">{group.events.length}</span>
                  </h3>
                  <ol className="fms-acts">
                    {group.events.map((e) => (
                      <li key={e.id} className="fms-act">
                        <div className="fms-acthead">
                          <span className="t-body">{e.summary}</span>
                          <time className="t-caption fms-actwhen" dateTime={e.at}>
                            {timeOf(e.at)}
                          </time>
                        </div>
                        <div className="fms-actmeta t-micro">
                          <span className={e.actor === "ai" ? "fms-actor fms-actor--ai" : "fms-actor"}>
                            {e.actor === "ai" ? "The assistant" : "You"}
                          </span>
                          {e.model && <span className="fms-actmodel">{e.model}</span>}
                        </div>
                        {(e.before || e.after) && (
                          <dl className="fms-actdiff t-caption">
                            {e.before && (
                              <>
                                <dt>Before</dt>
                                <dd>{e.before}</dd>
                              </>
                            )}
                            {e.after && (
                              <>
                                <dt>After</dt>
                                <dd>{e.after}</dd>
                              </>
                            )}
                          </dl>
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>
        )}
      </Card>
    </div>
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
