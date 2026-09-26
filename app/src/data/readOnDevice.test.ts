/**
 * Read, then analyse, then check (the owner, 26 September 2026).
 *
 * A picture read well on the device goes to the model as text, to the fast
 * text models; one read badly still goes as a picture; and when the text
 * finds nothing the pictures go to a vision model after all.
 */
import { describe, expect, it, vi } from "vitest";

import { extractProposals } from "./aiClient";
import type { Attachment } from "./attachments";
import type { ReferenceLists } from "../domain/types";

const reference: ReferenceLists = {
  wallets: ["Maya", "Gcash"],
  savings: [],
  bills: [],
  subscriptions: [],
  revenueCategories: ["Allowance"],
  spendingTypes: [{ name: "Food", remark: "" }],
};
const token = async () => "a-token";
const picture = (id: string, name: string): Attachment => ({ id, name, kind: "image", bytes: 1000, dataUrl: `data:image/jpeg;base64,${id}` });
const maya = picture("m1", "maya.jpg");
const sunset = picture("s1", "sunset.jpg");

const reply = (data: unknown[]): Response =>
  new Response(JSON.stringify({ data, model: "groq:openai/gpt-oss-120b" }), { headers: { "content-type": "application/json" } });
const row = { flow: "Spending", date: "2026-09-20", fromWallet: "Maya", item: "Food", amountPesos: 149.8, confidence: "high" };
const bodyOf = (fetcher: ReturnType<typeof vi.fn>, call = 0): { images: string[]; context: string } =>
  JSON.parse(String((fetcher.mock.calls[call]?.[1] as RequestInit).body)) as { images: string[]; context: string };

const readings: Record<string, { plain: string; raised: string } | null> = {
  "data:image/jpeg;base64,m1": { plain: "DST -₱1.23\nService Fee -₱149.80", raised: "September 20, 2026\nFee applied 07:57 PM\nService Fee -₱149.80" },
  "data:image/jpeg;base64,s1": { plain: "sunset", raised: "" },
};
const readPicture = async (dataUrl: string) => readings[dataUrl] ?? null;

describe("a picture read on the device", () => {
  it("goes as its text, with no picture, so the fast text models answer", async () => {
    const fetcher = vi.fn(async () => reply([row]));
    const result = await extractProposals({ note: "add these", attachments: [maya], reference, asOf: "2026-09-26", fetcher: fetcher as unknown as typeof fetch, token, readPicture });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = bodyOf(fetcher);
    expect(body.images).toEqual([]);
    expect(body.context).toContain("Read on this device from the picture maya.jpg");
    expect(body.context).toContain("Reading 2, contrast raised:\nSeptember 20, 2026");
    expect(result.proposals).toHaveLength(1);
    expect(result.readOnDevice).toBe(1);
  });

  it("a picture with too little in it still goes as a picture", async () => {
    const fetcher = vi.fn(async () => reply([row]));
    await extractProposals({ note: "", attachments: [maya, sunset], reference, asOf: "2026-09-26", fetcher: fetcher as unknown as typeof fetch, token, readPicture });
    const body = bodyOf(fetcher);
    expect(body.images).toEqual(["data:image/jpeg;base64,s1"]);
    expect(body.context).toContain("maya.jpg");
  });

  it("when the text finds nothing, the pictures go to a vision model after all", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply([])).mockResolvedValueOnce(reply([row]));
    const result = await extractProposals({ note: "", attachments: [maya], reference, asOf: "2026-09-26", fetcher: fetcher as unknown as typeof fetch, token, readPicture });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetcher, 1).images).toEqual(["data:image/jpeg;base64,m1"]);
    expect(result.proposals).toHaveLength(1);
  });

  it("a reader that fails changes nothing: the picture goes as before", async () => {
    const fetcher = vi.fn(async () => reply([row]));
    await extractProposals({ note: "", attachments: [maya], reference, asOf: "2026-09-26", fetcher: fetcher as unknown as typeof fetch, token, readPicture: async () => { throw new Error("no wasm"); } });
    expect(bodyOf(fetcher).images).toEqual(["data:image/jpeg;base64,m1"]);
  });
});
