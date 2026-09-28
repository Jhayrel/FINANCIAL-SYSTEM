import { describe, expect, it } from "vitest";

import { thinksAloud, withoutThinking } from "./ai";

/**
 * A model's thinking is never shown as its answer.
 *
 * 28 September 2026: "Its 109" was answered, word for word, with the model's
 * own working: "We need to answer the question: ... The user says ... Likely
 * they are asking about something like...".
 */
describe("thinking is taken out of a reply", () => {
  it("drops a <think> block and keeps the answer", () => {
    expect(withoutThinking("<think>The user wants food.</think>You spent PHP 95.00 on food today.")).toBe(
      "You spent PHP 95.00 on food today.",
    );
  });

  it("treats a <think> that never closed as all thinking", () => {
    expect(withoutThinking("<think>The user wants to know")).toBe("");
  });

  it("keeps only the final channel of a GPT-OSS reply", () => {
    expect(
      withoutThinking("<|channel|>analysis<|message|>We need to add it up.<|end|><|channel|>final<|message|>PHP 109.00"),
    ).toBe("PHP 109.00");
  });

  it("leaves an ordinary answer alone", () => {
    expect(withoutThinking("  You have PHP 955.00 in Cash.  ")).toBe("You have PHP 955.00 in Cash.");
  });
});

describe("a reply that is the model thinking aloud", () => {
  it("is caught, as the owner saw it", () => {
    expect(
      thinksAloud(
        'We need to answer the question: "Its 109 fuck". The user says "Its 109 fuck". Likely they are asking about something like "Is 109 enough?"',
      ),
    ).toBe(true);
  });

  it("is caught in the other common openings", () => {
    expect(thinksAloud("Okay, so the user is asking how much they spent on food.")).toBe(true);
    expect(thinksAloud("The user wants a breakdown of September. Let me look at the entries.")).toBe(true);
    expect(thinksAloud("Analysis: the ledger shows three food entries.")).toBe(true);
  });

  it("is not an answer spoken to the owner", () => {
    expect(thinksAloud("You spent **PHP 2,689.00** on food in September, PHP 420.00 more than August.")).toBe(false);
    expect(thinksAloud("Yes. Your wallets hold PHP 955.00, and gas usually costs PHP 200.00.")).toBe(false);
    expect(thinksAloud("So far this month you are PHP 6,440.71 over the budget.")).toBe(false);
  });
});
