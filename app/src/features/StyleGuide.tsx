/**
 * Live style guide: every component, both themes, real figures.
 * Implements docs/04-STYLE-GUIDE.md. This is the approval gate.
 */

import { useState } from "react";

import {
  Alert,
  Button,
  Card,
  CountChip,
  DeltaChip,
  EmptyState,
  FlowBadge,
  KpiTile,
  Money,
  Placeholder,
  ProgressBar,
  SegmentedControl,
  StatusPill,
  Tabs,
  Toast,
  type Flow,
  type Status,
} from "../components/primitives";
import {
  AmountInput,
  Checkbox,
  Field,
  SearchInput,
  Select,
  Switch,
  TextInput,
} from "../components/forms";
import { DataTable, type Column } from "../components/DataTable";
import { AreaChart, BarChart, DonutChart, RankBars, Sparkline } from "../components/charts";
import { getPreference, resolvesToDark, setPreference } from "../theme";
import type { Centavos } from "../domain/money";

const FLOWS: Flow[] = ["revenue", "spending", "transfer", "debt"];
const STATUSES: Status[] = ["ok", "over", "warn", "info", "none"];

interface Txn {
  id: string;
  no: string;
  date: string;
  flow: Flow;
  item: string;
  wallet: string;
  amount: Centavos;
  status: string;
  flagged?: boolean;
}

