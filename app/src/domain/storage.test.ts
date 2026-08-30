/**
 * Storage accounting.
 *
 * The numbers here are measured from the real ledger, so a change in how a
 * transaction is shaped shows up as a change in these tests.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import {
  averageRowSize,
  BROWSER_QUOTA,
  byteSize,
  formatBytes,
  measureStorage,
  projectAnnualGrowth,
} from "./storage";

const fixture = loadFixture();

describe("byteSize", () => {
  it("counts UTF-8 bytes, not characters", () => {
    // The peso sign is three bytes. Counting characters would undercount every
    // description that has one.
    expect(byteSize("₱")).toBe(5); // the quotes are part of the JSON
    expect("₱".length).toBe(1);
  });

  it("is zero for nothing", () => {
    expect(byteSize(undefined)).toBe(0);
    expect(byteSize([])).toBe(2);
  });
});

describe("formatBytes", () => {
  it("reads the way a phone's storage screen reads", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(43.19 * 1024 * 1024)).toBe("43.2 MB");
    expect(formatBytes(823 * 1024 * 1024)).toBe("823 MB");
  });

  it("keeps two decimals only while they matter", () => {
    expect(formatBytes(4.38 * 1024 * 1024 * 1024)).toBe("4.38 GB");
    expect(formatBytes(150 * 1024 * 1024)).toBe("150 MB");
  });
});

describe("measureStorage", () => {
  const report = measureStorage({
    transactions: fixture.transactions,
    deleted: fixture.deleted,
    accounts: [],
    credits: [],
    budgets: fixture.budgets,
    categories: fixture.reference.spendingTypes,
    quota: BROWSER_QUOTA,
  });

  it("puts the biggest section first", () => {
    const sizes = report.sections.map((s) => s.bytes);
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
    expect(report.sections[0]?.id).toBe("transactions");
  });

  it("adds up to the total", () => {
    expect(report.sections.reduce((a, s) => a + s.bytes, 0)).toBe(report.used);
  });

  it("shows the real ledger as a small fraction of the browser quota", () => {
    expect(report.used).toBeGreaterThan(50_000);
    expect(report.fraction).toBeLessThan(0.1);
    expect(report.nearlyFull).toBe(false);
  });

  it("counts the rows in each section, not just the bytes", () => {
    const tx = report.sections.find((s) => s.id === "transactions");
    expect(tx?.count).toBe(fixture.transactions.length);
  });

  it("clamps a blown quota rather than reporting over 100 per cent", () => {
    const tight = measureStorage({
      transactions: fixture.transactions,
      deleted: [],
      accounts: [],
      credits: [],
      budgets: {},
      categories: [],
      quota: 1000,
    });
    expect(tight.fraction).toBe(1);
    expect(tight.free).toBe(0);
    expect(tight.nearlyFull).toBe(true);
  });
});

describe("projection", () => {
  it("refuses to guess from too little history", () => {
    expect(projectAnnualGrowth(200, 10, 14)).toBeNull();
    expect(projectAnnualGrowth(200, 500, 30)).toBeNull();
  });

  it("projects a year from a representative stretch", () => {
    // 440 rows over 240 days at 200 bytes each.
    expect(projectAnnualGrowth(200, 440, 240)).toBe(133_833);
  });

  it("divides safely when there is nothing there", () => {
    expect(averageRowSize(0, 0)).toBe(0);
  });
});
