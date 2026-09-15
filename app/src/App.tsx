/**
 * App shell: style guide §3.8.
 *
 * Desktop: a fixed 240px sidebar that never scrolls; only the content column
 * moves. Phone: bottom nav, with the overflow screens on a More sheet.
 *
 * ── Where the data lives ──────────────────────────────────────────────────
 * With Firebase configured and the owner signed in, Firestore is the source of
 * truth: the ledger is a live subscription, and every edit writes through. The
 * Excel fixture is then only the seed for a first, empty database.
 *
 * With no Firebase configuration the same screens run against the fixture in
 * React state, with settings in localStorage. That is not a fallback bolted on
 *, it is how the app runs on a fresh clone and in tests, so it has to work.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { AddTransaction } from "./features/AddTransaction";
import { Bin } from "./features/Bin";
import { CoderView } from "./features/CoderView";
import { Budget } from "./features/Budget";
import { Dashboard } from "./features/Dashboard";
import { Database } from "./features/Database";
import { DebtScreen } from "./features/DebtScreen";
import { Insights } from "./features/Insights";
import { Settings } from "./features/Settings";
import { Statements } from "./features/Statements";
import { Alert, Button, Card, EmptyState, Money, Toast } from "./components/primitives";
import { useUpdateAvailable } from "./data/updateCheck";
import { Icon, type IconName } from "./components/Icon";
import { AskPanel } from "./features/AskPanel";
import { useProposalSink } from "./features/useProposalSink";
import { useMediaQuery } from "./features/useMediaQuery";
import { aiSurfaceOn } from "./domain/aiSurface";
import type { Draft } from "./domain/entry";
import { loadLocalLedger } from "./data/localSource";
import { applyDebtMigration, planDebtMigration } from "./domain/debtMigration";
import { applyOpeningMigration, planOpeningMigration } from "./domain/year";
import { misdatedOpenings, OBSOLETE_REVENUE_CATEGORY } from "./domain/opening";
import { cleanedSettings } from "./domain/settingsCleanup";
import { netWorth, positionsOf } from "./domain/debt";
import { totalSavingsBalance, totalWalletBalance, walletBalances } from "./domain/balances";
import { emptyDraft, insertChronologically } from "./domain/entry";
import { formatMedium, getYear, today } from "./domain/dates";
import { systemToCsv } from "./domain/csv";
import { browserSettingsStore, type SettingsStore } from "./data/settingsStore";
import {
  checksum,
  createBackup,
  restore,
  type Backup,
  type BackupData,
  type RestoreMode,
} from "./domain/backup";
import { BROWSER_QUOTA, FIRESTORE_QUOTA } from "./domain/storage";
import { getPreference, setPreference } from "./theme";
import {
  firestoreLedger,
  firestoreSettingsStore,
  saveBudget,
  seedIfEmpty,
  subscribeBudgets,
} from "./data/firestoreLedger";
import { useCloud } from "./data/useCloud";
import { SignIn } from "./features/SignIn";
import { migrateAccounts, renameAccount, renameItem, type Account } from "./domain/accounts";
import { defaultSettings, isBlankSettings, type AppSettings } from "./domain/settings";
import { Activity } from "./features/Activity";
import { activityStore } from "./data/activityStore";
import { chatStore } from "./data/chatStore";
import { aiLogStore } from "./data/aiLogStore";
import { manualCorrections } from "./domain/aiLog";
import {
  binned as binnedEvent,
  created as createdEvent,
  restored as restoredEvent,
  updated as updatedEvent,
  BY_OWNER,
  type ActivityEvent,
  type Provenance,
} from "./domain/activity";
import type { BudgetYear, Budgets, DeletedTransaction, ReferenceLists, Transaction } from "./domain/types";

type Screen =
  | "dashboard"
  | "add"
  | "database"
  | "debt"
  | "insights"
  | "budget"
  | "statements"
  | "bin"
  | "activity"
  | "settings"
  /** The assistant on a tab of its own: a phone's version of the floating chat. */
  | "ai";

/**
 * Every screen, in sidebar order.
 *
 * The icons are drawn shapes from components/Icon.tsx. They were text
 * characters, which each device draws from whichever font it has, so they
 * came out at mismatched sizes and, on some phones, as colour emoji.
 */
const NAV: { id: Screen; label: string; icon: IconName; primary?: boolean }[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", primary: true },
  { id: "add", label: "Add", icon: "add", primary: true },
  { id: "database", label: "Database", icon: "ledger", primary: true },
  { id: "debt", label: "Debt", icon: "debt", primary: true },
  { id: "insights", label: "Insights", icon: "insights" },
  { id: "budget", label: "Budget", icon: "budget" },
  { id: "statements", label: "Statements", icon: "statements" },
  { id: "bin", label: "Bin", icon: "bin" },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "settings", label: "Settings", icon: "settings" },
];

/**
 * What a phone shows, and nothing else.
 *
 * The owner's list on 2026-09-15: adding, the dashboard, the database, the
 * budget, and the assistant on a tab of its own. Debt, Insights, Statements,
 * the Bin and Activity stay on the computer, where there is room for them.
 * Settings stays reachable from the gear in the top bar, because the AI switch
 * and the accounts live there and a phone still needs both.
 */
const PHONE_SCREENS: readonly Screen[] = ["dashboard", "database", "add", "budget", "ai", "settings"];

/** The phone bar, left to right. Add is drawn raised; with the AI tab it is dead centre. */
const BAR: readonly Screen[] = ["dashboard", "database", "add", "budget"];
const BAR_WITH_AI: readonly Screen[] = ["dashboard", "database", "add", "budget", "ai"];

/**
 * The fixture is a snapshot ending 2026-08-28, so running against it anchors
 * "today" there: a demo ledger with no rows for the current month reports an
 * empty month, which is true and useless.
 */
const FIXTURE_AS_OF = "2026-08-29";

