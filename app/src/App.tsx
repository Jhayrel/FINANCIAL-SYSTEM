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
import { Budget } from "./features/Budget";
import { Dashboard } from "./features/Dashboard";
import { Database } from "./features/Database";
import { DebtScreen } from "./features/DebtScreen";
import { Insights } from "./features/Insights";
import { Settings } from "./features/Settings";
import { Statements } from "./features/Statements";
import { Alert, Card, EmptyState, Money, Toast } from "./components/primitives";
import { loadLocalLedger } from "./data/localSource";
import { applyDebtMigration, planDebtMigration } from "./domain/debtMigration";
import { applyOpeningMigration, planOpeningMigration } from "./domain/year";
import { OBSOLETE_REVENUE_CATEGORY } from "./domain/opening";
import { cleanedSettings } from "./domain/settingsCleanup";
import { netWorth, positionsOf } from "./domain/debt";
import { totalSavingsBalance, totalWalletBalance, walletBalances } from "./domain/balances";
import { insertChronologically } from "./domain/entry";
import { formatMedium, getYear } from "./domain/dates";
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
import { migrateAccounts, renameAccount, renameItem } from "./domain/accounts";
import { defaultSettings, isBlankSettings, type AppSettings } from "./domain/settings";
import type { Centavos } from "./domain/money";
import type { Budgets, DeletedTransaction, ReferenceLists, Transaction } from "./domain/types";

type Screen =
  | "dashboard"
  | "add"
  | "database"
  | "debt"
  | "insights"
  | "budget"
  | "statements"
  | "bin"
  | "settings";

