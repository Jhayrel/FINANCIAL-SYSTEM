import { describe, expect, it } from "vitest";

import { isChartFollowUp } from "./charts";

/**
 * A short message after a chart: the same chart over another window, or a
 * question of its own. 28 September 2026, "so since starting I didnt have
 * good budgeting?" was drawn as September's chart, because "since starting"
 * read as a period and "didnt" was not "did".
 */
describe("a follow-up to the chart on screen", () => {
  it.each([
    ["since march", true],
    ["since aug", true],
    ["since 2025", true],
    ["since last month", true],
    ["2025", true],
    ["even 2022?", true],
    ["how about this month?", true],
    ["this week", true],
    ["so since starting I didnt have good budgeting?", false],
    ["is 2022 bad?", false],
    ["2022 was good", false],
  ] as const)("%s", (said, follows) => {
    expect(isChartFollowUp(said, true)).toBe(follows);
  });
});
