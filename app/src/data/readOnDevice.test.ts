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

  it("a picture with too little in it still goes as a picture, in its own request", async () => {
    const fetcher = vi.fn(async () => reply([row]));
    await extractProposals({ note: "", attachments: [maya, sunset], reference, asOf: "2026-09-26", fetcher: fetcher as unknown as typeof fetch, token, readPicture });
    // Each picture is read on its own (27 September 2026), so one's fees never land on the other's rows.
    const bodies = fetcher.mock.calls.map((_, k) => bodyOf(fetcher, k));
    const asPicture = bodies.find((b) => b.images.length > 0);
    const asText = bodies.find((b) => b.images.length === 0);
    expect(asPicture?.images).toEqual(["data:image/jpeg;base64,s1"]);
    expect(asPicture?.context).not.toContain("Read on this device from the picture maya.jpg");
    expect(asText?.context).toContain("maya.jpg");
  });

  it("when the text finds nothing, the pictures go to a vision model after all", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply([])).mockResolvedValueOnce(reply([row]));
    const result = await extractProposals({ note: "", attachments: [maya], reference, asOf: "2026-09-26", fetcher: fetcher as unknown as typeof fetch, token, readPicture });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetcher, 1).images).toEqual(["data:image/jpeg;base64,m1"]);
    expect(result.proposals).toHaveLength(1);
  });

  it("a text answer with only refused rows still sends the pictures to a vision model", async () => {
    const junk = { flow: "Spending or Revenue or Transfer or Debt or OnBehalf or Balance" };
    const fetcher = vi.fn().mockResolvedValueOnce(reply([junk])).mockResolvedValueOnce(reply([row]));
    const result = await extractProposals({ note: "This is maya credit", attachments: [maya], reference, asOf: "2026-09-26", fetcher: fetcher as unknown as typeof fetch, token, readPicture });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.proposals).toHaveLength(1);
  });

  it("keeps the text answer when the vision models are no better", async () => {
    const junk = { flow: "" };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(reply([junk]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Every model in the chain failed." }), { status: 502, headers: { "content-type": "application/json" } }));
    const result = await extractProposals({ note: "", attachments: [maya], reference, asOf: "2026-09-26", fetcher: fetcher as unknown as typeof fetch, token, readPicture });
    expect(result.source).toBe("model");
    expect(result.readOnDevice).toBe(1);
  });

  it("a reader that fails changes nothing: the picture goes as before", async () => {
    const fetcher = vi.fn(async () => reply([row]));
    await extractProposals({ note: "", attachments: [maya], reference, asOf: "2026-09-26", fetcher: fetcher as unknown as typeof fetch, token, readPicture: async () => { throw new Error("no wasm"); } });
    expect(bodyOf(fetcher).images).toEqual(["data:image/jpeg;base64,m1"]);
  });
});

/**
 * 2 October 2026: with Gemini set up, a model that sees well looks at each
 * picture itself, and the device's reading goes beside it only as a check.
 * The device's misreadings had been filed as item names because the model
 * never saw the picture.
 */