const NAV: { id: Screen; label: string; icon: string; primary?: boolean }[] = [
  { id: "dashboard", label: "Dashboard", icon: "◧", primary: true },
  { id: "add", label: "Add", icon: "＋", primary: true },
  { id: "database", label: "Database", icon: "☰", primary: true },
  { id: "debt", label: "Debt", icon: "◑", primary: true },
  { id: "insights", label: "Insights", icon: "◈" },
  { id: "budget", label: "Budget", icon: "▤" },
  { id: "statements", label: "Statements", icon: "▦" },
  { id: "bin", label: "Bin", icon: "⌫" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

/** The fixture is a snapshot ending 2026-08-28; anchor "today" to it. */
const AS_OF = "2026-08-29";

export default function App() {
  const cloud = useCloud();
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [dbFilter, setDbFilter] = useState<"all" | "flagged">("all");
  const [toast, setToast] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

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
      if (!cancelled && !isBlankSettings(stored)) setSettings(cleanedSettings(stored));
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
        return checksum(current) === checksum(next) ? current : next;
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
   * Reference lists are derived from settings, so every screen keeps working
   * against the shape it already knows while Settings edits the richer model.
   */
  const reference: ReferenceLists = useMemo(
    () => ({
      wallets: settings.accounts.filter((a) => a.kind === "spending" && !a.archived).map((a) => a.name),
      savings: settings.accounts
        .filter((a) => (a.kind === "savings" || a.kind === "goal" || a.kind === "reserve") && !a.archived)
        .map((a) => a.name),
      bills: settings.bills,
      subscriptions: settings.subscriptions,
      revenueCategories: settings.revenueCategories,
      spendingTypes: settings.spendingTypes,
    }),
    [settings],
  );

  const view = useMemo(() => {
    const positions = positionsOf(settings.credits, transactions, AS_OF);
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

  const handleSave = (rows: Transaction[]): void => {
    setTransactions((prev) => insertChronologically(prev, rows));
    push((l) => l.saveMany(rows));
    flash(
      rows.length > 1
        ? `Saved. ${rows.length} rows added.`
        : `Saved. Record #${String(rows[0]?.recordNumber ?? 0).padStart(4, "0")}.`,
    );
  };

  /** Soft delete: the row moves to the bin, never out of existence. */
  const handleDelete = (id: string): void => {
    const row = transactions.find((t) => t.id === id);
    if (!row) return;
    const at = new Date().toISOString();
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    setDeleted((prev) => [{ ...row, deletedAt: at }, ...prev]);
    push((l) => l.bin(id, at));
    flash(`Moved record #${String(row.recordNumber).padStart(4, "0")} to the bin.`);
  };

  const handleRestore = (id: string): void => {
    const row = deleted.find((t) => t.id === id);
    if (!row) return;
    setDeleted((prev) => prev.filter((t) => t.id !== id));
    const { deletedAt: _ignored, ...restored } = row;
    setTransactions((prev) => insertChronologically(prev, [restored]));
    push((l) => l.restore(id));
    flash(`Restored record #${String(row.recordNumber).padStart(4, "0")}.`);
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

  const handleBudgetChange = (
    year: number,
    month: number,
    track: "spending" | "billsSubs",
    value: Centavos,
  ): void => {
    setBudgets((prev) => {
      const key = String(year);
      const current = prev[key] ?? {
        spending: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const,
        billsSubs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const,
      };
      const next = [...current[track]];
      next[month - 1] = value;
      const updated = { ...current, [track]: next as unknown as typeof current.spending };
      if (cloud.uid) {
        saveBudget(cloud.uid, key, updated).catch((e: Error) => setSyncError(e.message));
      }
      return { ...prev, [key]: updated };
    });
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

  const handleBackup = (): void => {
    const backup = createBackup(systemState(), new Date().toISOString());
    download(
      `fms-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(backup, null, 2),
      "application/json",
    );
    flash(`Backed up ${transactions.length.toLocaleString()} transactions and every setting.`);
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
      `financial-management-system-${AS_OF}.csv`,
      systemToCsv(systemState(), new Date().toISOString()),
      "text/csv;charset=utf-8",
    );
    flash("Exported the whole system as CSV.");
  };

  // With Firebase configured, nothing renders until the owner is signed in,
  // the rules would deny every read anyway, so a half-rendered app would only
  // show empty screens and permission errors.
  if (cloud.configured && cloud.auth.status !== "ready") {
    return <SignIn auth={cloud.auth} onSignIn={cloud.signIn} onSignOut={cloud.signOut} />;
  }

  if (!base.loaded && !cloud.uid) {
    return (
      <Card>
        <EmptyState message="No ledger loaded. Run python tools/extract_fixture.py to load your Excel data." />
      </Card>
    );
  }

  const title = NAV.find((n) => n.id === screen)?.label ?? "";
  const go = (id: Screen): void => {
    setScreen(id);
    setMoreOpen(false);
  };

  return (
    <div className="fms-app">
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
            <div className="t-caption" style={{ color: "var(--ink-3)" }}>{formatMedium(AS_OF)}</div>
          </div>
        </div>

        <nav className="fms-nav">
          {NAV.map((n) => {
            const active = screen === n.id;
            return (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                aria-current={active ? "page" : undefined}
                className={`fms-navitem ${active ? "t-body-strong" : "t-body"}`}
                style={{
                  background: active ? "var(--brand-100)" : "transparent",
                  color: active ? "var(--brand-700)" : "var(--ink-2)",
                }}
              >
                <span aria-hidden className="fms-navicon">{n.icon}</span>
                {n.label}
                {n.id === "bin" && deleted.length > 0 && (
                  <span className="t-micro fms-navcount">{deleted.length}</span>
                )}
              </button>
            );
          })}
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
          <h1 className="t-display-m" style={{ margin: 0 }}>{title}</h1>
          <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
            {transactions.length.toLocaleString()} records · net worth{" "}
            <Money value={view.worth.total} size="s" />
          </p>
        </header>

        <main className={`fms-main${screen === "settings" ? " fms-main--fixed" : ""}`}>
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
              asOf={AS_OF}
              onReview={() => { setDbFilter("flagged"); go("database"); }}
            />
          )}
          {screen === "add" && (
            <AddTransaction
              transactions={transactions}
              reference={reference}
              debts={settings.credits}
              balances={view.rows}
              onSave={handleSave}
            />
          )}
          {screen === "database" && (
            <Database
              key={dbFilter}
              transactions={transactions}
              initialFilter={dbFilter}
              onDelete={handleDelete}
            />
          )}
          {screen === "debt" && (
            <DebtScreen
              transactions={transactions}
              debts={settings.credits}
              reference={reference}
              asOf={AS_OF}
              onAdd={() => go("add")}
            />
          )}
          {screen === "insights" && (
            <Insights
              transactions={transactions}
              reference={reference}
              budgets={budgets}
              debts={settings.credits}
              asOf={AS_OF}
            />
          )}
          {screen === "budget" && (
            <Budget
              transactions={transactions}
              budgets={budgets}
              debts={settings.credits}
              asOf={AS_OF}
              onChangeBudget={handleBudgetChange}
            />
          )}
          {screen === "statements" && (
            <Statements
              transactions={transactions}
              reference={reference}
              debts={settings.credits}
              year={getYear(AS_OF)}
            />
          )}
          {screen === "bin" && (
            <Bin deleted={deleted} onRestore={handleRestore} onPurge={handlePurge} />
          )}
          {screen === "settings" && (
            <Settings
              settings={settings}
              transactions={transactions}
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
              onRenameAccount={(from, to) =>
                setTransactions((prev) => renameAccount(prev, from, to))
              }
              onRenameItem={(from, to) => setTransactions((prev) => renameItem(prev, from, to))}
              onExport={handleExport}
            />
          )}
        </main>
      </div>

      {/* Phone bottom nav: four primary screens plus More */}
      <nav className="fms-bottomnav safe-b">
        {NAV.filter((n) => n.primary).map((n) => {
          const active = screen === n.id;
          return (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              aria-current={active ? "page" : undefined}
              className="t-micro fms-bnitem"
              style={{
                color: active ? "var(--brand-700)" : "var(--ink-3)",
                fontWeight: active ? 600 : 500,
              }}
            >
              <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{n.icon}</span>
              {n.label}
            </button>
          );
        })}
        <button
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          className="t-micro fms-bnitem"
          style={{
            color: moreOpen || !NAV.find((n) => n.id === screen)?.primary ? "var(--brand-700)" : "var(--ink-3)",
          }}
        >
          <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>⋯</span>
          More
        </button>
      </nav>

      {moreOpen && (
        <>
          <div className="fms-scrim" onClick={() => setMoreOpen(false)} />
          <div className="fms-sheet safe-b" role="dialog" aria-label="More screens">
            <div className="fms-sheethandle" aria-hidden />
            {NAV.filter((n) => !n.primary).map((n) => (
              <button key={n.id} onClick={() => go(n.id)} className="fms-navitem t-body" style={{ color: "var(--ink)" }}>
                <span aria-hidden className="fms-navicon">{n.icon}</span>
                {n.label}
                {n.id === "bin" && deleted.length > 0 && (
                  <span className="t-micro fms-navcount">{deleted.length}</span>
                )}
              </button>
            ))}
          </div>
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
