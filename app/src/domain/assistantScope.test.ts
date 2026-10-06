import { describe, expect, it } from "vitest";

import { asksSettingsChange, asksWhatChartsExist, capabilitiesAnswer, chartsAnswer, wantsCapabilities } from "./assistantScope";

describe("what the assistant can do", () => {
  it("recognises the question", () => {
    expect(wantsCapabilities("What can my AI do?")).toBe(true);
    expect(wantsCapabilities("what can you do")).toBe(true);
    expect(wantsCapabilities("help")).toBe(true);
    expect(wantsCapabilities("what can I buy with 500")).toBe(false);
  });

  it("names every kind of action and says Settings are not one of them", () => {
    const answer = capabilitiesAnswer();
    for (const part of ["Add entries", "Edit and move", "Bin and restore", "Budgets and limits", "Find a difference", "Settings stay yours"]) {
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

  /*
   * 5 and 6 October 2026: each of these was told "Settings are yours to
   * change", three times in all.
   */
  it("does not mistake a sum with the bills taken out for one", () => {
    expect(asksSettingsChange("What is my safe spending? Like the actual safe spending based remove the subscription and bills")).toBe(false);
    expect(asksSettingsChange("What is my safe spending? Like the actual safe spending based remove the subscription and bills. Just a question let me know")).toBe(false);
    expect(
      asksSettingsChange(
        "Actually 200 per day is the safe to spend like look. You need to remove the subscription and bill to the equation then only whats left is use. Check it this works",
      ),
    ).toBe(false);
    expect(asksSettingsChange("how much is left if I remove the bills")).toBe(false);
    // Still a change to Settings when it is one.
    expect(asksSettingsChange("remove the subscription Netflix")).toBe(true);
    expect(asksSettingsChange("add a bill called Water")).toBe(true);
  });
});

/*
 * 6 October 2026: "WHAT KIND OF TABLE CAN MY SYSTEM PROVIDE LIKE CHARTS,
 * TRENDS ETC??" was drawn as October's spending by day.
 */
describe("what can be drawn", () => {
  it("is heard as a question about the charts, not a request for one", () => {
    for (const said of [
      "WHAT KIND OF TABLE CAN MY SYSTEM PROVIDE LIKE CHARTS, TRENDS ETC??",
      "what kinds of charts can you make",
      "what charts can you do",
      "what type of reports can my app give",
    ]) {
      expect([said, asksWhatChartsExist(said)]).toEqual([said, true]);
    }
    for (const said of ["chart my spending this month", "show me a trend of food", "what did I spend on food", "pie of september"]) {
      expect([said, asksWhatChartsExist(said)]).toEqual([said, false]);
    }
  });

  it("names every kind of chart and file, with words to ask for each", () => {
    const answer = chartsAnswer();
    for (const part of ["Where the money went", "Trends over time", "Two periods side by side", "Budget against what was spent", "Balances", "What is owed", "Tables as files"]) {
      expect(answer).toContain(part);
    }
    expect(answer.includes(String.fromCharCode(0x2014))).toBe(false);
  });
});
