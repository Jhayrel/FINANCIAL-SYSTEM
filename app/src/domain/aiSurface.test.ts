import { describe, expect, it } from "vitest";

import { aiSurfaceOn } from "./aiSurface";
import { DEFAULT_AI, type AiSettings } from "./settings";

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
