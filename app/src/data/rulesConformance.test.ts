/**
 * Every row the app can save, held to the database's own rules.
 *
 * There is no emulator on this machine, and a row the rules refuse is a row
 * the owner typed and lost: the save fails at the database, after the form has
 * been cleared. So the checks in `firestore.rules` (`validTransaction`) are
 * written out here and every kind of entry the form, the chat and the Debt,
 * Dashboard and Insights buttons can produce goes through them. If the rules
 * change, change `accepts` with them.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { draftToTransactions, emptyDraft, type Draft } from "../domain/entry";
import type { Transaction } from "../domain/types";
import { toDocument } from "./firestoreLedger";

const RULES = readFileSync(resolve(__dirname, "../../../firestore.rules"), "utf8");

const TYPES = ["Revenue", "Spending", "Transfer", "Debt"];
const CATEGORIES = ["Revenue", "Spending", "Bills", "Subscriptions", "Transfer", "Opening", ""];
const EFFECTS = ["draw", "charge", "repay", "interest", "fee", "writeoff", "lend", "collect"];
const SECRET = ["apiKey", "api_key", "apikey", "key", "token", "secret", "authorization", "bearer"];
const REQUIRED = ["recordNumber", "date", "type", "fromWallet", "toWallet", "category", "item", "description", "amount", "fee", "total", "notes", "status"];

const isInt = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v);
const isCentavos = (v: unknown): boolean => isInt(v) && (v as number) > -100000000000 && (v as number) < 100000000000;
const str = (v: unknown, max: number): boolean => typeof v === "string" && v.length <= max;

/** `validTransaction()` from firestore.rules, line for line. Returns what it would refuse. */
function refusals(d: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of REQUIRED) if (!(k in d)) out.push(`missing ${k}`);
  if (!isInt(d.recordNumber) || (d.recordNumber as number) <= 0) out.push("recordNumber");
  if (typeof d.date !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d.date)) out.push("date");
  if (!TYPES.includes(d.type as string)) out.push(`type ${String(d.type)}`);
  if (!CATEGORIES.includes(d.category as string)) out.push(`category ${String(d.category)}`);
  if (!str(d.fromWallet, 80)) out.push("fromWallet");
  if (!str(d.toWallet, 80)) out.push("toWallet");
  if (!str(d.item, 80)) out.push("item");
  if (!str(d.description, 500)) out.push("description");
  if (!str(d.notes, 1000)) out.push("notes");
  if (!str(d.status, 40)) out.push("status");
  if (!isCentavos(d.amount) || !isCentavos(d.fee) || !isCentavos(d.total)) out.push("money");
  if (d.total !== (d.amount as number) + (d.fee as number)) out.push("total");
  if (d.type === "Debt" && (!str(d.debtId, 10_000) || (d.debtId as string).length === 0 || !EFFECTS.includes(d.debtEffect as string))) {
    out.push("debt");
  }
  if ("deletedAt" in d && typeof d.deletedAt !== "string") out.push("deletedAt");
  if ("entrySource" in d && !["manual", "ai"].includes(d.entrySource as string)) out.push("entrySource");
  if ("partOf" in d && (!str(d.partOf, 200) || (d.partOf as string).length === 0)) out.push("partOf");
  if (Object.keys(d).some((k) => SECRET.includes(k))) out.push("secret");
  for (const [k, v] of Object.entries(d)) if (v === undefined) out.push(`undefined ${k}`);
  return out;
}

const entry = (over: Partial<Draft>): Draft => ({ ...emptyDraft("2026-09-18"), amount: 12345, ...over });

