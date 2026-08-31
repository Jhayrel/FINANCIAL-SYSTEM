/**
 * The activity trail: what happened, when, and who did it.
 *
 * Newest first, filterable by who did it and what kind of thing it was, with
 * an edit's before and after both shown. Nothing on this screen writes: the
 * collection is append only at the database, so there is no button here that
 * could exist even if one were wanted.
 */

import { useEffect, useMemo, useState } from "react";

import { Button } from "../components/primitives";
import { activityStore } from "../data/activityStore";
import type { ActivityEvent, Actor } from "../domain/activity";

/** Filters, as one row of chips rather than a form. */
const WHO: readonly { id: Actor | "all"; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "owner", label: "You" },
  { id: "ai", label: "The assistant" },
];

const KIND: readonly { id: string; label: string; match: (a: string) => boolean }[] = [
  { id: "all", label: "All kinds", match: () => true },
  { id: "added", label: "Added", match: (a) => a === "transaction.create" },
  { id: "changed", label: "Changed", match: (a) => a === "transaction.update" },
  {
    id: "binned",
    label: "Binned and restored",
    match: (a) => a === "transaction.bin" || a === "transaction.restore",
  },
  { id: "settings", label: "Settings", match: (a) => a.startsWith("settings.") },
];

/** "2026-08-31T04:12:09.123Z" reads as nothing. This reads as a time. */
function when(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Activity({ uid, reloadKey }: { uid: string | null; reloadKey: number }) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [who, setWho] = useState<Actor | "all">("all");
  const [kind, setKind] = useState("all");

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
  }, [uid, reloadKey]);

  const shown = useMemo(() => {
    const test = KIND.find((k) => k.id === kind)?.match ?? (() => true);
    return (events ?? []).filter((e) => (who === "all" || e.actor === who) && test(e.action));
  }, [events, who, kind]);

  const byAi = (events ?? []).filter((e) => e.actor === "ai").length;

  return (
    <>
      <div className="fms-actbar">
        <div className="fms-chips">
          {WHO.map((w) => (
            <button
              key={w.id}
              type="button"
              className="fms-chip t-caption"
              aria-pressed={who === w.id}
              onClick={() => setWho(w.id)}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div className="fms-chips">
          {KIND.map((k) => (
            <button
              key={k.id}
              type="button"
              className="fms-chip t-caption"
              aria-pressed={kind === k.id}
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <section className="fms-panel">
        {events === null ? (
          <p className="t-caption" style={{ color: "var(--ink-3)", margin: 0 }}>
            Loading.
          </p>
        ) : failed ? (
          <p className="t-caption" style={{ color: "var(--over)", margin: 0 }}>
            The activity trail could not be read: {failed}. Everything else still works, and no
            entry has been lost.
          </p>
        ) : shown.length === 0 ? (
          <div>
            <p className="t-body" style={{ margin: 0 }}>
              {(events ?? []).length === 0
                ? "Nothing recorded yet."
                : "Nothing matches those filters."}
            </p>
            <p className="t-caption" style={{ color: "var(--ink-3)", margin: "var(--space-2) 0 0" }}>
              {(events ?? []).length === 0
                ? "Add, change or bin an entry and it will appear here, with the date and whether you typed it or the assistant read it."
                : "Choose Everything and All kinds to see the whole trail."}
            </p>
          </div>
        ) : (
          <>
            <p className="t-caption" style={{ color: "var(--ink-3)", margin: "0 0 var(--space-3)" }}>
              {shown.length} {shown.length === 1 ? "event" : "events"}
              {byAi > 0 ? `, ${byAi} from the assistant` : ""}. This record cannot be edited or
              deleted, by you or by anything else.
            </p>
            <ol className="fms-acts">
              {shown.map((e) => (
                <li key={e.id} className="fms-act">
                  <div className="fms-acthead">
                    <span className="t-caption">{e.summary}</span>
                    <span className="t-micro fms-actwhen">{when(e.at)}</span>
                  </div>
                  <div className="fms-actmeta t-micro">
                    <span className={e.actor === "ai" ? "fms-actor fms-actor--ai" : "fms-actor"}>
                      {e.actor === "ai" ? "assistant" : "you"}
                    </span>
                    {e.model && <span>{e.model}</span>}
                  </div>
                  {(e.before || e.after) && (
                    <dl className="fms-actdiff t-micro">
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
          </>
        )}
      </section>

      {!uid && events !== null && (
        <p className="t-caption" style={{ color: "var(--ink-3)", marginTop: "var(--space-3)" }}>
          You are not signed in, so this trail is only for this session and is not saved. Signed in,
          it is written to your own database, where it can be added to and never changed.
        </p>
      )}
    </>
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