const TXNS: Txn[] = [
  { id: "1", no: "0440", date: "08/28/2026", flow: "spending", item: "Treat", wallet: "Maya", amount: -110000, status: "Paid" },
  { id: "2", no: "0439", date: "08/28/2026", flow: "revenue", item: "Framelink", wallet: "→ Maya", amount: 657828, status: "Received" },
  { id: "3", no: "0438", date: "08/28/2026", flow: "spending", item: "Unknown", wallet: "Cash", amount: -82600, status: "Paid" },
  { id: "4", no: "0408", date: "08/03/2026", flow: "debt", item: "Maya Credit", wallet: "Maya", amount: -268879, status: "Paid" },
  { id: "5", no: "0406", date: "08/03/2026", flow: "transfer", item: "Gcash → Maya", wallet: "Gcash", amount: 270000, status: "Transferred" },
  { id: "6", no: "0190", date: "04/03/2026", flow: "transfer", item: "Uncategorised", wallet: "Gcash", amount: 601500, status: "Transferred", flagged: true },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"];
const SPENDING: Centavos[] = [1174947, 3874160, 1733750, 2529799, 8365400, 3076200, 1512700, 1129137];
const REVENUE: Centavos[] = [3220297, 2500433, 1629111, 2251174, 11278701, 1385397, 777661, 1528822];
const BUDGET: Centavos[] = [930000, 2970000, 1370000, 2170000, 6470000, 1670000, 500000, 770000];

const TOP: { name: string; value: Centavos }[] = [
  { name: "School", value: 5243200 },
  { name: "Online Buy", value: 4149174 },
  { name: "Treat", value: 2570200 },
  { name: "Money Send", value: 1707100 },
  { name: "Home Needs", value: 1594800 },
  { name: "Food", value: 1451300 },
];

export function StyleGuide() {
  const [dark, setDark] = useState(() => resolvesToDark(getPreference()));
  const [tab, setTab] = useState<"all" | "flagged">("all");
  const [filter, setFilter] = useState<"all" | Flow>("all");
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState<Centavos | null>(110000);
  const [text, setText] = useState("Treat my friends at Bacsil View deck");
  const [wallet, setWallet] = useState("Maya");
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set(["2"]));
  const [sort, setSort] = useState("date");

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    setPreference(next ? "dark" : "light");
  };

  const columns: Column<Txn>[] = [
    { key: "no", header: "Record", width: "88px", render: (r) => <span className="t-num-s" style={{ color: "var(--ink-3)" }}>{r.no}</span> },
    { key: "date", header: "Date", width: "110px", sortable: true, render: (r) => <span className="t-num-s">{r.date}</span> },
    { key: "flow", header: "Flow", width: "120px", render: (r) => <FlowBadge flow={r.flow} /> },
    { key: "item", header: "Item", render: (r) => <span className="t-body-strong">{r.item}</span> },
    { key: "wallet", header: "Wallet", render: (r) => <span className="t-body" style={{ color: "var(--ink-2)" }}>{r.wallet}</span> },
    { key: "status", header: "Status", width: "120px", render: (r) => <StatusPill status={r.status === "Paid" ? "over" : "ok"}>{r.status}</StatusPill> },
    { key: "amount", header: "Amount", align: "right", sortable: true, render: (r) => <Money value={r.amount} signed /> },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--paper)" }}>
      {/* Top bar */}
      <header
        className="safe-t"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "var(--surface)",
          borderBottom: "1px solid var(--hairline)",
          padding: "var(--space-4) var(--space-5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-4)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <span
            aria-hidden
            style={{
              width: 28, height: 28, borderRadius: "var(--radius-sm)",
              background: "var(--brand-700)", display: "grid", placeItems: "center",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4.5h8M4 8h8M4 11.5h4.5" stroke="var(--on-brand)" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <h1 className="t-display-m" style={{ margin: 0 }}>Style guide</h1>
            <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
              Every component · both themes
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button size="sm" onClick={toggleTheme}>{dark ? "Light" : "Dark"} theme</Button>
          <Button size="sm" variant="primary">Add transaction</Button>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "var(--space-6) var(--space-5) var(--space-12)", display: "grid", gap: "var(--space-6)" }}>

        {/* KPI row */}
        <div style={{ display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <KpiTile
            label="Net worth"
            value={487797}
            delta={-3.2}
            components={[
              { label: "Wallets", value: 611245 },
              { label: "Savings", value: 152758 },
              { label: "Debt", value: -276206, tone: "var(--flow-debt-text)" },
            ]}
          />
          <KpiTile
            label="Spending this month"
            value={1129137}
            delta={12.4}
            footer={<ProgressBar value={1129137} max={770000} pace={0.93} />}
          />
          <KpiTile
            label="Revenue this month"
            value={1528822}
            delta={4.8}
            tone="var(--flow-revenue-text)"
            footer={<Sparkline values={REVENUE.map((v) => v / 100)} width={200} />}
          />
          <KpiTile
            label="Maya Credit"
            value={-276206}
            tone="var(--flow-debt-text)"
            components={[{ label: "Due", value: 0, tone: "var(--ink-3)" }]}
            footer={<StatusPill status="warn">Due in 5 days</StatusPill>}
          />
        </div>

        {/* Charts. Time series get the width they need. */}
        <div style={{ display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))" }}>
          <Card title="Revenue and spending" subtitle="January to August 2026" action={<SegmentedControl options={[{ id: "y", label: "Year" }, { id: "m", label: "Month" }]} value="y" onChange={() => {}} />}>
            <AreaChart
              labels={MONTHS}
              series={[
                { name: "Revenue", values: REVENUE, colour: "var(--flow-revenue)" },
                { name: "Spending", values: SPENDING, colour: "var(--flow-spending)" },
              ]}
            />
          </Card>

          <Card title="Budget vs actual" subtitle="Bars turn red when the month goes over">
            <BarChart labels={MONTHS} budget={BUDGET} actual={SPENDING} />
          </Card>

          <Card title="Top spending" subtitle="2026 year to date">
            <RankBars rows={TOP} />
          </Card>

          <Card title="Where the money went" subtitle="Composition of annual spending">
            <DonutChart slices={TOP} centreLabel="₱222k" size={160} />
          </Card>
        </div>

        {/* Table */}
        <Card
          title="Transactions"
          subtitle="Desktop table · phone stacks into rows"
          padded={false}
          action={<CountChip>440 records</CountChip>}
        >
          <div style={{ padding: "var(--space-4) var(--space-5)", display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "center" }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search item, description, wallet…" />
            <SegmentedControl
              options={[{ id: "all", label: "All" }, ...FLOWS.map((f) => ({ id: f, label: f[0]!.toUpperCase() + f.slice(1) }))]}
              value={filter}
              onChange={setFilter}
            />
          </div>
          <div style={{ padding: "0 var(--space-5)" }}>
            <Tabs
              tabs={[{ id: "all", label: "All", count: 440 }, { id: "flagged", label: "Needs review", count: 2 }]}
              value={tab}
              onChange={setTab}
            />
          </div>
          <DataTable
            columns={columns}
            rows={tab === "flagged" ? TXNS.filter((t) => t.flagged) : TXNS}
            getKey={(r) => r.id}
            sortKey={sort}
            onSort={setSort}
            selectedKeys={selected}
            onToggleRow={(k) =>
              setSelected((prev) => {
                const next = new Set(prev);
                next.has(k) ? next.delete(k) : next.add(k);
                return next;
              })
            }
            rowTone={(r) => (r.flagged ? "warn" : undefined)}
            footer={
              <>
                <span className="t-caption" style={{ color: "var(--ink-3)" }}>Showing 1 to 6 of 440</span>
                <span style={{ display: "flex", gap: "var(--space-2)" }}>
                  <Button size="sm" disabled>Previous</Button>
                  <Button size="sm">Next</Button>
                </span>
              </>
            }
          />
        </Card>

        {/* Buttons */}
        <Card title="Buttons" subtitle="4 variants × 3 sizes, plus states">
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            <Row label="Variants">
              <Button variant="primary">Save transaction</Button>
              <Button>Cancel</Button>
              <Button variant="ghost">Duplicate</Button>
              <Button variant="danger">Delete</Button>
            </Row>
            <Row label="Sizes">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg" variant="primary">Large</Button>
            </Row>
            <Row label="States">
              <Button variant="primary" loading>Saving</Button>
              <Button disabled>Disabled</Button>
              <Button iconLeft={<span aria-hidden>＋</span>} variant="primary">Add a debt</Button>
            </Row>
          </div>
        </Card>

        {/* Form */}
        <div style={{ display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          <Card title="Inputs" subtitle="Label always visible · placeholder shows format">
            <div style={{ display: "grid", gap: "var(--space-4)" }}>
              <Field label="Amount" required help="Numeric keypad on phone. Parsed to centavos on blur.">
                <AmountInput value={amount} onChange={setAmount} />
              </Field>
              <Field label="From wallet" required>
                <Select value={wallet} onChange={setWallet} options={["Maya", "Cash", "Gcash", "Reserved Fund"]} />
              </Field>
              <Field label="Description" optional>
                <TextInput value={text} onChange={setText} placeholder="What was it for?" />
              </Field>
              <Field label="Transaction fee" error="Amount must be more than ₱0.00.">
                <AmountInput value={0} onChange={() => {}} invalid />
              </Field>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)" }}>
                <Checkbox checked={checked} onChange={setChecked} label="Mark as reviewed" />
                <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <span className="t-body">Autofill</span>
                  <Switch checked={on} onChange={setOn} label="Autofill suggestions" />
                </span>
              </div>
              <Field label="Disabled">
                <TextInput value="0441" onChange={() => {}} disabled />
              </Field>
            </div>
          </Card>

          <Card title="Warnings and alerts" subtitle="Severity carries meaning, never decoration">
            <div style={{ display: "grid", gap: "var(--space-3)" }}>
              <Alert status="over" title="Insufficient balance">
                This puts Gcash at −₱44.29. Save anyway?
              </Alert>
              <Alert status="warn" title="This looks like borrowing">
                “Maya Credit” is an open debt. Book it as a debt draw instead of revenue?
                <div style={{ marginTop: "var(--space-2)", display: "flex", gap: "var(--space-2)" }}>
                  <Button size="sm" variant="primary">Book as debt</Button>
                  <Button size="sm">Keep as revenue</Button>
                </div>
              </Alert>
              <Alert status="info">
                Two transfer fees have no category, so ₱30.00 never counted as an expense.
              </Alert>
              <Alert status="ok" title="Saved">
                Record #0442 added. Wallet balances updated.
              </Alert>
              <div style={{ marginTop: "var(--space-2)" }}>
                <Toast action={<Button size="sm" variant="ghost">Undo</Button>}>
                  Saved. Record #0442.
                </Toast>
              </div>
            </div>
          </Card>
        </div>

        {/* Badges, flows, status */}
        <div style={{ display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          <Card title="Flow colours" subtitle="Direction of money, the only thing colour encodes">
            <div style={{ display: "grid", gap: "var(--space-3)" }}>
              <Row label="Badges">
                {FLOWS.map((f) => <FlowBadge key={f} flow={f} />)}
              </Row>
              {FLOWS.map((f) => (
                <div key={f} style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", padding: "var(--space-3)", background: `var(--flow-${f}-bg)`, borderRadius: "var(--radius-md)" }}>
                  <span aria-hidden style={{ width: 4, alignSelf: "stretch", borderRadius: "var(--radius-full)", background: `var(--flow-${f})` }} />
                  <div>
                    <div className="t-body-strong" style={{ color: `var(--flow-${f}-text)` }}>{f}</div>
                    <div className="t-caption" style={{ color: `var(--flow-${f}-text)` }}>
                      {f === "transfer" ? "Neither gain nor loss, so grey on purpose" : f === "debt" ? "A liability is not an expense, so amber rather than red" : "text on its own wash"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Status, chips and progress">
            <div style={{ display: "grid", gap: "var(--space-4)" }}>
              <Row label="Status">
                {STATUSES.map((s) => (
                  <StatusPill key={s} status={s}>
                    {{ ok: "Within budget", over: "Over budget", warn: "Due soon", info: "Needs review", none: "No budget set" }[s]}
                  </StatusPill>
                ))}
              </Row>
              <Row label="Chips">
                <CountChip>440 records</CountChip>
                <DeltaChip pct={3.5} />
                <DeltaChip pct={-2.1} />
              </Row>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span className="t-body">Spending</span>
                  <span className="t-num-s" style={{ color: "var(--ink-2)" }}>₱11,291.37 / ₱7,700.00</span>
                </div>
                <ProgressBar value={1129137} max={770000} pace={0.93} />
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span className="t-body">Bills &amp; subscriptions</span>
                  <span className="t-num-s" style={{ color: "var(--ink-2)" }}>₱1,641.00 / ₱1,700.00</span>
                </div>
                <ProgressBar value={164100} max={170000} pace={0.93} />
              </div>
              <Row label="Loading">
                <div style={{ display: "grid", gap: 6, width: "100%" }}>
                  <Placeholder width="60%" />
                  <Placeholder width="90%" />
                  <Placeholder width="40%" />
                </div>
              </Row>
            </div>
          </Card>
        </div>

        {/* Empty + type */}
        <div style={{ display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          <Card title="Empty state" subtitle="Never “no data”, always the next action">
            <EmptyState message="No debts tracked. Good place to be." action={<Button variant="primary">Add a debt</Button>} />
          </Card>

          <Card title="Type and numbers" subtitle="Inter · tabular figures for money">
            <div style={{ display: "grid", gap: "var(--space-3)" }}>
              <div className="t-display-xl">₱4,877.97</div>
              <div className="t-display-l">Screen title</div>
              <div className="t-display-m">Card title</div>
              <div className="t-body">Body: 14px, the default.</div>
              <div className="t-caption" style={{ color: "var(--ink-2)" }}>Caption: dates and meta.</div>
              <div className="t-th" style={{ color: "var(--ink-3)" }}>TABLE HEADER: the only uppercase</div>
              <div style={{ display: "grid", gap: 2, marginTop: "var(--space-2)" }}>
                {[579574, 16100, 15571, 152758, -276206].map((v) => (
                  <div key={v} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--hairline)", padding: "4px 0" }}>
                    <span className="t-body" style={{ color: "var(--ink-2)" }}>Aligned</span>
                    <Money value={v} />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
      <span className="t-label" style={{ color: "var(--ink-3)", width: 72, flex: "0 0 auto" }}>{label}</span>
      {children}
    </div>
  );
}
