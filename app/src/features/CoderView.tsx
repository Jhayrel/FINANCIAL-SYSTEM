/**
 * Coderview: the whole database as plain text, for debugging.
 *
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  TEMPORARY. DELETE THIS FILE WHEN THE SYSTEM IS DONE.                 ║
 * ║                                                                       ║
 * ║  Added 2026-08-31 to read the assistant's own record while fixing     ║
 * ║  the assistant. It is a debugging tool, not a feature, and it should  ║
 * ║  not outlive the debugging.                                           ║
 * ║                                                                       ║
 * ║  The removal is six steps and cannot break a screen:                  ║
 * ║  docs/11-CODERVIEW-IS-TEMPORARY.md                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * ── What this is for ──────────────────────────────────────────────────────
 *
 * The assistant keeps a record of everything it proposed and everything you
 * did about it, in `users/{uid}/ai`. That record is the only honest answer to
 * "why does it keep getting this wrong": it holds the sentences you typed,
 * what it guessed, and what you changed the guess to. None of it is reachable
 * without your signed-in session, so there was no way to read it while fixing
 * the thing it describes.
 *
 * This screen reads every collection the app has and prints them, unpaged and
 * unsummarised, so the whole database can be handed to whoever is debugging.
 *
 * ── Reached by URL, not by a nav item ─────────────────────────────────────
 *
 *     http://localhost:5173/?coderview
 *
 * It is a debugging tool, not a feature. It is not in the sidebar, it has no
 * design, and nothing here writes: every read is a read.
 *
 * ── Why it is safe to have, and how to keep it that way ───────────────────
 *
 * The dump contains your entire financial history. It is therefore:
 *
 *   - never written to disk by the app. You save it yourself, deliberately,
 *     with the button, into a folder that git ignores.
 *   - scrubbed of anything key-shaped on the way out, as a backstop. No key
 *     should ever be in Firestore (CLAUDE.md §2 puts them in server-side
 *     environment secrets), so a hit here is a bug worth knowing about, and
 *     the scrub means finding out does not publish it.
 *   - readable only by you. The Firestore rules allow exactly one account,
 *     so a signed-out browser at this URL sees the sign-in screen like every
 *     other one.
 *
 * The suggested place to save it is `MY THINGS/CODERVIEW/`, because that
 * whole folder is in `.gitignore`, which makes an accidental commit
 * impossible rather than merely unlikely.
 */

import { useEffect, useState } from "react";

import { collection, doc, getDoc, getDocs } from "firebase/firestore";

import { firestore } from "../data/firebase";
import { activityStore } from "../data/activityStore";
import { chatStore } from "../data/chatStore";
import { aiLogStore } from "../data/aiLogStore";
import { Alert, Button } from "../components/primitives";

/**
 * Every path the app writes to.
 *
 * Named explicitly because the web SDK cannot list subcollections: only the
 * admin SDK can, and this runs in your browser with your own credentials
 * rather than a service account. The list is checked against
 * `firestore.rules` by `coderview.test.ts`, so a seventh collection added
 * later fails a test instead of quietly going missing from the dump.
 */
export const COLLECTIONS = [
  "transactions",
  "meta",
  "activity",
  "chat",
  "ai",
  "budgets",
] as const;

/**
 * Anything shaped like a credential, on the way out.
 *
 * A backstop, not a policy. CLAUDE.md §2 is the policy: keys live in
 * server-side environment secrets and never in the database. If one of these
 * ever matches, the dump says so in the header and the value does not leave
 * the browser.
 */
