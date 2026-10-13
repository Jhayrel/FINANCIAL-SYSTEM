import { it, expect } from "vitest";
import { saysItWasAQuestion, saysItWasAStatement } from "./intent";
it("reads that the last message was a question or a remark (owner, 6 and 7 October 2026)", () => {
  for (const q of ["Thats a question", "I'm asking you", "I was just asking", "no thats a question bro", "I just asked", "nagtatanong ako", "that's a question not a card", "I am asking", "THATWS A QUESTION", "Its a question!"]) expect([q, saysItWasAQuestion(q)]).toEqual([q, true]);
  for (const q of ["Thats a statement", "it was a remark", "I was just saying", "that's not a question", "no that's a statement bro"]) expect([q, saysItWasAStatement(q)]).toEqual([q, true]);
  for (const q of ["what is my balance", "is that a question?", "I asked for 500 from Maya yesterday and she sent it", "statement for october"]) { expect([q, saysItWasAQuestion(q) || saysItWasAStatement(q)]).toEqual([q, false]); }
});
