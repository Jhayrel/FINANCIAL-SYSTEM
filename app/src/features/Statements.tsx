/**
 * Statements: spec 7.8.
 *
 * A statement type × a month range, shown as the sheet it prints as and
 * exported as a PDF laid out the way the owner's Excel printed one, or as
 * CSV for a spreadsheet.
 *
 * ── Asked for on 26 September 2026 ────────────────────────────────────────
 *
 * "Add pdf ... I want a layout", "who issued the statement like name to
 * input", "more option in the statement like credit or loan, all borrowed",
 * "at the end add nothing follows", "add somewhere the logo and the name of
 * the system". The PDF is `pdf/statementPdf.ts`, loaded only when asked for,
 * so the fonts it carries cost nothing until then. What this screen shows is
 * `buildSheet`, the same figures the PDF prints, row for row.
 */

import { saveFile } from "../data/download";
import { useEffect, useMemo, useState } from "react";

import { Button, Card, EmptyState, Money, StatusPill } from "../components/primitives";
import { Select } from "../components/Select";
import { TextInput } from "../components/forms";
import { DataTable, type Column } from "../components/DataTable";
import { formatShort, MONTH_NAMES, today } from "../domain/dates";
import { formatMoney } from "../domain/money";
import { accountGroups, type Account } from "../domain/accounts";
import type { Debt } from "../domain/debt";
import { buildSheet, periodLabel, type SheetLine } from "../domain/statementSheet";
import { buildPlanSheet, planSheetCsv, planSheetFilename } from "../domain/planSheet";
import { NO_DATE, type Plan } from "../domain/planner";
import { canFilter, filterChoices } from "../domain/statementFilter";
import { cashWallet } from "../domain/withdrawal";
import {
  buildStatementBetween,
  debtInScope,
  rangeOf,
  statementFilename,
  statementToCsv,
  STATEMENT_HINT,
  STATEMENT_LABEL,
  STATEMENT_TYPES,
  type StatementType,
} from "../domain/statements";
import type { IsoDate, ReferenceLists, Transaction } from "../domain/types";
import { yearsCovered } from "../domain/year";

/** Remembered on this device, so the name is typed once. */
const ISSUED_KEY = "fms.statement.issued";

export function readIssued(): { to: string; by: string } {
  try {
    const raw = localStorage.getItem(ISSUED_KEY);
    if (!raw) return { to: "", by: "" };
    const v = JSON.parse(raw) as { to?: unknown; by?: unknown };
    return { to: typeof v.to === "string" ? v.to : "", by: typeof v.by === "string" ? v.by : "" };
  } catch {
    return { to: "", by: "" };
  }
}


