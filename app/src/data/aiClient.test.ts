/**
 * The point of these tests is the failure paths.
 *
 * A model answering is the easy case and the rare one. What has to be right is
 * every way it does not answer, because each of those used to be a blank panel
 * with no explanation.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { buildContext } from "../domain/aiContext";
import { migrateAccounts } from "../domain/accounts";
import { askAi } from "./aiClient";

const fixture = loadFixture();
const context = buildContext({
  transactions: fixture.transactions,
  accounts: migrateAccounts(
    fixture.reference.wallets,
    fixture.reference.savings,
    fixture.transactions,
  ),
  budgets: fixture.budgets,
  credits: [],
  reference: fixture.reference,
  lowBalanceThreshold: 50000,
  asOf: fixture.expected.asOf,
});

/** A fetch that returns exactly what the test wants, without a network. */
const respond = (
  body: unknown,
  init: { status?: number; type?: string } = {},
): typeof fetch =>
  (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": init.type ?? "application/json" },
    })) as unknown as typeof fetch;

const ask = (fetcher: typeof fetch) =>
  askAi({ context, task: "summary", tone: "brief", fetcher, timeoutMs: 500 });

describe("askAi", () => {
  it("returns the model's text when a provider answers", async () => {
    const answer = await ask(respond({ text: "  You spent PHP 100.00.  ", model: "groq:x" }));

    expect(answer.source).toBe("model");
    expect(answer.text).toBe("You spent PHP 100.00.");
    expect(answer.model).toBe("groq:x");
    expect(answer.reason).toBeUndefined();
  });

  it("falls back when the dev server answers with the SPA shell", async () => {
    // The trap: status 200, body HTML. Without the content-type check this
    // reaches JSON.parse and throws on a doctype.
    const answer = await ask(respond("<!doctype html><title>App</title>", { type: "text/html" }));

    expect(answer.source).toBe("offline");
    expect(answer.reason).toContain("only on the deployed site");
    expect(answer.text.length).toBeGreaterThan(0);
  });

  it("passes the endpoint's own explanation through when no key is set", async () => {
    const answer = await ask(
      respond({ error: "No provider key is configured." }, { status: 503 }),
    );

    expect(answer.source).toBe("offline");
    expect(answer.reason).toBe("No provider key is configured.");
  });

  it("falls back when every model in the chain fails", async () => {
    const answer = await ask(
      respond({ error: "Every model in the chain failed." }, { status: 502 }),
    );

    expect(answer.source).toBe("offline");
    expect(answer.reason).toBe("Every model in the chain failed.");
  });

  it("falls back when the model answers with nothing", async () => {
    const answer = await ask(respond({ text: "   " }));

    expect(answer.source).toBe("offline");
    expect(answer.reason).toBe("The model returned nothing.");
  });

  it("falls back when the network is unreachable", async () => {
    const answer = await ask((() => Promise.reject(new Error("Failed to fetch"))) as unknown as typeof fetch);

    expect(answer.source).toBe("offline");
    expect(answer.reason).toContain("offline");
  });

  it("always produces usable text, whatever went wrong", async () => {
    const answers = await Promise.all([
      ask(respond("<html></html>", { type: "text/html" })),
      ask(respond({ error: "nope" }, { status: 500 })),
      ask(respond({ text: "" })),
    ]);

    for (const a of answers) {
      expect(a.text.length).toBeGreaterThan(20);
      expect(a.text).toContain("PHP");
    }
  });

  it("sends figures and never sends a raw transaction description", async () => {
    let sent = "";
    const spy = (async (_url: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response(JSON.stringify({ text: "ok" }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await ask(spy);
    const body = JSON.parse(sent) as { context: string; task: string; tone: string };

    expect(body.task).toBe("summary");
    expect(body.tone).toBe("brief");

    /**
     * Descriptions are the free text in the ledger, and the most sensitive
     * thing in it. None may appear.
     *
     * Account and category names are excluded from the check because they
     * legitimately appear in balances and rankings, and some rows use one as
     * their description: "Reserved Fund" is both. Matching on those would flag
     * the account name and prove nothing about the free text.
     */
    const known = new Set(
      [
        ...fixture.reference.wallets,
        ...fixture.reference.savings,
        ...fixture.reference.bills,
        ...fixture.reference.subscriptions,
        ...fixture.reference.revenueCategories,
        ...fixture.reference.spendingTypes.map((t) => t.name),
      ].map((n) => n.trim().toLowerCase()),
    );

    const freeText = fixture.transactions
      .map((t) => t.description.trim())
      .filter((d) => d.length > 12 && !known.has(d.toLowerCase()));

    expect(freeText.length).toBeGreaterThan(20); // the check has something to bite on
    for (const d of freeText) {
      expect(body.context).not.toContain(d);
    }
  });
});
