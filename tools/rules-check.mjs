/**
 * firestore.rules, run for real in the Firestore emulator.
 *
 * `app/src/data/rulesConformance.test.ts` mirrors the rules in TypeScript,
 * which is fast and runs everywhere, but a mirror can be wrong in the same
 * way as the thing it mirrors. This runs the rules file itself, in Google's
 * own rules engine, against every kind of write the app makes, and against
 * the writes the rules exist to refuse.
 *
 * Needs Java 11 or later. From the repository root:
 *
 *   npm i --no-save firebase-tools@15 @firebase/rules-unit-testing@5 firebase@12
 *   npx firebase emulators:exec --only firestore --project demo-fms "node tools/rules-check.mjs"
 *
 * Nothing here touches the real project: `demo-` projects exist only in the
 * emulator, and the emulator is thrown away when the command ends.
 */

import { readFileSync } from "node:fs";

import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteField, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const OWNER = /return '([^']+)';/.exec(rules)?.[1];
if (!OWNER) throw new Error("No owner uid found in firestore.rules");

const env = await initializeTestEnvironment({
  projectId: "demo-fms",
  firestore: { rules, host: "127.0.0.1", port: 8080 },
});

const owner = env.authenticatedContext(OWNER).firestore();
const stranger = env.authenticatedContext("someone-else").firestore();
const anonymous = env.unauthenticatedContext().firestore();
const at = (db, path) => doc(db, `users/${OWNER}/${path}`);

const row = (over = {}) => ({
  recordNumber: 442,
  date: "2026-09-28",
  type: "Spending",
  fromWallet: "Cash",
  toWallet: "",
  category: "Spending",
  item: "Home",
  description: "Reed diffuser",
  amount: 10900,
  fee: 0,
  total: 10900,
  notes: "",
  status: "Paid",
  entrySource: "ai",
  editedAt: serverTimestamp(),
  ...over,
});

const settings = {
  version: 9,
  accounts: [{ name: "Cash" }],
  bills: [],
  subscriptions: [],
  revenueCategories: [],
  spendingTypes: [],
  credits: [],
  lowBalanceThreshold: 50000,
  theme: "system",
  ai: { enabled: true, provider: "groq", model: "", tone: "brief" },
};

