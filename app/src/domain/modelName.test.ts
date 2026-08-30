/**
 * Every id here is one the live chain has actually served or offered, taken
 * from the provider catalogues on 2026-08-30, plus the families likely to
 * appear next. The point is that an unknown id still produces a readable
 * line, since the chain is discovered at runtime and will meet ids this file
 * has never seen.
 */

import { describe, expect, it } from "vitest";

import { modelLabel, modelName } from "./modelName";

describe("modelName, ids the chain actually serves", () => {
  it("names the model that answered on the live site", () => {
    expect(modelLabel("groq:openai/gpt-oss-120b")).toBe("GPT-OSS 120B by OpenAI");
    expect(modelLabel("groq:qwen/qwen3.8-27b")).toBe("Qwen3.8 27B by Alibaba");
  });

  it("handles the rest of the current chain", () => {
    expect(modelLabel("openrouter:z-ai/glm-5.2:free")).toBe("GLM 5.2 by Z.ai");
    expect(modelLabel("openrouter:minimax/minimax-m3:free")).toBe("M3 by MiniMax");
    expect(modelLabel("openrouter:google/gemma-4-31b-it:free")).toBe(
      "Gemma 4 31B IT by Google",
    );
    expect(modelLabel("groq:openai/gpt-oss-20b")).toBe("GPT-OSS 20B by OpenAI");
  });

  it("names Anthropic and Meta models, should they ever appear", () => {
    expect(modelLabel("openrouter:anthropic/claude-haiku-4-5")).toBe(
      "Claude Haiku 4 5 by Anthropic",
    );
    expect(modelLabel("openrouter:meta-llama/llama-3.3-70b-instruct:free")).toBe(
      "Llama 3.3 70B Instruct by Meta",
    );
  });
});

describe("modelName, the parts", () => {
  it("separates host, maker and name", () => {
    expect(modelName("groq:openai/gpt-oss-120b")).toEqual({
      name: "GPT-OSS 120B",
      maker: "OpenAI",
      host: "Groq",
    });
  });

  it("reports OpenRouter as the host", () => {
    expect(modelName("openrouter:z-ai/glm-5.2:free").host).toBe("OpenRouter");
  });

  it("copes with no host prefix at all", () => {
    expect(modelName("openai/gpt-oss-120b")).toEqual({
      name: "GPT-OSS 120B",
      maker: "OpenAI",
      host: "",
    });
  });
});

describe("modelName, suffixes and repetition", () => {
  it("drops the free tier marker, which is not part of the name", () => {
    expect(modelName("openrouter:google/gemma-4-31b-it:free").name).not.toContain("free");
  });

  it("does not repeat the maker inside the name", () => {
    // "minimax/minimax-m3" must not read "MiniMax M3 by MiniMax".
    expect(modelLabel("openrouter:minimax/minimax-m3:free")).toBe("M3 by MiniMax");
    expect(modelLabel("openrouter:deepseek/deepseek-chat-v3:free")).toBe(
      "Chat V3 by DeepSeek",
    );
  });

  it("keeps the name when it is not merely the maker repeated", () => {
    expect(modelLabel("groq:openai/gpt-oss-120b")).toContain("GPT-OSS");
  });
});

describe("modelName, ids it has never seen", () => {
  it("still produces a readable line for an unknown vendor", () => {
    const label = modelLabel("openrouter:brand-new-lab/wonder-9-40b:free");

    expect(label).toContain("by");
    expect(label).not.toContain("/");
    expect(label).not.toContain(":");
    expect(label).toContain("40B");
  });

  it("names a bare Groq id with no vendor prefix", () => {
    expect(modelLabel("groq:allam-2-7b")).toBe("Allam 2 7B by SDAIA");
    expect(modelLabel("groq:compound")).toBe("Compound by Groq");
  });

  it("survives an id with nothing useful in it", () => {
    expect(modelLabel("")).toBe("");
    expect(modelLabel("   ")).toBe("");
    expect(modelLabel("mystery")).toBe("Mystery");
  });
});

describe("modelName, formatting", () => {
  it("uppercases parameter counts rather than title casing them", () => {
    expect(modelName("openrouter:nvidia/nemotron-3-super-120b-a12b:free").name).toContain(
      "120B",
    );
    expect(modelName("openrouter:nvidia/nemotron-3-super-120b-a12b:free").name).toContain(
      "A12B",
    );
  });

  it("leaves version numbers alone", () => {
    expect(modelName("openrouter:z-ai/glm-5.2:free").name).toBe("GLM 5.2");
  });

  it("never leaves a slug artefact in what is shown", () => {
    const ids = [
      "groq:openai/gpt-oss-120b",
      "openrouter:z-ai/glm-5.2:free",
      "openrouter:google/gemma-4-31b-it:free",
      "openrouter:nvidia/nemotron-3-super-120b-a12b:free",
      "openrouter:thinkingmachines/inkling-small:free",
      "groq:allam-2-7b",
    ];

    for (const id of ids) {
      const label = modelLabel(id);
      expect(label).not.toContain("/");
      expect(label).not.toContain(":");
      expect(label).not.toContain("_");
      expect(label.trim()).toBe(label);
      expect(label.length).toBeGreaterThan(2);
    }
  });
});
