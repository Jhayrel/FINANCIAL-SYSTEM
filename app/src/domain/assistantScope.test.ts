import { describe, expect, it } from "vitest";

import { asksSettingsChange, capabilitiesAnswer, wantsCapabilities } from "./assistantScope";

describe("what the assistant can do", () => {
  it("recognises the question", () => {
    expect(wantsCapabilities("What can my AI do?")).toBe(true);
    expect(wantsCapabilities("what can you do")).toBe(true);
    expect(wantsCapabilities("help")).toBe(true);
    expect(wantsCapabilities("what can I buy with 500")).toBe(false);
  });

  it("names every kind of action and says Settings are not one of them", () => {
    const answer = capabilitiesAnswer();
    for (const part of ["Add entries", "Correct and move", "Bin and restore", "Budgets and limits", "Find a difference", "Settings stay yours"]) {
      expect(answer).toContain(part);
    }
    expect(answer.includes(String.fromCharCode(0x2014))).toBe(false);
  });
});

describe("where it stops", () => {
  it("leaves Settings to the owner", () => {
    expect(asksSettingsChange("change the theme to light")).toBe(true);
    expect(asksSettingsChange("add a new wallet called BPI")).toBe(true);
    expect(asksSettingsChange("switch the ai provider to openrouter")).toBe(true);
    expect(asksSettingsChange("rename my account Maya to Maya Wallet")).toBe(true);
  });

  it("does not mistake a change to entries or budgets for one", () => {
    expect(asksSettingsChange("change the category of the unknown to bills")).toBe(false);
    expect(asksSettingsChange("move my spotify from gcash to maya")).toBe(false);
    expect(asksSettingsChange("set my budget to 8000")).toBe(false);
    expect(asksSettingsChange("delete the food I paid yesterday")).toBe(false);
  });
});
