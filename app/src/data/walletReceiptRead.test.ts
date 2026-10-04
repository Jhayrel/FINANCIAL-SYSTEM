/**
 * An e-wallet receipt through the whole picture path: read on the device,
 * sent to the model with its note, and the answer held to the screen.
 *
 * Each picture is its own request, so a screen's reference number or date
 * read as money (₱10.00 for October) must never move another picture's
 * card, and with no model the device's own reading still makes the card.
 * Every name and number is invented.
 */
import { describe, expect, it, vi } from "vitest";

import { extractProposals } from "./aiClient";
import type { Attachment } from "./attachments";
import type { ReferenceLists } from "../domain/types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash", "Maya"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
};
const token = async () => "a-token";
const picture = (id: string, name: string): Attachment => ({ id, name, kind: "image", bytes: 1000, dataUrl: `data:image/jpeg;base64,${id}` });
const gcash = picture("g1", "Screenshot_gcash.jpg");
const store = picture("t1", "receipt.jpg");

const readings: Record<string, { plain: string; raised: string }> = {
  "data:image/jpeg;base64,g1": {
    plain: "Sent via GCash\nAmount 120.00\nTotal Amount Sent ₱120.00\nRef No. 1234 567 890123 Oct 04,2026 9:15 AM",
    raised: "₱63 O......1234\nSent via GCash\nAmount\nTotal Amount Sent ₱120.00\nRef No. 1234 567 890123 Oct 04, 2026 9:15 AM\nJi 2799 (gcoze)\nBy going digital, you reduce your carbon footprint from",
  },
  "data:image/jpeg;base64,t1": { plain: "SARI STORE\nCandy\nTOTAL 10.00\nCASH 20.00\nCHANGE 10.00\n10/04/2026", raised: "SARI STORE\nTOTAL 10.00" },
};
const readPicture = async (dataUrl: string) => readings[dataUrl] ?? null;

const reply = (data: unknown[]): Response =>
  new Response(JSON.stringify({ data, model: "groq:openai/gpt-oss-120b" }), { headers: { "content-type": "application/json" } });
const contextOf = (init: RequestInit | undefined): string => (JSON.parse(String(init?.body)) as { context: string }).context;

describe("an e-wallet receipt among other pictures", () => {
  it("tells the model what the screen is, and holds its card to the screen", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      contextOf(init).includes("Sent via GCash")
        ? // The phone's "₱63" taken for the amount, as spending with no item.
          reply([{ flow: "Spending", date: "2026-10-04", fromWallet: "Gcash", item: "", amountPesos: 63, confidence: "medium" }])
        : reply([{ flow: "Spending", date: "2026-10-04", fromWallet: "Cash", item: "Food", description: "Candy", amountPesos: 10, confidence: "high" }]),
    );
    const result = await extractProposals({ note: "", attachments: [gcash, store], reference, asOf: "2026-10-04", fetcher: fetcher as unknown as typeof fetch, token, readPicture });

    const sentBody = fetcher.mock.calls.map((c) => contextOf(c[1])).find((c) => c.includes("Sent via GCash")) ?? "";
    expect(sentBody).toContain("confirmation of money sent to a person");
    expect(sentBody).toContain("Not amounts, never rows");

    expect(result.proposals).toHaveLength(2);
    const sent = result.proposals.find((p) => p.draft.fromWallet === "Gcash");
    expect(sent?.draft).toMatchObject({ flow: "Transfer", toWallet: "", amount: 12000, fee: 0, date: "2026-10-04" });
    // The store's ₱10.00 is its own, whatever the GCash screen's "Oct" reads as.
    const candy = result.proposals.find((p) => p.draft.fromWallet === "Cash");
    expect(candy?.draft).toMatchObject({ flow: "Spending", item: "Food", amount: 1000 });
  });

  it("still makes the card on the phone alone when no model answers", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await extractProposals({ note: "", attachments: [gcash], reference, asOf: "2026-10-04", fetcher: fetcher as unknown as typeof fetch, token, readPicture });
    expect(result.source).toBe("device");
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.draft).toMatchObject({ flow: "Transfer", fromWallet: "Gcash", amount: 12000, date: "2026-10-04" });
    expect(result.proposals[0]?.adjustments.join(" ")).toContain("read on this device");
  });
});
