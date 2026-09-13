/**
 * The test set the assistant is scored against.
 *
 * ── What this is instead of training ──────────────────────────────────────
 *
 * The models behind the assistant are hosted by Groq and OpenRouter, and
 * nobody outside those providers can change what they have learned. What this
 * app controls is everything around them: the reader on the device, the
 * examples the model is shown, and the rules that decide which of the two to
 * believe. A change to any of those is only an improvement if it makes more
 * sentences come out right and none come out wrong, and the only way to know
 * that is to count. This is the count.
 *
 * ── Where the sentences came from ─────────────────────────────────────────
 *
 * Their shapes are the owner's own. Every case here mirrors something they
 * actually typed, taken from the assistant's record: the Tagalog, the
 * misspellings, the three-part sentences, the questions that got filed as
 * rows. The amounts, the names and the dates are invented, because this
 * repository is public and a real ledger does not belong in it. The owner's
 * real sentences are replayed separately, from their own disk, by
 * `replayRecord.test.ts`, and never committed.
 *
 * ── Reading a result ──────────────────────────────────────────────────────
 *
 * A case marked `gap` is a known failure, kept visible on purpose. It is
 * still scored on every run, so the day one starts passing the scoreboard
 * says so, and the day a passing case starts failing the suite does.
 */

import type { ReferenceLists } from "../types";

/**
 * The owner's lists, as configuration.
 *
 * Their real shape, with names that identify nothing: wallet brands and item
 * categories are the same for anyone using these services, and the one
 * employer name in their real settings is replaced.
 */
export const REFERENCE: ReferenceLists = {
  wallets: ["Gcash", "Maya", "Cash"],
  savings: ["Maya Bank (Personal savings)", "Reserved Fund"],
  bills: ["Globe at Home Wifi", "Dito Prepaid"],
  subscriptions: ["Spotify", "Google Drive", "Microsoft Office 365", "Netflix"],
  revenueCategories: ["Cash on hand", "Allowance", "Random", "Bank interest", "Freelance"],
  spendingTypes: [
    { name: "Food", remark: "Meals, snacks, drinks" },
    { name: "Gas", remark: "Fuel for vehicle" },
    { name: "School", remark: "Tuition, school supplies" },
    { name: "Online Buy", remark: "Online orders, apps, or subscriptions" },
    { name: "Self Care", remark: "Haircut, hygiene, grooming, gym" },
    { name: "Health", remark: "Medicine or medical needs" },
    { name: "Travel", remark: "Trips, fares, rides" },
    { name: "Fun", remark: "Outings, parties, leisure" },
    { name: "Home Needs", remark: "Groceries, home items, small tools" },
    { name: "Parking", remark: "Fee for parking any types" },
    { name: "Unknown", remark: "Not sure where spent" },
    { name: "Treat", remark: "Treating someone" },
    { name: "Repairs", remark: "Technical and mechanical repairs" },
    { name: "Emergency", remark: "For Emergency needs" },
  ],
  credits: ["Maya Credit"],
};

export const TODAY = "2026-09-06";

export type Tag =
  | "spend, English"
  | "spend, Tagalog"
  | "shop names"
  | "income"
  | "own transfer"
  | "withdrawal"
  | "money to a person"
  | "several in one"
  | "borrowing"
  | "advice, never a row"
  | "question"
  | "delete and restore"
  | "chart"
  | "misspelled"
  | "bills and subscriptions";

export type Expect =
  | {
      readonly kind: "entry";
      readonly flow: "Spending" | "Revenue" | "Transfer";
      readonly item?: string;
      readonly pesos?: number;
      readonly from?: string;
      readonly to?: string;
      readonly sentOut?: boolean;
      readonly status?: string;
    }
  | { readonly kind: "split"; readonly parts: number }
  | { readonly kind: "debt"; readonly credit?: string }
  | { readonly kind: "question" }
  | { readonly kind: "delete" }
  | { readonly kind: "restore" }
  | { readonly kind: "discard" }
  | { readonly kind: "chart"; readonly compares?: boolean };

