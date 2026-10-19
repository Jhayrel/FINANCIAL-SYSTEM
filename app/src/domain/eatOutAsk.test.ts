import { describe, expect, it } from "vitest";

import { eatOutAnswer, mealPrice, readEatOutAsk } from "./eatOutAsk";
import { formatMoney } from "./money";

const food = { name: "Food", usual: 9_000, low: 5_000, high: 15_000, count: 12 };
const water = { name: "Water", usual: 2_500, low: 2_500, high: 2_500, count: 5 };

describe("should I eat out", () => {
  it("reads the question, and which day", () => {
    expect(readEatOutAsk("should I eat outside tomorrow")).toEqual({ when: "tomorrow" });
    expect(readEatOutAsk("can I eat out today?")).toEqual({ when: "today" });
    expect(readEatOutAsk("pwede ba kumain sa labas bukas")).toEqual({ when: "tomorrow" });
    expect(readEatOutAsk("I ate out 120")).toBeNull();
    expect(readEatOutAsk("can I eat out for 300 tomorrow")).toBeNull();
  });

  it("takes the meal price from the owner's own items", () => {
    expect(mealPrice([water, food])).toBe(food);
    expect(mealPrice([water])).toBeNull();
  });

  it("answers from tomorrow's figure, never one said before", () => {
    const day = { today: 4_000, after: 12_000, daysLeft: 12 };
    const yes = eatOutAnswer({ when: "tomorrow" }, day, food, formatMoney);
    expect(yes).toContain("Tomorrow you can spend **₱120.00**");
    expect(yes).toContain("yes, it fits, with ₱30.00 left");
    const no = eatOutAnswer({ when: "today" }, day, food, formatMoney);
    expect(no).toContain("not on that figure, it is ₱50.00 more");
  });

  it("says so on the month's last day and with nothing left", () => {
    expect(eatOutAnswer({ when: "tomorrow" }, { today: 5_000, after: 0, daysLeft: 1 }, food, formatMoney)).toContain("next month");
    expect(eatOutAnswer({ when: "today" }, { today: 0, after: 9_000, daysLeft: 5 }, food, formatMoney)).toContain("used up");
  });
});
