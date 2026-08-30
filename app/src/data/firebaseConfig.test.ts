/**
 * Reading a Firebase config.
 *
 * The parser has to accept what the console actually hands you, which is a
 * JavaScript snippet rather than JSON. Every test here is a paste that should
 * work, or a paste that should fail with a useful reason.
 */

import { describe, expect, it } from "vitest";

import { parseConfig } from "./firebaseConfig";

const CONSOLE_SNIPPET = `
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";

const firebaseConfig = {
  apiKey: "AIzaSyExample-key-value-here",
  authDomain: "financial-system-c2997.firebaseapp.com",
  projectId: "financial-system-c2997",
  storageBucket: "financial-system-c2997.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
};

const app = initializeApp(firebaseConfig);
`;

describe("what the console gives you", () => {
  it("reads the snippet as pasted, imports and all", () => {
    const { config, error } = parseConfig(CONSOLE_SNIPPET);
    expect(error).toBeUndefined();
    expect(config?.projectId).toBe("financial-system-c2997");
    expect(config?.authDomain).toBe("financial-system-c2997.firebaseapp.com");
    expect(config?.appId).toBe("1:123456789012:web:abcdef1234567890");
  });

  it("reads plain JSON too, with quoted keys", () => {
    const json = JSON.stringify({
      apiKey: "k",
      authDomain: "a",
      projectId: "p",
      storageBucket: "s",
      messagingSenderId: "m",
      appId: "i",
    });
    expect(parseConfig(json).config?.projectId).toBe("p");
  });

  it("copes with single quotes and trailing commas", () => {
    const loose = `{
      apiKey: 'k',
      authDomain: 'a',
      projectId: 'p',
      storageBucket: 's',
      messagingSenderId: 'm',
      appId: 'i',
    }`;
    expect(parseConfig(loose).config?.appId).toBe("i");
  });

  it("ignores anything else in the paste", () => {
    const noisy = `blah blah ${CONSOLE_SNIPPET} more text`;
    expect(parseConfig(noisy).config?.projectId).toBe("financial-system-c2997");
  });
});

describe("what it refuses", () => {
  it("says so when nothing was pasted", () => {
    expect(parseConfig("   ").error).toContain("Paste the config");
  });

  it("says so when the paste is not a config at all", () => {
    expect(parseConfig("hello world").error).toContain("does not look like");
  });

  it("names the fields that are missing rather than half-connecting", () => {
    const partial = `{ apiKey: "k", authDomain: "a", projectId: "p" }`;
    const { config, error } = parseConfig(partial);
    expect(config).toBeUndefined();
    expect(error).toContain("storageBucket");
    expect(error).toContain("messagingSenderId");
    expect(error).toContain("appId");
  });

  it("does not accept an empty value as present", () => {
    const blank = CONSOLE_SNIPPET.replace('projectId: "financial-system-c2997"', 'projectId: ""');
    expect(parseConfig(blank).error).toContain("projectId");
  });
});
