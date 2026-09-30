/**
 * How strong a model is, from its id (`_strength.ts`).
 *
 * 30 September 2026, the owner: "I want the most powerful ai ... All low end
 * ai and not smart ai make them last option." The ids are the kinds the
 * providers list; the point is the order, and that an id never seen before
 * still lands in a sensible place.
 */

import { describe, expect, it } from "vitest";

import { sizeOf, strength } from "./_strength";

const order = (ids: string[]): string[] => [...ids].sort((a, b) => strength(b) - strength(a));

describe("the size an id gives", () => {
  it("reads billions, a mixture's whole size and not its working share, and trillions", () => {
    expect(sizeOf("openai/gpt-oss-120b")).toBe(120);
    expect(sizeOf("qwen/qwen3-235b-a22b")).toBe(235);
    expect(sizeOf("mistralai/mixtral-8x7b-instruct")).toBe(56);
    expect(sizeOf("moonshotai/kimi-k2-1t")).toBe(1_000);
  });

  it("is not a version, a count of experts or a model's letter", () => {
    expect(sizeOf("gemini-3.8-flash")).toBeNull();
    expect(sizeOf("minimax/minimax-m3")).toBeNull();
    expect(sizeOf("google/gemma-3n-e4b-it")).toBeNull();
  });
});

describe("the strongest first", () => {
  it("puts a newer Gemini above an older one, and Flash above Lite of the same version", () => {
    expect(order(["gemini-2.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.5-flash"])).toEqual([
      "gemini-3.8-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-2.5-flash",
    ]);
  });

  it("puts the large open models above the small ones, whoever hosts them", () => {
    expect(
      order([
        "llama-3.1-8b-instant",
        "openai/gpt-oss-20b",
        "minimax/minimax-m3:free",
        "allam-2-7b",
        "openai/gpt-oss-120b",
        "z-ai/glm-5.2:free",
        "meta-llama/llama-3.3-70b-instruct:free",
      ]),
    ).toEqual([
      "minimax/minimax-m3:free",
      "z-ai/glm-5.2:free",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "meta-llama/llama-3.3-70b-instruct:free",
      "llama-3.1-8b-instant",
      "allam-2-7b",
    ]);
  });

  it("scores the same model the same on every host", () => {
    expect(strength("@cf/openai/gpt-oss-120b")).toBe(strength("openai/gpt-oss-120b"));
    expect(strength("@cf/qwen/qwen3.8-27b")).toBe(strength("qwen/qwen3.8-27b"));
  });

  it("ranks a new version of a family above the last without a change here", () => {
    expect(strength("minimax/minimax-m4:free")).toBeGreaterThan(strength("minimax/minimax-m3:free"));
    expect(strength("z-ai/glm-5.5:free")).toBeGreaterThan(strength("z-ai/glm-5.2:free"));
    expect(strength("deepseek/deepseek-v4.1:free")).toBeGreaterThan(strength("deepseek/deepseek-v3.2:free"));
  });

  it("keeps a small model of a strong family small", () => {
    expect(strength("z-ai/glm-4-9b:free")).toBeLessThan(strength("openai/gpt-oss-20b"));
    expect(strength("qwen/qwen3-30b-a3b:free")).toBeLessThan(strength("qwen/qwen3-32b"));
    expect(strength("deepseek/deepseek-r1-distill-llama-70b:free")).toBeLessThan(strength("deepseek/deepseek-r1-0528:free"));
  });

  it("places an id it has never seen by its size and its marks", () => {
    expect(strength("newlab/giant-400b:free")).toBeGreaterThan(strength("newlab/mid-24b:free"));
    expect(strength("newlab/thing-mini:free")).toBeLessThan(strength("newlab/thing:free"));
    expect(strength("newlab/thing:free")).toBeGreaterThan(strength("llama-3.1-8b-instant"));
  });

  it("does not take the maker MiniMax for a mini model", () => {
    expect(strength("minimax/minimax-m3:free")).toBeGreaterThan(50);
  });
});
