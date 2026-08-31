/**
 * Take credentials out of text before it leaves the device.
 *
 * ── Why this exists when nothing is supposed to hold a key ────────────────
 *
 * Nothing in this app stores a provider key: the rules refuse a secret-shaped
 * value, and the only key lives in a Cloudflare environment variable. That
 * covers the data. It does not cover a person pasting a key into the chat box
 * to ask what it is, or a key ending up in a description years ago.
 *
 * So this runs on every string on its way to the endpoint. It is the last
 * guard rather than the only one, and it is cheap enough to always be on.
 *
 * ── Why the patterns are duplicated from settings.ts ──────────────────────
 *
 * `settings.ts` asks whether a document contains a secret, and refuses to
 * save when it does. This replaces one inside a longer sentence and hands
 * back the rest. Same shapes, different verbs, and merging them would give
 * one function that does neither cleanly.
 */

/** What a redacted value is replaced with. Visible on purpose. */
export const REDACTED = "[redacted]";

/**
 * Provider key shapes, longest prefix first.
 *
 * `sk-ant-` before `sk-`, because the shorter pattern would match the whole
 * Anthropic key anyway and the order only affects which comment explains it.
 * All are global: a message can carry more than one.
 */
const KEY_PATTERNS: readonly RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g, // Anthropic
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI, OpenRouter
  /\bgsk_[A-Za-z0-9]{16,}/g, // Groq
];

/** The text with any key-shaped run replaced. */
export function redact(text: string): string {
  let out = text;
  for (const pattern of KEY_PATTERNS) {
    // `lastIndex` is state on a global regex, and a shared one would skip
    // matches on every second call. Rebuilt per use rather than reset.
    out = out.replace(new RegExp(pattern.source, "g"), REDACTED);
  }
  return out;
}

/** True when `redact` would change something. For telling the owner it did. */
export function hasSecret(text: string): boolean {
  return KEY_PATTERNS.some((p) => new RegExp(p.source).test(text));
}
