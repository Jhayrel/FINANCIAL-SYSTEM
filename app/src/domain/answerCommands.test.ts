/**
 * Commands an answer tells the owner to type, as buttons (owner, 10 November
 * 2026: "why I cant edit or add here in allocation using ai?"). Invented
 * figures.
 */
import { describe, expect, it } from "vitest";

import { suggestedCommands, withoutCommandLines } from "./answerCommands";

describe("a command in an answer", () => {
  it("is found when the answer says to type it, or puts it on a line alone", () => {
    expect(suggestedCommands('Increasing it covers the rest. Type **change the snack allocation to 650** to update it.')).toEqual(["change the snack allocation to 650"]);
    expect(suggestedCommands('Say "allocate 170 a week for snacks" and press the card.')).toEqual(["allocate 170 a week for snacks"]);
    const bare = "This tracks the month week by week.\n\nallocate 170 a week for snacks";
    expect(suggestedCommands(bare)).toEqual(["allocate 170 a week for snacks"]);
    expect(withoutCommandLines(bare, suggestedCommands(bare))).toBe("This tracks the month week by week.");
  });
  it("and the sentence telling the owner to type it goes, the rest of the answer stays", () => {
    const answer = "Add **PHP 120.00**. Type **change the snack allocation to 650** to update it.\n\n- At PHP 50.00 a time: PHP 30.00 more.";
    expect(withoutCommandLines(answer, suggestedCommands(answer))).toBe("Add **PHP 120.00**.\n\n- At PHP 50.00 a time: PHP 30.00 more.");
  });
  it("never from a sentence that only talks about one, or about something the chat does not change", () => {
    expect(suggestedCommands("You can change the allocation on Budget when you are ready.")).toEqual([]);
    expect(suggestedCommands("Make sure you eat well.")).toEqual([]);
    expect(suggestedCommands("Type hello to start.")).toEqual([]);
  });
});