export interface Case {
  readonly said: string;
  readonly tag: Tag;
  readonly expect: Expect;
  /** A known failure, with the reason. Scored, reported, never hidden. */
  readonly gap?: string;
}

export const CORPUS: readonly Case[] = [
  // ── Spending, in English ─────────────────────────────────────────────────
  { tag: "spend, English", said: "I paid 250 for gas using cash", expect: { kind: "entry", flow: "Spending", item: "Gas", pesos: 250, from: "Cash" } },
  { tag: "spend, English", said: "I paid 180 for tricycle fare using cash", expect: { kind: "entry", flow: "Spending", pesos: 180, from: "Cash" } },
  { tag: "spend, English", said: "I paid 640 for food from maya", expect: { kind: "entry", flow: "Spending", item: "Food", pesos: 640, from: "Maya" } },
  { tag: "spend, English", said: "I spent 1200 on school from gcash", expect: { kind: "entry", flow: "Spending", item: "School", pesos: 1200, from: "Gcash" } },
  { tag: "spend, English", said: "add 500 food cash", expect: { kind: "entry", flow: "Spending", item: "Food", pesos: 500, from: "Cash" } },
  { tag: "spend, English", said: "I paid 1,250.50 for medicine from gcash", expect: { kind: "entry", flow: "Spending", item: "Health", pesos: 1250.5, from: "Gcash" } },
  { tag: "spend, English", said: "I paid 45 for parking using cash", expect: { kind: "entry", flow: "Spending", item: "Parking", pesos: 45, from: "Cash" } },
  { tag: "spend, English", said: "I bought groceries 850 using cash", expect: { kind: "entry", flow: "Spending", item: "Home Needs", pesos: 850, from: "Cash" } },
  { tag: "spend, English", said: "I topped up 300 load on gcash", expect: { kind: "entry", flow: "Spending", pesos: 300, from: "Gcash" } },
  { tag: "spend, English", said: "I paid 500 for food at shell using cash", expect: { kind: "entry", flow: "Spending", item: "Food", pesos: 500, from: "Cash" } },

  // ── Spending, in Tagalog ─────────────────────────────────────────────────
  { tag: "spend, Tagalog", said: "nag bayad ako ng tricycle 500 kanina cash gamit ko", expect: { kind: "entry", flow: "Spending", item: "Travel", pesos: 500, from: "Cash" } },
  { tag: "spend, Tagalog", said: "bumuli ako ng pagkain 200 gcash", expect: { kind: "entry", flow: "Spending", item: "Food", pesos: 200, from: "Gcash" } },
  { tag: "spend, Tagalog", said: "bumili ako ng gamot 450 cash", expect: { kind: "entry", flow: "Spending", item: "Health", pesos: 450, from: "Cash" } },
  { tag: "spend, Tagalog", said: "nagbayad ako 300 pamasahe cash", expect: { kind: "entry", flow: "Spending", item: "Travel", pesos: 300, from: "Cash" } },
  { tag: "spend, Tagalog", said: "binili ko ang ulam 150 gcash", expect: { kind: "entry", flow: "Spending", item: "Food", pesos: 150, from: "Gcash" } },

  // ── A shop's name says what was bought ───────────────────────────────────
  { tag: "shop names", said: "I paid 285 at jollibee using gcash", expect: { kind: "entry", flow: "Spending", item: "Food", pesos: 285, from: "Gcash" } },
  { tag: "shop names", said: "I paid 190 for grab using gcash", expect: { kind: "entry", flow: "Spending", item: "Travel", pesos: 190, from: "Gcash" } },
  { tag: "shop names", said: "I ordered 360 on grabfood from gcash", expect: { kind: "entry", flow: "Spending", item: "Food", pesos: 360, from: "Gcash" } },
  { tag: "shop names", said: "I paid 420 at mercury drug from cash", expect: { kind: "entry", flow: "Spending", item: "Health", pesos: 420, from: "Cash" } },
  { tag: "shop names", said: "I bought 1038 on shopee from maya", expect: { kind: "entry", flow: "Spending", item: "Online Buy", pesos: 1038, from: "Maya" } },
  { tag: "shop names", said: "I paid 950 at petron using cash", expect: { kind: "entry", flow: "Spending", item: "Gas", pesos: 950, from: "Cash" } },
  { tag: "shop names", said: "I paid 1500 at puregold using gcash", expect: { kind: "entry", flow: "Spending", item: "Home Needs", pesos: 1500, from: "Gcash" } },
  { tag: "shop names", said: "I paid 560 for angkas using gcash", expect: { kind: "entry", flow: "Spending", item: "Travel", pesos: 560, from: "Gcash" } },
  { tag: "shop names", said: "I paid 600 for sm cinema tickets using gcash", expect: { kind: "entry", flow: "Spending", item: "Fun", pesos: 600, from: "Gcash" } },
  { tag: "shop names", said: "I paid 1160 for claude subscription from maya", expect: { kind: "entry", flow: "Spending", item: "Online Buy", pesos: 1160, from: "Maya" } },

  // ── Income ───────────────────────────────────────────────────────────────
  { tag: "income", said: "I received 3000 allowance in maya", expect: { kind: "entry", flow: "Revenue", item: "Allowance", pesos: 3000, to: "Maya" } },
  { tag: "income", said: "natanggap ko 5000 sa maya kahapon", expect: { kind: "entry", flow: "Revenue", pesos: 5000, to: "Maya" } },
  { tag: "income", said: "bank interest credited to maya 4.02", expect: { kind: "entry", flow: "Revenue", pesos: 4.02, to: "Maya" } },
  { tag: "income", said: "I got 2000 from freelance in gcash", expect: { kind: "entry", flow: "Revenue", item: "Freelance", pesos: 2000, to: "Gcash" } },

  // ── Between the owner's own accounts ─────────────────────────────────────
  { tag: "own transfer", said: "I transferred 2000 from maya to gcash", expect: { kind: "entry", flow: "Transfer", pesos: 2000, from: "Maya", to: "Gcash", status: "Transferred" } },
  { tag: "own transfer", said: "I transferred 5000 from maya to maya bank personal savings", expect: { kind: "entry", flow: "Transfer", pesos: 5000, from: "Maya", to: "Maya Bank (Personal savings)" } },
  { tag: "own transfer", said: "I moved 2000 to reserved fund from cash", expect: { kind: "entry", flow: "Transfer", pesos: 2000, from: "Cash", to: "Reserved Fund" } },
  { tag: "own transfer", said: "I transfer 5k to gcash from maya", expect: { kind: "entry", flow: "Transfer", pesos: 5000, from: "Maya", to: "Gcash" } },

  // ── Withdrawals ──────────────────────────────────────────────────────────
  { tag: "withdrawal", said: "I withdrew 5000 from maya to cash", expect: { kind: "entry", flow: "Transfer", pesos: 5000, from: "Maya", to: "Cash", status: "Withdrawn" } },
  { tag: "withdrawal", said: "I withdrew 3000 from maya to cash with 18 fee", expect: { kind: "entry", flow: "Transfer", pesos: 3000, from: "Maya", to: "Cash", status: "Withdrawn" } },

  // ── Money that left the accounts ─────────────────────────────────────────
  { tag: "money to a person", said: "I gave 500 to my mom from gcash", expect: { kind: "entry", flow: "Transfer", pesos: 500, from: "Gcash", sentOut: true } },
  { tag: "money to a person", said: "I paid my friend 1200 using gcash for the tickets she bought me", expect: { kind: "entry", flow: "Transfer", pesos: 1200, from: "Gcash", sentOut: true } },
  { tag: "money to a person", said: "I sent 500 to my mom's gcash from maya", expect: { kind: "entry", flow: "Transfer", pesos: 500, from: "Maya", sentOut: true } },
  { tag: "money to a person", said: "nagpadala ako 300 sa nanay ko galing gcash", expect: { kind: "entry", flow: "Transfer", pesos: 300, sentOut: true } },

  // ── Several entries in one message ───────────────────────────────────────
  { tag: "several in one", said: "I paid 500 for food from gcash and 300 for gas from cash", expect: { kind: "split", parts: 2 } },
  { tag: "several in one", said: "I paid 500 for food from gcash, then 300 for gas from cash, then 250 for fun from maya", expect: { kind: "split", parts: 3 } },
  { tag: "several in one", said: "I sent 500 to my mom's gcash and 500 to my own gcash, same day, from maya", expect: { kind: "split", parts: 2 } },
  { tag: "several in one", said: "I borrowed 2000 on maya credit into gcash, then paid 500 for food from gcash, then gave 300 to my mom", expect: { kind: "split", parts: 3 } },
  { tag: "several in one", said: "I paid 250 for gas and food from cash", expect: { kind: "split", parts: 1 } },
  { tag: "several in one", said: "I got 5000 allowance and 2000 from freelance in maya", expect: { kind: "split", parts: 2 } },

  // ── Borrowing ────────────────────────────────────────────────────────────
  { tag: "borrowing", said: "I borrowed 2000 on maya credit into gcash", expect: { kind: "debt", credit: "maya-credit" } },
  { tag: "borrowing", said: "I recived it in maya and the credit is from maya credit", expect: { kind: "debt", credit: "maya-credit" } },
  { tag: "borrowing", said: "umutang ako 2000 sa maya credit", expect: { kind: "debt", credit: "maya-credit" } },
  { tag: "borrowing", said: "i credited 5000 today and recieved it in maya", expect: { kind: "debt" } },
  { tag: "borrowing", said: "I paid my debt yesterday 2,950.00 using maya", expect: { kind: "debt" } },
  { tag: "borrowing", said: "I apid my debt too", expect: { kind: "debt" } },

  // ── Advice: answered, never filed ────────────────────────────────────────
  { tag: "advice, never a row", said: "I have 20000 saved and tuition is 18000 next month, what should I do", expect: { kind: "question" } },
  { tag: "advice, never a row", said: "if I loan 1 billion for treat is it good??", expect: { kind: "question" } },
  { tag: "advice, never a row", said: "should I put my savings in crypto", expect: { kind: "question" } },
  { tag: "advice, never a row", said: "should I go to mcdonalds today spend 30k?", expect: { kind: "question" } },
  { tag: "advice, never a row", said: "is it worth it to buy a 5000 phone now", expect: { kind: "question" } },
  { tag: "advice, never a row", said: "should I borrow 5000 for tuition or take it from my reserved fund?", expect: { kind: "question" } },
  { tag: "advice, never a row", said: "if i spend today 1000 is it good? I can adjust my budget", expect: { kind: "question" } },
  { tag: "advice, never a row", said: "dapat ba akong bumili ng bagong phone", expect: { kind: "question" } },

  // ── Ordinary questions ───────────────────────────────────────────────────
  { tag: "question", said: "how is this week going", expect: { kind: "question" } },
  { tag: "question", said: "what did I spend yesterday", expect: { kind: "question" } },
  { tag: "question", said: "which day this fortnight did I spend the most", expect: { kind: "question" } },
  { tag: "question", said: "My net worth says 102 million. Is that right?", expect: { kind: "question" } },
  { tag: "question", said: "what is my exact balance", expect: { kind: "question" } },
  { tag: "question", said: "What is the highest amount I spent?", expect: { kind: "question" } },

  // ── Delete, restore, discard ─────────────────────────────────────────────
  { tag: "delete and restore", said: "delete my latest spending thats wrong", expect: { kind: "delete" } },
  { tag: "delete and restore", said: "discard the food I paid yesterday", expect: { kind: "delete" } },
  { tag: "delete and restore", said: "restore my deleted entry yesterday", expect: { kind: "restore" } },
  { tag: "delete and restore", said: "bring back the food I deleted", expect: { kind: "restore" } },
  { tag: "delete and restore", said: "undelete the last one", expect: { kind: "restore" } },
  { tag: "delete and restore", said: "discard", expect: { kind: "discard" } },
  { tag: "delete and restore", said: "nevermind", expect: { kind: "discard" } },

  // ── Charts ───────────────────────────────────────────────────────────────
  { tag: "chart", said: "show me the trend of my food this year", expect: { kind: "chart" } },
  { tag: "chart", said: "chart my spending by wallet", expect: { kind: "chart" } },
  { tag: "chart", said: "make me a pie of top spending this month", expect: { kind: "chart" } },
  { tag: "chart", said: "how did august compare with july", expect: { kind: "chart", compares: true } },
  { tag: "chart", said: "I want graph", expect: { kind: "chart" } },
  { tag: "chart", said: "can you make a trend of all high spend only", expect: { kind: "chart" } },

  // ── Misspelled, as the owner actually types ──────────────────────────────
  { tag: "misspelled", said: "I paid 200 for foood using cash", expect: { kind: "entry", flow: "Spending", pesos: 200, from: "Cash" } },
  { tag: "misspelled", said: "I wihdraw 1000 to cash from maya yesterday", expect: { kind: "entry", flow: "Transfer", pesos: 1000, from: "Maya", to: "Cash", status: "Withdrawn" } },
  { tag: "misspelled", said: "I easrn 30000 yesterday in gcash", expect: { kind: "entry", flow: "Revenue", pesos: 30000, to: "Gcash" } },
  { tag: "misspelled", said: "I recieved 1500 allowance in gcash", expect: { kind: "entry", flow: "Revenue", item: "Allowance", pesos: 1500, to: "Gcash" } },
  { tag: "misspelled", said: "I trasfer 800 from gcash to maya", expect: { kind: "entry", flow: "Transfer", pesos: 800, from: "Gcash", to: "Maya" } },

  // ── Bills and subscriptions ──────────────────────────────────────────────
  { tag: "bills and subscriptions", said: "I paid my spotify from gcash", expect: { kind: "entry", flow: "Spending", item: "Spotify", from: "Gcash" } },
  { tag: "bills and subscriptions", said: "I paid my dito prepaid from maya", expect: { kind: "entry", flow: "Spending", item: "Dito Prepaid", from: "Maya" } },
  { tag: "bills and subscriptions", said: "I paid globe at home wifi 999 from maya", expect: { kind: "entry", flow: "Spending", item: "Globe at Home Wifi", pesos: 999, from: "Maya" } },

  // ── Added after replaying the owner's real record ────────────────────────
  //
  // Each of these is the shape of a real sentence that read as nothing when
  // the record was replayed through the reader. They are scored from now on,
  // so a fix is visible and a relapse is a failure.
  { tag: "question", said: ". how is this week going", expect: { kind: "question" } },
  { tag: "question", said: "wich day this fortnight did I sped the most", expect: { kind: "question" } },
  { tag: "question", said: "expalin my spending this month", expect: { kind: "question" } },
  { tag: "chart", said: "I want all of my transaction to be summarized into a visual", expect: { kind: "chart" } },
  { tag: "spend, English", said: "add 250 gas cash", expect: { kind: "entry", flow: "Spending", item: "Gas", pesos: 250, from: "Cash" } },
  { tag: "money to a person", said: "binigay ko 200 sa kuya galing maya", expect: { kind: "entry", flow: "Transfer", pesos: 200, from: "Maya", sentOut: true } },
  { tag: "advice, never a row", said: "should I loan???", expect: { kind: "question" } },
];
