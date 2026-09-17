import { describe, expect, it } from "vitest";

import { aiSurfaceOn } from "./aiSurface";
import { DEFAULT_AI, normaliseSettings, type AiSettings } from "./settings";

const on: AiSettings = { ...DEFAULT_AI, enabled: true };

describe("aiSurfaceOn", () => {
  it("removes every surface while AI is switched off", () => {
    const off: AiSettings = { ...on, enabled: false };
    for (const surface of ["chat", "capture", "alerts", "insightSummary", "descriptions"] as const) {
      expect(aiSurfaceOn(off, surface)).toBe(false);
    }
  });

  it("removes only the surface that was switched off", () => {
    const noChat: AiSettings = { ...on, features: { ...on.features, chat: false } };
    expect(aiSurfaceOn(noChat, "chat")).toBe(false);
    expect(aiSurfaceOn(noChat, "alerts")).toBe(true);
  });

  it("counts a surface saved before its setting existed as on", () => {
    const older: AiSettings = {
      ...on,
      features: { alerts: true, insightSummary: true, descriptions: false },
    };
    expect(aiSurfaceOn(older, "chat")).toBe(true);
    expect(aiSurfaceOn(older, "capture")).toBe(true);
  });
});

/**
 * Switched off, and still off after a reload.
 *
 * `normaliseSettings` copied three of the five switches and dropped `chat`
 * and `capture`, whose absence reads as on, so the chat came back by itself
 * the next time the settings were loaded.
 */
describe("a switch that survives loading", () => {
  it("keeps the chat and photo reading switched off", () => {
    const saved = { ai: { ...on, features: { ...on.features, chat: false, capture: false } } };
    const loaded = normaliseSettings(JSON.parse(JSON.stringify(saved)));
    expect(aiSurfaceOn(loaded.ai, "chat")).toBe(false);
    expect(aiSurfaceOn(loaded.ai, "capture")).toBe(false);
  });

  it("still reads settings saved before the two switches existed as on", () => {
    const saved = { ai: { ...on, features: { alerts: true, insightSummary: true, descriptions: false } } };
    const loaded = normaliseSettings(JSON.parse(JSON.stringify(saved)));
    expect(aiSurfaceOn(loaded.ai, "chat")).toBe(true);
    expect(aiSurfaceOn(loaded.ai, "capture")).toBe(true);
  });
});
