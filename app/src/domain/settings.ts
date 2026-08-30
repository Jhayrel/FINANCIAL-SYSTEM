/**
 * Settings: everything the user can configure.
 *
 * All of it is persisted. See docs/05-ACCOUNTS-AND-GOALS.md §3.
 *
 * ── The one thing that is NOT here ────────────────────────────────────────
 * There is no API key field, and there must never be one. A browser app that
 * reads its key from the database has to send that key to the browser, where
 * it lands in devtools, the network tab, and every database export, strictly
 * worse than the spreadsheet cell that already leaked three keys. The key
 * lives in a Cloudflare environment secret; everything else about the AI is
 * configured here. Rule AI4.
 */

import type { Account } from "./accounts";
import type { Debt } from "./debt";
import type { Centavos } from "./money";
import type { SpendingType } from "./types";

export type AiProvider = "groq" | "openrouter" | "openai" | "anthropic";

export const AI_PROVIDER_LABEL: Record<AiProvider, string> = {
  groq: "Groq",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

/** Sensible defaults per provider, so the model box is never a blank guess. */
export const AI_DEFAULT_MODEL: Record<AiProvider, string> = {
  groq: "llama-3.3-70b-versatile",
  openrouter: "openai/gpt-4o-mini",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
};

export type AiTone = "brief" | "plain" | "detailed";

export const AI_TONE_HINT: Record<AiTone, string> = {
  brief: "One line, numbers first",
  plain: "A short paragraph in plain language",
  detailed: "Fuller explanation with the reasoning",
};

export interface AiSettings {
  readonly enabled: boolean;
  readonly provider: AiProvider;
  readonly model: string;
  readonly tone: AiTone;
  /** Which surfaces are allowed to call the model. */
  readonly features: {
    readonly alerts: boolean;
    readonly insightSummary: boolean;
    readonly descriptions: boolean;
  };
}

export const DEFAULT_AI: AiSettings = {
  enabled: false,
  provider: "groq",
  model: AI_DEFAULT_MODEL.groq,
  tone: "brief",
  features: { alerts: true, insightSummary: true, descriptions: false },
};

export type ThemePreference = "light" | "dark" | "system";

export interface AppSettings {
  readonly accounts: readonly Account[];
  readonly bills: readonly string[];
  readonly subscriptions: readonly string[];
  readonly revenueCategories: readonly string[];
  readonly spendingTypes: readonly SpendingType[];
  /**
   * Credit lines and loans out. Each names the bank or wallet the money moves
   * through, so a Debt transaction can be attributed without guessing.
   */
  readonly credits: readonly Debt[];
  readonly ai: AiSettings;
  readonly theme: ThemePreference;
  /** Warn when a spending wallet drops below this. */
  readonly lowBalanceThreshold: Centavos;
  /** Bumped whenever the shape changes, so a stored blob can be upgraded. */
  readonly version: number;
}

export const SETTINGS_VERSION = 2;

export function defaultSettings(): AppSettings {
  return {
    accounts: [],
    bills: [],
    subscriptions: [],
    revenueCategories: [],
    spendingTypes: [],
    credits: [],
    ai: DEFAULT_AI,
    theme: "system",
    lowBalanceThreshold: 50000,
    version: SETTINGS_VERSION,
  };
}

/**
 * Coerce whatever came back from storage into a valid settings object.
 *
 * Anything persisted can be older than the code reading it, or hand-edited in
 * the Firestore console. Merging against the defaults means a missing field is
 * a default rather than a crash on the next render.
 */
export function normaliseSettings(raw: unknown): AppSettings {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object") return base;

  const input = raw as Partial<AppSettings> & { ai?: Partial<AiSettings> };

  const provider: AiProvider =
    input.ai?.provider && input.ai.provider in AI_DEFAULT_MODEL ? input.ai.provider : base.ai.provider;

  return {
    accounts: Array.isArray(input.accounts) ? input.accounts : base.accounts,
    bills: Array.isArray(input.bills) ? input.bills : base.bills,
    subscriptions: Array.isArray(input.subscriptions) ? input.subscriptions : base.subscriptions,
    revenueCategories: Array.isArray(input.revenueCategories)
      ? input.revenueCategories
      : base.revenueCategories,
    spendingTypes: Array.isArray(input.spendingTypes) ? input.spendingTypes : base.spendingTypes,
    credits: Array.isArray(input.credits) ? input.credits : base.credits,
    ai: {
      enabled: input.ai?.enabled ?? base.ai.enabled,
      provider,
      model: input.ai?.model?.trim() || AI_DEFAULT_MODEL[provider],
      tone: input.ai?.tone ?? base.ai.tone,
      features: {
        alerts: input.ai?.features?.alerts ?? base.ai.features.alerts,
        insightSummary: input.ai?.features?.insightSummary ?? base.ai.features.insightSummary,
        descriptions: input.ai?.features?.descriptions ?? base.ai.features.descriptions,
      },
    },
    theme: input.theme ?? base.theme,
    lowBalanceThreshold:
      typeof input.lowBalanceThreshold === "number" && Number.isInteger(input.lowBalanceThreshold)
        ? input.lowBalanceThreshold
        : base.lowBalanceThreshold,
    version: SETTINGS_VERSION,
  };
}

/**
 * Guard against a key ever reaching storage.
 *
 * Belt and braces: even if a future change adds a field that happens to hold
 * one, this catches it before it is written. Provider key formats are
 * recognisable, which is exactly why leaked ones get scraped so fast.
 */
const KEY_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/, // OpenAI, OpenRouter
  /\bgsk_[A-Za-z0-9]{16,}/, // Groq
  /\bsk-ant-[A-Za-z0-9_-]{16,}/, // Anthropic
];

export function containsSecret(value: unknown): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return KEY_PATTERNS.some((p) => p.test(text));
}

/** Throws rather than persisting anything that looks like a credential. */
export function assertNoSecrets(settings: AppSettings): void {
  if (containsSecret(settings)) {
    throw new Error(
      "Refusing to save: this looks like an API key. Keys belong in a Cloudflare environment secret, never in the database.",
    );
  }
}
