/**
 * The client half of reading a receipt.
 *
 * There is no auth and no Functions runtime in local development, so this is
 * the only place the request shape and the failure paths get exercised at all.
 * Both are injected, which is why they are options on `extractProposals` in
 * the first place.
 */

import { describe, expect, it, vi } from "vitest";

import { extractProposals } from "./aiClient";
import type { Attachment } from "./attachments";
import type { ReferenceLists } from "../domain/types";

const reference: ReferenceLists = {
  wallets: ["Cash", "Gcash"],
  savings: [],
  bills: ["Electricity"],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
};

const ASOF = "2026-08-31";
const token = async () => "a-token";

const photo: Attachment = {
  id: "a1",
  name: "receipt.jpg",
  kind: "image",
  bytes: 1000,
  dataUrl: "data:image/jpeg;base64,AAAA",
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const sent = (fetcher: ReturnType<typeof vi.fn>): Record<string, unknown> =>
  JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;

describe("extractProposals: what goes out", () => {
  it("sends the image, the task, and the allowed lists, and no ledger rows", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ data: [], model: "groq:x" }));

    await extractProposals({
      note: "this is from BPI",
      attachments: [photo],
      reference,
      asOf: ASOF,
      fetcher: fetcher as unknown as typeof fetch,
      token,
    });

    const body = sent(fetcher);
    expect(body["task"]).toBe("extract");
    expect(body["images"]).toEqual(["data:image/jpeg;base64,AAAA"]);

    const context = String(body["context"]);
    expect(context).toContain(ASOF);
    expect(context).toContain("Cash, Gcash");
    expect(context).toContain("Food");
    expect(context).toContain("this is from BPI");
  });

  it("sends a text file's contents rather than the file", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ data: [] }));

    await extractProposals({
      note: "",
      attachments: [{ id: "a2", name: "august.csv", kind: "text", bytes: 20, text: "date,amount" }],
      reference,
      asOf: ASOF,
      fetcher: fetcher as unknown as typeof fetch,
      token,
    });

    const body = sent(fetcher);
    expect(body["images"]).toEqual([]);
    expect(String(body["context"])).toContain("date,amount");
  });

  it("takes a pasted key out of the note before it leaves the device", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ data: [] }));

    await extractProposals({
      note: "my key is gsk_abcdefghijklmnopqrst",
      attachments: [photo],
      reference,
      asOf: ASOF,
      fetcher: fetcher as unknown as typeof fetch,
      token,
    });

    const context = String(sent(fetcher)["context"]);
    expect(context).not.toContain("gsk_abcdefghijklmnopqrst");
    expect(context).toContain("[redacted]");
  });

  it("sends nothing at all without a session", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ data: [] }));

    const result = await extractProposals({
      note: "",
      attachments: [photo],
      reference,
      asOf: ASOF,
      fetcher: fetcher as unknown as typeof fetch,
      token: async () => null,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.source).toBe("offline");
    expect(result.reason).toContain("Not signed in");
  });
});

describe("extractProposals: what comes back", () => {
  it("turns the payload into proposals", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            flow: "Spending",
            date: "2026-08-30",
            fromWallet: "Cash",
            item: "Food",
            amountPesos: 100,
            confidence: "high",
            sourceRef: "image 1, line 2",
          },
        ],
        model: "groq:qwen",
      }),
    );

    const result = await extractProposals({
      note: "",
      attachments: [photo],
      reference,
      asOf: ASOF,
      fetcher: fetcher as unknown as typeof fetch,
      token,
    });

    expect(result.source).toBe("model");
    expect(result.model).toBe("groq:qwen");
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.draft.amount).toBe(10000);
    expect(result.proposals[0]?.sourceRef).toBe("image 1, line 2");
  });

  it("keeps the reason a row was refused", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ data: [{ flow: "Debt", amountPesos: 500 }] }),
    );

    const result = await extractProposals({
      note: "",
      attachments: [photo],
      reference,
      asOf: ASOF,
      fetcher: fetcher as unknown as typeof fetch,
      token,
    });

    expect(result.proposals).toHaveLength(0);
    expect(result.refused[0]?.reason).toContain("debt");
  });

  it("reports an empty read as an empty read, not a failure", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ data: [] }));

    const result = await extractProposals({
      note: "",
      attachments: [photo],
      reference,
      asOf: ASOF,
      fetcher: fetcher as unknown as typeof fetch,
      token,
    });

    expect(result.source).toBe("model");
    expect(result.proposals).toHaveLength(0);
    expect(result.reason).toBeUndefined();
  });

  it("passes the endpoint's own message through when it refuses", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: "Neither provider is offering a free model that can read pictures right now." }, 503),
    );

    const result = await extractProposals({
      note: "",
      attachments: [photo],
      reference,
      asOf: ASOF,
      fetcher: fetcher as unknown as typeof fetch,
      token,
    });

    expect(result.source).toBe("offline");
    expect(result.reason).toContain("read pictures");
  });

  it("recognises the dev server answering with the app shell", async () => {
    const fetcher = vi.fn(
      async () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }),
    );

    const result = await extractProposals({
      note: "",
      attachments: [photo],
      reference,
      asOf: ASOF,
      fetcher: fetcher as unknown as typeof fetch,
      token,
    });

    expect(result.source).toBe("offline");
    expect(result.reason).toContain("only on the deployed site");
  });

  it("says a timeout was a timeout, and what to do about it", async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });

    const result = await extractProposals({
      note: "",
      attachments: [photo],
      reference,
      asOf: ASOF,
      fetcher: fetcher as unknown as typeof fetch,
      token,
    });

    expect(result.source).toBe("offline");
    expect(result.reason).toContain("smaller or clearer");
  });
});
