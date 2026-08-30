/**
 * The rule is "no asterisks reach the screen". These are the ways a model
 * produces them, and the ways a careless filter breaks a peso figure while
 * removing them.
 */

import { describe, expect, it } from "vitest";

import { plainText, PLAIN_TEXT_RULES } from "./aiText";

describe("plainText, emphasis", () => {
  it("unwraps bold, which is what models do to every figure", () => {
    expect(plainText("You spent **PHP 1,000.00** in August.")).toBe(
      "You spent PHP 1,000.00 in August.",
    );
  });

  it("unwraps italic and underscore emphasis", () => {
    expect(plainText("That is *over* budget.")).toBe("That is over budget.");
    expect(plainText("That is __over__ budget.")).toBe("That is over budget.");
  });

  it("unwraps bold italic completely, leaving nothing behind", () => {
    expect(plainText("***PHP 250.00*** over.")).toBe("PHP 250.00 over.");
  });

  it("removes unbalanced marks, which is what a cut-off answer leaves", () => {
    expect(plainText("You spent **PHP 1,000.00 and")).toBe("You spent PHP 1,000.00 and");
    expect(plainText("Net worth is *")).toBe("Net worth is");
  });

  it("leaves no asterisk anywhere, whatever the shape", () => {
    const messy = "**A** * B ** C *** D ****";
    expect(plainText(messy)).not.toContain("*");
  });
});

describe("plainText, structure", () => {
  it("strips bullet markers but keeps the words", () => {
    expect(plainText("- Rent is overdue\n- Water is overdue")).toBe(
      "Rent is overdue\nWater is overdue",
    );
  });

  it("strips numbered list markers", () => {
    expect(plainText("1. Rent\n2. Water")).toBe("Rent\nWater");
  });

  it("strips headings and the blank line they leave", () => {
    expect(plainText("## August\n\n\nYou spent PHP 10.00.")).toBe(
      "August\n\nYou spent PHP 10.00.",
    );
  });

  it("strips block quotes and code marks", () => {
    expect(plainText("> `PHP 5.00` is left.")).toBe("PHP 5.00 is left.");
  });

  it("keeps the content of a fenced block", () => {
    expect(plainText("```\nPHP 5.00 left\n```")).toBe("PHP 5.00 left");
  });

  it("reduces a link to the words a person would read", () => {
    expect(plainText("See [the budget](https://example.com) for more.")).toBe(
      "See the budget for more.",
    );
  });
});

describe("plainText, the em dash rule", () => {
  it("replaces an em dash with a comma", () => {
    expect(plainText("You are over budget\u2014by PHP 250.00.")).toBe(
      "You are over budget, by PHP 250.00.",
    );
  });

  it("replaces a spaced en dash used as a dash", () => {
    expect(plainText("Spending is high \u2013 mostly food.")).toBe(
      "Spending is high, mostly food.",
    );
  });

  it("does not leave doubled punctuation behind", () => {
    expect(plainText("Over budget,\u2014by a lot.")).toBe("Over budget, by a lot.");
    expect(plainText("Three things:\u2014food, rent, fares.")).toBe(
      "Three things: food, rent, fares.",
    );
  });

  it("leaves no em dash in the output", () => {
    expect(plainText("a\u2014b\u2014c")).not.toContain("\u2014");
  });
});

describe("plainText, money is never touched", () => {
  it("keeps the U+2212 minus sign, which the writing rule exempts", () => {
    const negative = "Remaining is \u2212PHP 250.00.";
    expect(plainText(negative)).toBe(negative);
  });

  it("keeps a hyphen inside a word or a date", () => {
    expect(plainText("On 2026-08-30 the pay-out cleared.")).toBe(
      "On 2026-08-30 the pay-out cleared.",
    );
  });

  it("never alters a figure while stripping formatting around it", () => {
    const figures = ["PHP 11,291.37", "PHP 5,795.74", "PHP 222,259.14", "PHP 0.85"];
    for (const f of figures) {
      expect(plainText(`**${f}**`)).toBe(f);
      expect(plainText(`- ${f}`)).toBe(f);
      expect(plainText(`\`${f}\``)).toBe(f);
    }
  });

  it("keeps a hyphenated minus in front of a figure", () => {
    expect(plainText("-PHP 250.00")).toBe("-PHP 250.00");
  });
});

describe("plainText, ordinary text", () => {
  it("leaves clean prose exactly as it is", () => {
    const clean = "You have spent PHP 11,291.37 in August and taken in PHP 2,000.00.";
    expect(plainText(clean)).toBe(clean);
  });

  it("trims surrounding whitespace", () => {
    expect(plainText("  \n Net worth is PHP 1.00. \n ")).toBe("Net worth is PHP 1.00.");
  });

  it("survives an empty answer", () => {
    expect(plainText("")).toBe("");
    expect(plainText("   ")).toBe("");
  });
});

describe("PLAIN_TEXT_RULES", () => {
  it("tells the model the same thing the filter enforces", () => {
    expect(PLAIN_TEXT_RULES).toContain("asterisks");
    expect(PLAIN_TEXT_RULES).toContain("em dash");
    expect(PLAIN_TEXT_RULES).toContain("Markdown");
  });

  it("obeys its own rule, since it is shipped text", () => {
    expect(PLAIN_TEXT_RULES).not.toContain("\u2014");
    expect(PLAIN_TEXT_RULES).not.toContain("*");
  });
});
