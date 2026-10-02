/** What Settings says about the providers after a key or binding is added in Cloudflare (2 October 2026). */
import { describe, expect, it } from "vitest";

import { providersSetUp } from "./settings";

describe("which providers are set up", () => {
  it("names each one, and says Gemini looks at pictures", () => {
    expect(providersSetUp({ groq: true, openrouter: true, gemini: true, workers: true })).toBe(
      "Set up in Cloudflare: Google Gemini, Cloudflare Workers AI, Groq and OpenRouter. Pictures are looked at by Gemini, with this device's reading as a check.",
    );
  });

  it("says what is missing, and how pictures are read without Gemini", () => {
    expect(providersSetUp({ groq: true, openrouter: false, gemini: false, workers: true })).toBe(
      "Set up in Cloudflare: Cloudflare Workers AI and Groq. Not set up: Google Gemini and OpenRouter. Pictures are read on this device first, since Gemini is not set up.",
    );
    expect(providersSetUp({ groq: false, openrouter: false, gemini: false, workers: false })).toMatch(/^Nothing is set up in Cloudflare yet\./);
  });
});
