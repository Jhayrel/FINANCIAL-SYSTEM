/**
 * How strong a model is, read from its id, so the chain can ask the
 * strongest first.
 *
 * 30 September 2026, the owner: "I want the most powerful ai. Like if the
 * other powerful is not available means use the other most powerful. All
 * low end ai and not smart ai make them last option."
 *
 * The chain used to be ordered by provider (Gemini's two, then Groq and
 * OpenRouter taking turns), so a small model on one could be asked before a
 * far stronger one on another. Now every model from every provider gets one
 * score and the chain is sorted by it.
 *
 * The scores are a rough standing from public benchmarks, on one scale, and
 * are used for order only: nothing is shown or decided from the number
 * itself. A family is scored by its version, so a newer one Google or
 * anyone else releases ranks above the last without a change here. A
 * family not listed is scored from its size in the id ("70b", "235b-a22b")
 * and its marks ("lite", "mini", "instant"), so an id this file has never
 * seen still lands in a sensible place: the chain is discovered at runtime
 * and will meet those.
 */

const clamp = (n: number): number => Math.max(1, Math.min(99, Math.round(n * 10) / 10));

/**
 * The size in billions of parameters the id gives, or null.
 *
 * "235b-a22b" is 235: the "a22b" is the share of a mixture that works on
 * each word, not its size. "8x7b" is 56, "1t" 1,000.
 */
export function sizeOf(id: string): number | null {
  let largest: number | null = null;
  for (const m of id.matchAll(/(?:^|[-_/.:])(?:(\d+)x)?(\d+(?:\.\d+)?)([bt])(?=$|[-_/.:])/gi)) {
    const unit = (m[3] ?? "").toLowerCase() === "t" ? 1_000 : 1;
    const n = Number(m[2]) * (m[1] ? Number(m[1]) : 1) * unit;
    if (largest === null || n > largest) largest = n;
  }
  return largest;
}

/** What a model of this size is, when nothing else is known about it. */
function bySize(size: number | null): number {
  if (size === null) return 30;
  if (size >= 400) return 50;
  if (size >= 200) return 48;
  if (size >= 100) return 44;
  if (size >= 60) return 36;
  if (size >= 25) return 32;
  if (size >= 12) return 24;
  if (size >= 6) return 16;
  return 10;
}

/** A small model says so in its name. Not "minimax", which is a maker. */
const LOW = /(?:^|[-_/.])(?:lite|mini|nano|tiny|micro|instant)(?=$|[-_/.:])/;

/** The first number a pattern captures, or null. */
const num = (re: RegExp, s: string): number | null => {
  const m = re.exec(s);
  return m?.[1] ? Number(m[1]) : null;
};

/**
 * However good a family is, a small model of it is still small. Gemini's
 * ids carry no size, so they are never held to this.
 */
function capBySize(score: number, size: number | null): number {
  if (size === null) return score;
  if (size < 6) return Math.min(score, 16);
  if (size < 12) return Math.min(score, 25);
  if (size < 20) return Math.min(score, 38);
  if (size < 40) return Math.min(score, 52);
  return score;
}

function family(s: string, size: number | null): number | null {
  // Google's Gemini, by kind and version. An alias with no version is one
  // of the others under a second name, so it ranks just below its kind.
  const gemini = /gemini-(?:(\d+(?:\.\d+)?)-)?(pro|flash)(-lite)?/.exec(s);
  if (gemini) {
    const v = gemini[1] ? Number(gemini[1]) : null;
    const at = (base: number, slope: number): number => (v === null ? base - 1 : base + slope * (v - 2.5));
    if (gemini[3]) return at(40, 20);
    return gemini[2] === "pro" ? at(62, 22) : at(55, 24);
  }

  // The closed frontier, on the rare day one is offered free.
  if (/claude|gpt-[5-9]|grok-[4-9]/.test(s)) return LOW.test(s) ? 55 : 70;

  if (/gpt-oss/.test(s)) return (size ?? 0) >= 100 ? 58 : 46;

  if (/deepseek/.test(s)) {
    const v = num(/v(\d+(?:\.\d+)?)/, s);
    const r = num(/(?:^|[-_/])r(\d+)/, s);
    const base = v !== null ? 50 + 15 * (v - 3) : r !== null ? 42 + 10 * r : 50;
    return base - (/flash/.test(s) ? 6 : 0);
  }

  const kimi = num(/kimi-k(\d+(?:\.\d+)?)/, s);
  if (kimi !== null) return 55 + 8 * (kimi - 2) + (/thinking/.test(s) ? 8 : 0);
  if (/kimi/.test(s)) return 50;

  const minimax = num(/minimax-m(\d+(?:\.\d+)?)/, s);
  if (minimax !== null) return 61 + 6 * (minimax - 2);

  const glm = num(/glm-(\d+(?:\.\d+)?)/, s);
  if (glm !== null) return 53 + 12 * (glm - 4.5) - (/air/.test(s) ? 7 : 0) - (/flash/.test(s) ? 15 : 0);

  const qwen = num(/qwen(\d+(?:\.\d+)?)/, s);
  if (qwen !== null || /qwq/.test(s)) {
    const known = /max|plus/.test(s) && size === null ? 400 : size;
    const active = num(/-a(\d+(?:\.\d+)?)b(?=$|[-_/.:])/, s);
    return bySize(known) + 10 + 10 * ((qwen ?? 3) - 3) - (active !== null && active < 5 ? 6 : 0);
  }

  const llama = num(/llama-?(\d(?:\.\d+)?)(?=$|[-_/.:])/, s);
  if (llama !== null) {
    if (llama >= 4) return /maverick/.test(s) ? 38 : /scout/.test(s) ? 30 : 34;
    return Math.min(bySize(size) - 6, 30);
  }

  const gemma = num(/gemma-?(\d+)/, s);
  if (gemma !== null) return 22 + 13 * (gemma - 3) - (/\d+n(?=$|[-_/.:])/.test(s) ? 10 : 0);

  if (/nemotron/.test(s)) {
    const v = num(/nemotron-(\d+)/, s) ?? 1;
    const kind = /ultra/.test(s) ? 50 : /super/.test(s) ? 48 : /nano/.test(s) ? 30 : null;
    return kind === null ? null : kind + 3 * (v - 1);
  }

  if (/mistral|magistral|devstral|codestral|ministral|pixtral/.test(s)) {
    if (/ministral/.test(s)) return 15;
    if (/medium/.test(s)) return /magistral/.test(s) ? 42 : 40;
    if (/large/.test(s)) return 38;
    if (/small/.test(s)) return 28;
    return bySize(size) - 2;
  }

  if (/compound/.test(s)) return /mini/.test(s) ? 35 : 45;
  if (/allam/.test(s)) return 10;
  // OpenRouter's own router picks any free model it likes.
  if (s === "openrouter/free") return 30;
  return null;
}

/**
 * The strength of one model, 1 to 99. Higher is asked first.
 */
export function strength(raw: string): number {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/^models\//, "")
    .replace(/^@(?:cf|hf)\//, "")
    .replace(/:(?:free|nitro)$/, "");
  const size = sizeOf(s);

  // A distilled model is the small one it was distilled into, whatever the name says.
  if (/distill/.test(s)) return clamp(bySize(size) - 4);

  const known = family(s, size);
  if (known !== null) {
    const thinking = /thinking|reason/.test(s) && !/kimi/.test(s) ? 3 : 0;
    return clamp(capBySize(known + thinking, /gemini/.test(s) ? null : size));
  }
  const guessed = bySize(size);
  return clamp(LOW.test(s) ? Math.min(guessed, 22) : guessed);
}
