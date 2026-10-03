/**
 * The endpoint, which ran with no tests at all.
 *
 * It deploys to Cloudflare and nothing else runs it, so every change to it
 * has been checked by typechecking and then by the owner's next message.
 * That is how a syntax error shipped three times, and how the shrink ladder
 * below went out on 20 September 2026 having only ever been reasoned about.
 *
 * What is tested here is what can be tested without a provider: the
 * compaction, the sizes it comes down through, and the words a failure is
 * reported in. The parts that need a model are exercised against the live
 * endpoint instead, and the findings from that are what these were written
 * from.
 */

import { describe, expect, it } from "vitest";

import { arrange, bestInOrder, compactContext, coolFor, spreadProviders, emptyRead, fitConversation, geminiRank, geminiRefusal, rankChain, shortReason, SHRINK_TO, systemFor, toneFor, usefulRead, visionChain, workersFailure, workersModels, workersText } from "./ai";

/** A context shaped like the real one: worked-out figures, then the rows. */
function contextOf(rows: number): string {
  const head = [
    "Date: 2026-09-20. Currency: Philippine Peso.",
    "",
    "## September 2026",
    "Spent PHP 39,638.36, received PHP 12,338.22.",
    "Budget PHP 7,700.00, over by PHP 31,938.36.",
    "",
    "## Today and the days before it",
    "Today, 2026-09-20: spent PHP 3,434.00, received PHP 0.00, across 21 entries.",
    "",
    "## Accounts",
    "Gcash: PHP 484,341.38",
    "Maya: PHP 484,557.00",
  ].join("\n");

  const entries = ["", "## Entries"].concat(
    Array.from({ length: rows }, (_, i) => `2026-09-${String((i % 28) + 1).padStart(2, "0")} | Spending | Item ${i} | PHP ${100 + i}.00`),
  );

  return [head, ...entries].join("\n");
}