export default function App() {
  const cloud = useCloud();
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [dbFilter, setDbFilter] = useState<"all" | "flagged">("all");
  /** A search another screen opened the Database with, such as a kind of spending on Budget. */
  const [dbQuery, setDbQuery] = useState<{ query: string; at: number } | null>(null);
  /**
   * The row the Add screen is editing, if any.
   *
   * Held here rather than in `AddTransaction` because it is set from the
   * Database, on a different screen. Cleared on save and on cancel, so the
   * form goes back to being a new entry.
   */
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Bumped on every recorded event, so the Activity screen refetches. */
  const [activityKey, setActivityKey] = useState(0);
  /** A newer build has been published than the one this tab is running. */
  const updateReady = useUpdateAvailable();
  /** So a missing rules deploy is reported once, not once per row saved. */
  const activityWarned = useRef(false);
  /** The floating chat on a computer: open now, and mounted since it was first opened. */
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMounted, setChatMounted] = useState(false);
  /**
   * A card the assistant sent to the form from outside the Add screen, and the
   * last row the form saved. Held here because the assistant can be in three
   * places and the form is in one.
   */
  const [incoming, setIncoming] = useState<{ draft: Draft; at: number } | null>(null);
  const [lastSaved, setLastSaved] = useState<{ draft: Draft; at: number } | null>(null);
  /** Phone and tablet: the bottom bar, and the phone's shorter list of screens. */
  const compact = useMediaQuery("(max-width: 1023px)");

  /**
   * "Today", which was frozen at 2026-08-29 for everybody.
   *
   * ── What it cost ────────────────────────────────────────────────────────
   *
   * On 2026-09-02 the owner typed "I transfer 1000 to cash 15 fee then use
   * that 1000 to pay my food today" and got two rows dated 2026-08-29, four
   * days earlier. Their reply was "you give wrong entry fix this".
   *
   * It was not only the assistant. The anchor is the whole app's idea of now,
   * so on live data the Dashboard read August 29, "this month" meant August
   * while September was running, and every budget, alert and insight
   * described a month that had already ended.
   *
   * The anchor exists for the fixture, and only the fixture: a demo ledger
   * ending in August has nothing in September, and reporting an empty month
   * would be true and useless. Signed into Firebase the rows are real and
   * current, so today is today.
   */
  const asOf = cloud.uid ? today() : FIXTURE_AS_OF;

  const base = loadLocalLedger();

  const seed = useMemo(() => {
    if (!base.loaded) return { transactions: [] as Transaction[], debts: [] };

    const plan = planDebtMigration(base.transactions, "Maya Credit", {
      debtId: "maya-credit",
      counterparty: "Maya",
      wallet: "Maya",
    });
    const withDebt = applyDebtMigration(base.transactions, plan);

    /**
     * The Excel carried each year's closing balance forward as Revenue, so
     * PHP 953.89 of money already owned was reported as 2026 income. This
     * reclassifies those five rows to `Opening`. Balances do not move by a
     * centavo, which `year.test.ts` asserts across all 440 rows.
     */
    const transactions = applyOpeningMigration(withDebt, planOpeningMigration(withDebt));

    return { transactions, debts: [plan.debt] };
  }, [base]);

  const [transactions, setTransactions] = useState<Transaction[]>(seed.transactions);
  const [deleted, setDeleted] = useState<DeletedTransaction[]>(base.deleted);
  const [budgets, setBudgets] = useState<Budgets>(base.budgets);

  /**
   * Settings persist across refreshes. The store is swapped for the Firestore
   * one in Phase 5: this is the only line that changes.
   */
  const store = useMemo(
    () => (cloud.uid ? firestoreSettingsStore(cloud.uid) : browserSettingsStore()),
    [cloud.uid],
  );
  /**
   * Names the debt migration turned into credit lines.
   *
   * Only used to build the initial category lists, before `settings` exists.
   * From then on `domain/settingsCleanup.ts` does the same job against the
   * live `settings.credits`, so a credit line added later is stripped too.
   */
  const creditNames = useMemo(
    () => new Set(seed.debts.map((d) => d.name.trim().toLowerCase())),
    [seed.debts],
  );
  const isCreditLine = (name: string): boolean =>
    creditNames.has(name.trim().toLowerCase());

  const [settings, setSettings] = useState<AppSettings>(() => ({
    ...defaultSettings(),
    /**
     * Seeded from what this device is already showing.
     *
     * `defaultSettings()` says "system", and starting from that would push
     * "system" over a real choice the moment anything else was edited.
     */
    theme: getPreference(),
    accounts: base.loaded
      ? migrateAccounts(base.reference.wallets, base.reference.savings, base.transactions)
      : [],
    /**
     * A credit line is not a bill and not a revenue source.
     *
     * The Excel had "Maya Credit" in both lists, which is how PHP 5,450.00 of
     * borrowing became income and a PHP 2,688.79 repayment became a bill. The
     * debt module owns it now, so offering it here would invite the same
     * mistake on the next entry.
     */
    bills: base.reference.bills.filter((b) => !isCreditLine(b)),
    subscriptions: base.reference.subscriptions,
    /**
     * "Transfer of balance" is dropped. It was the Excel's way of starting a
     * year, and offering it again would invite booking money you already had
     * as income. The Add screen has a Starting balance flow instead.
     */
    revenueCategories: base.reference.revenueCategories.filter(
      (c) => c !== OBSOLETE_REVENUE_CATEGORY && !isCreditLine(c),
    ),
    spendingTypes: base.reference.spendingTypes,
    // The credit line the migration found, so it is manageable in Settings and
    // visible on the Debt screen from the first render.
    credits: seed.debts,
  }));
  /**
   * Which store has actually been read.
   *
   * A boolean is not enough. The store swaps from the browser to Firestore the
   * moment auth resolves, and a boolean stays true across that swap, so the
   * save effect fired against the NEW store carrying settings read from the
   * OLD one. On a fresh domain that meant writing empty accounts over the real
   * ones in Firestore before the Firestore read had even returned.
   *
   * Holding the store itself means "have I read THIS store", which is the
   * question that actually matters.
   */
  const [loadedStore, setLoadedStore] = useState<SettingsStore | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A new store has not been read yet, whatever the previous one told us.
    setLoadedStore(null);
    void store.load().then((stored) => {
      /**
       * Clean on every load, not just on the first build.
       *
       * Filtering the lists when they are first constructed never runs again
       * once settings have been saved, so an obsolete entry like "Transfer of
       * balance" survives every reload. See `domain/settingsCleanup.ts`.
       */
      // A store with nothing in it means first run: keep the migrated
      // defaults. Anything else is saved data and wins, even if one of its
      // lists is empty.
      if (!cancelled && !isBlankSettings(stored)) {
        setSettings(cleanedSettings(stored));
        /**
         * The theme is the one setting with an effect outside React state:
         * a class on <html>, set from its own localStorage key so the page
         * does not flash on load. Storing it in settings without applying it
         * here meant it never actually synced, so signing in on a second
         * device showed the wrong theme with the right value saved.
         */
        setPreference(stored.theme);
      }
      if (!cancelled) setLoadedStore(store);
    });
    return () => { cancelled = true; };
  }, [store]);

  useEffect(() => {
    // Never write to a store that has not been read yet.
    if (loadedStore !== store) return;
    void store.save(settings);
  }, [store, settings, loadedStore]);

  /**
   * Settings changed somewhere else.
   *
   * The ledger has been a live subscription since Firestore was wired in, but
   * settings were read once at startup. An account renamed on the phone stayed
   * invisible on the desktop until a reload, which is the kind of split that
   * ends with two devices disagreeing about what an account is called.
   *
   * The store skips snapshots carrying this tab's own pending writes, so
   * saving does not feed back into loading.
   */
  useEffect(() => {
    if (loadedStore !== store || !store.subscribe) return;
    return store.subscribe((incoming) => {
      const next = cleanedSettings(incoming);
      setSettings((current) => {
        /**
         * Only accept a genuine change.
         *
         * A write produces two snapshots: a local one carrying
         * `hasPendingWrites` (which the store filters) and a second from the
         * server that does not. That second one echoes back what was just
         * saved. Setting state from it would give `settings` a new identity,
         * retrigger the save effect, and write again, forever, at real cost
         * against the Firestore quota.
         *
         * Comparing content rather than identity stops the echo dead.
         */
        if (checksum(current) === checksum(next)) return current;

        // Same reason as the load path: the theme has an effect outside
        // React state, so a change made on another device has to be applied
        // rather than merely stored.
        if (next.theme !== current.theme) setPreference(next.theme);

        return next;
      });
    });
  }, [store, loadedStore]);

  const [syncError, setSyncError] = useState<string | null>(null);
  /**
   * Where the rows on screen came from.
   *
   * "seed" means they are still the Excel fixture and have not reached
   * Firebase. "live" means they arrived from Firestore, which is the only
   * proof the upload actually landed. A row count alone proves nothing:
   * 441 looks the same either way.
   */
  const [ledgerSource, setLedgerSource] = useState<"seed" | "live">("seed");
  const [uploading, setUploading] = useState(false);

  /**
   * Live ledger.
   *
   * The snapshot fires immediately from the offline cache, then on every
   * change: including one made on the phone while this tab was open. An empty
   * database is seeded once from the fixture; after that the fixture is never
   * consulted again.
   */
  useEffect(() => {
    const uid = cloud.uid;
    if (!uid) {
      setLedgerSource("seed");
      return;
    }

    let seeding = false;
    const ledger = firestoreLedger(uid);

    const stop = ledger.subscribe(
      (snap) => {
        if (snap.transactions.length === 0 && snap.deleted.length === 0) {
          // Nothing there yet. Seed once, from what is already in memory.
          if (seeding || seed.transactions.length === 0) return;
          seeding = true;
          void seedIfEmpty(uid, seed.transactions, settingsRef.current)
            .then((r) => { if (r.seeded) flash(`Uploaded ${r.count} transactions to Firebase.`); })
            .catch((e: Error) => setSyncError(e.message));
          return;
        }
        setTransactions([...snap.transactions]);
        setDeleted([...snap.deleted]);
        setLedgerSource("live");
        setSyncError(null);
      },
      (e) => setSyncError(e.message),
    );

    const stopBudgets = subscribeBudgets(uid, (b) => {
      if (Object.keys(b).length > 0) setBudgets(b);
    });

    return () => { stop(); stopBudgets(); };
    // `settings` is read through a ref so a settings edit does not tear down
    // and rebuild the ledger subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud.uid, seed.transactions]);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /** Writes through to Firestore when connected; a no-op when local. */
  const push = (fn: (l: ReturnType<typeof firestoreLedger>) => Promise<void>): void => {
    if (!cloud.uid) return;
    fn(firestoreLedger(cloud.uid)).catch((e: Error) => setSyncError(e.message));
  };

  /**
   * Write the audit event beside the data write.
   *
   * Deliberately not awaited and deliberately not able to fail the caller. A
   * ledger write that succeeded must not report an error because its audit
   * entry did not: the owner would be told their money did not save when it
   * did. So a failed event surfaces in the sync banner and nowhere else, and
   * the direction this fails in is the one where the ledger is right.
   */
  const record = (...events: readonly ActivityEvent[]): void => {
    const store = activityStore(cloud.uid ?? null);
    for (const event of events) {
      store.record(event).catch((e: Error) => {
        /**
         * Said once, not once per row.
         *
         * The commonest cause by far is the rules for this collection not
         * being deployed yet, which is one fact about the project rather than
         * a problem with this row. Eight rows off one screenshot would
         * otherwise raise the same banner eight times, and a permission
         * message repeated eight times reads like eight failures.
         */
        if (activityWarned.current) return;
        activityWarned.current = true;
        setSyncError(
          /permission|insufficient/i.test(e.message)
            ? "The activity trail is not recording: your database has not been given its rules yet. Your entries are saving normally. Run: firebase deploy --only firestore:rules"
            : `The activity trail is not recording: ${e.message}. Your entries are saving normally.`,
        );
      });
    }
    setActivityKey((n) => n + 1);
  };

  /**
   * Reference lists are derived from settings, so every screen keeps working
   * against the shape it already knows while Settings edits the richer model.
   *
   * Names are made unique on the way through. A balance is keyed by name, so
   * two accounts called "Cash" are one wallet as far as money is concerned,
   * and listing both showed the same balance twice on every panel and offered
   * the same choice twice in every picker. New accounts cannot collide,
   * `validateAccount` refuses that, but a pair already in the settings
   * document predates the check and has to render sensibly anyway.
   */
  const reference: ReferenceLists = useMemo(() => {
    const namesOf = (kinds: readonly Account["kind"][]): string[] => [
      ...new Set(
        settings.accounts
          .filter((a) => kinds.includes(a.kind) && !a.archived)
          .map((a) => a.name.trim())
          .filter(Boolean),
      ),
    ];

    return {
      wallets: namesOf(["spending"]),
      savings: namesOf(["savings", "goal", "reserve"]),
      bills: settings.bills,
      subscriptions: settings.subscriptions,
      revenueCategories: settings.revenueCategories,
      spendingTypes: settings.spendingTypes,
      /**
       * The credit lines, so the reader knows they are not accounts.
       *
       * Without this, "the credit is from maya credit" found the account
       * "Maya" inside those words and produced a transfer from Maya to Maya.
       * A credit line is where borrowed money comes from; naming one is
       * naming debt.
       */
      credits: settings.credits.filter((c) => !c.archived).map((c) => c.name),
    };
  }, [settings]);

  const view = useMemo(() => {
    const positions = positionsOf(settings.credits, transactions, asOf);
    const wallets = totalWalletBalance(transactions, reference.wallets);
    const savings = totalSavingsBalance(transactions, reference.savings);
    return {
      worth: netWorth(wallets, savings, positions),
      owed: positions.reduce((a, p) => a + Math.max(0, p.outstanding), 0),
      rows: walletBalances(
        transactions,
        [...reference.wallets, ...reference.savings],
        reference.savings,
      ),
    };
  }, [transactions, settings.credits, reference]);

  const flash = (message: string): void => {
    setToast(message);
    window.setTimeout(() => setToast(null), 6000);
  };

  /**
   * Whether this ledger renumbers on every write.
   *
   * The Excel did, and the ledger here does until it lives in Firebase (spec
   * 5.11). Firebase keeps the number a row was saved with. Every write path
   * asks this one question, so the numbers on screen never disagree with the
   * numbers stored.
   */
  const renumbers = ledgerSource !== "live";

  const handleSave = (rows: Transaction[], by: Provenance = BY_OWNER): void => {
    /**
     * Stamped here, at the one place provenance is known.
     *
     * `draftToTransactions` builds a row from a draft and has no idea who
     * asked for it, so marking it there would mean threading provenance
     * through the whole domain layer for one field. Every writer comes
     * through here.
     */
    const stamped = rows.map((r) => ({ ...r, entrySource: by.actor }) as Transaction);

    setTransactions((prev) => insertChronologically(prev, stamped, { renumber: renumbers }));
    push((l) => l.saveMany(stamped));
    record(...stamped.map((r) => createdEvent(r, by)));

    /**
     * The number the row ended up with, not the one it was handed.
     *
     * Where the ledger renumbers, a back-dated entry takes its place among the
     * dates and its number changes with it. "Saved. Record #0442." for a row
     * that landed at #0300 sent you looking for the wrong row.
     */
    const landed = renumbers
      ? insertChronologically(transactions, stamped).find((t) => t.id === stamped[0]?.id)
      : stamped[0];
    flash(
      rows.length > 1
        ? `Saved. ${rows.length} rows added.`
        : `Saved. Record #${String(landed?.recordNumber ?? 0).padStart(4, "0")}.`,
    );
  };

  /**
   * Replace a row that already exists.
   *
   * Keyed on id, and the record number is carried over rather than reissued:
   * an edit is the same entry corrected, and renumbering it would break every
   * reference to it, including the one in the toast that just told you what
   * it was.
   *
   * Written through to Firestore by the same `saveMany` an insert uses, which
   * writes by id, so an update overwrites rather than duplicating.
   */
  const handleUpdate = (rows: Transaction[], by: Provenance = BY_OWNER): void => {
    // Read before the state changes, so the event carries what it replaced.
    const previous = new Map(transactions.map((t) => [t.id, t]));
    record(
      ...rows.map((r) => {
        const was = previous.get(r.id);
        return was ? updatedEvent(was, r, by) : createdEvent(r, by);
      }),
    );

    /**
     * Correcting a row the assistant entered is how it learns.
     *
     * The learning reads its own record and applies what it finds, and after
     * 310 events that record held two corrections, neither of them an item.
     * It had learned nothing, because only the chat's own amend path ever
     * wrote one: correcting a card by typing "gcash" was remembered, and
     * correcting the same field in the form beside it was not. Almost every
     * correction happens in the form.
     *
     * Only rows it entered. Fixing your own typo teaches nothing about its
     * guessing and would fill the record with noise.
     */
    for (const r of rows) {
      const was = previous.get(r.id);
      if (!was) continue;
      for (const event of manualCorrections(was, r, "add")) {
        void aiLogStore(cloud.uid ?? null)
          .record(event)
          .catch(() => {});
      }
    }
    setTransactions((prev) => {
      const byId = new Map(rows.map((r) => [r.id, r]));
      const replaced = prev.map((t) => byId.get(t.id) ?? t);
      // A split repayment can turn one row into two, so anything the edit
      // produced that was not already there still has to be inserted.
      const added = rows.filter((r) => !prev.some((t) => t.id === r.id));
      return added.length ? insertChronologically(replaced, added) : replaced;
    });
    push((l) => l.saveMany(rows));
    setEditing(null);
    flash(`Updated record #${String(rows[0]?.recordNumber ?? 0).padStart(4, "0")}.`);
  };

  /**
   * Pull a starting balance back inside the ledger, once.
   *
   * An early version dated these the day before the first entry, which put
   * the money in the previous year: counted towards no annual figure, and
   * last in a list sorted newest first, where it looked like it had never
   * saved at all. See `domain/opening.ts`.
   *
   * This runs against whatever is on screen, so it repairs rows that came
   * back from Firestore as well as ones in the fixture, and it writes the
   * correction through so it does not have to run again. It cannot loop: a
   * repaired row is no longer misdated, so the next pass finds nothing.
   */
  useEffect(() => {
    const wrong = misdatedOpenings(transactions);
    if (wrong.length === 0) return;

    const byId = new Map(wrong.map((r) => [r.id, r]));
    setTransactions((prev) => prev.map((t) => byId.get(t.id) ?? t));
    push((l) => l.saveMany(wrong));
    flash(
      wrong.length === 1
        ? `Moved a starting balance to ${wrong[0]?.date}, where the ledger begins.`
        : `Moved ${wrong.length} starting balances to where the ledger begins.`,
    );
    // `push` and `flash` are stable for this purpose; keying on the rows
    // themselves is what makes this run once per genuine finding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions]);

  const startEditing = (row: Transaction): void => {
    setEditing(row);
    go("add");
  };

  /** Soft delete: the row moves to the bin, never out of existence. */
  const handleDelete = (id: string): void => {
    const row = transactions.find((t) => t.id === id);
    if (!row) return;
    const at = new Date().toISOString();
    /**
     * A row being edited that goes to the bin stops being edited.
     *
     * Otherwise the form kept it, and Save wrote it back into the ledger as
     * an update while its binned copy stayed in the bin: one entry live and
     * binned at once, and a restore that made two.
     */
    if (editing?.id === id) setEditing(null);
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    setDeleted((prev) => [{ ...row, deletedAt: at }, ...prev]);
    push((l) => l.bin(id, at));
    record(binnedEvent(row));
    flash(`Moved record #${String(row.recordNumber).padStart(4, "0")} to the bin.`);
  };

  /**
   * Several rows to the bin in one move.
   *
   * Not a loop over `handleDelete`. Twelve rows through that is twelve state
   * updates, twelve audit writes announced one at a time, and twelve toasts
   * where the last one wins: what the owner would see is "moved record #0412
   * to the bin" after selecting a dozen. One move, one sentence, one record
   * of it, and the ledger writes go out together so a failure halfway is one
   * message rather than six.
   */
  const handleDeleteMany = (ids: readonly string[]): void => {
    const rows = transactions.filter((t) => ids.includes(t.id));
    if (rows.length === 0) return;
    const at = new Date().toISOString();
    const gone = new Set(rows.map((t) => t.id));

    if (editing && gone.has(editing.id)) setEditing(null);
    setTransactions((prev) => prev.filter((t) => !gone.has(t.id)));
    setDeleted((prev) => [...rows.map((t) => ({ ...t, deletedAt: at })), ...prev]);
    push(async (l) => {
      for (const t of rows) await l.bin(t.id, at);
    });
    record(...rows.map((t) => binnedEvent(t)));
    flash(
      rows.length === 1
        ? `Moved record #${String(rows[0]?.recordNumber ?? 0).padStart(4, "0")} to the bin.`
        : `Moved ${rows.length} records to the bin. They are restorable.`,
    );
  };

  const handleRestore = (id: string): void => {
    const row = deleted.find((t) => t.id === id);
    if (!row) return;
    setDeleted((prev) => prev.filter((t) => t.id !== id));
    const { deletedAt: _ignored, ...restored } = row;
    setTransactions((prev) => insertChronologically(prev, [restored], { renumber: renumbers }));
    push((l) => l.restore(id));
    record(restoredEvent(restored));
    flash(`Restored record #${String(row.recordNumber).padStart(4, "0")}.`);
  };

  /** The same move backwards: several rows out of the bin at once. */
  const handleRestoreMany = (ids: readonly string[]): void => {
    const rows = deleted.filter((t) => ids.includes(t.id));
    if (rows.length === 0) return;
    const back = new Set(rows.map((t) => t.id));

    setDeleted((prev) => prev.filter((t) => !back.has(t.id)));
    const restored = rows.map(({ deletedAt: _ignored, ...rest }) => rest);
    setTransactions((prev) => insertChronologically(prev, restored, { renumber: renumbers }));
    push(async (l) => {
      for (const t of rows) await l.restore(t.id);
    });
    record(...restored.map((t) => restoredEvent(t)));
    flash(
      rows.length === 1
        ? `Restored record #${String(rows[0]?.recordNumber ?? 0).padStart(4, "0")}.`
        : `Restored ${rows.length} records.`,
    );
  };

  /**
   * Rename an account or an item everywhere it appears.
   *
   * It used to rewrite the rows on screen and nothing else. Binned rows kept
   * the old name, so restoring one brought back an account that no longer
   * existed and split its balance in two, the one thing a rename must never
   * do. And nothing reached the database: signed in, the next change from
   * anywhere replaced the renamed rows with the stored ones and quietly
   * undid it.
   *
   * `saveMany` merges, and a binned row's `deletedAt` is not part of what it
   * writes, so a renamed row in the bin stays in the bin.
   */
  const handleRename = (kind: "account" | "item", from: string, to: string): void => {
    const rename = <T extends Transaction>(rows: readonly T[]): T[] =>
      kind === "account" ? renameAccount(rows, from, to) : renameItem(rows, from, to);

    const live = rename(transactions);
    const binned = rename(deleted);
    const changed: Transaction[] = [
      ...live.filter((t, i) => t !== transactions[i]),
      ...binned.filter((t, i) => t !== deleted[i]),
    ];
    if (changed.length === 0) return;

    setTransactions(live);
    setDeleted(binned);
    push((l) => l.saveMany(changed));
  };

  /**
   * Purge exists only in local mode. Against Firestore the rules deny `delete`
   * outright, so there is no way to lose a money record, and offering a
   * button that always fails would be worse than not offering it.
   */
  const handlePurge = cloud.uid
    ? undefined
    : (id: string): void => {
        setDeleted((prev) => prev.filter((t) => t.id !== id));
        flash("Removed from this browser.");
      };

  /**
   * A year's budget, however many months a save touched.
   *
   * The Budget screen's planner saves to one month, the rest of the year or
   * all of it. Each is one state change and one write, rather than a write
   * per month that each read a budget the previous one had not yet replaced.
   */
  const handleBudgetYear = (year: number, next: BudgetYear): void => {
    const key = String(year);
    setBudgets((prev) => ({ ...prev, [key]: next }));
    if (cloud.uid) {
      saveBudget(cloud.uid, key, next).catch((e: Error) => setSyncError(e.message));
    }
  };

  /** Download a blob without leaving the page. */
  const download = (name: string, body: string, mime: string): void => {
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * The complete system state.
   *
   * Anything a backup must carry lives here, including the parts kept outside
   * the settings document: the theme, and which one-time migrations have run.
   * A restore that missed either would re-run a migration over already
   * converted rows.
   */
  const systemState = (): BackupData => ({
    transactions,
    deleted,
    budgets,
    settings,
    preferences: { theme: getPreference() },
    // The seed applies the debt migration before the app ever renders, and the
    // opening migration runs alongside it.
    migrations: { debt: true, opening: true },
  });

  /**
   * The whole system, including the three records it used to leave out.
   *
   * The button calls this "the whole system in one file" and it exported the
   * ledger, the bin, the budgets and the settings and nothing else. The
   * activity trail, the conversation and the assistant's own record were 604
   * documents against 451 transactions on this database, so more rows were
   * being dropped from the backup than kept in it.
   *
   * Read at the moment of the click rather than held in state, because they
   * are written by three separate stores and anything cached here would be
   * one message out of date the moment it was cached.
   */
  const handleBackup = async (): Promise<void> => {
    const uid = cloud.uid ?? null;
    const [activity, chat, ai] = await Promise.all([
      activityStore(uid).recent().catch(() => []),
      chatStore(uid).recent().catch(() => []),
      aiLogStore(uid).recent().catch(() => []),
    ]);

    const backup = createBackup(
      { ...systemState(), logs: { activity, chat, ai } },
      new Date().toISOString(),
    );
    download(
      `fms-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(backup, null, 2),
      "application/json",
    );
    flash(
      `Backed up ${transactions.length.toLocaleString()} transactions, every setting, and ${(
        activity.length + chat.length + ai.length
      ).toLocaleString()} records of what happened.`,
    );
  };

  const handleRestoreBackup = (backup: Backup, mode: RestoreMode): void => {
    const result = restore(backup, systemState(), mode);
    setTransactions([...result.transactions]);
    setDeleted([...result.deleted]);
    setBudgets(result.budgets);
    setSettings(result.settings);
    // The theme lives outside settings, so restoring it is a separate call.
    setPreference(result.preferences.theme);

    // Firestore is the source of truth when connected, so the restored ledger
    // has to reach it or the next snapshot would undo the restore.
    push((l) => l.saveMany(result.transactions));

    flash(
      mode === "replace"
        ? `Replaced everything. ${result.added.toLocaleString()} transactions restored.`
        : `Merged. ${result.added.toLocaleString()} added, ${result.kept.toLocaleString()} kept.`,
    );
  };

  /**
   * Upload everything to Firebase, on purpose.
   *
   * The automatic seed only fires when the database is completely empty, which
   * makes it invisible and unrepeatable. This is the same write, available on
   * demand, and safe to run twice: every row is written by id, so a second run
   * overwrites rather than duplicates.
   */
  const handleUpload = async (): Promise<void> => {
    const uid = cloud.uid;
    if (!uid) return;

    setUploading(true);
    try {
      await firestoreLedger(uid).saveMany(transactions);
      await firestoreSettingsStore(uid).save(settings);
      for (const [year, budget] of Object.entries(budgets)) {
        await saveBudget(uid, year, budget);
      }
      setSyncError(null);
      flash(`Uploaded ${transactions.length.toLocaleString()} transactions and every setting.`);
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleExport = (): void => {
    // Every part, not just the ledger. The old export wrote one account
    // statement, so opening it showed the database and nothing else.
    download(
      `financial-management-system-${asOf}.csv`,
      systemToCsv(systemState(), new Date().toISOString()),
      "text/csv;charset=utf-8",
    );
    flash("Exported the whole system as CSV.");
  };

  /**
   * The scrolling region, so a screen change can start at the top.
   *
   * The shell never scrolls; this element does. Switching screens left its
   * scrollTop where the previous screen had put it, so arriving at a shorter
   * screen from a scrolled position on a longer one showed a band of empty
   * space with the content already above the fold.
   *
   * ── Why this sits above the sign-in return ──────────────────────────────
   *
   * It did not, and that crashed the app the moment anyone signed in. Hooks
   * have to run in the same order on every render, and these were below the
   * early return: signed out they never ran, signed in they suddenly did,
   * so React counted two extra hooks and threw error 310. The sign-in popup
   * succeeded and the page went white.
   *
   * Every hook belongs above that return. There is nothing special about
   * these two.
   */
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [screen]);

  /** Every AI surface goes when AI or its chat is off (domain/aiSurface.ts). */
  const chatOn = aiSurfaceOn(settings.ai, "chat");

  /**
   * Keep the screen one this device actually offers.
   *
   * A phone has no Insights, a computer has no AI tab, and turning AI off
   * removes the AI tab everywhere. Resizing a window, or switching AI off,
   * could otherwise leave the app on a screen with no way back to it. The
   * computer's version of the AI tab is the floating chat, so arriving there
   * opens it. Above the sign-in return, like every hook here.
   */
  useEffect(() => {
    if (screen === "ai" && (!chatOn || !compact)) {
      setScreen("dashboard");
      if (chatOn) {
        setChatMounted(true);
        setChatOpen(true);
      }
      return;
    }
    if (compact && !PHONE_SCREENS.includes(screen)) setScreen("dashboard");
  }, [screen, compact, chatOn]);

  /** Escape closes the floating chat, unless a picture or a dialog is open over it. */
  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".fms-lightbox, .fms-backdrop")) return;
      setChatOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chatOpen]);

  /**
   * The assistant's actions for the chat outside the Add screen.
   *
   * The same path the Add screen's own chat uses (features/useProposalSink.ts).
   * "Edit first" cannot fill a form that is not on screen, so it opens the Add
   * screen with the card already in it.
   */
  const sink = useProposalSink({
    transactions,
    reference,
    debts: settings.credits,
    reserved: renumbers ? undefined : deleted,
    onSave: handleSave,
    onBin: handleDelete,
    onBinMany: handleDeleteMany,
    onRestore: handleRestore,
    onUse: (draft) => {
      setIncoming({ draft, at: Date.now() });
      setChatOpen(false);
      setScreen("add");
    },
  });

  // With Firebase configured, nothing renders until the owner is signed in,
  // the rules would deny every read anyway, so a half-rendered app would only
  // show empty screens and permission errors.
  if (cloud.configured && cloud.auth.status !== "ready") {
    return <SignIn auth={cloud.auth} onSignIn={cloud.signIn} onSignOut={cloud.signOut} />;
  }

  /**
   * `?coderview`: the whole database as text, for debugging.
   *
   * After the sign-in gate and before everything else, because it is not a
   * screen of the app: it has no nav item, no state of its own, and it reads
   * straight from Firestore rather than from what the app happens to have
   * loaded. See `features/CoderView.tsx` for why it exists and what makes it
   * safe to leave in.
   */
  if (typeof window !== "undefined" && window.location.search.includes("coderview")) {
    return (
      <CoderView
        uid={cloud.uid ?? null}
        local={{ transactions, deleted, budgets, settings }}
      />
    );
  }

  if (!base.loaded && !cloud.uid) {
    return (
      <Card>
        <EmptyState message="No ledger loaded. Run python tools/extract_fixture.py to load your Excel data." />
      </Card>
    );
  }

  const title = screen === "ai" ? "AI assistant" : (NAV.find((n) => n.id === screen)?.label ?? "");
  const go = (id: Screen): void => {
    setScreen(id);
    setChatOpen(false);
    // A search a link opened the Database with ends when you go elsewhere.
    setDbQuery(null);
  };

  return (
    <div
      className={[
        "fms-app",
        !compact && chatOn && screen !== "add" && "fms-app--fab",
        (chatOn ? BAR_WITH_AI : BAR).length % 2 === 0 && "fms-app--evennav",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Fixed sidebar. Never scrolls with the content. */}
      <aside className="fms-sidebar">
        <div className="fms-brand">
          <span aria-hidden className="fms-mark">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4.5h8M4 8h8M4 11.5h4.5" stroke="var(--on-brand)" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="t-body-strong">Finances</div>
            <div className="t-caption" style={{ color: "var(--ink-3)" }}>{formatMedium(asOf)}</div>
          </div>
        </div>

        <nav className="fms-nav" aria-label="Screens">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => go(n.id)}
              aria-current={screen === n.id ? "page" : undefined}
              className="fms-navitem"
            >
              <span aria-hidden className="fms-navicon">
                <Icon name={n.icon} />
              </span>
              <span className="fms-navlabel">{n.label}</span>
              {n.id === "bin" && deleted.length > 0 && (
                <span className="t-micro fms-navcount">{deleted.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="fms-networth">
          <div className="t-label" style={{ color: "var(--ink-2)" }}>Net worth</div>
          <Money value={view.worth.total} size="l" />
          {view.owed > 0 && (
            <div className="t-caption" style={{ color: "var(--ink-3)", marginTop: 2 }}>
              after <Money value={view.owed} size="s" tone="var(--flow-debt-text)" /> owed
            </div>
          )}
        </div>
      </aside>

      {/* Scrolling content column */}
      <div className="fms-content">
        <header className="fms-topbar safe-t">
          <div className="fms-topbar-titles">
            <h1 className="t-display-m" style={{ margin: 0 }}>{title}</h1>
            <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
              {transactions.length.toLocaleString()} records · net worth{" "}
              <Money value={view.worth.total} size="s" />
            </p>
          </div>
          {/* Settings on a phone: the bar has no room for it, and the AI switch lives there. */}
          {compact && (
            <button
              type="button"
              className="fms-topbar-action"
              aria-label="Settings"
              aria-current={screen === "settings" ? "page" : undefined}
              onClick={() => go("settings")}
            >
              <Icon name="settings" size={22} />
            </button>
          )}
        </header>

        {/*
          Settings scrolls its own panel at every width. The Database only
          does on a desktop: below that its rows are a plain list and the page
          has to scroll, which the fixed layout was switching off.
        */}
        <main
          ref={mainRef}
          className={`fms-main${
            screen === "settings" || screen === "ai"
              ? " fms-main--fixed"
              : screen === "database"
                ? " fms-main--fixed-lg"
                : ""
          }`}
        >
          {updateReady && (
            <div style={{ marginBottom: "var(--space-4)" }}>
              <Alert
                status="info"
                title="A newer version of the app is ready"
                action={
                  <Button size="sm" variant="primary" onClick={() => window.location.reload()}>
                    Reload
                  </Button>
                }
              >
                This tab is still running the version it opened with, so recent fixes are not on
                screen yet. A half-typed entry on the Add screen is kept.
              </Alert>
            </div>
          )}
          {syncError && (
            <div style={{ marginBottom: "var(--space-4)" }}>
              <Alert status="over" title="Not saving to Firebase">
                {syncError} Your changes are still on screen but are not reaching the database.
                check the security rules and that you are signed in as the owner.
              </Alert>
            </div>
          )}
          {screen === "dashboard" && (
            <Dashboard
              transactions={transactions}
              reference={reference}
              budgets={budgets}
              debts={settings.credits}
              balances={view.rows}
              accounts={settings.accounts}
              lowBalanceThreshold={settings.lowBalanceThreshold}
              asOf={asOf}
              onReview={() => { setDbFilter("flagged"); go("database"); }}
              settings={settings}
            />
          )}
          {screen === "add" && (
            <AddTransaction
              transactions={transactions}
              reference={reference}
              debts={settings.credits}
              balances={view.rows}
              uid={cloud.uid ?? null}
              onSave={handleSave}
              onBin={handleDelete}
              onBinMany={handleDeleteMany}
              onRestoreRow={handleRestore}
              deleted={deleted}
              reserved={renumbers ? undefined : deleted}
              onUpdate={handleUpdate}
              editing={editing}
              onCancelEdit={() => setEditing(null)}
              ai={settings.ai}
              settings={settings}
              budgets={budgets}
              asOf={asOf}
              showChat={chatOn && !compact}
              incoming={incoming}
              lastSaved={lastSaved}
              onSaved={setLastSaved}
            />
          )}
          {screen === "ai" && chatOn && (
            <div className="fms-aiscreen">
              <AskPanel
                sink={sink}
                deleted={deleted}
                debts={settings.credits}
                lastSaved={lastSaved}
                uid={cloud.uid ?? null}
                settings={settings}
                transactions={transactions}
                budgets={budgets}
                reference={reference}
                asOf={asOf}
              />
            </div>
          )}
          {screen === "database" && (
            <Database
              key={`${dbFilter}-${dbQuery?.at ?? 0}`}
              transactions={transactions}
              initialFilter={dbFilter}
              initialQuery={dbQuery?.query}
              onDelete={handleDelete}
              onDeleteMany={handleDeleteMany}
              onEdit={startEditing}
              asOf={asOf}
            />
          )}
          {screen === "debt" && (
            <DebtScreen
              transactions={transactions}
              debts={settings.credits}
              reference={reference}
              asOf={asOf}
              onAdd={() => go("add")}
            />
          )}
          {screen === "insights" && (
            <Insights
              transactions={transactions}
              reference={reference}
              budgets={budgets}
              debts={settings.credits}
              asOf={asOf}
              settings={settings}
            />
          )}
          {screen === "budget" && (
            <Budget
              transactions={transactions}
              budgets={budgets}
              debts={settings.credits}
              reference={reference}
              asOf={asOf}
              onReplaceYear={handleBudgetYear}
              onRecordBill={(bill) => {
                // Filled in and shown, never saved: the Add form is where it is checked.
                setIncoming({
                  draft: {
                    ...emptyDraft(asOf),
                    flow: "Spending",
                    category: bill.category,
                    item: bill.item,
                    amount: bill.amount,
                    status: "Paid",
                  },
                  at: Date.now(),
                });
                go("add");
              }}
              onShowRows={(query) => {
                go("database");
                setDbFilter("all");
                setDbQuery({ query, at: Date.now() });
              }}
            />
          )}
          {screen === "statements" && (
            <Statements
              transactions={transactions}
              reference={reference}
              debts={settings.credits}
              year={getYear(asOf)}
            />
          )}
          {screen === "bin" && (
            <Bin
              deleted={deleted}
              onRestore={handleRestore}
              onRestoreMany={handleRestoreMany}
              onPurge={handlePurge}
            />
          )}
          {screen === "activity" && (
            <Activity uid={cloud.uid ?? null} reloadKey={activityKey} onAdd={() => go("add")} />
          )}
          {screen === "settings" && (
            <Settings
              settings={settings}
              transactions={transactions}
              reference={reference}
              deleted={deleted}
              budgets={budgets}
              storeName={store.name}
              quota={cloud.uid ? FIRESTORE_QUOTA : BROWSER_QUOTA}
              onBackup={handleBackup}
              onRestore={handleRestoreBackup}
              onAddTransactions={handleSave}
              signedInUid={cloud.auth.status === "ready" ? cloud.auth.uid : undefined}
              ledgerSource={cloud.uid ? ledgerSource : undefined}
              uploading={uploading}
              onUpload={cloud.uid ? () => void handleUpload() : undefined}
              onChange={setSettings}
              onRenameAccount={(from, to) => handleRename("account", from, to)}
              onRenameItem={(from, to) => handleRename("item", from, to)}
              onExport={handleExport}
            />
          )}
        </main>
      </div>

      {/*
        Phone navigation: Dashboard, Database, Add, Budget, and the assistant.

        Add sits raised and round, per style guide §3.8: it is the action this
        app exists for. The AI tab is there only while AI is on.
      */}
      <nav
        className={
          (chatOn ? BAR_WITH_AI : BAR).length % 2 === 0
            ? "fms-bottomnav fms-bottomnav--even safe-b"
            : "fms-bottomnav safe-b"
        }
        aria-label="Screens"
      >
        {(chatOn ? BAR_WITH_AI : BAR).map((id, _, bar) => {
          const n = NAV.find((x) => x.id === id);
          const label = id === "ai" ? "AI" : (n?.label ?? "");
          const icon: IconName = id === "ai" ? "ai" : (n?.icon ?? "dashboard");
          const active = screen === id;

          if (id === "add") {
            return (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                aria-current={active ? "page" : undefined}
                aria-label="Add a transaction"
                className={`t-micro fms-bnitem fms-bnitem--add${active ? " fms-bnitem--on" : ""}`}
              >
                <span aria-hidden className="fms-bnadd">
                  <Icon name="add" size={bar.length % 2 === 0 ? 22 : 26} />
                </span>
                {/* Level with the others, it is labelled like them. */}
                {bar.length % 2 === 0 && (
                  <span aria-hidden className="fms-bnlabel">
                    Add
                  </span>
                )}
              </button>
            );
          }

          return (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              aria-current={active ? "page" : undefined}
              className={`t-micro fms-bnitem${active ? " fms-bnitem--on" : ""}`}
            >
              <Icon name={icon} size={24} />
              <span className="fms-bnlabel">{label}</span>
            </button>
          );
        })}
      </nav>

      {/*
        The assistant on a computer, on every screen but Add.

        A round button at the bottom right opens it. The Add screen keeps its
        chat beside the form instead, so the two are never on screen together
        writing to one conversation. Once opened it stays mounted while you move
        between screens, so an answer on its way is not lost by closing it.
      */}
      {!compact && chatOn && screen !== "add" && (
        <>
          {chatMounted && (
            <div className="fms-chatpop" role="dialog" aria-label="AI assistant" hidden={!chatOpen}>
              <button
                type="button"
                className="fms-chatpop-close"
                aria-label="Close the AI assistant"
                onClick={() => setChatOpen(false)}
              >
                <Icon name="close" size={20} />
              </button>
              <AskPanel
                sink={sink}
                deleted={deleted}
                debts={settings.credits}
                lastSaved={lastSaved}
                uid={cloud.uid ?? null}
                settings={settings}
                transactions={transactions}
                budgets={budgets}
                reference={reference}
                asOf={asOf}
              />
            </div>
          )}
          <button
            type="button"
            className="fms-chatfab"
            aria-label={chatOpen ? "Close the AI assistant" : "Open the AI assistant"}
            aria-expanded={chatOpen}
            onClick={() => {
              setChatMounted(true);
              setChatOpen((open) => !open);
            }}
          >
            <Icon name={chatOpen ? "close" : "ai"} size={26} />
          </button>
        </>
      )}

      {toast && (
        <div className="fms-toastwrap">
          <Toast>{toast}</Toast>
        </div>
      )}
    </div>
  );
}