describe("a picture, when a model that sees well is set up", () => {
  const sees = async () => true;
  const longList = picture("l1", "history.jpg");
  const manyRows = Array.from({ length: 16 }, (_, k) => `Sent money ${k + 1}\n-₱${k + 10}.00`).join("\n");
  const readAll = async (dataUrl: string) =>
    dataUrl === "data:image/jpeg;base64,l1" ? { plain: `September 20, 2026\n${manyRows}`, raised: "" } : readPicture(dataUrl);

  it("is looked at, with the device's reading beside it marked for checking only", async () => {
    const fetcher = vi.fn(async () => reply([{ ...row, sourceRef: "line 2" }]));
    const result = await extractProposals({ note: "", attachments: [maya], reference, asOf: "2026-09-26", fetcher: fetcher as unknown as typeof fetch, token, readPicture, seesPictures: sees });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = bodyOf(fetcher);
    expect(body.images).toEqual(["data:image/jpeg;base64,m1"]);
    expect(body.context).toContain("maya.jpg, the device's reading, for checking only");
    expect(body.context).toContain("For checking only. You can see the picture maya.jpg itself");
    expect(result.readOnDevice).toBeUndefined();
    // The row names its picture, so "you missed one" knows it was read.
    expect(result.proposals[0]?.sourceRef).toBe("maya.jpg, line 2");
  });

  it("each picture in its own request, and a picture the device cannot read goes alone", async () => {
    const fetcher = vi.fn(async () => reply([row]));
    await extractProposals({ note: "", attachments: [maya, sunset], reference, asOf: "2026-09-26", fetcher: fetcher as unknown as typeof fetch, token, readPicture, seesPictures: sees });
    const bodies = fetcher.mock.calls.map((_, k) => bodyOf(fetcher, k));
    expect(bodies.map((b) => b.images)).toEqual([["data:image/jpeg;base64,m1"], ["data:image/jpeg;base64,s1"]]);
    expect(bodies[1]?.context).not.toContain("for checking only");
  });

  it("falls back to the device's text when no model could look at it", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Every model in the chain failed." }), { status: 502, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(reply([row]));
    const result = await extractProposals({ note: "", attachments: [maya], reference, asOf: "2026-09-26", fetcher: fetcher as unknown as typeof fetch, token, readPicture, seesPictures: sees });
    // Asked once, of Gemini only, and not again: the device's reading is there instead.
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body)).seeWell).toBe(true);
    expect(bodyOf(fetcher, 1).images).toEqual([]);
    expect(bodyOf(fetcher, 1).context).toContain("Read on this device from the picture maya.jpg");
    expect(result.proposals).toHaveLength(1);
    expect(result.readOnDevice).toBe(1);
  });

  it("a picture neither Gemini nor the device could read goes to every model that can see, as before", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Every model in the chain failed." }), { status: 502, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(reply([row]));
    const result = await extractProposals({ note: "", attachments: [sunset], reference, asOf: "2026-09-26", fetcher: fetcher as unknown as typeof fetch, token, readPicture, seesPictures: sees });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String((fetcher.mock.calls[1]?.[1] as RequestInit).body)) as { images: string[]; seeWell?: boolean };
    expect(second.images).toEqual(["data:image/jpeg;base64,s1"]);
    expect(second.seeWell).toBeUndefined();
    expect(result.proposals).toHaveLength(1);
    expect(result.readOnDevice).toBeUndefined();
  });

  it("keeps what the model saw when the device's text finds no more", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply([])).mockResolvedValueOnce(reply([]));
    const result = await extractProposals({ note: "", attachments: [maya], reference, asOf: "2026-09-26", fetcher: fetcher as unknown as typeof fetch, token, readPicture, seesPictures: sees });
    expect(result.source).toBe("model");
    expect(result.readOnDevice).toBeUndefined();
  });

  it("a list too long for one answer is still read in parts, as text", async () => {
    const fetcher = vi.fn(async () => reply([row]));
    const result = await extractProposals({ note: "", attachments: [longList], reference, asOf: "2026-09-26", fetcher: fetcher as unknown as typeof fetch, token, readPicture: readAll, seesPictures: sees });
    const bodies = fetcher.mock.calls.map((_, k) => bodyOf(fetcher, k));
    expect(bodies.length).toBeGreaterThan(1);
    expect(bodies.every((b) => b.images.length === 0)).toBe(true);
    expect(bodies[0]?.context).toContain("history.jpg, part 1 of");
    expect(result.readOnDevice).toBe(1);
  });

  it("without one, the device reads first as before", async () => {
    const fetcher = vi.fn(async () => reply([row]));
    const result = await extractProposals({ note: "", attachments: [maya], reference, asOf: "2026-09-26", fetcher: fetcher as unknown as typeof fetch, token, readPicture, seesPictures: async () => false });
    expect(bodyOf(fetcher).images).toEqual([]);
    expect(result.readOnDevice).toBe(1);
  });
});

describe("whether a model that sees well is set up", () => {
  it("is Gemini having a key, asked without the catalogues", async () => {
    const { seesPictures } = await import("./aiClient");
    const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify({ configured: { gemini: true, groq: true } }), { headers: { "content-type": "application/json" } }));
    expect(await seesPictures({ fetcher: fetcher as unknown as typeof fetch, token })).toBe(true);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/ai?configured");
    // Known for ten minutes, so a second picture does not ask again.
    expect(await seesPictures({ fetcher: fetcher as unknown as typeof fetch, token })).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