describe("cutting a context to size", () => {
  it("leaves a context that already fits exactly as it is", () => {
    const small = contextOf(5);
    expect(compactContext(small, 18_000)).toBe(small);
  });

  it("keeps the worked-out figures and cuts the rows", () => {
    const cut = compactContext(contextOf(4000), 6_000);

    expect(cut.length).toBeLessThanOrEqual(6_000);
    expect(cut).toContain("## September 2026");
    expect(cut).toContain("## Today and the days before it");
    expect(cut).toContain("Gcash: PHP 484,341.38");
    expect(cut).toContain("## Entries");
  });

  it("says how many rows it left out, so nothing is counted that cannot be seen", () => {
    const cut = compactContext(contextOf(4000), 6_000);
    const note = /\((\d+) more entries left out to fit/.exec(cut);

    expect(note, cut.slice(-200)).not.toBeNull();
    expect(Number(note![1])).toBeGreaterThan(3000);
  });

  it("never returns more than it was asked for, at any size", () => {
    for (const max of [200, 500, 2_000, 6_000, 18_000]) {
      const cut = compactContext(contextOf(4000), max);
      expect(cut.length, `max ${max}`).toBeLessThanOrEqual(max);
    }
  });

  it("keeps the figures even when the room is too small for a single row", () => {
    const cut = compactContext(contextOf(4000), 400);
    expect(cut).toContain("## September 2026");
    expect(cut.length).toBeLessThanOrEqual(400);
  });

  it("cuts a context with no rows in it at all, rather than failing", () => {
    const noEntries = "## September 2026\n" + "x".repeat(5_000);
    const cut = compactContext(noEntries, 1_000);
    expect(cut.length).toBeLessThanOrEqual(1_000);
    expect(cut).toContain("## September 2026");
  });
});

describe("cutting by section, least needed first", () => {
  /*
   * 28 September 2026: the owner's context was 78 KB, the 18,000 character
   * retry cut it from the end, and "The window asked about" and the year
   * totals were the part that went. Whole low-value sections go first now.
   */
  const bulky = [
    "Date: 2026-09-28. Currency: Philippine Peso.",
    "",
    "## September 2026",
    "Spent PHP 19,580.71, received PHP 21,791.45.",
    "",
    "## Accounts, by what each is for",
    "Usable now: Cash PHP 854.00, Maya PHP 3,944.95.",
    "",
    "## Already flagged by the app",
    ...Array.from({ length: 200 }, (_, i) => `[warn] Flag ${i}. Something the app noticed about record ${i}.`),
    "",
    "## Debt, every movement",
    ...Array.from({ length: 80 }, (_, i) => `2026-09-${String((i % 28) + 1).padStart(2, "0")} Maya Credit draw PHP ${100 + i}.00`),
    "",
    "## Every year in the ledger",
    "2022: spent PHP 120,000.00. 2023: spent PHP 180,000.00.",
    "",
    "## The window asked about: 2022 to today (2022-01-01 to 2026-09-28)",
    "Spent PHP 900,000.00, received PHP 924,245.46, 3,900 entries.",
  ].join("\n");
  const context = `${bulky}\n\n## Entries\n${Array.from({ length: 2000 }, (_, i) => `2026-09-01 | Spending | Item ${i} | PHP 1.00`).join("\n")}`;

  it("drops the flags before the window asked about, and only what it must", () => {
    const cut = compactContext(context, 6_000);
    expect(cut.length).toBeLessThanOrEqual(6_000);
    expect(cut).toContain("## The window asked about: 2022 to today");
    expect(cut).toContain("## Every year in the ledger");
    expect(cut).toContain("## Accounts, by what each is for");
    expect(cut).not.toContain("## Already flagged by the app");
    // The flags were enough: the debt log fits once they are gone, so it stays.
    expect(cut).toContain("## Debt, every movement");
    expect(cut).toContain("(Left out to fit: Already flagged by the app. Say so if the answer needs them.)");
  });

  it("keeps the question's own window even at the smallest size", () => {
    const cut = compactContext(context, SHRINK_TO[SHRINK_TO.length - 1]!);
    expect(cut).toContain("## The window asked about");
    expect(cut).toContain("## September 2026");
  });
});

describe("the conversation, apart from the figures", () => {
  const conversation = [
    "Earlier sessions, oldest first:",
    ...Array.from({ length: 40 }, (_, i) => `2026-09-2${i % 8} you: an older thing said, number ${i}`),
    "",
    "Earlier in this conversation:",
    "you: what's your realistic budget recommendation next month?",
    "assistant: I recommend a budget of PHP 14,322.00 for October 2026: PHP 12,800.00 for spending and PHP 1,522.00 for bills and subscriptions.",
    "you: tell me whats the separation of that budget?",
  ].join("\n");

  it("is left alone when it fits", () => {
    expect(fitConversation(conversation, 16_000)).toBe(conversation);
  });

  it("never shortens what to keep in mind", () => {
    const pinned = "What to keep in mind:\nWhat they have told you, newest first (never ask for these again):\n- They expect about PHP 8,000.00 coming in.";
    const cut = fitConversation(`${pinned}\n\n${conversation}`, 700);
    expect(cut.startsWith(pinned)).toBe(true);
    expect(cut).toContain("you: tell me whats the separation of that budget?");
    expect(cut.length).toBeLessThanOrEqual(700);
  });

  it("keeps this conversation, newest lines, before anything from earlier sessions", () => {
    const cut = fitConversation(conversation, 500);
    expect(cut.length).toBeLessThanOrEqual(500);
    expect(cut).toContain("Earlier in this conversation:");
    expect(cut).toContain("I recommend a budget of PHP 14,322.00 for October 2026");
    expect(cut).toContain("you: tell me whats the separation of that budget?");
    expect(cut).not.toContain("number 0");
  });
});

describe("the sizes a refused request comes down through", () => {
  it("starts at the ordinary size and gets smaller each time", () => {
    expect(SHRINK_TO.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < SHRINK_TO.length; i += 1) {
      expect(SHRINK_TO[i]!, `step ${i}`).toBeLessThan(SHRINK_TO[i - 1]!);
    }
  });

  it("each step really is a smaller request, not just a smaller number", () => {
    const full = contextOf(4000);
    const sizes = SHRINK_TO.map((chars) => compactContext(full, chars).length);
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i]!, `step ${i}`).toBeLessThan(sizes[i - 1]!);
    }
  });

  it("the smallest still carries the figures an answer is usually made of", () => {
    const smallest = compactContext(contextOf(4000), SHRINK_TO[SHRINK_TO.length - 1]!);
    expect(smallest).toContain("## September 2026");
    expect(smallest).toContain("Spent PHP 39,638.36");
  });
});

