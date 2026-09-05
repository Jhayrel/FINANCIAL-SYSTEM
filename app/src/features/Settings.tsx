/**
 * Settings: docs/05-ACCOUNTS-AND-GOALS.md §3.
 *
 * Four fixed sections. The page itself never scrolls; only the panel under the
 * tabs does, so the tabs and the screen title stay put while you work.
 *
 * Everything here is editable and persisted. The one deliberate omission is a
 * field for an API key: see the AI section, and rule AI4.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Button,
  CountChip,
  EmptyState,
  Money,
  ProgressBar,
  StatusPill,
} from "../components/primitives";
import { AmountInput, Field, Select, Switch, TextInput } from "../components/forms";
import { useConfirm, type ConfirmRequest } from "../components/Confirm";
import {
  canArchive,
  goalProgress,
  KIND_HINT,
  KIND_LABEL,
  makeAccountId,
  renameImpact,
  validateAccount,
  type Account,
  type AccountKind,
} from "../domain/accounts";
import { walletBalance } from "../domain/balances";
import { describeClose, planGoalClose } from "../domain/goalClose";
import { validateBackup, type Backup, type RestoreMode, type Validation } from "../domain/backup";
import { formatBytes, measureStorage } from "../domain/storage";
import { cleanSettings } from "../domain/settingsCleanup";
import { canSetOpening, ledgerStart, openingRows } from "../domain/opening";
import { recoverAccounts } from "../domain/recovery";
import { AiAnswerView } from "../components/AiAnswer";
import { useAi } from "./useAi";
import {
  clearConfig,
  parseConfig,
  readConfig,
  readOwnerUid,
  saveConfig,
  saveOwnerUid,
} from "../data/firebaseConfig";
import { makeDebtId, positionsOf, type Debt, type DebtKind } from "../domain/debt";
import {
  DEBT_FORM_LABEL,
  debtExplanation,
  debtLabel,
  defaultsFor,
  headline,
  type DebtForm,
} from "../domain/debtForms";
import { formatMedium, today } from "../domain/dates";
import {
  AI_DEFAULT_MODEL,
  AI_PROVIDER_LABEL,
  AI_TONE_HINT,
  IMAGE_BOUNDS,
  imageLimits,
  type AiProvider,
  type AiSettings,
  type AiTone,
  type AppSettings,
  type ThemePreference,
} from "../domain/settings";
import { formatAmount, formatMoney, type Centavos } from "../domain/money";
import { chatStore } from "../data/chatStore";
import { aiLogHealth, aiLogStore } from "../data/aiLogStore";
import { activityStore } from "../data/activityStore";
import { correctionsFrom, type AiEvent } from "../domain/aiLog";
import type { ChatMessage } from "../domain/chat";
import { setPreference as setThemePreference } from "../theme";
import type { Budgets, ReferenceLists, SpendingType, Transaction } from "../domain/types";

type Tab =
  | "accounts"
  | "goals"
  | "credit"
  | "categories"
  | "alerts"
  | "ai"
  | "appearance"
  | "data";

const TABS: { id: Tab; label: string }[] = [
  { id: "accounts", label: "Accounts" },
  { id: "goals", label: "Goals" },
  { id: "credit", label: "Credit and loans" },
  { id: "categories", label: "Categories" },
  { id: "alerts", label: "Alerts" },
  { id: "ai", label: "AI" },
  { id: "appearance", label: "Appearance" },
  { id: "data", label: "Data" },
];

const KINDS: AccountKind[] = ["spending", "reserve", "savings", "goal"];
const GROUPS: AccountKind[] = ["spending", "reserve", "savings"];

export function Settings({
  settings,
  transactions,
  reference,
  deleted,
  budgets,
  storeName,
  quota,
  onChange,
  onRenameAccount,
  onRenameItem,
  onExport,
  onBackup,
  onRestore,
  onAddTransactions,
  signedInUid,
  ledgerSource,
  uploading,
  onUpload,
}: {
  settings: AppSettings;
  transactions: readonly Transaction[];
  /** Derived from settings in App, passed in so it is derived exactly once. */
  reference: ReferenceLists;
  deleted: readonly Transaction[];
  budgets: Readonly<Record<string, unknown>>;
  storeName: string;
  /** Bytes the store will hold before it starts refusing writes. */
  quota: number;
  onChange: (next: AppSettings) => void;
  onRenameAccount: (from: string, to: string) => void;
  onRenameItem: (from: string, to: string) => void;
  onExport: () => void;
  onBackup: () => void;
  onRestore: (backup: Backup, mode: RestoreMode) => void;
  /** Closing a goal writes real rows, so Settings needs a way to add them. */
  onAddTransactions: (rows: Transaction[]) => void;
  /** Who is signed in right now, if anyone. Shown so setup can be finished. */
  signedInUid?: string | undefined;
  /** Whether the rows on screen came from Firestore or are still the seed. */
  ledgerSource?: "seed" | "live" | undefined;
  uploading?: boolean | undefined;
  onUpload?: (() => void) | undefined;
}) {
  const [tab, setTab] = useState<Tab>("accounts");
  const patch = (part: Partial<AppSettings>): void => onChange({ ...settings, ...part });

  const goals = useMemo(
    () => settings.accounts.filter((a) => a.kind === "goal"),
    [settings.accounts],
  );

  const counts: Record<Tab, number> = {
    accounts: settings.accounts.filter((a) => a.kind !== "goal" && !a.archived).length,
    goals: goals.filter((g) => !g.archived).length,
    credit: settings.credits.filter((c) => !c.archived).length,
    categories:
      settings.bills.length +
      settings.subscriptions.length +
      settings.revenueCategories.length +
      settings.spendingTypes.length,
    alerts: 0,
    ai: 0,
    appearance: 0,
    data: 0,
  };

  return (
    <div className="fms-settings">
      <div className="fms-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`fms-tab ${tab === t.id ? "t-body-strong" : "t-body"}`}
          >
            {t.label}
            {counts[t.id] > 0 && (
              <span className="t-micro" style={{ marginLeft: 6, opacity: 0.75 }}>
                {counts[t.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="fms-panel-scroll">
       <div className="fms-settings-inner">
        {tab === "accounts" && (
          <AccountsSection
            accounts={settings.accounts}
            transactions={transactions}
            onChange={(accounts) => patch({ accounts })}
            onRename={onRenameAccount}
            onAddTransactions={onAddTransactions}
          />
        )}

        {tab === "goals" && (
          <GoalsSection
            goals={goals}
            accounts={settings.accounts}
            transactions={transactions}
            onChange={(accounts) => patch({ accounts })}
            onAddTransactions={onAddTransactions}
          />
        )}

        {tab === "credit" && (
          <CreditLines
            credits={settings.credits}
            accounts={settings.accounts}
            transactions={transactions}
            onChange={(credits) => patch({ credits })}
          />
        )}

        {tab === "categories" && (
          <CategoriesSection
            settings={settings}
            transactions={transactions}
            patch={patch}
            onRenameItem={onRenameItem}
          />
        )}

        {tab === "alerts" && <AlertsSection settings={settings} patch={patch} />}

        {tab === "ai" && (
          <AiSection
            settings={settings}
            patch={patch}
            transactions={transactions}
            budgets={budgets as Budgets}
            reference={reference}
            signedInUid={signedInUid ?? null}
          />
        )}

        {tab === "appearance" && <AppearanceSection settings={settings} patch={patch} />}

        {tab === "data" && (
          <DataSection
            transactions={transactions}
            deleted={deleted}
            budgets={budgets}
            settings={settings}
            storeName={storeName}
            quota={quota}
            onExport={onExport}
            onBackup={onBackup}
            onRestore={onRestore}
            onChangeSettings={onChange}
            signedInUid={signedInUid}
            ledgerSource={ledgerSource}
            uploading={uploading}
            onUpload={onUpload}
          />
        )}
       </div>
      </div>
    </div>
  );
}

// ── Shared bits ────────────────────────────────────────────────────────────

function Group({
  title,
  hint,
  action,
  wide,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  /** Give the section the whole row: for tables wider than two columns. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`fms-card fms-setgroup${wide ? " fms-card--wide" : ""}`}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-3)" }}>
        <div>
          <div className="t-display-m">{title}</div>
          {hint && (
            <p className="t-caption" style={{ margin: "2px 0 0", color: "var(--ink-3)" }}>{hint}</p>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

// ── Accounts ───────────────────────────────────────────────────────────────

function AccountsSection({
  accounts,
  transactions,
  onChange,
  onRename,
  onAddTransactions,
}: {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  onChange: (accounts: Account[]) => void;
  onRename: (from: string, to: string) => void;
  onAddTransactions: (rows: Transaction[]) => void;
}) {
  const [adding, setAdding] = useState("");
  const [kind, setKind] = useState<AccountKind>("spending");
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  /**
   * Archived goals live on the Goals tab, not here.
   *
   * A goal is a label over its parent account, so listing "Maya Bank (Drone)"
   * beside Maya Bank itself reads as two accounts when it is one.
   */
  const inactive = accounts.filter((a) => a.archived && a.kind !== "goal");

  const add = (): void => {
    const name = adding.trim();
    const account: Account = { id: makeAccountId(name), name, kind, archived: false };
    const issues = validateAccount(account, accounts, transactions);
    if (issues.length > 0) {
      setError(issues[0]!.message);
      return;
    }
    onChange([...accounts, account]);
    setAdding("");
    setError(null);
  };

  const update = (id: string, part: Partial<Account>): void =>
    onChange(accounts.map((a) => (a.id === id ? { ...a, ...part } : a)));

  return (
    <>
      {dialog}

      <Group
        title="Accounts"
        hint="Every place your money sits, grouped by what it is for"
        action={<CountChip>{accounts.filter((a) => a.kind !== "goal" && !a.archived).length}</CountChip>}
      >
        <table className="fms-table">
          <thead>
            <tr>
              <th>Account</th>
              <th className="fms-th-right fms-shrink">Balance</th>
              <th style={{ width: 150 }}>Type</th>
              <th className="fms-shrink" />
            </tr>
          </thead>
          <tbody>
            {GROUPS.flatMap((group) => {
              const rows = accounts.filter((a) => a.kind === group && !a.archived);
              return [
                <tr key={`h-${group}`} className="fms-grouphead">
                  <th colSpan={4} className="t-label">
                    <span className="fms-groupname">
                      <span className="t-body-strong">{KIND_LABEL[group]}</span>
                      <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                        {KIND_HINT[group]}
                      </span>
                    </span>
                  </th>
                </tr>,
                ...(rows.length === 0
                  ? [
                      <tr key={`e-${group}`}>
                        <td colSpan={4} className="t-caption" style={{ color: "var(--ink-3)" }}>
                          Nothing here yet.
                        </td>
                      </tr>,
                    ]
                  : rows.map((a) => (
                      <AccountRow
                        key={a.id}
                        account={a}
                        accounts={accounts}
                        transactions={transactions}
                        confirm={confirm}
                        onUpdate={(part) => update(a.id, part)}
                        onRename={onRename}
                        onAddTransactions={onAddTransactions}
                      />
                    ))),
              ];
            })}
          </tbody>
        </table>

        <div className="fms-addrow">
          <span className="fms-grow">
            <TextInput
              value={adding}
              onChange={(v) => { setAdding(v); setError(null); }}
              placeholder="Name, exactly as you'll use it"
            />
          </span>
          <span style={{ width: 150 }}>
            <Select
              value={KIND_LABEL[kind]}
              onChange={(label) => {
                const found = KINDS.find((k) => KIND_LABEL[k] === label);
                if (found) setKind(found);
              }}
              options={GROUPS.map((k) => KIND_LABEL[k])}
            />
          </span>
          <Button variant="primary" onClick={add} disabled={!adding.trim()}>Add account</Button>
        </div>
        {error && (
          <p className="t-caption" style={{ margin: "var(--space-2) 0 0", color: "var(--over)" }}>{error}</p>
        )}
      </Group>

      {inactive.length > 0 && (
        <Group
          title="Inactive"
          hint="Hidden from pickers. Still counted in history and net worth."
          action={<CountChip>{inactive.length}</CountChip>}
        >
          <table className="fms-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="fms-th-right fms-shrink">Balance</th>
                <th className="fms-shrink" />
              </tr>
            </thead>
            <tbody>
              {inactive.map((a) => (
                <tr key={a.id}>
                  <td className="fms-cell-flex">
                    <span className="t-body fms-truncate" style={{ color: "var(--ink-3)" }} title={a.name}>
                      {a.name}
                    </span>
                    <span className="t-micro" style={{ color: "var(--ink-3)" }}>{KIND_LABEL[a.kind]}</span>
                  </td>
                  <td className="fms-td-right">
                    <Money value={walletBalance(transactions, a.name)} size="s" tone="var(--ink-3)" />
                  </td>
                  <td>
                    <span className="fms-rowactions">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Reactivate ${a.name}?`,
                            body: "It comes back in every wallet picker. Its history and balance are unchanged.",
                            confirmLabel: "Reactivate",
                          });
                          if (ok) update(a.id, { archived: false });
                        }}
                      >
                        Reactivate
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Group>
      )}
    </>
  );
}

function AccountRow({
  account,
  accounts,
  transactions,
  confirm,
  onUpdate,
  onRename,
  onAddTransactions,
}: {
  account: Account;
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  confirm: (req: ConfirmRequest) => Promise<boolean>;
  onUpdate: (part: Partial<Account>) => void;
  onRename: (from: string, to: string) => void;
  onAddTransactions: (rows: Transaction[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [startAmount, setStartAmount] = useState<Centavos | null>(null);

  /**
   * Dated before everything else, so it is the position you started from.
   *
   * Putting it on today would make the balance right and the history wrong:
   * every report before today would show the account empty, and the day you
   * set it up would look like the day the money appeared.
   */
  const commitOpening = async (): Promise<void> => {
    if (startAmount === null || startAmount === 0) return;

    const check = canSetOpening(account.name, transactions);
    if (!check.ok) {
      setBlocked(check.reason ?? "That cannot be set now.");
      setOpening(false);
      return;
    }

    const ok = await confirm({
      title: `Start ${account.name} at ₱${formatAmount(startAmount)}?`,
      body: `This records what the account already held before your first entry. It is not income, so it never appears in a revenue figure, and it can only be set once: from here on the balance moves only when you add a transaction.`,
      confirmLabel: "Set starting balance",
    });
    if (!ok) return;

    /**
     * Dated with the ledger's first entry, not the day before it.
     *
     * The day before sounds more correct and is worse in every way that
     * shows. On a ledger starting 1 January it lands on 31 December of the
     * previous year, which puts the money outside the year every report
     * filters by, so a PHP 5,000.00 starting balance counted towards
     * nothing, and left it the last of 442 rows sorted newest first, nine
     * pages down. It looked like it had not saved at all.
     *
     * Sharing the first day is also simply true: this is what the account
     * held when the record begins, and the record begins that day.
     */
    // The same definition the repair uses, so the two cannot disagree about
    // where the ledger begins and undo each other. See domain/opening.ts.
    const startsOn = ledgerStart(transactions) ?? today();

    const nextNumber = Math.max(0, ...transactions.map((t) => t.recordNumber)) + 1;
    onAddTransactions(
      openingRows([{ account: account.name, amount: startAmount }], startsOn, nextNumber),
    );

    setOpening(false);
    setStartAmount(null);
  };

  const balance = walletBalance(transactions, account.name);
  const impact = renameImpact(transactions, account.name);
  const goalCount = accounts.filter((a) => a.parentId === account.id && !a.archived).length;

  const commitRename = async (): Promise<void> => {
    const next = name.trim();
    if (!next || next === account.name) {
      setEditing(false);
      return;
    }

    const ok = await confirm({
      title: `Rename to “${next}”?`,
      body:
        impact > 0
          ? `${impact} historical row${impact === 1 ? "" : "s"} will be rewritten to the new name, so the balance follows it. Nothing else changes.`
          : "No historical rows mention this account yet, so only the name changes.",
      confirmLabel: "Rename",
    });
    if (!ok) return;

    onRename(account.name, next);
    onUpdate({ name: next, id: makeAccountId(next) });
    setEditing(false);
  };

  const changeKind = async (label: string): Promise<void> => {
    const found = KINDS.find((k) => KIND_LABEL[k] === label);
    if (!found || found === "goal" || found === account.kind) return;

    // A stray scroll over a dropdown used to silently move a wallet out of
    // Spending, which quietly changes what the dashboard counts.
    const ok = await confirm({
      title: `Move ${account.name} to ${KIND_LABEL[found]}?`,
      body: `${KIND_HINT[found]}. Its balance of ₱${formatAmount(balance)} and its whole history stay exactly as they are. Only where it appears changes.`,
      confirmLabel: `Move to ${KIND_LABEL[found]}`,
    });
    if (ok) onUpdate({ kind: found });
  };

  const deactivate = async (): Promise<void> => {
    const check = canArchive(account, transactions);
    if (!check.ok) {
      setBlocked(`${check.reason} ${check.fix}`);
      return;
    }

    const ok = await confirm({
      title: `Deactivate ${account.name}?`,
      body: "It disappears from every wallet picker, so you cannot file new transactions against it. History and net worth are untouched, and you can reactivate it whenever you like.",
      confirmLabel: "Deactivate",
      tone: "danger",
    });
    if (ok) onUpdate({ archived: true });
  };

  if (editing) {
    return (
      <tr>
        <td className="fms-cell-flex">
          <TextInput value={name} onChange={setName} />
        </td>
        <td className="fms-td-right">
          <Money value={balance} size="s" tone="var(--ink-3)" />
        </td>
        <td className="t-caption" style={{ color: "var(--ink-3)" }}>
          {KIND_LABEL[account.kind]}
        </td>
        <td>
          <span className="fms-rowactions">
            <Button size="sm" variant="primary" onClick={() => void commitRename()}>Save</Button>
            <Button size="sm" variant="secondary" onClick={() => { setName(account.name); setEditing(false); }}>
              Cancel
            </Button>
          </span>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr>
        <td className="fms-cell-flex">
          <span className="t-body fms-truncate" title={account.name}>{account.name}</span>
          {goalCount > 0 && (
            <span className="t-micro" style={{ color: "var(--ink-3)" }}>
              {goalCount} goal{goalCount === 1 ? "" : "s"} inside
            </span>
          )}
        </td>
        <td className="fms-td-right">
          {/*
            The offer lives on the balance, not in the action column.

            As a third button it squeezed into the 96px every action gets,
            and left rows that had it out of line with rows that did not,
            since only accounts with no history are offered one. Here it
            replaces the zero it would be correcting, which is where you
            would look for it anyway, and the actions stay two wide on every
            row.

            `canSetOpening` refuses once the account has any history or
            already has a starting balance, so it cannot be set twice or set
            on top of real transactions. That is what makes remembering a
            missed entry later harmless: the missed entry is an ordinary
            transaction on its own date.
          */}
          {canSetOpening(account.name, transactions).ok ? (
            <Button size="sm" variant="secondary" onClick={() => setOpening(true)}>
              Set starting balance
            </Button>
          ) : (
            <Money value={balance} size="s" tone={balance === 0 ? "var(--ink-3)" : undefined} />
          )}
        </td>
        <td>
          <Select
            value={KIND_LABEL[account.kind]}
            onChange={(label) => void changeKind(label)}
            options={GROUPS.map((k) => KIND_LABEL[k])}
          />
        </td>
        <td>
          <span className="fms-rowactions">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Rename</Button>
            <Button size="sm" variant="danger" onClick={() => void deactivate()}>Deactivate</Button>
          </span>
        </td>
      </tr>

      {opening && (
        <tr>
          <td colSpan={4}>
            <div className="fms-addrow">
              <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                What {account.name} held on the day you started recording
              </span>
              <AmountInput value={startAmount} onChange={setStartAmount} />
              <Button
                size="sm"
                variant="primary"
                disabled={startAmount === null || startAmount === 0}
                onClick={() => void commitOpening()}
              >
                Set it
              </Button>
              <Button size="sm" onClick={() => { setOpening(false); setStartAmount(null); }}>
                Cancel
              </Button>
              <span className="t-caption" style={{ color: "var(--ink-3)" }}>
                Recorded once, dated with your first entry. It is not income and never counts as
                revenue.
              </span>
            </div>
          </td>
        </tr>
      )}

      {blocked && (
        <tr>
          <td colSpan={4}>
            <Alert
              status="warn"
              action={<Button size="sm" onClick={() => setBlocked(null)}>Got it</Button>}
            >
              {blocked}
            </Alert>
          </td>
        </tr>
      )}
    </>
  );
}

function GoalsSection({
  goals,
  accounts,
  transactions,
  onChange,
  onAddTransactions,
}: {
  goals: readonly Account[];
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  onChange: (accounts: Account[]) => void;
  onAddTransactions: (rows: Transaction[]) => void;
}) {
  const parents = accounts.filter(
    (a) => (a.kind === "savings" || a.kind === "reserve") && !a.archived,
  );

  const { confirm, dialog } = useConfirm();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState(parents[0]?.id ?? "");
  const [target, setTarget] = useState<Centavos | null>(null);
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState<string | null>(null);

  const parent = parents.find((p) => p.id === parentId);
  const active = goals.filter((g) => !g.archived);
  const done = goals.filter((g) => g.archived);

  const add = (): void => {
    // Named inside its parent, so a goal reads as part of it in the ledger.
    const stem = parent ? parent.name.replace(/\s*\(.*\)$/, "") : "";
    const fullName = parent ? `${stem} (${name.trim()})` : name.trim();

    const goal: Account = {
      id: makeAccountId(fullName),
      name: fullName,
      kind: "goal",
      parentId,
      target: target ?? 0,
      deadline,
      openedDate: today(),
      archived: false,
    };

    const issues = validateAccount(goal, accounts, transactions);
    if (issues.length > 0) {
      setError(issues[0]!.message);
      return;
    }

    onChange([...accounts, goal]);
    setName("");
    setTarget(null);
    setDeadline("");
    setError(null);
  };

  const update = (id: string, part: Partial<Account>): void =>
    onChange(accounts.map((a) => (a.id === id ? { ...a, ...part } : a)));

  return (
    <>
      {dialog}

      <Group
        title="Active goals"
        hint="A savings target inside an account. Funded by an ordinary transfer."
        action={<CountChip>{active.length}</CountChip>}
      >
        {active.length === 0 ? (
          <EmptyState message="No goals yet. Add one below to start putting money aside for something." />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {active.map((g) => (
              <GoalRow
                key={g.id}
                goal={g}
                accounts={accounts}
                transactions={transactions}
                onUpdate={(part) => update(g.id, part)}
                onAddTransactions={onAddTransactions}
              />
            ))}
          </div>
        )}
      </Group>

      <Group title="Add a goal">
        {parents.length === 0 ? (
          <Alert status="info">Add a savings or reserve account first: a goal lives inside one.</Alert>
        ) : (
          <>
            <div style={{ display: "grid", gap: "var(--space-3)", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="t-label" style={{ color: "var(--ink-2)" }}>What for</span>
                <TextInput value={name} onChange={(v) => { setName(v); setError(null); }} placeholder="Buy iPhone" />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="t-label" style={{ color: "var(--ink-2)" }}>Inside</span>
                <Select
                  value={parent?.name ?? ""}
                  onChange={(n) => setParentId(parents.find((p) => p.name === n)?.id ?? "")}
                  options={parents.map((p) => p.name)}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="t-label" style={{ color: "var(--ink-2)" }}>Target</span>
                <AmountInput value={target} onChange={setTarget} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="t-label" style={{ color: "var(--ink-2)" }}>Deadline</span>
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="t-body fms-control"
                />
              </label>
            </div>

            {error && (
              <p className="t-caption" style={{ margin: "var(--space-2) 0 0", color: "var(--over)" }}>{error}</p>
            )}

            <div style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
              <Button onClick={add} disabled={!name.trim() || !target || !deadline}>Add goal</Button>
              {parent && name.trim() && (
                <span className="t-micro" style={{ color: "var(--ink-3)" }}>
                  Creates “{parent.name.replace(/\s*\(.*\)$/, "")} ({name.trim()})”. Fund it with a transfer.
                  your balances do not change, the money is just spoken for.
                </span>
              )}
            </div>
          </>
        )}
      </Group>

      {done.length > 0 && (
        <Group title="Done" hint="Finished goals. Still in history." action={<CountChip>{done.length}</CountChip>}>
          <table className="fms-table">
            <thead>
              <tr>
                <th>Goal</th>
                <th className="fms-th-right fms-shrink">Balance</th>
                <th className="fms-shrink" />
              </tr>
            </thead>
            <tbody>
              {done.map((g) => (
                <tr key={g.id}>
                  <td><span className="t-body" style={{ color: "var(--ink-3)" }}>{g.name}</span></td>
                  <td className="fms-td-right">
                    <Money value={walletBalance(transactions, g.name)} size="s" tone="var(--ink-3)" />
                  </td>
                  <td>
                    <span className="fms-rowactions">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Reopen ${g.name}?`,
                            body: "It goes back to the active list and starts counting towards its target again.",
                            confirmLabel: "Reopen",
                          });
                          if (ok) update(g.id, { archived: false });
                        }}
                      >
                        Reopen
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Group>
      )}
    </>
  );
}

const GOAL_STATUS_TONE = {
  active: "info",
  reached: "ok",
  matured: "warn",
  archived: "none",
} as const;

function GoalRow({
  goal,
  accounts,
  transactions,
  onUpdate,
  onAddTransactions,
}: {
  goal: Account;
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  onUpdate: (part: Partial<Account>) => void;
  onAddTransactions: (rows: Transaction[]) => void;
}) {
  const [blocked, setBlocked] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [actualBalance, setActualBalance] = useState<Centavos | null>(null);
  const { confirm, dialog } = useConfirm();

  /** Record numbers continue from the end of the ledger. */
  const nextRecord =
    transactions.reduce((a, t) => Math.max(a, t.recordNumber), 0) + 1;
  const p = goalProgress(goal, transactions);
  const parent = accounts.find((a) => a.id === goal.parentId);

  /**
   * Closing a goal.
   *
   * The old version refused whenever the goal still held money and told you to
   * go and transfer it yourself. This writes the transfer instead, because the
   * moment you close the goal is the moment you know where the money should go.
   *
   * If the goal lives in a real bank, it asks what the bank actually says
   * first. Nothing here is connected to one, so interest the bank paid is
   * invisible until someone types it in, and this is the one moment you are
   * looking at that account.
   */
  const finish = async (): Promise<void> => {
    const dry = planGoalClose(goal, accounts, transactions, {
      today: today(),
      nextRecordNumber: nextRecord,
    });

    if (dry.blocked) {
      setBlocked(dry.blocked);
      return;
    }

    let actual: Centavos | undefined;

    if (dry.couldEarnInterest && dry.recorded > 0) {
      const asked = await confirm({
        title: `Does ${parent?.name ?? "the bank"} agree?`,
        body: `This app has ${formatMoney(dry.recorded)} in ${goal.name}. If the bank shows more, the difference is interest it paid that was never recorded here. Check it now, because after closing there is nothing left to compare against.`,
        confirmLabel: "The bank shows something different",
        cancelLabel: "It matches",
      });
      if (asked) {
        setReconciling(true);
        return;
      }
    }

    await commitClose(actual);
  };

  const commitClose = async (actual: Centavos | undefined): Promise<void> => {
    const plan = planGoalClose(goal, accounts, transactions, {
      today: today(),
      nextRecordNumber: nextRecord,
      ...(actual === undefined ? {} : { reconcile: { actual } }),
    });

    if (plan.blocked) {
      setBlocked(plan.blocked);
      return;
    }

    const ok = await confirm({
      title: `Close ${goal.name}?`,
      body: describeClose(plan, formatMoney),
      confirmLabel: "Close it",
    });
    if (!ok) return;

    if (plan.rows.length > 0) onAddTransactions([...plan.rows]);
    onUpdate({ archived: true });
    setReconciling(false);
  };

  return (
    <div style={{ padding: "var(--space-3)", background: "var(--surface-sunk)", borderRadius: "var(--radius-md)" }}>
      {dialog}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <span className="t-body-strong">{goal.name}</span>
        <StatusPill status={GOAL_STATUS_TONE[p.status]}>{p.status}</StatusPill>
      </div>

      <div style={{ margin: "var(--space-2) 0" }}>
        <ProgressBar value={p.saved} max={p.target || 1} />
      </div>

      <div className="t-caption" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)", color: "var(--ink-2)" }}>
        <span><Money value={p.saved} size="s" /> of <Money value={p.target} size="s" tone="var(--ink-3)" /></span>
        {p.remaining > 0 && <span><Money value={p.remaining} size="s" tone="var(--ink-3)" /> to go</span>}
        {goal.deadline && <span>by {formatMedium(goal.deadline)}</span>}
        {parent && <span style={{ color: "var(--ink-3)" }}>in {parent.name}</span>}
      </div>

      {p.requiredPerMonth !== undefined && (
        <p className="t-caption" style={{ margin: "var(--space-2) 0 0", color: p.onTrack ? "var(--ok)" : "var(--warn)" }}>
          <Money value={p.requiredPerMonth} size="s" tone={p.onTrack ? "var(--ok)" : "var(--warn)"} />/month to make it
          {!p.onTrack && ", currently behind"}
        </p>
      )}

      {p.status === "matured" && (
        <div style={{ marginTop: "var(--space-2)" }}>
          <Alert status="warn" title="Deadline passed">
            Saved <Money value={p.saved} size="s" /> of <Money value={p.target} size="s" />. Spend it, move it
            back to {parent?.name ?? "the parent"}, or extend the deadline. The app will not move your money for you.
          </Alert>
        </div>
      )}

      {p.status === "reached" && (
        <div style={{ marginTop: "var(--space-2)" }}>
          <Alert status="ok" title="Target reached">
            <Money value={p.saved} size="s" /> saved. Record the purchase as a Spending row from this goal,
            then mark it done.
          </Alert>
        </div>
      )}

      {reconciling && (
        <div style={{ marginTop: "var(--space-3)" }}>
          <Alert status="info" title={`What does ${parent?.name ?? "the bank"} actually show?`}>
            <p className="t-caption" style={{ margin: "0 0 var(--space-3)", color: "var(--ink-2)" }}>
              Type the balance on the bank's own screen. Anything above{" "}
              {formatMoney(walletBalance(transactions, goal.name))} is recorded as interest before
              the money moves back.
            </p>
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ width: 160 }}>
                <AmountInput value={actualBalance} onChange={setActualBalance} />
              </span>
              <Button
                size="sm"
                variant="primary"
                disabled={actualBalance === null}
                onClick={() => void commitClose(actualBalance ?? undefined)}
              >
                Continue
              </Button>
              <Button size="sm" onClick={() => setReconciling(false)}>Cancel</Button>
            </div>
          </Alert>
        </div>
      )}

      {blocked && (
        <div style={{ marginTop: "var(--space-2)" }}>
          <Alert status="warn">{blocked}</Alert>
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ width: 150 }}>
          <input
            type="date"
            value={goal.deadline ?? ""}
            onChange={(e) => {
              const next = e.target.value;
              void (async () => {
                const ok = await confirm({
                  title: `Move the deadline to ${next}?`,
                  body: "The monthly amount needed to reach the target is recalculated from today to the new date.",
                  confirmLabel: "Move it",
                });
                if (ok) onUpdate({ deadline: next });
              })();
            }}
            aria-label={`Deadline for ${goal.name}`}
            className="t-body fms-control"
          />
        </span>
        <span style={{ width: 140 }}>
          <AmountInput
            value={goal.target ?? 0}
            onChange={(v) => {
              const next = v ?? 0;
              if (next === (goal.target ?? 0)) return;
              void (async () => {
                const ok = await confirm({
                  title: "Change the target?",
                  body: `The goal will aim for ${formatAmount(next)} instead. What you have already put aside is unchanged.`,
                  confirmLabel: "Change it",
                });
                if (ok) onUpdate({ target: next });
              })();
            }}
          />
        </span>
        <Button size="sm" onClick={() => void finish()}>Mark done</Button>
      </div>
    </div>
  );
}

// ── Categories ─────────────────────────────────────────────────────────────

function CategoriesSection({
  settings,
  transactions,
  patch,
  onRenameItem,
}: {
  settings: AppSettings;
  transactions: readonly Transaction[];
  patch: (part: Partial<AppSettings>) => void;
  onRenameItem: (from: string, to: string) => void;
}) {
  return (
    <>
      <StringList
        title="Bills"
        singular="Bill"
        hint="Recurring. Predicted one month after the last payment."
        values={settings.bills}
        onChange={(bills) => patch({ bills })}
      />
      <StringList
        title="Subscriptions"
        singular="Subscription"
        hint="Same prediction, separate budget line"
        values={settings.subscriptions}
        onChange={(subscriptions) => patch({ subscriptions })}
      />
      <StringList
        title="Revenue categories"
        singular="Revenue category"
        hint="Sources of money in"
        values={settings.revenueCategories}
        onChange={(revenueCategories) => patch({ revenueCategories })}
      />
      <SpendingTypes
        types={settings.spendingTypes}
        transactions={transactions}
        onChange={(spendingTypes) => patch({ spendingTypes })}
        onRename={onRenameItem}
      />
    </>
  );
}

function StringList({
  title,
  singular,
  hint,
  values,
  onChange,
}: {
  title: string;
  singular: string;
  hint: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
}) {
  const [adding, setAdding] = useState("");
  const { confirm, dialog } = useConfirm();

  const add = (): void => {
    const name = adding.trim();
    if (!name || values.some((v) => v.toLowerCase() === name.toLowerCase())) return;
    onChange([...values, name]);
    setAdding("");
  };

  const remove = async (v: string): Promise<void> => {
    const ok = await confirm({
      title: `Remove \u201c${v}\u201d?`,
      body: `It disappears from the ${singular.toLowerCase()} list and stops being predicted. Transactions already filed under it keep the name and still count.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (ok) onChange(values.filter((x) => x !== v));
  };

  return (
    <Group title={title} hint={hint} action={<CountChip>{values.length}</CountChip>}>
      {dialog}
      {values.length === 0 ? (
        <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
          No {title.toLowerCase()} yet.
        </p>
      ) : (
        <table className="fms-table">
          <thead>
            <tr>
              <th>{singular}</th>
              <th className="fms-shrink" />
            </tr>
          </thead>
          <tbody>
            {values.map((v) => (
              <tr key={v}>
                <td><span className="t-body">{v}</span></td>
                <td>
                  <span className="fms-rowactions">
                    <Button size="sm" variant="danger" ariaLabel={`Remove ${v}`} onClick={() => void remove(v)}>
                      Remove
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="fms-addrow">
        <span className="fms-grow">
          <TextInput value={adding} onChange={setAdding} placeholder={`Add a ${singular.toLowerCase()}`} />
        </span>
        <Button onClick={add} disabled={!adding.trim()}>Add</Button>
      </div>
    </Group>
  );
}

/** A note is a label, not a paragraph. Long enough for a few words. */
const MAX_REMARK = 40;

/**
 * Types the app works out for itself, and therefore does not list here.
 *
 * Money Send and Transaction Fee are not things you choose. A transfer to a
 * blank destination is money sent out; a transfer to one of your own accounts
 * costs only its fee. The Add screen decides which it is from the destination
 * you pick, so listing them here would offer a choice that does not exist.
 *
 * They still appear in every ranking and total: the rows are real, the label is
 * just no longer typed. See `domain/transfers.ts`.
 */
const DERIVED_TYPES = new Set(["money send", "transaction fee"]);

const isDerived = (name: string): boolean => DERIVED_TYPES.has(name.trim().toLowerCase());

function SpendingTypes({
  types,
  transactions,
  onChange,
  onRename,
}: {
  types: readonly SpendingType[];
  transactions: readonly Transaction[];
  onChange: (types: SpendingType[]) => void;
  onRename: (from: string, to: string) => void;
}) {
  const [adding, setAdding] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const { confirm, dialog } = useConfirm();

  const used = (name: string): number => transactions.filter((x) => x.item === name).length;

  /** The list you can edit. The derived two are not part of it. */
  const shown = types.filter((t) => !isDerived(t.name));

  const add = (): void => {
    const name = adding.trim();
    if (!name || types.some((t) => t.name.toLowerCase() === name.toLowerCase())) return;
    // Typing one of the derived names back in would create a type that never
    // gets picked, because the Add screen sets those itself.
    if (isDerived(name)) return;
    onChange([...types, { name, remark: "" }]);
    setAdding("");
  };

  const commitRename = async (from: string): Promise<void> => {
    const to = draft.trim();
    if (!to || to === from) {
      setEditingName(null);
      return;
    }

    const n = used(from);
    const ok = await confirm({
      title: `Rename \u201c${from}\u201d to \u201c${to}\u201d?`,
      body:
        n > 0
          ? `${n} transaction${n === 1 ? "" : "s"} will be rewritten so the ranking stays whole. Amounts and dates do not change.`
          : "Nothing uses this type yet, so only the list changes.",
      confirmLabel: "Rename",
    });
    if (!ok) return;

    onRename(from, to);
    onChange(types.map((t) => (t.name === from ? { ...t, name: to } : t)));
    setEditingName(null);
  };

  const remove = async (name: string): Promise<void> => {
    const n = used(name);
    const ok = await confirm({
      title: `Remove \u201c${name}\u201d?`,
      body:
        n > 0
          ? `${n} transaction${n === 1 ? "" : "s"} still carry this type. They keep it and still count. You just cannot pick it for new entries. Rename it instead if you want those rows moved.`
          : "Nothing uses it. It disappears from the picker.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (ok) onChange(types.filter((x) => x.name !== name));
  };

  return (
    <Group
      title="Spending types"
      hint={`The authoritative list for every ranking. Notes are capped at ${MAX_REMARK} characters.`}
      action={<CountChip>{shown.length}</CountChip>}
      wide
    >
      {dialog}

      <table className="fms-table">
        <thead>
          <tr>
            <th style={{ width: 190 }}>Type</th>
            <th>What counts as this</th>
            <th className="fms-th-right fms-shrink">Rows</th>
            <th className="fms-shrink" />
          </tr>
        </thead>
        <tbody>
          {shown.map((t) => {
            const rows = used(t.name);

            if (editingName === t.name) {
              return (
                <tr key={t.name}>
                  <td>
                    <TextInput value={draft} onChange={setDraft} />
                  </td>
                  <td className="t-caption" style={{ color: "var(--ink-3)" }}>
                    {rows > 0
                      ? `Renaming rewrites ${rows} row${rows === 1 ? "" : "s"}.`
                      : "Nothing uses this type yet."}
                  </td>
                  <td className="fms-td-right">
                    <span className="t-num-s" style={{ color: "var(--ink-3)" }}>{rows || "0"}</span>
                  </td>
                  <td>
                    <span className="fms-rowactions">
                      <Button size="sm" variant="primary" onClick={() => void commitRename(t.name)}>Save</Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditingName(null)}>Cancel</Button>
                    </span>
                  </td>
                </tr>
              );
            }

            return (
              <tr key={t.name}>
                <td>
                  <span className="t-body">{t.name}</span>
                </td>
                <td>
                  <TextInput
                    value={t.remark}
                    onChange={(remark) =>
                      onChange(types.map((x) => (x.name === t.name ? { ...x, remark: remark.slice(0, MAX_REMARK) } : x)))
                    }
                    placeholder="A few words"
                  />
                </td>
                <td className="fms-td-right">
                  <span className="t-num-s" style={{ color: "var(--ink-3)" }}>{rows || "0"}</span>
                </td>
                <td>
                  <span className="fms-rowactions">
                    <Button size="sm" variant="secondary" onClick={() => { setEditingName(t.name); setDraft(t.name); }}>
                      Rename
                    </Button>
                    <Button size="sm" variant="danger" ariaLabel={`Remove ${t.name}`} onClick={() => void remove(t.name)}>
                      Remove
                    </Button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="fms-addrow">
        <span className="fms-grow">
          <TextInput value={adding} onChange={setAdding} placeholder="Add a spending type" />
        </span>
        <Button onClick={add} disabled={!adding.trim()}>Add</Button>
      </div>
    </Group>
  );
}

// ── AI & data ──────────────────────────────────────────────────────────────

// ── Credit and loans ──────────────────────────────────────

const DIRECTIONS: DebtKind[] = ["payable", "receivable"];
const FORMS: DebtForm[] = ["credit-line", "term-loan", "informal"];

const DIRECTION_LABEL: Record<DebtKind, string> = {
  payable: "I owe it",
  receivable: "It is owed to me",
};

/**
 * Credit and loans.
 *
 * Direction and form are separate questions. Which way the money is owed does
 * not tell you whether it revolves, runs to a schedule, or is a handshake, and
 * those three need different numbers. See `domain/debtForms.ts`.
 */
function CreditLines({
  credits,
  accounts,
  transactions,
  onChange,
}: {
  credits: readonly Debt[];
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  onChange: (credits: Debt[]) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DebtKind>("payable");
  const [form, setForm] = useState<DebtForm>("credit-line");
  const [wallet, setWallet] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const banks = accounts.filter((a) => !a.archived && a.kind !== "goal").map((a) => a.name);
  const positions = positionsOf(credits, transactions, today());

  const add = (): void => {
    const trimmed = name.trim();
    const bank = wallet || banks[0];
    if (!trimmed || !bank) {
      setError(banks.length === 0 ? "Add an account first: a credit line lives against one." : null);
      return;
    }
    const id = makeDebtId(trimmed);
    if (credits.some((c) => c.id === id)) {
      setError("Something with that name already exists.");
      return;
    }

    const d = defaultsFor(form);
    onChange([
      ...credits,
      {
        id,
        name: trimmed,
        kind,
        form,
        counterpartyType: d.counterpartyType,
        counterparty: bank,
        openedDate: today(),
        wallet: bank,
        interestType: d.interestType,
        interestRate: 0,
        notes: "",
        archived: false,
      },
    ]);
    setName("");
    setError(null);
  };

  const update = (id: string, part: Partial<Debt>): void =>
    onChange(credits.map((c) => (c.id === id ? { ...c, ...part } : c)));

  const confirmUpdate = async (
    c: Debt,
    part: Partial<Debt>,
    title: string,
    body: string,
    label: string,
    tone: "normal" | "danger" = "normal",
  ): Promise<void> => {
    const ok = await confirm({ title, body, confirmLabel: label, tone });
    if (ok) update(c.id, part);
  };

  const remove = async (c: Debt): Promise<void> => {
    const used = transactions.filter((t) => t.debtId === c.id).length;
    if (used > 0) {
      setError(
        `\u201c${c.name}\u201d has ${used} transaction${used === 1 ? "" : "s"} filed against it. Removing it would orphan them. Archive it instead.`,
      );
      return;
    }
    const ok = await confirm({
      title: `Remove \u201c${c.name}\u201d?`,
      body: "Nothing is filed against it, so nothing is lost. It disappears from the Debt screen and from the entry form.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (ok) onChange(credits.filter((x) => x.id !== c.id));
  };

  const owed = credits.filter((c) => c.kind === "payable");
  const owing = credits.filter((c) => c.kind === "receivable");

  const section = (title: string, hint: string, rows: readonly Debt[]): React.ReactNode => (
    <Group title={title} hint={hint} action={<CountChip>{rows.length}</CountChip>} wide>
      {rows.length === 0 ? (
        <EmptyState message={`Nothing here. Add one below if you have ${title.toLowerCase()}.`} />
      ) : (
        <table className="fms-table">
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ width: 165 }}>Form</th>
              <th style={{ width: 165 }}>Account</th>
              <th className="fms-th-right fms-shrink">Outstanding</th>
              <th className="fms-shrink" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const position = positions.find((x) => x.debt.id === c.id);
              const shape = c.form ?? "credit-line";
              return (
                <tr key={c.id}>
                  <td className="fms-cell-flex">
                    <span className="t-body fms-truncate" title={c.name}>{c.name}</span>
                    <span className="t-micro" style={{ display: "block", color: "var(--ink-3)" }}>
                      {position ? headline(position, today(), formatMoney) : debtLabel(c.kind, shape)}
                      {c.archived ? " \u00b7 archived" : ""}
                    </span>
                  </td>
                  <td>
                    <Select
                      value={DEBT_FORM_LABEL[shape]}
                      ariaLabel={`Form of ${c.name}`}
                      onChange={(label) => {
                        const found = FORMS.find((f) => DEBT_FORM_LABEL[f] === label);
                        if (!found || found === shape) return;
                        void confirmUpdate(
                          c,
                          { form: found, ...defaultsFor(found) },
                          `Treat ${c.name} as a ${DEBT_FORM_LABEL[found].toLowerCase()}?`,
                          debtExplanation(c.kind, found),
                          "Change it",
                        );
                      }}
                      options={FORMS.map((f) => DEBT_FORM_LABEL[f])}
                    />
                  </td>
                  <td>
                    <Select
                      value={c.wallet}
                      ariaLabel={`Account for ${c.name}`}
                      onChange={(bank) => {
                        if (bank === c.wallet) return;
                        void confirmUpdate(
                          c,
                          { wallet: bank, counterparty: bank },
                          `Move ${c.name} to ${bank}?`,
                          `New movements will be filed against ${bank}. Everything already recorded keeps the account it was filed against.`,
                          `Use ${bank}`,
                        );
                      }}
                      options={banks.includes(c.wallet) ? banks : [c.wallet, ...banks]}
                    />
                  </td>
                  <td className="fms-td-right">
                    <Money
                      value={position?.outstanding ?? 0}
                      size="s"
                      tone={
                        position && position.outstanding > 0
                          ? c.kind === "payable"
                            ? "var(--flow-debt-text)"
                            : "var(--ok)"
                          : "var(--ink-3)"
                      }
                    />
                  </td>
                  <td>
                    <span className="fms-rowactions">
                      <Button
                        size="sm"
                        variant={c.archived ? "primary" : "secondary"}
                        onClick={() =>
                          void confirmUpdate(
                            c,
                            { archived: !c.archived },
                            c.archived ? `Reopen ${c.name}?` : `Archive ${c.name}?`,
                            c.archived
                              ? "It comes back on the Debt screen and in the entry form. Its history and balance are unchanged."
                              : "It disappears from the Debt screen and from the entry form, so you cannot file new movements against it. Everything already recorded stays.",
                            c.archived ? "Reopen" : "Archive",
                            c.archived ? "normal" : "danger",
                          )
                        }
                      >
                        {c.archived ? "Reopen" : "Archive"}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => void remove(c)}>Remove</Button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Group>
  );

  return (
    <>
      {dialog}

      {section(
        "What I owe",
        "Money you have to pay back. It comes off your net worth.",
        owed,
      )}

      {section(
        "What is owed to me",
        "Money you lent out. It is still yours, so it counts towards your net worth.",
        owing,
      )}

      <Group title="Add one" hint="Two questions: which way, and what shape" wide>
        <div className="fms-addrow" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
          <span className="fms-grow">
            <TextInput
              value={name}
              onChange={(v) => { setName(v); setError(null); }}
              placeholder="Maya Credit, a bank loan, money lent to a friend"
            />
          </span>
          <span style={{ width: 175 }}>
            <Select
              value={DIRECTION_LABEL[kind]}
              ariaLabel="Which way is it owed"
              onChange={(label) => {
                const found = DIRECTIONS.find((k) => DIRECTION_LABEL[k] === label);
                if (found) setKind(found);
              }}
              options={DIRECTIONS.map((k) => DIRECTION_LABEL[k])}
            />
          </span>
          <span style={{ width: 165 }}>
            <Select
              value={DEBT_FORM_LABEL[form]}
              ariaLabel="What shape is it"
              onChange={(label) => {
                const found = FORMS.find((f) => DEBT_FORM_LABEL[f] === label);
                if (found) setForm(found);
              }}
              options={FORMS.map((f) => DEBT_FORM_LABEL[f])}
            />
          </span>
          <span style={{ width: 165 }}>
            <Select
              value={wallet || (banks[0] ?? "")}
              ariaLabel="Which account"
              onChange={setWallet}
              options={banks}
              placeholder={banks.length === 0 ? "No accounts yet" : undefined}
            />
          </span>
          <Button variant="primary" onClick={add} disabled={!name.trim() || banks.length === 0}>
            Add
          </Button>
        </div>

        <p className="t-caption" style={{ margin: "var(--space-3) 0 0", color: "var(--ink-2)" }}>
          <strong>{debtLabel(kind, form)}.</strong> {debtExplanation(kind, form)}
        </p>

        {error && (
          <p className="t-caption" style={{ margin: "var(--space-2) 0 0", color: "var(--over)" }}>{error}</p>
        )}
      </Group>
    </>
  );
}

// ── Alerts ────────────────────────────────────────────────

/** ₱50,000: above this a "low balance" warning would fire on every wallet. */
const MAX_LOW_BALANCE = 5_000_000;

function AlertsSection({
  settings,
  patch,
}: {
  settings: AppSettings;
  patch: (part: Partial<AppSettings>) => void;
}) {
  const low = settings.lowBalanceThreshold;
  const { confirm, dialog } = useConfirm();

  /**
   * Commits on a question, not on a keystroke.
   *
   * This one number decides what the dashboard warns about, and setting it to
   * zero silently turns the warning off entirely.
   */
  const setLow = (v: Centavos | null): void => {
    const next = clampLow(v);
    if (next === low) return;
    void (async () => {
      const ok = await confirm({
        title: next === 0 ? "Turn the low balance warning off?" : `Warn below \u20b1${formatAmount(next)}?`,
        body:
          next === 0
            ? "No wallet will be flagged on the dashboard, however low it gets."
            : `Spending wallets under \u20b1${formatAmount(next)} will show on the dashboard.`,
        confirmLabel: next === 0 ? "Turn it off" : "Set it",
        ...(next === 0 ? { tone: "danger" as const } : {}),
      });
      if (ok) patch({ lowBalanceThreshold: next });
    })();
  };

  return (
    <>
      {dialog}

      <Group title="Low balance" hint="Warns you before a spending wallet runs dry">
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end", flexWrap: "wrap" }}>
          <span style={{ width: 160 }}>
            <Field label="Warn below" htmlFor="low-balance">
              <AmountInput id="low-balance" value={low} onChange={setLow} />
            </Field>
          </span>
          <p className="t-caption" style={{ margin: "0 0 var(--space-3)", color: "var(--ink-3)", flex: "1 1 200px" }}>
            ₱0 turns it off. Anything over {formatAmount(MAX_LOW_BALANCE)} is clamped, because it would
            flag every wallet you own.
          </p>
        </div>

        <p className="t-caption" style={{ margin: 0, color: "var(--ink-2)" }}>
          {low === 0
            ? "Off. No wallet will be flagged."
            : `Spending wallets under ₱${formatAmount(low)} show on the dashboard.`}
        </p>
      </Group>

      <Group title="Always on" hint="Checks you cannot switch off">
        <dl className="fms-deflist">
          <dt className="t-body">Budget overrun</dt>
          <dd className="t-caption" style={{ color: "var(--ink-2)", margin: 0 }}>
            A month past its budget
          </dd>
          <dt className="t-body">Rows needing review</dt>
          <dd className="t-caption" style={{ color: "var(--ink-2)", margin: 0 }}>
            Money that left a wallet without counting as spending
          </dd>
          <dt className="t-body">Debt due</dt>
          <dd className="t-caption" style={{ color: "var(--ink-2)", margin: 0 }}>
            An open credit line with a balance
          </dd>
        </dl>
        <p className="t-caption" style={{ margin: "var(--space-3) 0 0", color: "var(--ink-3)" }}>
          These report only. Nothing here edits your ledger.
        </p>
      </Group>
    </>
  );
}

const clampLow = (v: Centavos | null): Centavos =>
  v === null ? 0 : Math.min(Math.max(v, 0), MAX_LOW_BALANCE);

// ── AI ───────────────────────────────────────────────────

const AI_FEATURES: { key: keyof AiSettings["features"]; label: string; what: string }[] = [
  { key: "alerts", label: "Finance alerts", what: "Sums up the flagged items on the Dashboard" },
  { key: "insightSummary", label: "Insight summary", what: "Describes the month on the Insights screen" },
  {
    key: "descriptions",
    label: "Transaction descriptions",
    what: "Fills the Suggest button on the Add screen, for items with no history",
  },
  {
    key: "chat",
    label: "Ask",
    what: "The conversation beside the Add form. Reads your figures and your entries; it can only propose",
  },
  {
    key: "capture",
    label: "Reading photos and files",
    what: "Turns a receipt or a statement into rows you check and add. Sends the picture to the provider",
  },
];

/** Model ids are short; anything longer is a paste accident. */
const MAX_MODEL_LENGTH = 80;

function AiSection({
  settings,
  patch,
  transactions,
  budgets,
  reference,
  signedInUid,
}: {
  settings: AppSettings;
  patch: (part: Partial<AppSettings>) => void;
  /** Where the conversation is stored. Null in local mode. */
  signedInUid: string | null;
  transactions: readonly Transaction[];
  budgets: Budgets;
  reference: ReferenceLists;
}) {
  const tryOut = useAi({ settings, transactions, budgets, reference, feature: "insightSummary" });
  const ai = settings.ai;
  const setAi = (part: Partial<AiSettings>): void => patch({ ai: { ...ai, ...part } });
  const off = !ai.enabled;
  const limits = imageLimits(ai);
  const { confirm, dialog } = useConfirm();

  /** Every switch and picker here asks first. */
  const ask = async (
    title: string,
    body: string,
    confirmLabel: string,
    part: Partial<AiSettings>,
    tone: "normal" | "danger" = "normal",
  ): Promise<void> => {
    const ok = await confirm({ title, body, confirmLabel, tone });
    if (ok) setAi(part);
  };

  return (
    <>
      {dialog}

      <Group
        title="AI"
        hint="Rewrites figures the app already computed"
        action={
          <Switch
            checked={ai.enabled}
            label="Enable AI"
            onChange={(enabled) =>
              void ask(
                enabled ? "Turn AI on?" : "Turn AI off?",
                enabled
                  ? "The app may send figures it has already calculated to the provider below. Nothing leaves this device until you turn this on."
                  : "Nothing will be sent anywhere. Every screen keeps working; the wording just stops being rewritten.",
                enabled ? "Turn it on" : "Turn it off",
                { enabled },
                enabled ? "normal" : "danger",
              )
            }
          />
        }
      >
        <p className="t-caption" style={{ margin: 0, color: "var(--ink-2)" }}>
          It never writes to your ledger, never adds a transaction, and never changes a balance.
          Every number it repeats was calculated here first.
        </p>
        {off && (
          <p className="t-caption" style={{ margin: "var(--space-3) 0 0", color: "var(--ink-3)" }}>
            Off. The rest of this tab is inactive.
          </p>
        )}
      </Group>

      <Group title="Model" hint="Which service answers">
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field label="Provider" help="Sets a sensible default model when you switch.">
            <Select
              value={AI_PROVIDER_LABEL[ai.provider]}
              disabled={off}
              onChange={(label) => {
                const provider = (Object.keys(AI_PROVIDER_LABEL) as AiProvider[]).find(
                  (x) => AI_PROVIDER_LABEL[x] === label,
                );
                if (!provider || provider === ai.provider) return;
                void ask(
                  `Switch to ${AI_PROVIDER_LABEL[provider]}?`,
                  `The model changes to ${AI_DEFAULT_MODEL[provider]}, so anything typed in the model box is replaced. The key for the new provider has to be set in Cloudflare.`,
                  "Switch",
                  { provider, model: AI_DEFAULT_MODEL[provider] },
                );
              }}
              options={Object.values(AI_PROVIDER_LABEL)}
            />
          </Field>

          <Field label="Model" help={`Exactly as the provider spells it. Up to ${MAX_MODEL_LENGTH} characters.`}>
            <TextInput
              value={ai.model}
              disabled={off}
              onChange={(model) => setAi({ model: model.slice(0, MAX_MODEL_LENGTH) })}
              placeholder={AI_DEFAULT_MODEL[ai.provider]}
            />
          </Field>

          <Field label="Tone" help={AI_TONE_HINT[ai.tone]}>
            <Select
              value={ai.tone}
              disabled={off}
              onChange={(tone) => setAi({ tone: tone as AiTone })}
              options={["brief", "plain", "detailed"]}
            />
          </Field>
        </div>
      </Group>

      <Group title="Where it is used" hint="Each surface is separate">
        <table className="fms-table">
          <tbody>
            {AI_FEATURES.map((f) => (
              <tr key={f.key}>
                <td>
                  <div className="t-body">{f.label}</div>
                  <div className="t-caption" style={{ color: "var(--ink-3)" }}>{f.what}</div>
                </td>
                <td className="fms-td-right" style={{ width: 60 }}>
                  <Switch
                    checked={ai.features[f.key] !== false}
                    label={f.label}
                    onChange={(v) =>
                      void ask(
                        v
                          ? `Use AI for ${f.label.toLowerCase()}?`
                          : `Stop using AI for ${f.label.toLowerCase()}?`,
                        v
                          ? `${f.what}. It runs only while you are on that screen.`
                          : "That screen goes back to plain wording.",
                        v ? "Use it" : "Stop",
                        { features: { ...ai.features, [f.key]: v } },
                        v ? "normal" : "danger",
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Group>

      {/*
        What a message may carry.

        The client refuses an oversized file by name with its size, which is
        the version worth reading. The endpoint keeps its own ceiling
        regardless: a limit set here is a preference, never a control.
      */}
      <Group title="Photos and files" hint="What one message may carry">
        <div className="fms-addrow">
          <label className="t-caption" style={{ color: "var(--ink-2)" }}>
            Most files in one message
            <input
              className="t-body fms-input"
              type="number"
              inputMode="numeric"
              min={IMAGE_BOUNDS.maxCount.min}
              max={IMAGE_BOUNDS.maxCount.max}
              value={limits.maxCount}
              disabled={off}
              onChange={(e) =>
                setAi({ image: { ...ai.image, maxCount: Number(e.target.value) } })
              }
              style={{ display: "block", marginTop: 4, width: 90 }}
            />
          </label>
          <label className="t-caption" style={{ color: "var(--ink-2)" }}>
            Largest file, in MB
            <input
              className="t-body fms-input"
              type="number"
              inputMode="numeric"
              min={IMAGE_BOUNDS.maxSizeMB.min}
              max={IMAGE_BOUNDS.maxSizeMB.max}
              value={limits.maxSizeMB}
              disabled={off}
              onChange={(e) =>
                setAi({ image: { ...ai.image, maxSizeMB: Number(e.target.value) } })
              }
              style={{ display: "block", marginTop: 4, width: 90 }}
            />
          </label>
        </div>
        <p className="t-caption" style={{ margin: "var(--space-2) 0 0", color: "var(--ink-3)" }}>
          Pictures are downscaled and re-encoded on this device before anything is sent, so a phone
          photo usually arrives well under the limit. Five is what the free vision models accept in
          one request.
        </p>
      </Group>

      <Group title="Try it" hint="Runs a real call against your own figures" wide>
        <p className="t-body" style={{ margin: "0 0 var(--space-3)", color: "var(--ink-2)" }}>
          This sends the same summary every other screen sends, so whatever comes back tells you
          exactly what the AI can and cannot see.
        </p>

        <div className="fms-addrow">
          <Button variant="primary" loading={tryOut.loading} onClick={() => void tryOut.run("summary")}>
            Summarise this month
          </Button>
          <Button onClick={() => void tryOut.run("patterns")}>Look for a pattern</Button>
          {tryOut.answer && <Button onClick={tryOut.clear}>Clear</Button>}
        </div>

        {tryOut.answer && (
          <div style={{ marginTop: "var(--space-3)" }}>
            <AiAnswerView answer={tryOut.answer} />
          </div>
        )}
      </Group>

      <AiLearningGroup uid={signedInUid} />

      <AiHistoryGroup uid={signedInUid} />

      <Group title="API key" hint="Not stored here, on purpose">
        <Alert status="info" title="The key goes in Cloudflare, not in this app">
          A browser app has to hand the key to the browser, which puts it in devtools and in every
          export. Set <code>GROQ_API_KEY</code> or <code>OPENROUTER_API_KEY</code> under Cloudflare
          → Pages → Settings → Environment variables, then redeploy. The app calls them through a
          server function and never sees the value.
        </Alert>

        <Alert status="info" title="It still works with no key at all">
          With no key, or when every free model is rate limited, the wording is written on this
          device from the same figures. Answers say which of the two you are reading, so you are
          never guessing.
        </Alert>
      </Group>
    </>
  );
}

// ── Appearance ─────────────────────────────────────────────

const THEMES: { id: ThemePreference; label: string; hint: string }[] = [
  { id: "light", label: "Light", hint: "Always light" },
  { id: "dark", label: "Dark", hint: "Always dark" },
  { id: "system", label: "System", hint: "Follows your device" },
];

function AppearanceSection({
  settings,
  patch,
}: {
  settings: AppSettings;
  patch: (part: Partial<AppSettings>) => void;
}) {
  const choose = (theme: ThemePreference): void => {
    setThemePreference(theme);
    patch({ theme });
  };

  return (
    <Group title="Theme" hint="Applies immediately and syncs with your settings">
      <div className="fms-segmented" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={settings.theme === t.id}
            onClick={() => choose(t.id)}
            className={`fms-seg ${settings.theme === t.id ? "t-body-strong" : "t-body"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="t-caption" style={{ margin: "var(--space-3) 0 0", color: "var(--ink-3)" }}>
        {THEMES.find((t) => t.id === settings.theme)?.hint}
      </p>
    </Group>
  );
}

// ── Data ──────────────────────────────────────────────────

function DataSection({
  transactions,
  deleted,
  budgets,
  settings,
  storeName,
  quota,
  onExport,
  onBackup,
  onRestore,
  onChangeSettings,
  signedInUid,
  ledgerSource,
  uploading,
  onUpload,
}: {
  transactions: readonly Transaction[];
  deleted: readonly Transaction[];
  budgets: Readonly<Record<string, unknown>>;
  settings: AppSettings;
  storeName: string;
  quota: number;
  onExport: () => void;
  onBackup: () => void;
  onRestore: (backup: Backup, mode: RestoreMode) => void;
  onChangeSettings: (next: AppSettings) => void;
  signedInUid?: string | undefined;
  ledgerSource?: "seed" | "live" | undefined;
  uploading?: boolean | undefined;
  onUpload?: (() => void) | undefined;
}) {
  const { confirm, dialog } = useConfirm();
  const [picked, setPicked] = useState<Validation | null>(null);
  const [reading, setReading] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  /**
   * The three records nothing was measuring.
   *
   * The panel says it measures what is actually stored, and left out the
   * activity trail, the conversation and the assistant's own record. On this
   * database that is 604 documents against 451 transactions: more rows than
   * the ledger it claimed to be measuring.
   *
   * Read here rather than passed in, so the figure cannot drift from the
   * collections it describes, and so it is right whether the caller
   * remembered to thread them through or not.
   */
  const [logs, setLogs] = useState<{
    activity: readonly unknown[];
    chat: readonly unknown[];
    ai: readonly unknown[];
  }>({ activity: [], chat: [], ai: [] });

  useEffect(() => {
    let live = true;
    const uid = signedInUid ?? null;
    void Promise.all([
      activityStore(uid).recent(),
      chatStore(uid).recent(),
      aiLogStore(uid).recent(),
    ])
      .then(([activity, chat, ai]) => {
        if (live) setLogs({ activity, chat, ai });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [signedInUid]);

  const report = useMemo(
    () =>
      measureStorage({
        transactions,
        deleted,
        accounts: settings.accounts,
        credits: settings.credits,
        budgets,
        activity: logs.activity,
        chat: logs.chat,
        ai: logs.ai,
        categories: [
          ...settings.bills,
          ...settings.subscriptions,
          ...settings.revenueCategories,
          ...settings.spendingTypes,
        ],
        quota,
      }),
    [transactions, deleted, budgets, settings, quota],
  );

  /**
   * Offered only in the state that actually needs it: rows exist, accounts do
   * not. Showing a "rebuild" button next to a healthy list would invite
   * someone to press it and find out what it does.
   */
  const recovery = useMemo(() => {
    if (settings.accounts.length > 0 || transactions.length === 0) return null;
    const report = recoverAccounts(transactions, settings.accounts);
    return report.recovered > 0 ? report : null;
  }, [transactions, settings.accounts]);

  const runRecovery = async (): Promise<void> => {
    if (!recovery) return;

    const preview = recovery.accounts
      .slice(0, 6)
      .map((a) => a.name)
      .join(", ");

    const ok = await confirm({
      title: `Rebuild ${recovery.recovered.toLocaleString()} accounts?`,
      body: `Names come straight from your ${transactions.length.toLocaleString()} transactions: ${preview}${recovery.recovered > 6 ? `, and ${(recovery.recovered - 6).toLocaleString()} more` : ""}. No transaction is touched and no amount changes. Goal targets and deadlines are not restored this way.`,
      confirmLabel: "Rebuild accounts",
    });
    if (!ok) return;

    onChangeSettings({ ...settings, accounts: [...recovery.accounts] });
  };

  const read = async (f: File): Promise<void> => {
    setReading(true);
    try {
      setPicked(validateBackup(JSON.parse(await f.text())));
    } catch {
      setPicked({
        ok: false,
        problems: [{ severity: "error", message: "That file is not readable JSON. Pick the .json backup this app wrote." }],
      });
    } finally {
      setReading(false);
      if (file.current) file.current.value = "";
    }
  };

  const apply = async (mode: RestoreMode): Promise<void> => {
    if (!picked?.backup) return;
    const b = picked.backup;

    const ok = await confirm({
      title: mode === "replace" ? "Replace everything?" : "Merge this backup in?",
      body:
        mode === "replace"
          ? `Your current ${transactions.length.toLocaleString()} transactions are swapped for the ${b.data.transactions.length.toLocaleString()} in the file. Export a backup first if you have not already.`
          : `Rows already here are kept. Only rows the file has and you do not are added, matched on date, amount and description rather than on id, so restoring the same file twice adds nothing the second time.`,
      confirmLabel: mode === "replace" ? "Replace everything" : "Merge",
      tone: mode === "replace" ? "danger" : "normal",
    });
    if (!ok) return;

    onRestore(b, mode);
    setPicked(null);
  };

  return (
    <>
      {dialog}

      <ConnectFirebase signedInUid={signedInUid} />

      {recovery && (
        <Group title="Rebuild accounts" hint="Your account list is empty" wide>
          <Alert status="warn" title="The ledger has accounts but the settings do not">
            {transactions.length.toLocaleString()} transactions name{" "}
            {recovery.recovered.toLocaleString()} accounts between them, but the account list is
            empty, so every balance reads zero. The transactions are intact. Rebuilding reads the
            names back out of them.
          </Alert>

          <dl className="fms-deflist" style={{ marginTop: "var(--space-3)" }}>
            <dt className="t-body">Recovered exactly</dt>
            <dd className="t-body" style={{ margin: 0 }}>
              Every account name, and so every balance
            </dd>
            <dt className="t-body">Worked out from the name</dt>
            <dd className="t-body" style={{ margin: 0 }}>
              Whether each one is spending, savings or a goal
            </dd>
            <dt className="t-body">Cannot be recovered</dt>
            <dd className="t-body" style={{ margin: 0 }}>
              Goal targets, deadlines, and which accounts were archived. Restore a backup for those.
            </dd>
          </dl>

          <div className="fms-addrow">
            <Button variant="primary" onClick={() => void runRecovery()}>
              Rebuild {recovery.recovered.toLocaleString()} accounts
            </Button>
            <span className="t-caption" style={{ color: "var(--ink-3)" }}>
              Adds nothing to the ledger and changes no amount. It only names the accounts the
              transactions already refer to.
            </span>
          </div>
        </Group>
      )}

      {onUpload && (
        <Group
          title="Sync"
          hint={ledgerSource === "live" ? "Reading from Firebase" : "Not uploaded yet"}
          wide
        >
          <dl className="fms-deflist">
            <dt className="t-body">Rows on screen</dt>
            <dd className="t-num-s" style={{ margin: 0 }}>
              {transactions.length.toLocaleString()}
            </dd>
            <dt className="t-body">Where they came from</dt>
            <dd className="t-body-strong" style={{ margin: 0 }}>
              {ledgerSource === "live" ? "Firebase" : "The Excel import, still on this device"}
            </dd>
          </dl>

          <div style={{ marginTop: "var(--space-3)" }}>
            {ledgerSource === "live" ? (
              <Alert status="ok" title="Synced">
                These rows arrived from Firestore, which is the only proof the upload landed. A row
                count on its own does not tell you: 441 looks the same either way.
              </Alert>
            ) : (
              <Alert status="warn" title="Still local">
                Firebase is connected but the ledger has not come back from it yet. Upload it, or
                reload if the automatic upload is still running.
              </Alert>
            )}
          </div>

          <div className="fms-addrow">
            <Button variant="primary" loading={uploading ?? false} onClick={onUpload}>
              Upload everything to Firebase
            </Button>
            <span className="t-caption" style={{ color: "var(--ink-3)" }}>
              Safe to run twice. Every row is written by id, so a second run overwrites rather than
              duplicates.
            </span>
          </div>
        </Group>
      )}

      <Tidy settings={settings} onChange={onChangeSettings} />

      <Group
        title="Storage"
        hint={`Measured from what is actually stored in ${storeName.toLowerCase()}`}
        wide
      >
        <div className="fms-storage-head">
          <div>
            <div className="t-display-l" style={{ lineHeight: 1 }}>
              {Math.max(1, Math.round(report.fraction * 100))}
              <span className="t-body" style={{ color: "var(--ink-3)" }}> % used</span>
            </div>
            <p className="t-caption" style={{ margin: "var(--space-2) 0 0", color: "var(--ink-2)" }}>
              {formatBytes(report.used)} of {formatBytes(report.quota)}
            </p>
          </div>
          <div className="t-caption" style={{ color: "var(--ink-3)", textAlign: "right" }}>
            {formatBytes(report.free)} free
          </div>
        </div>

        <div className="fms-storage-bar" role="img" aria-label={`${formatBytes(report.used)} used of ${formatBytes(report.quota)}`}>
          {report.sections
            .filter((sec) => sec.bytes > 0)
            .map((sec) => (
              <span
                key={sec.id}
                style={{
                  width: `${(sec.bytes / report.quota) * 100}%`,
                  background: sec.colour,
                }}
              />
            ))}
        </div>

        <table className="fms-table">
          <tbody>
            {report.sections.map((sec) => (
              <tr key={sec.id}>
                <td className="fms-shrink">
                  <span className="fms-dot" style={{ background: sec.colour }} />
                </td>
                <td className="fms-cell-flex">
                  <span className="t-body">{sec.label}</span>
                </td>
                <td className="fms-td-right fms-shrink">
                  <span className="t-num-s" style={{ color: "var(--ink-3)" }}>
                    {sec.count.toLocaleString()}
                  </span>
                </td>
                <td className="fms-td-right fms-shrink">
                  <span className="t-num-s">{formatBytes(sec.bytes)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {report.nearlyFull && (
          <div style={{ marginTop: "var(--space-3)" }}>
            <Alert status="warn" title="Running out of room">
              Export a backup and move to Firebase. Browser storage stops accepting writes when it
              fills, and it does so without saying anything.
            </Alert>
          </div>
        )}
      </Group>

      <Group title="Back up" hint="The whole system in one file">
        <p className="t-caption" style={{ margin: "0 0 var(--space-3)", color: "var(--ink-2)" }}>
          Every transaction, the recycle bin, budgets, accounts, goals, credit lines and every
          category. It restores this app exactly as it stands.
        </p>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <Button variant="primary" onClick={onBackup}>Download backup</Button>
          <Button onClick={onExport}>Export CSV</Button>
        </div>
        <p className="t-caption" style={{ margin: "var(--space-3) 0 0", color: "var(--ink-3)" }}>
          The CSV is for reading elsewhere and cannot be restored from. Money in it is a plain
          decimal so a spreadsheet reads it as a number.
        </p>
      </Group>

      <Group title="Restore" hint="From a backup file">
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
          }}
        />

        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
          <Button loading={reading} onClick={() => file.current?.click()}>Choose a backup file</Button>
          {picked && <Button variant="secondary" onClick={() => setPicked(null)}>Clear</Button>}
        </div>

        {picked && (
          <div style={{ marginTop: "var(--space-4)", display: "grid", gap: "var(--space-3)" }}>
            {picked.problems.map((prob, i) => (
              <Alert
                key={i}
                status={prob.severity === "error" ? "over" : "warn"}
                title={prob.severity === "error" ? "Cannot restore this file" : "Worth knowing"}
              >
                {prob.message}
              </Alert>
            ))}

            {picked.ok && picked.backup && (
              <>
                <Alert status="ok" title="File checked">{picked.summary}</Alert>

                {/* Every part, counted, before anything is written. The Excel's
                    own backup silently left the category lists behind, so what
                    a file does and does not contain is worth showing. */}
                <table className="fms-table">
                  <thead>
                    <tr>
                      <th>What is in the file</th>
                      <th className="fms-th-right fms-shrink">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {picked.manifest?.map((m) => (
                      <tr key={m.part}>
                        <td className="fms-cell-flex">
                          <span className="t-body">{m.part}</span>
                        </td>
                        <td className="fms-td-right">
                          <span className="t-num-s" style={{ color: m.count === 0 ? "var(--ink-3)" : "var(--ink)" }}>
                            {m.count === 0 ? "none" : m.count.toLocaleString()}
                          </span>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="fms-cell-flex">
                        <span className="t-body">Theme</span>
                      </td>
                      <td className="fms-td-right">
                        <span className="t-body" style={{ textTransform: "capitalize" }}>
                          {picked.backup.data.preferences.theme}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                  <Button variant="primary" onClick={() => void apply("merge")}>
                    Merge into what I have
                  </Button>
                  <Button variant="danger" onClick={() => void apply("replace")}>
                    Replace everything
                  </Button>
                </div>
                <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
                  Merge adds only what is missing and is safe to run twice. Replace swaps the lot,
                  so download a backup first.
                </p>
              </>
            )}
          </div>
        )}
      </Group>

      <Group title="Deleting" hint="Nothing is ever removed outright">
        <p className="t-caption" style={{ margin: 0, color: "var(--ink-2)" }}>
          A deleted transaction moves to the Bin and stays restorable. Balances exclude it from the
          moment you delete it, so the numbers are right without the row being gone.
        </p>
      </Group>
    </>
  );
}


// ── Connecting to Firebase ───────────────────────────────────

/**
 * Connect the app to a Firebase project.
 *
 * Every value asked for here is public. The web `apiKey` is a project
 * identifier, not a credential: it says which project a request belongs to, and
 * the request is still checked against the security rules and the signed-in
 * uid. It ships in the JavaScript bundle of every Firebase web app. That is why
 * pasting it into a form is fine, and why the AI provider key, which is a real
 * secret, has no field anywhere in this app.
 */
function ConnectFirebase({ signedInUid }: { signedInUid?: string | undefined }) {
  const { config, source } = readConfig();
  const uid = readOwnerUid();

  const [pasted, setPasted] = useState("");
  const [owner, setOwner] = useState(uid ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { confirm, dialog } = useConfirm();

  const connect = (): void => {
    const result = parseConfig(pasted);
    if (result.error || !result.config) {
      setError(result.error ?? "Could not read that config.");
      return;
    }
    saveConfig(result.config);
    if (owner.trim()) saveOwnerUid(owner);
    setError(null);
    setSaved(true);
  };

  const disconnect = async (): Promise<void> => {
    const ok = await confirm({
      title: "Disconnect from Firebase?",
      body: "The app goes back to storing everything in this browser. Nothing in Firebase is deleted, and reconnecting brings it back.",
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (ok) {
      clearConfig();
      window.location.reload();
    }
  };

  if (config) {
    return (
      <Group title="Firebase" hint="Connected" wide>
        {dialog}
        <dl className="fms-deflist">
          <dt className="t-body">Project</dt>
          <dd className="t-body-strong" style={{ margin: 0 }}>{config.projectId}</dd>
          <dt className="t-body">Configuration from</dt>
          <dd className="t-body" style={{ margin: 0 }}>
            {source === "environment" ? "Build variables" : "This browser"}
          </dd>
          <dt className="t-body">Owner uid</dt>
          <dd className="t-num-s" style={{ margin: 0 }}>{uid ?? "not set"}</dd>
        </dl>

        {!uid && signedInUid && (
          <div style={{ marginTop: "var(--space-3)" }}>
            <Alert status="warn" title="This is your uid. It goes in two places.">
              <p className="t-num-s fms-uid">{signedInUid}</p>
              <p className="t-caption" style={{ margin: "var(--space-2) 0 0", color: "var(--ink-2)" }}>
                Put it in <code>VITE_OWNER_UID</code> in <code>app/.env.local</code>, and in{" "}
                <code>ownerUid()</code> in <code>firestore.rules</code>, then publish the rules.
                Until both match, every read is denied.
              </p>
            </Alert>
          </div>
        )}

        {!uid && !signedInUid && (
          <div style={{ marginTop: "var(--space-3)" }}>
            <Alert status="warn" title="No owner uid yet">
              Sign in once and your uid appears here, ready to copy into{" "}
              <code>firestore.rules</code> and <code>app/.env.local</code>.
            </Alert>
          </div>
        )}

        {source === "browser" && (
          <div style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-2)" }}>
            <Button variant="danger" onClick={() => void disconnect()}>Disconnect</Button>
          </div>
        )}
      </Group>
    );
  }

  return (
    <Group title="Connect to Firebase" hint="Your ledger is in this browser only" wide>
      {dialog}

      <p className="t-caption" style={{ margin: "0 0 var(--space-3)", color: "var(--ink-2)" }}>
        In the Firebase console, open <strong>Project settings, General, Your apps, SDK setup and
        configuration</strong> and copy the whole config block. Paste it below exactly as it comes.
      </p>

      <textarea
        value={pasted}
        onChange={(e) => { setPasted(e.target.value); setError(null); setSaved(false); }}
        rows={8}
        spellCheck={false}
        placeholder={"const firebaseConfig = {\n  apiKey: \"...\",\n  authDomain: \"...\",\n  projectId: \"...\",\n  ...\n};"}
        className="t-num-s fms-paste"
      />

      <div style={{ marginTop: "var(--space-3)", display: "grid", gap: "var(--space-2)" }}>
        <Field
          label="Owner uid"
          help="From Authentication, Users, after you sign in once. Optional now, required before anything loads."
        >
          <TextInput value={owner} onChange={setOwner} placeholder="Paste your User UID" />
        </Field>
      </div>

      <div style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <Button variant="primary" onClick={connect} disabled={!pasted.trim()}>Connect</Button>
      </div>

      {error && (
        <p className="t-caption" style={{ margin: "var(--space-2) 0 0", color: "var(--over)" }}>{error}</p>
      )}

      {saved && (
        <div style={{ marginTop: "var(--space-3)" }}>
          <Alert status="ok" title="Saved. Reload to connect.">
            Export a backup first if you want a copy of what is in this browser, then reload the
            page and sign in.
          </Alert>
        </div>
      )}

      <div style={{ marginTop: "var(--space-4)" }}>
        <Alert status="info" title="These values are public, the AI key is not">
          The web apiKey identifies the project; it does not grant access. Your security rules and
          the signed-in account do that. An AI provider key is a real secret and belongs in a
          Cloudflare environment variable, which is why there is no field for one anywhere here.
        </Alert>
      </div>
    </Group>
  );
}


// ── Tidying the lists ─────────────────────────────────────────

/**
 * What the cleanup would remove, and why.
 *
 * The same rules run automatically on every load, so this is usually empty.
 * It exists for the case where something slipped in, and because a cleanup
 * that silently deletes a category the owner spent a year typing into is
 * indistinguishable from a bug.
 */
function Tidy({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
}) {
  const report = useMemo(() => cleanSettings(settings), [settings]);
  const { confirm, dialog } = useConfirm();

  if (!report.changed) {
    return (
      <Group title="Category lists" hint="Nothing to tidy" wide>
        <p className="t-caption" style={{ margin: 0, color: "var(--ink-2)" }}>
          No blanks, no duplicates, and nothing that belongs somewhere else. The same checks run
          every time the app loads, so this stays true on its own.
        </p>
      </Group>
    );
  }

  const apply = async (): Promise<void> => {
    const ok = await confirm({
      title: `Remove ${report.removals.length} entr${report.removals.length === 1 ? "y" : "ies"}?`,
      body: "Only the lists change. Every transaction keeps the category it was filed under, and no balance moves.",
      confirmLabel: "Remove them",
      tone: "danger",
    });
    if (ok) onChange(report.settings);
  };

  return (
    <Group
      title="Category lists"
      hint="Entries that no longer belong"
      action={<CountChip>{report.removals.length}</CountChip>}
      wide
    >
      {dialog}

      <table className="fms-table">
        <thead>
          <tr>
            <th style={{ width: 170 }}>List</th>
            <th style={{ width: 190 }}>Entry</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {report.removals.map((r, i) => (
            <tr key={`${r.list}-${r.value}-${i}`}>
              <td className="t-caption" style={{ color: "var(--ink-3)" }}>{r.list}</td>
              <td><span className="t-body">{r.value || "(blank)"}</span></td>
              <td className="t-caption" style={{ color: "var(--ink-2)" }}>{r.why}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="fms-addrow">
        <Button variant="danger" onClick={() => void apply()}>Remove them</Button>
        <span className="t-caption" style={{ color: "var(--ink-3)" }}>
          Lists only. No transaction and no balance changes.
        </span>
      </div>
    </Group>
  );
}

/**
 * Everything asked and answered, from the database.
 *
 * ── Why the record lives here and not only in the panel ───────────────────
 *
 * The conversation is written to `users/{uid}/chat` as it happens, append
 * only at the database, so "clear this view" clears the screen and not the
 * record. This is where the whole of it can be read back.
 *
 * ── What "learning" actually means here ───────────────────────────────────
 *
 * Not this. The assistant gets better from the ledger, not from the
 * transcript: every row saved changes what `domain/infer.ts` knows about
 * which wallet pays for what, what the usual amount is, and what an item is
 * called. Correcting a card and saving it is the training signal, and it
 * takes effect on the next sentence with no model retrained and nothing
 * uploaded anywhere.
 *
 * This screen is the record of what was said, which is a different and also
 * useful thing: it is how you check what left the device.
 */
function AiHistoryGroup({ uid }: { uid: string | null }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    chatStore(uid)
      .recent()
      .then((found) => {
        if (live) setMessages(found);
      })
      .catch((e: Error) => {
        if (live) {
          setMessages([]);
          setFailed(e.message);
        }
      });
    return () => {
      live = false;
    };
  }, [uid]);

  const [showAll, setShowAll] = useState(false);
  const yours = (messages ?? []).filter((m) => m.role === "you").length;

  return (
    <Group title="History" hint="Everything asked, and what came back" wide>
      {messages === null ? (
        <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
          Loading.
        </p>
      ) : failed ? (
        <p className="t-caption" style={{ margin: 0, color: "var(--over)" }}>
          The history could not be read: {failed}. If this says permissions, your database has not
          been given its rules yet. Run: firebase deploy --only firestore:rules
        </p>
      ) : messages.length === 0 ? (
        <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
          Nothing yet. Everything you type into Ask, and every answer, is recorded here.
        </p>
      ) : (
        <>
          <p className="t-caption" style={{ margin: "0 0 var(--space-3)", color: "var(--ink-3)" }}>
            {messages.length} messages, {yours} of them yours. This record cannot be edited or
            deleted. Keys are removed before anything is written.
          </p>
          <ol className="fms-acts">
            {[...messages].reverse().slice(0, showAll ? 200 : 8).map((m) => (
              <li key={m.id} className="fms-act">
                <div className="fms-acthead">
                  <span className="t-caption" style={{ whiteSpace: "pre-wrap" }}>
                    {m.text}
                  </span>
                  <span className="t-micro fms-actwhen">{new Date(m.at).toLocaleString("en-PH")}</span>
                </div>
                <div className="fms-actmeta t-micro">
                  <span className={m.role === "you" ? "fms-actor" : "fms-actor fms-actor--ai"}>
                    {m.role === "you" ? "you" : "assistant"}
                  </span>
                  {m.from && <span>{m.from}</span>}
                </div>
              </li>
            ))}
          </ol>

          {messages.length > 8 && (
            <Button size="sm" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer" : `Show all ${messages.length}`}
            </Button>
          )}
        </>
      )}

      {!uid && messages !== null && (
        <p className="t-caption" style={{ marginTop: "var(--space-3)", color: "var(--ink-3)" }}>
          You are not signed in, so this is only for this session. Signed in, it is written to your
          own database, where it can be added to and never changed.
        </p>
      )}
    </Group>
  );
}

/**
 * What the assistant has been told, and what it did.
 *
 * ── The difference from the activity trail ────────────────────────────────
 *
 * The Activity screen records what happened to the money. This records what
 * happened to the assistant: what was asked, what it proposed, what you
 * accepted, corrected or threw away, and which photo produced which row.
 *
 * ── What it learns, and what it does not ──────────────────────────────────
 *
 * A correction is a pair, and those pairs are the whole of the learning. Told
 * once that a word means Food, it uses Food from then on: no model is
 * retrained and nothing is uploaded, it is a table of your own corrections
 * read back on the next sentence.
 *
 * ── Photos are here as descriptions ───────────────────────────────────────
 *
 * The name, what it turned out to be, its size and what was read out of it.
 * Never the picture: a photo is a megabyte and a document is capped at one,
 * so an image would be the least useful byte in the database.
 */
function AiLearningGroup({ uid }: { uid: string | null }) {
  const [events, setEvents] = useState<AiEvent[] | null>(null);

  useEffect(() => {
    let live = true;
    aiLogStore(uid)
      .recent()
      .then((found) => {
        if (live) setEvents(found);
      })
      .catch(() => {
        if (live) setEvents([]);
      });
    return () => {
      live = false;
    };
  }, [uid]);

  const [showAll, setShowAll] = useState(false);
  const all = events ?? [];
  const learned = correctionsFrom(all, "item");
  const count = (action: string): number => all.filter((e) => e.action === action).length;

  /**
   * Whether any of this is actually reaching the database.
   *
   * Every caller writes this log as `record(event).catch(() => {})`, which is
   * right: an audit entry that failed must not make a saved transaction look
   * unsaved. But swallowed and never mentioned, "is the assistant saving
   * properly?" had no answer from inside the app. A denied write and a
   * successful one looked identical, and this very panel reads the same store,
   * so it showed the same numbers either way.
   *
   * Read on render rather than watched. It only changes when something is
   * written, and arriving on this screen is when anyone wants to know.
   */
  const health = aiLogHealth(uid);

  return (
    <Group title="What it has learned" hint="Corrections, and what happened to each suggestion" wide>
      {health.lastFailure ? (
        <Alert status="over" title="Not saving to the database">
          {health.failures} of {health.writes + health.failures} writes failed. {health.lastFailure}
        </Alert>
      ) : health.target === "this browser only" ? (
        <Alert status="ok" title="Kept in this browser only">
          No database is configured in this build, so what the assistant learns lasts until you
          close the tab. Sign in to the Firebase build to keep it.
        </Alert>
      ) : null}
      {events === null ? (
        <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
          Loading.
        </p>
      ) : all.length === 0 ? (
        <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
          Nothing yet. Correct a suggestion once and it will use your correction from then on.
        </p>
      ) : (
        <>
          <div className="fms-tallies">
            {[
              ["Suggested", count("proposed")],
              ["Added", count("accepted")],
              ["Corrected", count("edited")],
              ["Thrown away", count("rejected")],
              ["Photos read", count("uploaded")],
            ].map(([label, n]) => (
              <div key={String(label)} className="fms-tally">
                <div className="t-num">{n}</div>
                <div className="t-micro" style={{ color: "var(--ink-3)" }}>
                  {label}
                </div>
              </div>
            ))}
          </div>

          {learned.size > 0 && (
            <>
              <div className="t-label" style={{ color: "var(--ink-2)", margin: "var(--space-4) 0 var(--space-2)" }}>
                It now knows
              </div>
              <ul className="fms-learned">
                {[...learned.entries()].map(([from, to]) => (
                  <li key={from} className="t-caption">
                    <span style={{ color: "var(--ink-3)" }}>{from}</span> is <strong>{to}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="t-label" style={{ color: "var(--ink-2)", margin: "var(--space-4) 0 var(--space-2)" }}>
            Recently
          </div>
          <ol className="fms-acts">
            {all.slice(0, showAll ? 200 : 8).map((e) => (
              <li key={e.id} className="fms-act">
                <div className="fms-acthead">
                  <span className="t-caption">
                    {e.action === "edited" && e.field
                      ? `Corrected the ${e.field}: ${e.proposed} became ${e.corrected}`
                      : e.action === "uploaded"
                        ? (e.files ?? [])
                            .map((f) => `${f.name} (${f.kind}): ${f.details}`)
                            .join(" · ")
                        : (e.text ?? e.entry ?? e.action)}
                  </span>
                  <span className="t-micro fms-actwhen">{new Date(e.at).toLocaleString("en-PH")}</span>
                </div>
                <div className="fms-actmeta t-micro">
                  <span className="fms-actor">{e.action}</span>
                  <span>{e.where}</span>
                  {e.model && <span>{e.model}</span>}
                </div>
              </li>
            ))}
          </ol>

          {/*
            Eight, then the rest on request.

            This grows by several rows every time the assistant is used, and a
            page that becomes a wall after a fortnight is a page nobody opens.
            The counts above are the part worth seeing every time.
          */}
          {all.length > 8 && (
            <Button size="sm" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer" : `Show all ${all.length}`}
            </Button>
          )}
        </>
      )}

      <p className="t-caption" style={{ margin: "var(--space-3) 0 0", color: "var(--ink-3)" }}>
        Pictures are never stored, only described: the filename, what it turned out to be, its size,
        and what was read out of it. This record cannot be edited or deleted.
      </p>
    </Group>
  );
}