let passed = 0;
let failed = 0;
async function check(name, work) {
  try {
    await work();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  FAIL  ${name}\n        ${e instanceof Error ? e.message : e}`);
  }
}

console.log("Who can read and write");
await check("the owner reads the ledger", () => assertSucceeds(getDocs(collection(owner, `users/${OWNER}/transactions`))));
await check("another account cannot read it", () => assertFails(getDocs(collection(stranger, `users/${OWNER}/transactions`))));
await check("signed out cannot read it", () => assertFails(getDocs(collection(anonymous, `users/${OWNER}/transactions`))));
await check("another account cannot write", () => assertFails(setDoc(at(stranger, "transactions/t-1"), row())));

console.log("The ledger");
await check("a spending row", () => assertSucceeds(setDoc(at(owner, "transactions/t-1"), row())));
await check("a debt payment", () =>
  assertSucceeds(setDoc(at(owner, "transactions/t-2"), row({ type: "Debt", category: "", item: "", debtId: "maya-credit", debtEffect: "repay" }))));
await check("an opening balance", () =>
  assertSucceeds(setDoc(at(owner, "transactions/t-3"), row({ type: "Revenue", category: "Opening", fromWallet: "", toWallet: "Cash" }))));
await check("a float amount is refused", () => assertFails(setDoc(at(owner, "transactions/t-4"), row({ amount: 109.5, total: 109.5 }))));
await check("parts that do not add up are refused", () => assertFails(setDoc(at(owner, "transactions/t-4"), row({ total: 99 }))));
await check("a debt row without its debt is refused", () => assertFails(setDoc(at(owner, "transactions/t-4"), row({ type: "Debt" }))));
await check("a key-shaped field is refused", () => assertFails(setDoc(at(owner, "transactions/t-4"), row({ apiKey: "x" }))));
await check("a hard delete is refused", () => assertFails(deleteDoc(at(owner, "transactions/t-1"))));

console.log("Binning, restoring and starting clean");
await check("bin a row", () => assertSucceeds(setDoc(at(owner, "transactions/t-1"), { deletedAt: "2026-09-28T01:00:00Z", editedAt: serverTimestamp() }, { merge: true })));
await check("restore it", () => assertSucceeds(setDoc(at(owner, "transactions/t-1"), { deletedAt: deleteField(), editedAt: serverTimestamp() }, { merge: true })));
await env.withSecurityRulesDisabled(async (ctx) => {
  // A row from before today's rules: no status field and an entrySource the rules no longer take.
  const legacy = row({ entrySource: "owner" });
  delete legacy.status;
  delete legacy.editedAt;
  await setDoc(doc(ctx.firestore(), `users/${OWNER}/transactions/old-1`), legacy);
});
await check("an old row can be binned", () => assertSucceeds(setDoc(at(owner, "transactions/old-1"), { deletedAt: "2026-09-28T01:00:00Z", editedAt: serverTimestamp() }, { merge: true })));
await check("an old row can be set aside by Start clean", () => assertSucceeds(setDoc(at(owner, "transactions/old-1"), { discardedAt: "2026-09-28T01:00:00Z", editedAt: serverTimestamp() }, { merge: true })));
await check("an old row's money still cannot change on its own", () => assertFails(updateDoc(at(owner, "transactions/old-1"), { amount: 1, total: 1 })));
await check("a mark must be the right kind", () => assertFails(setDoc(at(owner, "transactions/old-1"), { deletedAt: 5 }, { merge: true })));
await check("an old row rewritten whole and valid is accepted", () => assertSucceeds(setDoc(at(owner, "transactions/old-1"), row())));

console.log("Settings and budgets");
await check("settings", () => assertSucceeds(setDoc(at(owner, "meta/settings"), settings)));
await check("one section of settings", () => assertSucceeds(setDoc(at(owner, "meta/settings"), { theme: "dark" }, { mergeFields: ["theme"] })));
await check("settings with a key in them are refused", () => assertFails(setDoc(at(owner, "meta/settings"), { ...settings, ai: { ...settings.ai, apiKey: "x" } })));
await check("a budget year", () => assertSucceeds(setDoc(at(owner, "budgets/2026"), { spending: Array(12).fill(0), billsSubs: Array(12).fill(0) })));
await check("a budget with eleven months is refused", () => assertFails(setDoc(at(owner, "budgets/2026"), { spending: Array(11).fill(0), billsSubs: Array(12).fill(0) })));

console.log("The three logs, append only");
await check("an activity event", () =>
  assertSucceeds(setDoc(at(owner, "activity/e1"), { at: "2026-09-28T01:00:00Z", actor: "ai", via: "ai_image", action: "transaction.create", summary: "Added #442" })));
await check("an activity event cannot be edited", () => assertFails(updateDoc(at(owner, "activity/e1"), { summary: "changed" })));
await check("a chat message with a card", () =>
  assertSucceeds(setDoc(at(owner, "chat/m1"), { at: "2026-09-28T01:00:00Z", role: "assistant", text: "One card", card: "{}", files: ["receipt.jpg, a receipt: Home, PHP 109.00"] })));
await check("a chat message holding a picture is refused", () =>
  assertFails(setDoc(at(owner, "chat/m2"), { at: "2026-09-28T01:00:00Z", role: "you", text: "data:image/png;base64,AAAA", files: [] })));
await check("an assistant event", () =>
  assertSucceeds(setDoc(at(owner, "ai/a1"), { at: "2026-09-28T01:00:00Z", action: "proposed", where: "add", entry: "Home PHP 109.00" })));
await check("an assistant event cannot be deleted", () => assertFails(deleteDoc(at(owner, "ai/a1"))));

console.log("Coderview's reads");
await check("the parent document", () => assertSucceeds(getDoc(doc(owner, `users/${OWNER}`))));
await check("the whole meta collection", () => assertSucceeds(getDocs(collection(owner, `users/${OWNER}/meta`))));
await check("anything else is refused", () => assertFails(setDoc(doc(owner, "elsewhere/x"), { a: 1 })));

await env.cleanup();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