const KEY_SHAPED =
  /\b(sk-or-v1-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/g;

let scrubbed = 0;

const scrub = (text: string): string =>
  text.replace(KEY_SHAPED, () => {
    scrubbed += 1;
    return "[REDACTED CREDENTIAL]";
  });

interface Dumped {
  readonly name: string;
  readonly docs: readonly { readonly id: string; readonly data: Record<string, unknown> }[];
  /** Why this one is missing, when it is. */
  readonly failed?: string;
}

/**
 * Read one collection whole. No limit, no ordering: this is a dump.
 *
 * Each collection carries its own failure rather than throwing, because the
 * commonest failure by far is one collection being denied while the rest are
 * fine: `activity`, `chat` and `ai` need rules that may not be deployed yet.
 * One throw would lose the five that worked, and the file would say nothing
 * about why. A named denial is a diagnosis; an empty file is a mystery.
 */
async function readAll(uid: string, name: string): Promise<Dumped> {
  const db = firestore();
  if (!db) return { name, docs: [], failed: "Firebase is not configured in this build." };
  try {
    const snapshot = await getDocs(collection(db, `users/${uid}/${name}`));
    return {
      name,
      docs: snapshot.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> })),
    };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return {
      name,
      docs: [],
      failed: /permission|insufficient/i.test(why)
        ? `Denied. The rules for this collection are not deployed: npx firebase deploy --only firestore:rules`
        : why,
    };
  }
}

/**
 * What the assistant got wrong, counted.
 *
 * The reason this screen exists. `accepted` against `edited` and `rejected`
 * is the hit rate, and the per-field breakdown says which reading is weak:
 * a pile of corrections to `toWallet` means the transfer question is what
 * needs work, not the amount parser.
 */
function scoreAi(docs: readonly { readonly data: Record<string, unknown> }[]): string[] {
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const events = docs.map((d) => d.data);

  const count = (action: string): number =>
    events.filter((e) => str(e["action"]) === action).length;

  const proposed = count("proposed");
  const accepted = count("accepted");
  const edited = count("edited");
  const rejected = count("rejected");
  const cleared = count("cleared");
  const decided = accepted + edited + rejected;

  const byField = new Map<string, number>();
  const pairs: string[] = [];
  for (const e of events) {
    if (str(e["action"]) !== "edited") continue;
    const field = str(e["field"]) || "(unnamed)";
    byField.set(field, (byField.get(field) ?? 0) + 1);
    pairs.push(
      `    ${field}: proposed ${str(e["proposed"]) || "(blank)"} -> corrected to ${
        str(e["corrected"]) || "(blank)"
      }${str(e["text"]) ? `   [said: ${str(e["text"]).slice(0, 120)}]` : ""}`,
    );
  }

  const rate = decided > 0 ? `${Math.round((accepted / decided) * 100)}%` : "n/a";

  return [
    "── How the assistant is doing ──────────────────────────────────────────",
    "",
    `  asked      ${count("asked")}`,
    `  answered   ${count("answered")}`,
    `  uploaded   ${count("uploaded")}`,
    `  proposed   ${proposed}`,
    `  accepted   ${accepted}`,
    `  edited     ${edited}      <- corrections`,
    `  rejected   ${rejected}`,
    `  cleared    ${cleared}`,
    "",
    `  Accepted as proposed: ${rate} of ${decided} decided cards.`,
    "",
    "  Corrections by field, worst first:",
    ...(byField.size === 0
      ? ["    none recorded"]
      : [...byField.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([field, n]) => `    ${field.padEnd(14)} ${n}`)),
    "",
    "  Every correction, in full:",
    ...(pairs.length === 0 ? ["    none recorded"] : pairs),
    "",
  ];
}

/** The whole thing as one text file. */
function render(uid: string, dumps: readonly Dumped[]): string {
  const nl = String.fromCharCode(10);
  const ai = dumps.find((d) => d.name === "ai");

  const lines: string[] = [
    "CODERVIEW",
    `Taken ${new Date().toISOString()}`,
    `Account ${uid}`,
    "",
    "Every collection this app writes to, whole and unpaged. Nothing is",
    "summarised away. This file holds a complete financial history: keep it",
    "out of git and off any service.",
    "",
    "── Contents ────────────────────────────────────────────────────────────",
    "",
    ...dumps.map(
      (d) => `  ${d.name.padEnd(14)} ${d.failed ? "COULD NOT READ" : `${d.docs.length} documents`}`,
    ),
    "",
    ...(dumps.some((d) => d.failed)
      ? [
          "  Some collections could not be read, so this dump is incomplete.",
          "  Each one says why in its own section below.",
          "",
        ]
      : []),
    ...(ai?.failed
      ? [
          "── How the assistant is doing ──────────────────────────────────────────",
          "",
          `  Cannot say: ${ai.failed}`,
          "",
        ]
      : ai
        ? scoreAi(ai.docs)
        : []),
  ];

  for (const dump of dumps) {
    lines.push(
      `── ${dump.name} (${dump.failed ? "unreadable" : dump.docs.length}) ${"─".repeat(
        Math.max(0, 60 - dump.name.length),
      )}`,
      "",
    );
    if (dump.failed) {
      lines.push(`  ${dump.failed}`, "");
      continue;
    }
    if (dump.docs.length === 0) {
      lines.push("  (empty)", "");
      continue;
    }
    for (const d of dump.docs) {
      lines.push(`  ${d.id}`, `    ${JSON.stringify(d.data)}`);
    }
    lines.push("");
  }

  return scrub(lines.join(nl));
}

