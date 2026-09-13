/**
 * What a Philippine shop sells, so its name alone says what was bought.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * "I paid 285 at jollibee using gcash" names no item, and every reader in
 * this app looks for an item word: food, gas, travel. A person does not need
 * one. Jollibee is a meal, Petron is fuel, Mercury Drug is medicine, and
 * anybody who lives here knows that without being told.
 *
 * ── Where this list came from ─────────────────────────────────────────────
 *
 * Written for this file, not copied. The public categorisation datasets that
 * permit reuse (MIT and Apache-2.0 licensed, on GitHub and Hugging Face) cover
 * the United States, the United Kingdom, Canada, Australia and India, and none
 * of them contains a single Philippine merchant. The one Philippine project
 * with keyword rules is "All rights reserved". What a brand sells is a plain
 * fact rather than anyone's work, so it is set down here directly.
 *
 * ── What it will not do ───────────────────────────────────────────────────
 *
 * Choose an item the owner does not have. Every hint below is an English word
 * that is matched against their own list and their own notes, so a hint of
 * "health" becomes Health only if they have a Health type. And it never beats
 * an item the sentence actually named: "I paid 500 for food at shell" is Food,
 * whatever Shell sells, because the owner said so.
 *
 * Ambiguous shops are left out on purpose. Watsons sells both medicine and
 * shampoo and 7-Eleven sells both lunch and load, and a confident wrong guess
 * is worse than a blank the owner fills in a second.
 */

/**
 * Brand patterns, most specific first.
 *
 * Order carries meaning: GrabFood is food and Grab is a ride, so the delivery
 * services are tested before the ride services that share their names.
 */
const MERCHANTS: readonly (readonly [RegExp, string])[] = [
  [/\b(grab\s?food|grab\s?mart|food\s?panda|pick\s?a\s?roo)\b/i, "food"],
  [
    /\b(jollibee|jolibee|mc\s?do|mcdonald'?s|kfc|chowking|mang inasal|greenwich|red ribbon|goldilocks|starbucks|dunkin|bonchon|shakey'?s|pizza hut|domino'?s|yellow cab|potato corner|army navy|tokyo tokyo|burger king|andok'?s|baliwag)\b/i,
    "food",
  ],
  [
    /\b(grab|angkas|joyride|move\s?it|lrt|mrt|beep\s?card|p2p|cebu pacific|philippine airlines|airasia)\b/i,
    "travel",
  ],
  [/\b(petron|shell|caltex|seaoil|sea oil|phoenix fuels?|cleanfuel|unioil|jetti)\b/i, "gas"],
  [
    /\b(shopee|lazada|zalora|temu|shein|tiktok shop|aliexpress|amazon|claude|anthropic|chatgpt|openai|google play|app store)\b/i,
    "online buy",
  ],
  [
    /\b(mercury drug|south\s?star drug|rose pharmacy|the generics pharmacy|generika)\b/i,
    "health",
  ],
  [
    /\b(sm supermarket|savemore|puregold|robinsons supermarket|waltermart|walter mart|alfamart|ace hardware|handyman|wilcon|mr\.? diy|citimart)\b/i,
    "home needs",
  ],
  [/\b(sm cinema|ayala cinema|cinema|timezone|arena\s?plus|steam|playstation|nintendo)\b/i, "fun"],
];

/**
 * What the shop named in a sentence sells, or empty when none was named.
 *
 * Returns an English hint, never an item name, so the caller resolves it
 * against the owner's real list exactly as it resolves an English word.
 */
export function merchantHintIn(text: string): string {
  for (const [pattern, hint] of MERCHANTS) {
    if (pattern.test(text)) return hint;
  }
  return "";
}
