/**
 * The owner's own misspellings, 26 September 2026: "chnage the budget last
 * month" and "add it to sseptember to december". Each lost the word a rule
 * needed and fell through to the wrong reader.
 */

import { describe, expect, it } from "vitest";

import { meant, withCommandWordsFixed } from "./typos";

describe("command words spelled the way they were meant", () => {
  it("fixes the two from the record", () => {
    expect(withCommandWordsFixed("chnage the budget last month")).toBe("change the budget last month");
    expect(withCommandWordsFixed("how about add it to sseptember to december")).toBe("how about add it to september to december");
  });

  it("fixes the ordinary ones", () => {
    for (const [typed, want] of [
      ["buget", "budget"],
      ["budjet", "budget"],
      ["delte", "delete"],
      ["resotre", "restore"],
      ["udpate", "update"],
      ["octber", "october"],
      ["decmber", "december"],
      ["untill", "until"],
    ]) {
      expect(meant(typed as string), typed).toBe(want);
    }
  });

  it("leaves real words that sit one keystroke away alone", () => {
    for (const word of ["charge", "chance", "expert", "remote", "apple", "reset", "event", "mouth"]) {
      expect(meant(word), word).toBe(word);
    }
  });

  it("never touches a figure", () => {
    expect(withCommandWordsFixed("set budjet to 8,814.58 for octber")).toBe("set budget to 8,814.58 for october");
  });

  it("leaves short words alone, where one keystroke is usually another word", () => {
    expect(meant("edt")).toBe("edt");
    expect(meant("bin")).toBe("bin");
  });
});