describe("what a failure is called", () => {
  it("names the status when a provider refuses", () => {
    expect(shortReason(new Error("413"))).toBe("rejected (413)");
    expect(shortReason(new Error("429"))).toBe("rejected (429)");
    expect(shortReason(new Error("500"))).toBe("provider error (500)");
  });

  it("says the one thing the owner can act on", () => {
    expect(shortReason(new Error("no key"))).toBe("no key for this provider");
  });

  it("says timed out for an abort, and never invents a reason", () => {
    expect(shortReason(new Error("The operation was aborted"))).toBe("timed out");
    expect(shortReason(new Error("something nobody has seen"))).toBe("unavailable");
    expect(shortReason("a string, not an error")).toBe("unavailable");
  });
});

/**
 * The tone setting reaches the conversation.
 *
 * The owner, 26 September 2026: "Fix the ai in the settings make sure it
 * actually works like if I say detailed etc life actually work." The chat
 * was deliberately untoned, so the setting changed nothing on the one screen
 * it is used from.
 */
describe("the tone setting in the chat", () => {
  it("sends a different instruction for each of the three", () => {
    const lines = ["brief", "plain", "detailed"].map((t) => toneFor("chat", t));
    expect(new Set(lines).size).toBe(3);
    for (const line of lines) expect(line).not.toBe("");
  });

  it("says what detailed means: the working, not more lines", () => {
    expect(toneFor("chat", "detailed")).toContain("Give the reasoning as well as the answer");
  });

  /*
   * Why it was switched off in the first place: the panel tone says "one
   * line where possible", which fought the conversation instruction and made
   * detailed return the same short sentence. That line must never reach a
   * conversation again.
   */
  it("never sends the panel's one-line rule to a conversation", () => {
    for (const tone of ["brief", "plain", "detailed"]) {
      expect(toneFor("chat", tone), tone).not.toContain("One line where possible");
    }
  });

  it("still sends the panel tones to a panel", () => {
    expect(toneFor("summary", "brief")).toContain("One line where possible");
  });

  it("falls back to brief for a tone nobody set", () => {
    expect(toneFor("chat", "shouty")).toBe(toneFor("chat", "brief"));
  });
});

/**
 * Detailed has to be able to win on the panels too.
 *
 * The summary was told "three sentences or fewer" and the alerts "one short
 * paragraph" in their own instructions, so on Insights "detailed" was
 * outvoted by the task and nothing changed when it was picked.
 */
describe("the tone setting on the panels", () => {
  it("sends a different length for each of the three", () => {
    const lines = ["brief", "plain", "detailed"].map((t) => toneFor("summary", t));
    expect(new Set(lines).size).toBe(3);
    expect(toneFor("summary", "detailed")).toContain("Up to 150 words");
  });
});

