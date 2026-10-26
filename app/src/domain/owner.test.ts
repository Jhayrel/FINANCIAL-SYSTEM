import { describe, expect, it } from "vitest";

import { checkOwner, NO_OWNER, normaliseOwner, ownerAnswer, ownerChanges, ownerLines, ownerName, readOwnerAsk } from "./owner";

/** Invented details: no real person's. */
const me = normaliseOwner({ name: "Juan Dela Cruz", callMe: "Jay", email: "juan@example.com", phone: "0917 123 4567", address: "12 Rizal Street, Bangued", about: "A student, allowance every 15th", shareContact: false });

describe("the owner's details (owner, 27 October 2026)", () => {
  it("keeps what storage holds tidy, and a broken copy empty", () => {
    expect(normaliseOwner(null)).toEqual(NO_OWNER);
    expect(normaliseOwner({ name: "  Juan   Dela Cruz ", shareContact: "yes" })).toMatchObject({ name: "Juan Dela Cruz", shareContact: false });
    expect(normaliseOwner({ about: "x".repeat(900) }).about.length).toBe(400);
  });

  it("checks an e-mail and a phone number, and nothing else is required", () => {
    expect(checkOwner(NO_OWNER)).toEqual({});
    expect(checkOwner({ ...NO_OWNER, email: "juan@" }).email).toBeTruthy();
    expect(checkOwner({ ...NO_OWNER, phone: "call me" }).phone).toBeTruthy();
    expect(checkOwner({ ...NO_OWNER, phone: "123" }).phone).toBeTruthy();
    expect(checkOwner({ ...NO_OWNER, phone: "+63 917 123 4567" })).toEqual({});
  });

  it("names a statement with the name given, else the Google account's, never an e-mail", () => {
    expect(ownerName(me, "Google Name")).toBe("Juan Dela Cruz");
    expect(ownerName(NO_OWNER, "Google Name")).toBe("Google Name");
    expect(ownerName(NO_OWNER, "someone@gmail.com")).toBe("");
  });

  it("tells the assistant contact details only when allowed", () => {
    expect(ownerLines(me).join(" ")).toMatch(/Juan Dela Cruz; call them Jay/);
    expect(ownerLines(me).join(" ")).not.toMatch(/0917|example\.com|Rizal/);
    expect(ownerLines({ ...me, shareContact: true }).join(" ")).toMatch(/e-mail juan@example\.com; phone 0917 123 4567; address 12 Rizal Street/);
    expect(ownerLines(NO_OWNER)).toEqual([]);
  });

  it("says which parts changed, never their values", () => {
    expect(ownerChanges(NO_OWNER, me)).toEqual(["name", "what to call you", "contact e-mail", "phone", "address", "about you"]);
    expect(ownerChanges(me, { ...me, shareContact: true })).toEqual(["the assistant may see your contact details"]);
  });
});

describe("the details from the chat", () => {
  it.each([
    ["who am I?", { kind: "show", field: "all" }],
    ["what do you know about me", { kind: "show", field: "all" }],
    ["what's my email?", { kind: "show", field: "email" }],
    ["what is my phone number", { kind: "show", field: "phone" }],
    ["my email is juan@example.com", { kind: "set", field: "email", value: "juan@example.com" }],
    ["change my gmail to juan.dc@gmail.com", { kind: "set", field: "email", value: "juan.dc@gmail.com" }],
    ["call me Jay", { kind: "set", field: "callMe", value: "Jay" }],
    ["my name is Juan Dela Cruz", { kind: "set", field: "name", value: "Juan Dela Cruz" }],
    ["update my address to 12 Rizal Street, Bangued", { kind: "set", field: "address", value: "12 Rizal Street, Bangued" }],
    ["my phone is 0917 123 4567", { kind: "set", field: "phone", value: "0917 123 4567" }],
  ])("%s", (text, want) => {
    expect(readOwnerAsk(text)).toEqual(want);
  });

  it.each(["my phone is broken", "my phone is broken, spent 500 on repair", "my name is on the receipt 2", "my email is not working", "phone load 50 gcash", "I paid my tuition"])("leaves alone: %s", (text) => {
    expect(readOwnerAsk(text)).toBeNull();
  });

  it("answers from what is saved, and says how to add what is not", () => {
    expect(ownerAnswer(me, "email")).toBe("Your contact e-mail is juan@example.com.");
    expect(ownerAnswer(me, "callMe")).toBe("I call you Jay.");
    expect(ownerAnswer(NO_OWNER, "phone")).toMatch(/^No phone is saved yet\. Tell me, like "my phone is/);
    expect(ownerAnswer(me, "all")).toMatch(/- Address: 12 Rizal Street, Bangued/);
    expect(ownerAnswer(me, "all")).toMatch(/stay on this app unless you turn that on/);
  });
});
