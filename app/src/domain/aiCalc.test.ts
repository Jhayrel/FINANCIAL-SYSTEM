/**
 * The model writes the sum and the device works it out (PAL, Program of
 * Thoughts): exactly, in whole centavos, and trusted only when every peso
 * amount in it came from the data. Every figure here is invented.
 */
import { describe, expect, it } from "vitest";

import { CALC_RULE, evaluate, resolveCalcs } from "./aiCalc";
import { figuresIn, untracedFigures } from "./aiFigures";

const DASH = String.fromCharCode(0x2014);

describe("working out what the model wrote", () => {
  it("is exact, in the usual order, with brackets", () => {
    const at = (e: string): string => {
      const r = evaluate(e)!;
      return `${r.value.n}/${r.value.d}`;
    };
    expect(at("30000 - 2500.25 - 4000.50")).toBe("93997/4");
    expect(at("0.1 + 0.2")).toBe("3/10");
    expect(at("2 + 3 * 4")).toBe("14/1");
    expect(at("(2 + 3) * 4")).toBe("20/1");
    expect(at("PHP 1,000.00 − ₱250.50")).toBe("1499/2");
    expect(at("-5 + 10")).toBe("5/1");
    expect(evaluate("5 / 0")).toBeNull();
    expect(evaluate("five minus two")).toBeNull();
    expect(evaluate("2 +")).toBeNull();
    expect(evaluate("(2 + 3")).toBeNull();
  });

  it("puts the result in place: pesos to the centavo, counts as whole ones that fit", () => {
    const known = new Set([3_000_000, 250_025, 400_050, 100_000]);
    const r = resolveCalcs("You would be {{calc: 30000 - 2500.25 - 4000.50 - 1000}} short. It pays for {{count: 500 / 90}} sessions.", known);
    expect(r.text).toBe("You would be PHP 22,499.25 short. It pays for 5 sessions.");
    expect(r.trusted).toEqual([2_249_925]);
    expect(r.done).toBe(2);
  });

  it("rounds half away from zero, and keeps a minus", () => {
    expect(resolveCalcs("{{calc: 10 / 3}}", new Set()).text).toBe("PHP 3.33");
    expect(resolveCalcs("{{calc: 0.125 + 0}}", new Set()).text).toBe("PHP 0.13");
    expect(resolveCalcs("{{calc: 100 - 250.5}}", new Set([25_050])).text).toBe("-PHP 150.50");
  });

  it("trusts a result only when every peso amount in it is the app's", () => {
    // 4,500 was never given: worked out, shown, and not trusted.
    const r = resolveCalcs("{{calc: 12000 - 4500}}", new Set([1_200_000]));
    expect(r.text).toBe("PHP 7,500.00");
    expect(r.trusted).toEqual([]);
    // Small whole numbers are counts and factors: 22 days, twice a week.
    expect(resolveCalcs("{{calc: 31.50 * 22}}", new Set([3_150])).trusted).toEqual([69_300]);
  });

  it("leaves what it cannot read as written, without the braces", () => {
    expect(resolveCalcs("about {{calc: the rest of it}} left", new Set()).text).toBe("about the rest of it left");
    expect(resolveCalcs("no calculation here, PHP 50.00", new Set()).text).toBe("no calculation here, PHP 50.00");
  });

  it("a trusted result is never flagged; the same figure written by hand is", () => {
    const given = "Wallets PHP 2,500.25. Savings PHP 4,000.50. Extra cash PHP 1,000.00. Plan PHP 30,000.00.";
    const known = new Set(figuresIn(given).map(Math.abs));
    const calc = resolveCalcs("Short by {{calc: 30000 - 2500.25 - 4000.50 - 1000}}.", known);
    expect(untracedFigures(calc.text, given, calc.trusted.map((c) => `PHP ${(c / 100).toFixed(2)}`).join("\n"))).toEqual([]);
    expect(untracedFigures("Short by PHP 22,499.25.", given, "")).toEqual([2_249_925]);
  });

  it("the rule as written has no em dash", () => {
    expect(CALC_RULE).not.toContain(DASH);
  });
});
