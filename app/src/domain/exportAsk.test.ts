/**
 * Asking the assistant for a file.
 *
 * The owner, 20 September 2026: it should do every part, export included. The
 * trap here is that an export request looks like an entry: "save my september
 * spending" has a month, a kind of spending and a verb, and every reader in
 * this app would happily make a transaction out of it. So the cases that must
 * come back as nothing matter as much as the ones that must come back as a
 * file.
 */

import { describe, expect, it } from "vitest";

import { exportWords, readExportAsk } from "./exportAsk";

const ASOF = "2026-09-20";
const ask = (said: string) => readExportAsk(said, ASOF);

describe("what file is being asked for", () => {
  it("a backup, when the word is backup or restore", () => {
    expect(ask("make me a backup")?.kind).toBe("backup");
    expect(ask("backup my data")?.kind).toBe("backup");
    expect(ask("export a backup file I can restore from")?.kind).toBe("backup");
    expect(ask("download the json backup")?.kind).toBe("backup");
  });

  it("the whole system as a spreadsheet, when nothing narrows it", () => {
    expect(ask("export my data")?.kind).toBe("csv");
    expect(ask("export everything")?.kind).toBe("csv");
    expect(ask("download all my data as csv")?.kind).toBe("csv");
    expect(ask("i want a spreadsheet of everything")?.kind).toBe("csv");
  });

  it("a statement, when a month or a kind of sheet is named", () => {
    const september = ask("export september");
    expect(september?.kind).toBe("statement");
    expect(september?.fromMonth).toBe(9);
    expect(september?.toMonth).toBe(9);
    expect(september?.year).toBe(2026);

    expect(ask("download my debt statement")?.type).toBe("debt");
    expect(ask("export my income for august")?.type).toBe("revenue");
    expect(ask("save my expense sheet")?.type).toBe("expense");
    expect(ask("export my savings")?.type).toBe("savings");
  });

  it("takes the year from the sentence when it names one", () => {
    expect(ask("export january 2025")?.year).toBe(2025);
    expect(ask("export january 2025")?.fromMonth).toBe(1);
    // With no year, the year the question was asked in.
    expect(ask("export march")?.year).toBe(2026);
  });
});

describe("what is not a request for a file", () => {
  it("an entry that happens to use the word save", () => {
    expect(ask("I saved 500 in my reserved fund")).toBeNull();
    expect(ask("bayad ko 300 sa wifi")).toBeNull();
    expect(ask("paid 250 for food, save it")).toBeNull();
    expect(ask("I spent 1000 and want to save more")).toBeNull();
  });

  it("a question about money", () => {
    expect(ask("how much did I spend in september")).toBeNull();
    expect(ask("what is my maya balance")).toBeNull();
  });

  it("nothing at all", () => {
    expect(ask("")).toBeNull();
    expect(ask("   ")).toBeNull();
    expect(ask("hello")).toBeNull();
  });
});

describe("what the reply says the file will be", () => {
  it("names what a backup carries, since it is the one that restores", () => {
    const words = exportWords(ask("make me a backup")!, ASOF);
    expect(words).toContain("restores");
    expect(words.length).toBeGreaterThan(40);
  });

  it("names the period and the sheet for a statement", () => {
    const words = exportWords(ask("export my income for august")!, ASOF);
    expect(words).toContain("August 2026");
    expect(words).toContain("what came in");
  });

  it("says plainly what the spreadsheet holds", () => {
    expect(exportWords(ask("export everything")!, ASOF)).toContain("every entry");
  });
});
