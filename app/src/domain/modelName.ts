/**
 * Turning a model id into something a person recognises.
 *
 * The endpoint reports what actually answered, as the provider spells it:
 * `groq:qwen/qwen3.8-27b`. That is the right thing to record and the wrong
 * thing to show. The owner wants to know a model by Alibaba wrote it, not to
 * parse a slug.
 *
 * ── Why a table and a fallback, rather than one or the other ──────────────
 *
 * The chain is discovered at runtime now, so this will meet ids that did not
 * exist when it was written. A pure lookup table would show a blank for those,
 * which is exactly the case where the owner most wants to know what answered.
 * A pure prettifier would render "z-ai" as "Z Ai" and call Gemma's maker
 * "Google" only by luck.
 *
 * So: a table for the makers, which change rarely and cannot be derived, and a
 * prettifier for the model name, which is mechanical. An unknown vendor still
 * produces a sensible line rather than nothing.
 */

/** Vendor prefix to the name a person would use for them. */
const MAKERS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  "meta-llama": "Meta",
  meta: "Meta",
  qwen: "Alibaba",
  deepseek: "DeepSeek",
  "z-ai": "Z.ai",
  minimax: "MiniMax",
  nvidia: "NVIDIA",
  mistralai: "Mistral AI",
  cohere: "Cohere",
  liquid: "Liquid AI",
  inclusionai: "InclusionAI",
  thinkingmachines: "Thinking Machines",
  poolside: "Poolside",
  "dots-studio": "Dots Studio",
  canopylabs: "Canopy Labs",
  groq: "Groq",
  moonshotai: "Moonshot AI",
  "x-ai": "xAI",
  microsoft: "Microsoft",
  amazon: "Amazon",
};

/**
 * Ids with no vendor prefix, which Groq uses for models it hosts directly.
 * There is no way to derive the maker from "allam-2-7b", so it is listed.
 */
const BARE: Record<string, string> = {
  allam: "SDAIA",
  whisper: "OpenAI",
  compound: "Groq",
};

/** Fragments that should keep their conventional capitalisation. */
const ACRONYMS = new Map<string, string>([
  ["gpt", "GPT"],
  ["oss", "OSS"],
  ["glm", "GLM"],
  ["lfm", "LFM"],
  ["ai", "AI"],
  ["it", "IT"],
  ["moe", "MoE"],
  ["ocr", "OCR"],
  ["tts", "TTS"],
  ["v3", "V3"],
  ["r1", "R1"],
]);

export interface ModelName {
  /** "GPT-OSS 120B" */
  readonly name: string;
  /** "OpenAI", or "" when the id gives nothing to go on. */
  readonly maker: string;
  /** Which service actually served it. "Groq", "OpenRouter", or "". */
  readonly host: string;
}

const HOSTS: Record<string, string> = { groq: "Groq", openrouter: "OpenRouter" };

export function modelName(raw: string): ModelName {
  const trimmed = raw.trim();
  if (!trimmed) return { name: "", maker: "", host: "" };

  // "groq:qwen/qwen3.8-27b" splits into host and the provider's own id.
  const colon = trimmed.indexOf(":");
  const maybeHost = colon > 0 ? trimmed.slice(0, colon).toLowerCase() : "";
  const host = HOSTS[maybeHost] ?? "";
  let id = host ? trimmed.slice(colon + 1) : trimmed;

  // OpenRouter marks its free tier with a suffix that is not part of the name.
  id = id.replace(/:free$/i, "").replace(/:nitro$/i, "");

  const slash = id.indexOf("/");
  const vendor = slash > 0 ? id.slice(0, slash).toLowerCase() : "";
  const model = slash > 0 ? id.slice(slash + 1) : id;

  const maker =
    MAKERS[vendor] ??
    (vendor ? titleCase(vendor) : bareMaker(model));

  return { name: prettify(model, maker), maker, host };
}

/** "GPT-OSS 120B by OpenAI", the line the owner actually reads. */
export function modelLabel(raw: string): string {
  const { name, maker } = modelName(raw);
  if (!name) return "";
  return maker ? `${name} by ${maker}` : name;
}

function bareMaker(model: string): string {
  const first = model.toLowerCase().split(/[-_.]/)[0] ?? "";
  return BARE[first] ?? "";
}

/**
 * Make the model segment readable without inventing anything.
 *
 * The vendor name is dropped when it merely repeats the maker: "minimax/
 * minimax-m3" should read "M3 by MiniMax", not "MiniMax M3 by MiniMax".
 */
function prettify(model: string, maker: string): string {
  /**
   * Underscores are separators; dots are not. "glm-5.2" is version five point
   * two, and splitting on the dot renders it "GLM 5 2", which is a different
   * and wrong model number.
   */
  let s = model.replace(/_/g, "-");

  const makerSlug = maker.toLowerCase().replace(/[^a-z0-9]/g, "");
  const head = s.split("-")[0] ?? "";
  if (makerSlug && head.toLowerCase().replace(/[^a-z0-9]/g, "") === makerSlug && s.includes("-")) {
    s = s.slice(head.length + 1);
  }

  const words = s.split("-").filter(Boolean).map(word => {
    const lower = word.toLowerCase();

    const known = ACRONYMS.get(lower);
    if (known) return known;

    // Parameter counts: 120b, 27b, a12b. Capitalise the unit, keep the number.
    if (/^a?\d+(\.\d+)?[bm]$/i.test(word)) return word.toUpperCase();

    // A bare version number stays as it is: 3.3, 2026.
    if (/^\d/.test(word)) return word;

    return titleCase(word);
  });

  /**
   * "GPT OSS 120B" reads worse than "GPT-OSS 120B", and the hyphen is part of
   * how these families are actually written. Rejoin adjacent acronyms.
   */
  const out: string[] = [];
  for (const word of words) {
    const previous = out[out.length - 1];
    if (previous && isAcronym(previous) && isAcronym(word)) {
      out[out.length - 1] = `${previous}-${word}`;
      continue;
    }
    out.push(word);
  }

  return out.join(" ");
}

const isAcronym = (s: string): boolean => /^[A-Z]{2,}$/.test(s.split("-").pop() ?? "");

const titleCase = (s: string): string =>
  s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