/**
 * Whatever this build is actually holding, when there is no database.
 *
 * The app runs two ways. Signed into Firebase it reads Firestore; with no
 * Firebase configured it runs the same screens against the Excel fixture in
 * React state, and that build has real data in it too. Saying "not signed
 * in" there was wrong twice over: there is nothing to sign into, and there
 * was plenty to dump.
 *
 * The three logs come from the same stores the app uses, called with a null
 * uid, which is how they return their in-memory copies.
 */
async function dumpLocal(local: LocalData): Promise<Dumped[]> {
  const [activity, chat, ai] = await Promise.all([
    activityStore(null).recent(),
    chatStore(null).recent(),
    aiLogStore(null).recent(),
  ]);

  const rows = (name: string, list: readonly unknown[], key: (v: unknown) => string): Dumped => ({
    name,
    docs: list.map((v) => ({ id: key(v), data: v as Record<string, unknown> })),
  });

  const id = (v: unknown): string => {
    const record = v as { id?: unknown };
    return typeof record.id === "string" ? record.id : "(no id)";
  };

  return [
    rows("transactions", local.transactions, id),
    rows("deleted (the bin)", local.deleted, id),
    { name: "meta", docs: [{ id: "settings", data: local.settings as Record<string, unknown> }] },
    rows("activity", activity, id),
    rows("chat", chat, id),
    rows("ai", ai, id),
    {
      name: "budgets",
      docs: Object.entries(local.budgets).map(([year, budget]) => ({
        id: year,
        data: budget as unknown as Record<string, unknown>,
      })),
    },
  ];
}

/** What the app is holding, handed in so this screen reads nothing twice. */
export interface LocalData {
  readonly transactions: readonly unknown[];
  readonly deleted: readonly unknown[];
  readonly budgets: Readonly<Record<string, unknown>>;
  readonly settings: unknown;
}