describe("asking several models at once", () => {
  const wait = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      });
    });

  it("takes the stronger answer when it comes in time, though the weaker came first", async () => {
    const answer = await bestInOrder(["strong", "weak"], 2, async (name: string, stop: AbortSignal) => {
      await wait(name === "strong" ? 60 : 5, stop);
      return name;
    }, Date.now() + 2_000);
    expect(answer).toBe("strong");
  });

  it("takes the weaker answer at the hold, and stops the stronger", async () => {
    const stopped: string[] = [];
    const started = Date.now();
    const answer = await bestInOrder(["strong", "weak"], 2, async (name: string, stop: AbortSignal) => {
      stop.addEventListener("abort", () => stopped.push(name));
      await wait(name === "strong" ? 5_000 : 5, stop);
      return name;
    }, Date.now() + 100);
    expect(answer).toBe("weak");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(stopped).toContain("strong");
  });

  it("answers by the deadline with what is in, before every model's own timeout", async () => {
    // 4 October 2026: the app gave up first and answered on its own.
    const started = Date.now();
    const answer = await bestInOrder(["strong", "weak"], 2, async (name: string, stop: AbortSignal) => {
      await wait(name === "strong" ? 5_000 : 40, stop);
      return name;
    }, Date.now() + 10_000, 0, Date.now() + 150);
    expect(answer).toBe("weak");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("gives up at the deadline with nothing, rather than past the app's wait", async () => {
    const started = Date.now();
    const answer = await bestInOrder(["a", "b"], 2, async (_name: string, stop: AbortSignal) => {
      await wait(5_000, stop);
      return "late";
    }, 0, 0, Date.now() + 100);
    expect(answer).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("takes the weaker answer as soon as the stronger fails", async () => {
    const started = Date.now();
    const answer = await bestInOrder(["strong", "weak"], 2, async (name: string, stop: AbortSignal) => {
      await wait(name === "strong" ? 40 : 5, stop);
      return name === "strong" ? null : name;
    }, Date.now() + 5_000);
    expect(answer).toBe("weak");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("puts the next one down in a failed model's place at once", async () => {
    const began: string[] = [];
    const answer = await bestInOrder(["a", "b", "c", "d"], 2, async (name: string, stop: AbortSignal) => {
      began.push(name);
      if (name === "a") {
        await wait(80, stop);
        return null;
      }
      return name === "c" ? name : null;
    }, Date.now() + 5_000);
    expect(answer).toBe("c");
    // c was asked while a was still working, and d never was.
    expect(began).toEqual(["a", "b", "c"]);
  });

  it("answers null when nothing answers", async () => {
    expect(await bestInOrder([1, 2, 3], 2, async () => null)).toBeNull();
  });

  it("asks the strongest alone first when staggered, and the next only if it is slow or fails", async () => {
    // 3 October 2026: Gemini's free answers went two at a time.
    const asked: string[] = [];
    const quick = await bestInOrder(["strong", "next"], 2, async (name: string) => {
      asked.push(name);
      await new Promise((r) => setTimeout(r, 20));
      return name;
    }, 0, 200);
    expect(quick).toBe("strong");
    expect(asked).toEqual(["strong"]);

    const tried: string[] = [];
    const failed = await bestInOrder(["strong", "next"], 2, async (name: string) => {
      tried.push(name);
      return name === "strong" ? null : name;
    }, 0, 10_000);
    expect(failed).toBe("next");
    expect(tried).toEqual(["strong", "next"]);
  });
});


/**
 * "What can you recommend?", 26 September 2026, answered with "I cannot
 * recommend investments, stocks, or coins". The system message told every
 * task not to recommend, and the chat obeyed it over its own instruction.
 */
describe("who may advise", () => {
  it("lets the conversation recommend from their own figures", () => {
    const chat = systemFor("chat");
    expect(chat).not.toContain("Do not recommend");
    expect(chat).not.toContain("Never advise");
    expect(chat).toContain("so recommend");
    expect(chat).toContain("which stock, coin, fund or other investment");
  });

  it("keeps the panels to the facts", () => {
    for (const task of ["summary", "alerts", "patterns", "extract"]) {
      expect(systemFor(task), task).toContain("Do not recommend");
      expect(systemFor(task), task).toContain("Never advise");
    }
  });

  it("changes nothing else the two share", () => {
    const shared = "Repeat figures exactly; never round or estimate";
    expect(systemFor("chat")).toContain(shared);
    expect(systemFor("summary")).toContain(shared);
    expect(systemFor("chat")).toContain("Never use an em dash");
  });
});

/**
 * 26 September 2026, 15:07: three screenshots, each answered in four to nine
 * seconds by openrouter/free with nothing found, because a reply that found
 * nothing counted as the first good answer and won the race.
 */
describe("a picture read as empty", () => {
  it("is told apart from one that found rows", () => {
    expect(emptyRead({ text: "0 found", data: [] })).toBe(true);
    expect(emptyRead({ text: "1 found", data: [{ flow: "Spending" }] })).toBe(false);
    expect(emptyRead({ text: "a sentence" })).toBe(false);
  });

  it("loses the race to a slower model that reads it", async () => {
    const answer = await bestInOrder(["blind", "slow reader"], 3, async (name: string) => {
      if (name === "blind") return null; // what an empty read now returns while others run
      await new Promise((r) => setTimeout(r, 30));
      return "rows";
    });
    expect(answer).toBe("rows");
  });
});

/**
 * 26 September 2026, 23:27: "Every model in the chain failed. Tried: gemma
 * rejected (429), qwen rejected (429), dots timed out." Three models, all
 * OpenRouter, and the router had fallen off the end.
 */
describe("the vision models to try", () => {
  const or = ["google/gemma-3-12b-it:free", "qwen/qwen3.8-27b-vl:free", "minimax/minimax-m3:free", "a:free", "b:free", "c:free", "d:free", "e:free", "f:free", "g:free", "openrouter/free"];
  const at = (chain: readonly { provider: string; model: string }[]): string[] => chain.map((c) => `${c.provider}:${c.model}`);

  it("is strongest first across providers, and keeps the router last", () => {
    const chain = at(visionChain({ gemini: ["gemini-3.8-flash", "gemini-3.5-flash-lite"], groq: ["meta-llama/llama-4-scout-17b-16e-instruct"], openrouter: or }));
    expect(chain.slice(0, 4)).toEqual(["gemini:gemini-3.8-flash", "openrouter:minimax/minimax-m3:free", "gemini:gemini-3.5-flash-lite", "openrouter:qwen/qwen3.8-27b-vl:free"]);
    expect(chain).toHaveLength(9);
    expect(chain[8]).toBe("openrouter:openrouter/free");
    expect(chain).not.toContain("openrouter:google/gemma-3-12b-it:free");
  });

  it("puts a model refused lately behind the others", () => {
    const chain = at(visionChain({ gemini: ["gemini-3.8-flash"], openrouter: ["minimax/minimax-m3:free", "openrouter/free"] }, (c) => c.model === "gemini-3.8-flash"));
    expect(chain).toEqual(["openrouter:minimax/minimax-m3:free", "gemini:gemini-3.8-flash", "openrouter:openrouter/free"]);
  });

  it("is empty only when no provider has a model", () => {
    expect(visionChain({})).toEqual([]);
  });
});

/**
 * 26 September 2026, 23:45: the owner's Maya credit screen, read well on the
 * device, came back "Nothing in that looked like a transaction": a row with
 * no usable kind won the race.
 */
describe("an answer worth winning with", () => {
  it("has at least one row of a kind the app can use", () => {
    expect(usefulRead({ text: "2 found", data: [{ flow: "Debt" }, { flow: "" }] })).toBe(true);
    expect(usefulRead({ text: "1 found", data: [{ flow: " OnBehalf " }] })).toBe(true);
  });

  it("is not empty, and not the template copied back", () => {
    expect(usefulRead({ text: "0 found", data: [] })).toBe(false);
    expect(usefulRead({ text: "1 found", data: [{ flow: "Spending or Revenue or Transfer or Debt or OnBehalf or Balance" }] })).toBe(false);
    expect(usefulRead({ text: "1 found", data: [{ flow: "" }, {}] })).toBe(false);
  });

  it("leaves other tasks' answers alone", () => {
    expect(usefulRead({ text: "A sentence." })).toBe(true);
  });
});

/**
 * 30 September 2026: "Can we add another powerful ai that is free and cannot
 * forget and actually smart?" Google Gemini goes first and Cloudflare Workers
 * AI stands behind the rest. Neither can be called from a test, so what is
 * pinned is which of their models are asked, in what order, and how their
 * failures are read.
 */
describe("Gemini's models, from Google's own list", () => {
  const catalogue = [
    "models/embedding-001",
    "models/gemini-2.5-flash",
    "models/gemini-2.5-pro",
    "models/gemini-3.5-flash",
    "models/gemini-3.6-flash",
    "models/gemini-3.7-flash",
    "models/gemini-3.8-flash",
    "models/gemini-3.8-pro",
    "models/gemini-3.5-pro",
    "models/gemini-3.5-flash-lite",
    "models/gemini-3.1-flash-lite",
    "models/gemini-3.8-flash-preview-tts",
    "models/gemini-3.5-flash-image",
    "models/gemini-3.5-flash-live-001",
    "models/gemini-embedding-001",
    "models/gemma-4-31b-it",
    "models/gemini-flash-latest",
  ];

  it("keeps the chat models, strongest first: the newest Pro, every Flash, a few Lite", () => {
    expect(geminiRank(catalogue)).toEqual([
      "gemini-3.8-pro",
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-2.5-flash",
      "gemini-flash-latest",
      "gemini-3.1-flash-lite",
    ]);
  });

  it("is empty when the list has nothing to chat with", () => {
    expect(geminiRank(["models/embedding-001", "models/imagen-4.0-generate-001"])).toEqual([]);
  });
});

describe("a request Gemini refuses", () => {
  it("is not sent again when the key is wrong or the region is not served", () => {
    expect(geminiRefusal('{"error":{"code":400,"message":"User location is not supported for the API use.","status":"FAILED_PRECONDITION"}}')).toBe("403");
    expect(geminiRefusal('[{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}]')).toBe("403");
  });

  it("is sent again, lean, when it was the request's shape", () => {
    expect(geminiRefusal('{"error":{"code":400,"message":"Invalid JSON payload received.","status":"INVALID_ARGUMENT"}}')).toBe("400");
    expect(geminiRefusal("")).toBe("400");
  });
});

/**
 * 30 September 2026: "I want the most powerful ai. Like if the other
 * powerful is not available means use the other most powerful. All low end
 * ai and not smart ai make them last option."
 */
describe("the text models to try", () => {
  const lists = {
    gemini: ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
    groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.1-8b-instant", "allam-2-7b"],
    openrouter: ["minimax/minimax-m3:free", "z-ai/glm-5.2:free", "meta-llama/llama-3.3-70b-instruct:free"],
    workers: ["@cf/openai/gpt-oss-120b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"],
  };
  const at = (chain: readonly { provider: string; model: string }[]): string[] => chain.map((c) => `${c.provider}:${c.model}`);

  it("asks the strongest first, whoever hosts it, and the small ones last", () => {
    expect(at(arrange(rankChain(lists), "chat"))).toEqual([
      "gemini:gemini-3.8-flash",
      "openrouter:minimax/minimax-m3:free",
      "openrouter:z-ai/glm-5.2:free",
      "gemini:gemini-3.5-flash-lite",
      "groq:openai/gpt-oss-120b",
      "workers:@cf/openai/gpt-oss-120b",
      "groq:openai/gpt-oss-20b",
      "openrouter:meta-llama/llama-3.3-70b-instruct:free",
      "workers:@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      "groq:llama-3.1-8b-instant",
      "groq:allam-2-7b",
    ]);
  });

  it("uses the next strongest when the strongest was refused lately", () => {
    const chain = at(arrange(rankChain(lists), "chat", (c) => c.provider === "gemini" && c.model === "gemini-3.8-flash"));
    expect(chain[0]).toBe("openrouter:minimax/minimax-m3:free");
    expect(chain[chain.length - 1]).toBe("gemini:gemini-3.8-flash");
  });

  it("leaves the few strong answers a day to the questions, and asks Groq first for the quick jobs", () => {
    const chain = at(arrange(rankChain(lists), "route"));
    expect(chain.slice(0, 4)).toEqual(["groq:openai/gpt-oss-120b", "openrouter:minimax/minimax-m3:free", "openrouter:z-ai/glm-5.2:free", "gemini:gemini-3.5-flash-lite"]);
    expect(chain.indexOf("gemini:gemini-3.8-flash")).toBeGreaterThan(chain.indexOf("groq:allam-2-7b"));
    expect(chain.indexOf("workers:@cf/openai/gpt-oss-120b")).toBeGreaterThan(chain.indexOf("groq:allam-2-7b"));
  });

  it("is the old providers alone when neither new one is set up", () => {
    expect(at(rankChain({ groq: ["openai/gpt-oss-20b", "openai/gpt-oss-120b"], openrouter: ["minimax/minimax-m3:free"] }))).toEqual([
      "openrouter:minimax/minimax-m3:free",
      "groq:openai/gpt-oss-120b",
      "groq:openai/gpt-oss-20b",
    ]);
  });
});

describe("how long a refused model is left alone", () => {
  it("is hours for an allowance that is used up or never given, a minute for a busy minute", () => {
    expect(coolFor("429", "Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-3.8-pro")).toBe(12 * 60 * 60_000);
    expect(coolFor("429", '"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"')).toBe(3 * 60 * 60_000);
    expect(coolFor("429", "Rate limit exceeded: free-models-per-day")).toBe(3 * 60 * 60_000);
    expect(coolFor("429", "Rate limit reached on tokens per minute (TPM)")).toBe(60_000);
  });

  it("is an hour for a bad key, a region not served or a retired model, and nothing for an outage", () => {
    expect(coolFor("403")).toBe(60 * 60_000);
    expect(coolFor("404")).toBe(60 * 60_000);
    expect(coolFor("402")).toBe(12 * 60 * 60_000);
    expect(coolFor("503")).toBe(0);
    expect(coolFor("413")).toBe(0);
  });
});

describe("Workers AI", () => {
  it("uses the models kept here unless the environment names its own", () => {
    expect(workersModels()[0]).toBe("@cf/openai/gpt-oss-120b");
    expect(workersModels(" @cf/qwen/qwen3-30b-a3b-fp8 , nonsense, @hf/some/model ")).toEqual(["@cf/qwen/qwen3-30b-a3b-fp8", "@hf/some/model"]);
    expect(workersModels("nonsense")).toEqual(workersModels());
  });

  it("reads a failure in the terms the chain acts on", () => {
    expect(workersFailure("AiError: Input is too long for this model's context window")).toBe("413");
    expect(workersFailure("4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan")).toBe("429");
    expect(workersFailure("This model requires the Workers Paid plan or prepaid credits")).toBe("402");
    expect(workersFailure("5007: No such model @cf/old/model or task")).toBe("404");
    expect(workersFailure("InferenceUpstreamError: internal")).toBe("503");
  });

  it("reads the answer in each shape its models give", () => {
    expect(workersText({ response: '{"summary":"a"}' })).toBe('{"summary":"a"}');
    expect(workersText({ response: { summary: "a" } })).toBe('{"summary":"a"}');
    expect(workersText({ choices: [{ message: { content: "b" } }] })).toBe("b");
    expect(workersText({ output: [{ type: "reasoning", content: [{ text: "thinking" }] }, { type: "message", content: [{ type: "output_text", text: "c" }] }] })).toBe("c");
    expect(workersText(null)).toBe("");
  });
});

describe("asking one of each provider at once", () => {
  // 3 October 2026: "even provider switch, whichever is available ... the fastest".
  const chain = [
    { provider: "gemini" as const, model: "gemini-3.8-flash" },
    { provider: "gemini" as const, model: "gemini-3.5-flash" },
    { provider: "groq" as const, model: "openai/gpt-oss-120b" },
    { provider: "openrouter" as const, model: "nvidia/nemotron-3-ultra:free" },
    { provider: "groq" as const, model: "qwen/qwen3-32b" },
  ];

  it("puts the strongest of each provider first, then the rest in order", () => {
    expect(spreadProviders(chain, 3).map((c) => c.model)).toEqual([
      "gemini-3.8-flash",
      "openai/gpt-oss-120b",
      "nvidia/nemotron-3-ultra:free",
      "gemini-3.5-flash",
      "qwen/qwen3-32b",
    ]);
  });

  it("leaves a chain of one provider as it is", () => {
    const gemini = chain.filter((c) => c.provider === "gemini");
    expect(spreadProviders(gemini, 3)).toEqual(gemini);
  });

  it("sets a model that ran out of time aside for a few minutes", () => {
    expect(coolFor("timeout")).toBe(5 * 60_000);
  });
});