export function Statements({
  transactions,
  reference,
  accounts = [],
  debts,
  year: initialYear,
  asOf,
  plans = [],
  ownerName = "",
}: {
  transactions: readonly Transaction[];
  reference: ReferenceLists;
  /** Settings' accounts, so the wallet list sits under the same headings as there. */
  accounts?: readonly Account[];
  debts: readonly Debt[];
  /** The year it opens on. Any year the ledger covers can be picked. */
  year: number;
  /** Today: a statement starts at the first entry it covers and ends today at the latest (`fitPeriod`). */
  asOf?: IsoDate;
  /** The Planner's plans, for the Plans statement (`planSheet.ts`). */
  plans?: readonly Plan[];
  /** The name in Settings, Data, You: Issued to, until another is typed here. */
  ownerName?: string;
}) {
  const [type, setTypeState] = useState<StatementType>("account");
  /*
   * Only the months the ledger has. Every month of every year was offered,
   * so a statement could be asked for a period with nothing in it and came
   * back empty, with its CSV switched off (owner, 27 September 2026: "show
   * onlt the available date, like match it with the database"). Now each
   * year lists the months it has rows in, a later end cannot be put before
   * the start, and it opens on the months this year has so far.
   */
  const ledgerMonths = useMemo(() => {
    const out = new Map<number, Set<number>>();
    for (const t of transactions) {
      const y = Number(t.date.slice(0, 4));
      const m = Number(t.date.slice(5, 7));
      if (!Number.isInteger(y) || m < 1 || m > 12) continue;
      out.set(y, (out.get(y) ?? new Set()).add(m));
    }
    return out;
  }, [transactions]);
  // The Plans statement offers the months plans are due in, ahead ones too, and this month.
  const planMonths = useMemo(() => {
    const out = new Map<number, Set<number>>();
    const add = (d: string): void => {
      const y = Number(d.slice(0, 4));
      const m = Number(d.slice(5, 7));
      if (Number.isInteger(y) && m >= 1 && m <= 12) out.set(y, (out.get(y) ?? new Set()).add(m));
    };
    for (const p of plans) if (p.status !== "removed" && p.due !== NO_DATE) add(p.due);
    if (asOf) add(asOf);
    return out;
  }, [plans, asOf]);
  const monthsByYear = type === "plans" ? planMonths : ledgerMonths;
  /** Newest first. An imported year appears here as soon as its rows do. */
  const years = useMemo(() => {
    const list = type === "plans" ? [...planMonths.keys()].sort((a, b) => b - a) : [...new Set([...yearsCovered(transactions), ...ledgerMonths.keys()])].sort((a, b) => b - a);
    return list.length > 0 ? list : [initialYear];
  }, [type, transactions, ledgerMonths, planMonths, initialYear]);
  const monthsOf = (y: number): number[] => {
    const set = monthsByYear.get(y);
    return set && set.size > 0 ? [...set].sort((a, b) => a - b) : [];
  };
  const openYear = years.includes(initialYear) ? initialYear : (years[0] ?? initialYear);
  const [year, setYearState] = useState(openYear);
  const [toYear, setToYearState] = useState(openYear);
  const [from, setFrom] = useState(() => monthsOf(openYear)[0] ?? 1);
  const [to, setTo] = useState(() => monthsOf(openYear).at(-1) ?? 12);

  // The months each picker offers: those with rows, and never an end before the start.
  const fromMonths = monthsOf(year);
  const toMonths = monthsOf(toYear).filter((m) => toYear > year || m >= from);
  const toYears = years.filter((y) => y >= year);
  const nearest = (list: readonly number[], want: number, fallback: number): number =>
    list.includes(want) ? want : (list.find((m) => m >= want) ?? list.at(-1) ?? fallback);

  const setYear = (y: number): void => {
    setYearState(y);
    const nextFrom = nearest(monthsOf(y), from, 1);
    setFrom(nextFrom);
    // The end follows when it would fall before the new start.
    if (toYear < y || (toYear === y && to < nextFrom)) {
      setToYearState(y);
      setTo(monthsOf(y).at(-1) ?? 12);
    }
  };
  const setFromMonth = (m: number): void => {
    setFrom(m);
    if (toYear === year && to < m) setTo(nearest(monthsOf(toYear), m, m));
  };
  const setToYear = (y: number): void => {
    setToYearState(y);
    const allowed = monthsOf(y).filter((m) => y > year || m >= from);
    setTo(allowed.includes(to) ? to : (allowed.at(-1) ?? 12));
  };

  /*
   * Into or out of the Plans statement, the months change: plans are mostly
   * ahead, the ledger's months are behind. Plans open on the first month with
   * an open plan or this month, whichever is earlier, through the last month
   * planned; the ledger as it opens, this year's months.
   */
  const setType = (next: StatementType): void => {
    setTypeState(next);
    if ((next === "plans") === (type === "plans")) return;
    const key = (y: number, m: number): number => y * 12 + m;
    const flat = (map: Map<number, Set<number>>): { y: number; m: number }[] =>
      [...map.entries()].flatMap(([y, ms]) => [...ms].map((m) => ({ y, m }))).sort((a, b) => key(a.y, a.m) - key(b.y, b.m));
    if (next === "plans") {
      const all = flat(planMonths);
      const openDue = plans.filter((p) => p.status === "open" && p.due !== NO_DATE).map((p) => ({ y: Number(p.due.slice(0, 4)), m: Number(p.due.slice(5, 7)) }));
      const now = asOf ? { y: Number(asOf.slice(0, 4)), m: Number(asOf.slice(5, 7)) } : all[0];
      const first = [...openDue, ...(now ? [now] : [])].sort((a, b) => key(a.y, a.m) - key(b.y, b.m))[0] ?? all[0];
      const last = all.at(-1);
      if (first && last) {
        setYearState(first.y);
        setFrom(first.m);
        setToYearState(last.y);
        setTo(last.m);
      }
      return;
    }
    const back = [...new Set([...yearsCovered(transactions), ...ledgerMonths.keys()])].sort((a, b) => b - a);
    const y = back.includes(initialYear) ? initialYear : (back[0] ?? initialYear);
    const months = [...(ledgerMonths.get(y) ?? [])].sort((a, b) => a - b);
    setYearState(y);
    setToYearState(y);
    setFrom(months[0] ?? 1);
    setTo(months.at(-1) ?? 12);
  };

  // Every wallet the settings list or the year's rows name, the everyday ones first.
  const wallets = useMemo(() => {
    const named = new Set<string>([...reference.wallets, ...reference.savings]);
    for (const t of transactions) {
      const y = Number(t.date.slice(0, 4));
      if (y < Math.min(year, toYear) || y > Math.max(year, toYear)) continue;
      if (t.fromWallet) named.add(t.fromWallet);
      if (t.toWallet) named.add(t.toWallet);
    }
    return accountGroups([...named], accounts, reference);
  }, [reference, accounts, transactions, year, toYear]);
  const [wallet, setWallet] = useState(reference.wallets[0] ?? "");
  const [debtId, setDebtId] = useState(debts[0]?.id ?? "");

  const [issued, setIssued] = useState(() => {
    const last = readIssued();
    return { ...last, to: last.to || ownerName };
  });
  useEffect(() => {
    try {
      localStorage.setItem(ISSUED_KEY, JSON.stringify(issued));
    } catch {
      /* Private browsing: the name is simply not remembered. */
    }
  }, [issued]);

  const [making, setMaking] = useState(false);
  const [failed, setFailed] = useState("");

  const whole = useMemo(
    () =>
      type === "plans"
        ? buildPlanSheet(plans, { transactions, accounts, asOf: asOf ?? today() }, rangeOf({ year, month: from }, { year: toYear, month: to }), periodLabel(year, from, to, toYear))
        : buildSheet(transactions, { type, year, fromMonth: from, toMonth: to, toYear, wallet, debtId: debtId || undefined, asOf }, reference, debts),
    [transactions, type, year, from, to, toYear, wallet, debtId, reference, debts, asOf, plans, accounts],
  );
  /*
   * The Show picker: part of the statement only (owner, 12 October 2026:
   * "bills only, subscription only or a specific only", and the same on the
   * other statements). It offers what the period holds, and a pick the
   * period no longer has falls back to everything.
   */
  const [only, setOnly] = useState("");
  const choices = useMemo(
    () =>
      canFilter(type)
        ? filterChoices(
            type,
            buildStatementBetween(transactions, type, whole.from, whole.to, reference, undefined, { debts }).rows.map((r) => r.transaction),
            new Set(reference.savings),
            cashWallet(reference.wallets),
            debts,
          )
        : null,
    [transactions, type, whole.from, whole.to, reference, debts],
  );
  const shown = choices?.labelOf.has(only) ? only : "";
  const filtered = useMemo(
    () =>
      shown
        ? buildSheet(
            transactions,
            { type, year, fromMonth: from, toMonth: to, toYear, wallet, debtId: debtId || undefined, asOf, only: shown },
            reference,
            debts,
          )
        : null,
    [shown, transactions, type, year, from, to, toYear, wallet, debtId, reference, debts, asOf],
  );
  const sheet = filtered ?? whole;
  const statementNow = () =>
    buildStatementBetween(transactions, type, sheet.from, sheet.to, reference, debtId || undefined, { wallet, debts, only: shown || undefined });

  // Statements that cover a kind of debt say so when there is none of that kind.
  const noDebtsOfKind =
    (type === "borrowed" || type === "credit" || type === "lent" || type === "onbehalf") &&
    !debts.some((d) => debtInScope(d, type));

  const downloadCsv = (): void => {
    if (type === "plans") {
      saveFile(planSheetFilename(sheet, "csv"), planSheetCsv(sheet), "text/csv;charset=utf-8");
      return;
    }
    const statement = statementNow();
    saveFile(statementFilename(statement, "csv", sheet.subject), statementToCsv(statement), "text/csv;charset=utf-8");
  };

  const downloadPdf = async (): Promise<void> => {
    setMaking(true);
    setFailed("");
    try {
      const { statementPdf } = await import("../pdf/statementPdf");
      const bytes = await statementPdf({ sheet, issuedTo: issued.to, issuedBy: issued.by, issuedAt: new Date() });
      saveFile(type === "plans" ? planSheetFilename(sheet, "pdf") : statementFilename(statementNow(), "pdf", sheet.subject), bytes as BlobPart, "application/pdf");
    } catch (e) {
      setFailed(
        `The PDF could not be made (${(e as Error).message || "no reason given"}). The CSV has the same rows; try the PDF again after reloading the page.`,
      );
    } finally {
      setMaking(false);
    }
  };

  /*
   * Plans are not money moving: nothing in a plan's row is income or spending
   * (rule D3), so its figures stay in ink.
   */
  const inTone = type === "plans" ? "var(--ink)" : "var(--flow-revenue-text)";
  const outTone = type === "plans" ? "var(--ink)" : "var(--flow-spending-text)";
  const signedCell = (value: number, tone: string) =>
    value === 0 ? <span className="t-num-s" style={{ color: "var(--ink-3)" }}>-</span> : <Money value={value} size="s" tone={tone} />;

  const columns: Column<SheetLine>[] = [
    {
      key: "date",
      header: "Date",
      width: "104px",
      render: (l) =>
        l.coversTo ? (
          <span className="fms-dbrange">
            <span className="t-num-s">{(l.date ? formatShort(l.date) : "No date")}</span>
            <span className="t-micro" style={{ color: "var(--ink-3)" }}>to {formatShort(l.coversTo)}</span>
          </span>
        ) : (
          <span className="t-num-s">{(l.date ? formatShort(l.date) : "No date")}</span>
        ),
    },
    {
      key: "desc",
      header: "Description",
      render: (l) => (
        <span className="fms-stmtdesc">
          <span className="t-body fms-wraptext" title={l.description}>
            {l.description}
          </span>
          {/* What a transfer moved and what it cost, which its columns cannot say. */}
          {l.detail && (
            <span className="t-micro fms-wraptext" style={{ color: "var(--ink-3)" }} title={l.detail}>
              {l.detail}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "type",
      header: "Type",
      width: "156px",
      hideBelow: "md",
      render: (l) => <span className="t-caption fms-truncate" style={{ color: "var(--ink-2)" }}>{l.kind}</span>,
    },
    {
      key: "wallet",
      header: "Wallet",
      width: "180px",
      hideBelow: "lg",
      render: (l) => {
        const path = l.fromWallet && l.toWallet ? `${l.fromWallet} → ${l.toWallet}` : l.toWallet ? `→ ${l.toWallet}` : l.fromWallet;
        return <span className="t-caption fms-truncate" style={{ color: "var(--ink-2)" }} title={path}>{path}</span>;
      },
    },
    ...(sheet.headings.moneyIn
      ? [{
          key: "in",
          header: sheet.headings.moneyIn,
          align: "right" as const,
          width: "128px",
          render: (l: SheetLine) => signedCell(l.moneyIn, inTone),
        }]
      : []),
    ...(sheet.headings.moneyOut
      ? [{
          key: "out",
          header: sheet.headings.moneyOut,
          align: "right" as const,
          width: "128px",
          render: (l: SheetLine) => signedCell(l.moneyOut, outTone),
        }]
      : []),
    {
      key: "balance",
      header: sheet.headings.balance,
      align: "right",
      width: "136px",
      render: (l) => <Money value={l.balance ?? 0} size="s" />,
    },
  ];

  const typeLabel = STATEMENT_LABEL[type];

  return (
    <div className="fms-db">
      <Card page title="Statements" subtitle="Any period, printed the way your Excel printed it" padded={false}>
        <div className="fms-stmttools">
          <label className="fms-stmtfield fms-stmtfield--wide">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>Statement</span>
            <Select
              value={typeLabel}
              onChange={(label) => {
                const found = STATEMENT_TYPES.find((t) => STATEMENT_LABEL[t] === label);
                if (found) {
                  setType(found);
                  setOnly("");
                }
              }}
              options={STATEMENT_TYPES.map((t) => STATEMENT_LABEL[t])}
            />
          </label>

          {choices && choices.options.length > 2 && (
            <label className="fms-stmtfield">
              <span className="t-label" style={{ color: "var(--ink-2)" }}>Show</span>
              <Select
                value={choices.labelOf.get(shown) ?? choices.options[0] ?? ""}
                onChange={(label) => setOnly(choices.keyOf.get(label) ?? "")}
                options={choices.options}
                groups={choices.groups}
                ariaLabel="Show"
              />
            </label>
          )}

          {type === "wallet" && wallets.options.length > 0 && (
            <label className="fms-stmtfield">
              <span className="t-label" style={{ color: "var(--ink-2)" }}>Wallet</span>
              <Select value={wallet} onChange={setWallet} options={wallets.options} groups={wallets.groups} ariaLabel="Which wallet" />
            </label>
          )}

          {type === "debt" && debts.length > 0 && (
            <label className="fms-stmtfield">
              <span className="t-label" style={{ color: "var(--ink-2)" }}>Debt</span>
              <Select
                value={debts.find((d) => d.id === debtId)?.name ?? ""}
                onChange={(name) => setDebtId(debts.find((d) => d.name === name)?.id ?? "")}
                options={debts.map((d) => d.name)}
              />
            </label>
          )}

          <div className="fms-stmtfield fms-stmtfield--range" role="group" aria-label="From">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>From</span>
            <div className="fms-stmtpair">
              <Select
                value={MONTH_NAMES[from - 1] ?? ""}
                onChange={(m) => setFromMonth(MONTH_NAMES.indexOf(m as (typeof MONTH_NAMES)[number]) + 1)}
                options={fromMonths.map((m) => MONTH_NAMES[m - 1]!)}
                ariaLabel="From month"
              />
              <Select value={String(year)} onChange={(v) => setYear(Number(v))} options={years.map(String)} ariaLabel="From year" />
            </div>
          </div>

          <div className="fms-stmtfield fms-stmtfield--range" role="group" aria-label="To">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>To</span>
            <div className="fms-stmtpair">
              <Select
                value={MONTH_NAMES[to - 1] ?? ""}
                onChange={(m) => setTo(MONTH_NAMES.indexOf(m as (typeof MONTH_NAMES)[number]) + 1)}
                options={toMonths.map((m) => MONTH_NAMES[m - 1]!)}
                ariaLabel="To month"
              />
              <Select value={String(toYear)} onChange={(v) => setToYear(Number(v))} options={toYears.map(String)} ariaLabel="To year" />
            </div>
          </div>
        </div>

        <div className="fms-stmttools fms-stmttools--issue">
          <label className="fms-stmtfield fms-stmtfield--wide">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>Issued to</span>
            <TextInput
              value={issued.to}
              onChange={(v) => setIssued((p) => ({ ...p, to: v }))}
              placeholder="Your name"
              maxLength={80}
            />
          </label>
          <label className="fms-stmtfield fms-stmtfield--wide">
            <span className="t-label" style={{ color: "var(--ink-2)" }}>
              Issued by <span style={{ color: "var(--ink-3)" }}>(optional)</span>
            </span>
            <TextInput
              value={issued.by}
              onChange={(v) => setIssued((p) => ({ ...p, by: v }))}
              placeholder="Who is issuing it"
              maxLength={80}
            />
          </label>
          <div className="fms-stmtexport">
            <Button variant="secondary" onClick={downloadCsv} disabled={sheet.lines.length === 0}>
              CSV
            </Button>
            <Button variant="primary" onClick={() => void downloadPdf()} loading={making}>
              Download PDF
            </Button>
          </div>
        </div>

        {failed && (
          <p className="t-caption" role="alert" style={{ margin: 0, padding: "var(--space-3) var(--space-5)", color: "var(--over)" }}>
            {failed}
          </p>
        )}

        <div className="fms-stmtsummary">
          <span className="t-caption" style={{ color: "var(--ink-3)" }}>
            {sheet.period}
            {sheet.subject ? ` · ${sheet.subject}` : ""} · {STATEMENT_HINT[type]}
          </span>
          <span style={{ display: "flex", gap: "var(--space-2) var(--space-4)", flexWrap: "wrap", alignItems: "center" }}>
            {sheet.broughtForward !== null && (
              <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                Brought forward <Money value={sheet.broughtForward} size="s" />
              </span>
            )}
            {sheet.headings.moneyIn && (
              <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                {sheet.headings.moneyIn} <Money value={sheet.totalIn} size="s" tone={inTone} />
              </span>
            )}
            {sheet.headings.moneyOut && (
              <span className="t-caption" style={{ color: "var(--ink-2)" }}>
                {sheet.headings.moneyOut} <Money value={sheet.totalOut} size="s" tone={outTone} />
              </span>
            )}
            <span className="t-caption" style={{ color: "var(--ink-2)" }}>
              {sheet.headings.balance} <Money value={sheet.closing} size="s" />
            </span>
            <StatusPill status="info">{sheet.lines.length} rows</StatusPill>
          </span>
        </div>

        {sheet.lines.length === 0 ? (
          <EmptyState
            message={
              noDebtsOfKind
                ? `No debt of this kind is set up. Add one on the Debt screen and its rows will show here.`
                : `Nothing in the ${typeLabel.toLowerCase()} for ${sheet.period}. Pick a wider range of months or another year.`
            }
          />
        ) : (
          <>
            <div className="fms-tablewrap">
              <DataTable columns={columns} rows={sheet.lines} getKey={(l) => l.id} />
            </div>
            <ul className="fms-dblist">
              {sheet.lines.map((l) => (
                <li key={l.id} className="fms-dbrow">
                  <div className="fms-dbrow-main">
                    <div className="fms-dbrow-text">
                      <span className="t-body-strong fms-wraptext">{l.description}</span>
                      <div className="t-micro" style={{ color: "var(--ink-3)" }}>
                        {(l.date ? formatShort(l.date) : "No date")}{l.coversTo ? ` to ${formatShort(l.coversTo)}` : ""} · {l.kind}
                        {l.fromWallet || l.toWallet ? ` · ${[l.fromWallet, l.toWallet].filter(Boolean).join(" → ")}` : ""}
                      </div>
                      {l.detail && (
                        <div className="t-micro" style={{ color: "var(--ink-3)" }}>
                          {l.detail}
                        </div>
                      )}
                    </div>
                    <div className="fms-dbrow-figure fms-stmtfigure">
                      {type === "plans" ? (
                        // A plan: what was planned, and what is left of it; no sign, nothing moved.
                        <>
                          <Money value={l.moneyIn} size="s" />
                          {l.moneyOut > 0 && (
                            <span className="t-micro" style={{ color: "var(--ink-3)" }}>
                              {formatMoney(l.moneyOut)} paid
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          {l.moneyIn > 0 && <Money value={l.moneyIn} size="s" signed tone="var(--flow-revenue-text)" />}
                          {l.moneyOut > 0 && <Money value={-l.moneyOut} size="s" tone="var(--flow-spending-text)" />}
                        </>
                      )}
                      {l.balance !== null && type !== "plans" && (
                        <span className="t-micro" style={{ color: "var(--ink-3)" }}>
                          <Money value={l.balance} size="s" tone="var(--ink-3)" />
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {/* What the PDF says under its totals, said here too: what was withdrawn, and any fee folded into a figure. */}
            {sheet.notes.length > 0 && (
              <div className="fms-stmtnotes">
                {sheet.notes.map((n) => (
                  <p key={n} className="t-caption" style={{ margin: 0, color: "var(--ink-2)" }}>
                    {n}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