export function CoderView({ uid, local }: { uid: string | null; local: LocalData }) {
  const [text, setText] = useState("Reading…");
  const [saved, setSaved] = useState("");
  /** Shown as a banner, because a line of text in the dump was missed. */
  const [wrongBuild, setWrongBuild] = useState(false);

  useEffect(() => {
    let alive = true;

    void (async () => {
      scrubbed = 0;

      if (!uid) {
        const dumps = await dumpLocal(local);
        if (!alive) return;
        /**
         * The warning goes first.
         *
         * It used to be appended after the dump, which on a 441 row ledger
         * put it several thousand lines below the fold. So the screen read as
         * "activity 0, chat 0, ai 0" with the explanation nowhere in sight,
         * and the obvious conclusion was that the database was broken.
         */
        setText(
          [
            "WRONG BUILD. This one has no database.",
            "",
            "There is no Firebase configured here, so what follows is only what this",
            "browser is holding: the Excel fixture in memory, and any logs made in this",
            "session. Your real data is in Firestore, and it is not readable from here.",
            "",
            "Open the app that is signed in, and put ?coderview on the end of its address.",
            "",
            "Signing in is not a formality. The rules allow exactly one account, and",
            "without a session Firestore returns nothing to anybody. That is the only",
            "reason your financial history is not public.",
            "",
            render("this browser, no database", dumps),
          ].join(String.fromCharCode(10)),
        );
        setWrongBuild(true);
        return;
      }
      const dumps = await Promise.all(COLLECTIONS.map((name) => readAll(uid, name)));

      /**
       * `users/{uid}` itself, in its own try, and this is load-bearing.
       *
       * Nothing writes that document, and until the rules are redeployed no
       * rule matches it, so reading it is denied. It used to sit in the same
       * try as everything else, so one denial on a document that does not
       * exist threw away five collections that had already been read
       * successfully, and the whole screen said "Missing or insufficient
       * permissions" as though the database were unreadable.
       *
       * The optional extra must never be able to lose the main answer.
       */
      let root = "";
      try {
        const db = firestore();
        if (db) {
          const snapshot = await getDoc(doc(db, `users/${uid}`));
          root = snapshot.exists() ? JSON.stringify(snapshot.data()) : "";
        }
      } catch {
        // Denied, or not there. Either way it holds nothing worth reporting.
      }

      try {
        if (!alive) return;
        const body = render(uid, dumps);
        setText(
          [
            body,
            root ? `── users/${uid} (the parent document) ──${String.fromCharCode(10)}  ${root}` : "",
            scrubbed > 0
              ? `WARNING: ${scrubbed} credential-shaped values were redacted. Nothing key-shaped should ever be in this database. Rotate at the provider and find out what wrote it.`
              : "No credential-shaped values found, which is what should happen.",
          ]
            .filter(Boolean)
            .join(String.fromCharCode(10, 10)),
        );
      } catch (e) {
        setText(
          `Could not read the database: ${
            e instanceof Error ? e.message : String(e)
          }${String.fromCharCode(10)}${String.fromCharCode(
            10,
          )}If this says permission denied, the rules are not deployed yet: npx firebase deploy --only firestore:rules`,
        );
      }
    })();

    return () => {
      alive = false;
    };
  }, [uid]);

  /**
   * Saved where you put it, not into Downloads.
   *
   * `showSaveFilePicker` lets you choose the folder once, which is the point:
   * the right folder is one git ignores. Browsers without it fall back to an
   * ordinary download, and then the file has to be moved by hand.
   */
  const save = async (): Promise<void> => {
    const suggested = `coderview-${new Date().toISOString().slice(0, 10)}.txt`;
    const picker = (
      window as unknown as {
        showSaveFilePicker?: (o: unknown) => Promise<{
          createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>;
        }>;
      }
    ).showSaveFilePicker;

    if (picker) {
      try {
        const handle = await picker({
          suggestedName: suggested,
          types: [{ description: "Text", accept: { "text/plain": [".txt"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        setSaved("Saved.");
        return;
      } catch {
        // Cancelled, or the browser refused. Fall through to a download.
      }
    }

    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = suggested;
    a.click();
    URL.revokeObjectURL(url);
    setSaved("Downloaded. Move it somewhere git ignores.");
  };

  return (
    <div style={{ padding: "var(--space-4)", display: "grid", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
        <span className="t-h3">Coderview</span>
        <span className="t-caption" style={{ color: "var(--ink-2)" }}>
          the whole database, as text
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)" }}>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(text);
              setSaved("Copied.");
            }}
          >
            Copy all
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Save to a file
          </Button>
        </span>
      </div>

      {wrongBuild && (
        <Alert status="over" title="This build has no database">
          You are looking at the fixture build, so activity, chat and ai are empty because
          nothing here writes them. Open the app you are signed into and add{" "}
          <code>?coderview</code> to the end of its address.
        </Alert>
      )}

      <p className="t-caption" style={{ color: "var(--ink-2)", margin: 0 }}>
        This is your whole financial history in one file. Save it under{" "}
        <code>MY THINGS/CODERVIEW/</code>: that folder is in <code>.gitignore</code>, so it cannot
        be committed by accident. {saved}
      </p>

      <pre
        className="t-num-s"
        style={{
          margin: 0,
          padding: "var(--space-3)",
          background: "var(--surface-sunk)",
          border: "1px solid var(--hairline)",
          maxHeight: "70vh",
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          color: "var(--ink)",
        }}
      >
        {text}
      </pre>
    </div>
  );
}
