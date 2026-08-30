/**
 * The point of these tests is the failure paths.
 *
 * A model answering is the easy case and the rare one. What has to be right is
 * every way it does not answer, because each of those used to be a blank panel
 * with no explanation.
 */

import { describe, expect, it } from "vitest";

import { loadFixture } from "../fixtures/load";
import { allowedCategories } from "../domain/categorise";
import { buildContext } from "../domain/aiContext";
import { migrateAccounts } from "../domain/accounts";
import { askAi, describeDraft, suggestCategory } from "./aiClient";

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
  askAi({
    context,
    task: "summary",
    tone: "brief",
    fetcher,
    timeoutMs: 500,
    token: async () => "test-token",
  });

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

  it("strips the Markdown a model adds, whatever the prompt asked", async () => {
    const answer = await ask(
      respond({
        text: "### August: you spent **PHP 1,000.00**, net worth is *PHP 5,000.00*",
      }),
    );

    expect(answer.source).toBe("model");
    expect(answer.text).not.toContain("*");
    expect(answer.text).not.toContain("#");
    // The figures survive untouched: only the formatting goes.
    expect(answer.text).toContain("PHP 1,000.00");
    expect(answer.text).toContain("PHP 5,000.00");
  });

  it("does not send anything at all when there is no session", async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const answer = await askAi({
      context,
      task: "summary",
      tone: "brief",
      fetcher: spy,
      token: async () => null,
    });

    expect(called).toBe(false);
    expect(answer.source).toBe("offline");
    expect(answer.reason).toContain("Not signed in");
  });

  it("proves who is calling, so the endpoint is not an open proxy", async () => {
    let auth: string | null = null;
    const spy = (async (_url: string, init: RequestInit) => {
      auth = new Headers(init.headers).get("authorization");
      return new Response(JSON.stringify({ text: "ok" }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await ask(spy);
    expect(auth).toBe("Bearer test-token");
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

describe("describeDraft", () => {
  const draft = {
    flow: "Spending" as const,
    date: "2026-08-30",
    fromWallet: "Maya",
    toWallet: "",
    category: "Food",
    item: "Zzz Never Bought This Before",
    description: "",
    amount: 15000,
    fee: 0,
    notes: "",
    status: "Paid",
  };

  const never = (() => {
    throw new Error("should not have called the network");
  }) as unknown as typeof fetch;

  it("answers from history without touching the network", async () => {
    const seen = fixture.transactions.find(
      (t) => t.type === "Spending" && t.item && t.description.trim(),
    );

    const result = await describeDraft(
      { ...draft, item: seen!.item, category: seen!.category },
      fixture.transactions,
      { fetcher: never, token: async () => "t" },
    );

    expect(result.source).toBe("history");
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("does not call the model when descriptions are switched off", async () => {
    const result = await describeDraft(draft, fixture.transactions, {
      allowModel: false,
      fetcher: never,
      token: async () => "t",
    });

    expect(result.source).toBe("none");
    expect(result.text).toBe("");
  });

  it("cleans what the model returns before it reaches the field", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ text: 'Here is a description: "**Lunch at Jollibee**."' }), {
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const result = await describeDraft(draft, fixture.transactions, {
      allowModel: true,
      fetcher,
      token: async () => "t",
    });

    expect(result.source).toBe("model");
    expect(result.text).toBe("Lunch at Jollibee");
  });

  it("stays quiet rather than showing an error when the model fails", async () => {
    const fetcher = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    const result = await describeDraft(draft, fixture.transactions, {
      allowModel: true,
      fetcher,
      token: async () => "t",
    });

    expect(result).toEqual({ text: "", source: "none" });
  });

  it("sends only the structured fields, never a description", async () => {
    let sent = "";
    const fetcher = (async (_u: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response(JSON.stringify({ text: "Lunch" }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await describeDraft(
      { ...draft, description: "SECRET-TYPED", notes: "SECRET-NOTE" },
      fixture.transactions,
      { allowModel: true, fetcher, token: async () => "t" },
    );

    const body = JSON.parse(sent) as { context: string; task: string };
    expect(body.task).toBe("describe");
    expect(body.context).not.toContain("SECRET-TYPED");
    expect(body.context).not.toContain("SECRET-NOTE");
    expect(body.context).toContain("Item: Zzz Never Bought This Before");
  });
});

describe("suggestCategory", () => {
  const draft = {
    flow: "Spending" as const,
    date: "2026-08-30",
    fromWallet: "Maya",
    toWallet: "",
    category: "",
    item: "Zzz Never Filed This",
    description: "",
    amount: 15000,
    fee: 0,
    notes: "",
    status: "Paid",
  };

  const never = (() => {
    throw new Error("should not have called the network");
  }) as unknown as typeof fetch;

  it("answers from history without asking, when the ledger already agrees", async () => {
    // The category has to be one the picker actually offers, or the plan
    // is right to refuse it.
    const allowed = new Set(allowedCategories("Spending", fixture.reference));
    const filed = fixture.transactions.filter(
      (t) => t.type === "Spending" && t.item.trim() && allowed.has(t.category.trim()),
    );
    const repeated = filed.find(
      (t) => filed.filter((o) => o.item === t.item && o.category === t.category).length >= 2,
    );
    expect(repeated).toBeDefined();

    const result = await suggestCategory(
      { ...draft, item: repeated!.item },
      fixture.transactions,
      fixture.reference,
      { fetcher: never, token: async () => "t" },
    );

    expect(result.source).toBe("history");
    expect(result.category).toBe(repeated!.category);
    expect(result.confidence).toBe("high");
  });

  it("does not call the model when the toggle is off", async () => {
    const result = await suggestCategory(draft, fixture.transactions, fixture.reference, {
      allowModel: false,
      fetcher: never,
      token: async () => "t",
    });

    expect(result.source).toBe("none");
  });

  it("accepts a category from the allowed list", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ category: "Food", confidence: "high" }), {
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const result = await suggestCategory(draft, fixture.transactions, fixture.reference, {
      allowModel: true,
      fetcher,
      token: async () => "t",
    });

    expect(result.source).toBe("model");
    expect(result.category).toBe("Food");
    expect(result.confidence).toBe("high");
  });

  it("refuses a category the model invented", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ category: "Snacks And Treats", confidence: "high" }), {
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const result = await suggestCategory(draft, fixture.transactions, fixture.reference, {
      allowModel: true,
      fetcher,
      token: async () => "t",
    });

    // Better to offer nothing than to put a category into the totals that
    // exists on exactly one row.
    expect(result.source).toBe("none");
    expect(result.category).toBe("");
  });

  it("sends the allowed list and the owner's own past labels", async () => {
    let sent = "";
    const fetcher = (async (_u: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response(JSON.stringify({ category: "Food", confidence: "high" }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await suggestCategory(draft, fixture.transactions, fixture.reference, {
      allowModel: true,
      fetcher,
      token: async () => "t",
    });

    const body = JSON.parse(sent) as { context: string; task: string };
    expect(body.task).toBe("categorise");
    expect(body.context).toContain("Allowed categories:");
    expect(body.context).toContain("Item: Zzz Never Filed This");
  });

  it("stays quiet rather than erroring when the model fails", async () => {
    const fetcher = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    const result = await suggestCategory(draft, fixture.transactions, fixture.reference, {
      allowModel: true,
      fetcher,
      token: async () => "t",
    });

    expect(result.source).toBe("none");
  });
});