/** Every shape of entry the app produces, by where it comes from. */
const CASES: [string, Draft, { principal: number; interest: number }?][] = [
  ["spending", entry({ flow: "Spending", category: "Spending", item: "Food", fromWallet: "Maya", status: "Paid" })],
  ["a bill with a fee", entry({ flow: "Spending", category: "Bills", item: "Wifi", fromWallet: "Gcash", fee: 1500, status: "Paid" })],
  ["income", entry({ flow: "Revenue", category: "Revenue", item: "Allowance", toWallet: "Cash", status: "Received" })],
  ["interest into savings", entry({ flow: "Revenue", category: "Revenue", item: "Bank interest", toWallet: "Maya Bank (Personal savings)", amount: 22 })],
  ["a transfer between own accounts", entry({ flow: "Transfer", fromWallet: "Maya", toWallet: "Gcash", fee: 1500, status: "Transferred" })],
  ["money sent to someone", entry({ flow: "Transfer", fromWallet: "Maya", toWallet: "", sentOut: true })],
  ["an opening balance", entry({ flow: "Opening", toWallet: "Cash" })],
  ["borrowing with fees", entry({ flow: "Debt", debtId: "maya-credit", debtEffect: "draw", toWallet: "Maya", charges: 2265 })],
  ["a charge on its own", entry({ flow: "Debt", debtId: "maya-credit", debtEffect: "charge" })],
  ["a payment with interest", entry({ flow: "Debt", debtId: "maya-credit", debtEffect: "repay", fromWallet: "Maya", amount: 268879, interest: 18879 }), { principal: 250000, interest: 18879 }],
  ["a personal loan lent", entry({ flow: "Debt", debtId: "juan", debtEffect: "lend", fromWallet: "Gcash" })],
  ["a personal loan paid back", entry({ flow: "Debt", debtId: "juan", debtEffect: "collect", toWallet: "Cash" })],
  ["waived by the lender", entry({ flow: "Debt", debtId: "maya-credit", debtEffect: "writeoff" })],
  ["on behalf: advance", entry({ flow: "Debt", behalf: "owed", debtId: "stephen", debtEffect: "lend", fromWallet: "Cash" })],
  ["on behalf: reimbursed", entry({ flow: "Debt", behalf: "owed", debtId: "stephen", debtEffect: "collect", toWallet: "Cash" })],
  ["on behalf: write off", entry({ flow: "Debt", behalf: "owed", debtId: "stephen", debtEffect: "writeoff", item: "Treat" })],
  ["on behalf: held", entry({ flow: "Debt", behalf: "held", debtId: "boss", debtEffect: "draw", toWallet: "Maya" })],
  ["on behalf: released", entry({ flow: "Debt", behalf: "held", debtId: "boss", debtEffect: "repay", fromWallet: "Maya" })],
  ["on behalf: retained", entry({ flow: "Debt", behalf: "held", debtId: "boss", debtEffect: "writeoff", item: "Random" })],
];

describe("every row the app saves passes the database rules", () => {
  it("reads the rules file this mirrors, so a change there is noticed here", () => {
    expect(RULES).toContain("d.type in ['Revenue', 'Spending', 'Transfer', 'Debt']");
    expect(RULES).toContain("'writeoff', 'lend', 'collect']");
    expect(RULES).toContain("'Transfer', 'Opening', '']");
    expect(RULES).toContain("d.partOf.size() <= 200");
  });

  for (const [name, draft, split] of CASES) {
    it(name, () => {
      const rows: Transaction[] = draftToTransactions(draft, 442, "t-1789999999999", split);
      for (const row of rows) {
        const doc = toDocument({ ...row, entrySource: "manual" });
        expect(refusals(doc), `${name}: ${JSON.stringify(doc)}`).toEqual([]);
        // What the form carries only for itself never reaches the database.
        expect(doc).not.toHaveProperty("behalf");
        expect(doc).not.toHaveProperty("sentOut");
        expect(doc).not.toHaveProperty("interest");
        expect(doc).not.toHaveProperty("charges");
      }
    });
  }

  it("writes no provenance at all rather than one the rules refuse", () => {
    const [row] = draftToTransactions(CASES[0]![1], 1, "t-1");
    const doc = toDocument({ ...row!, entrySource: "owner" as unknown as "manual" });
    expect(doc).not.toHaveProperty("entrySource");
    expect(refusals(doc)).toEqual([]);
    expect(toDocument({ ...row!, entrySource: "manual" }).entrySource).toBe("manual");
  });

  it("bins and restores with a field the rules accept", () => {
    const [row] = draftToTransactions(CASES[0]![1], 1, "t-1");
    expect(refusals(toDocument(row!, "2026-09-18T10:00:00.000Z"))).toEqual([]);
  });
});
