/**
 * A number that is part of a thing's name, not its price: "iphone 18 pro
 * max", "galaxy s24", "ps5", "128gb", "rtx 4060".
 *
 * The owner, 27 October 2026: "I plan to buy iphone 18 pro max next January
 * let me know" became a PHP 18.00 plan titled "Iphone pro max let me know":
 * the model number was read as the price, and taken out of the name. A
 * figure marked as money (PHP, a peso sign, "pesos", "5k") is never one of
 * these.
 */

const BRANDS = [
  "iphone", "ipad", "ipod", "airpods", "macbook", "imac", "galaxy", "pixel", "redmi", "poco", "realme", "oppo", "vivo",
  "xiaomi", "huawei", "honor", "infinix", "tecno", "nokia", "playstation", "xbox", "nintendo", "kindle", "surface",
  "thinkpad", "ideapad", "legion", "zenbook", "vivobook", "aspire", "nitro", "predator", "pavilion", "omen",
  "xps", "inspiron", "ryzen", "series", "gen",
].join("|");
const EDITIONS = "pro|max|plus|ultra|mini|air|se|fe|lite|edge|neo";
/** After a number with no brand, only the words that are never "at most" or "and": "18 pro max", never "500 max" or "500 plus 50". */
const EDITION_LEAD = "pro|ultra|mini|air|lite|edge|neo";

/*
 * A brand and its number, with the edition words after it: "iphone 18 pro
 * max", "galaxy s24 ultra". Two digits at most, so "vivo 2000" is still a
 * price; a graphics card's four only after its own name ("rtx 4060").
 */
const NAMED = new RegExp(String.raw`\b(?:(?:${BRANDS})\s?-?[a-z]?\d{1,2}[a-z]?|(?:rtx|gtx|rx)\s?\d{3,4}(?:\s?ti)?)(?:\s+(?:${EDITIONS}))*\b`, "gi");
/** Letters and digits run together: "s24", "ps5", "a54", "m3", never "php500" or "p500". */
const GLUED = /\b(?!(?:php|p)\d)[a-z]{1,4}\d{1,4}[a-z]{0,3}\b/gi;
/** A size or a spec: "128gb", "6.7 inch", "5000mah", "120hz". Never "in" alone: "50 in cash" is money. */
const SPEC = /\b\d{1,5}(?:\.\d)?\s*(?:gb|tb|mb|mah|hz|mp|inch(?:es)?|watts?)\b/gi;
/** A number with an edition after it: "18 pro max", "15 pro". */
const EDITIONED = new RegExp(String.raw`\b\d{1,2}\s+(?:${EDITION_LEAD})(?:\s+(?:${EDITIONS}))*\b`, "gi");

const PATTERNS = [NAMED, GLUED, SPEC, EDITIONED];

/** The text with every model number taken out, for reading a price from what is left. */
export function withoutModelNumbers(text: string): string {
  return PATTERNS.reduce((t, re) => t.replace(re, " "), text);
}

/**
 * Model numbers set aside while a name is cleaned of prices and dates, then
 * put back: `protect` swaps each for a placeholder with no digit in it, and
 * `restore` brings them back in the owner's words, the brand cased as it is
 * written ("iPhone 18 Pro Max").
 */
export function protectModels(text: string): { readonly text: string; readonly restore: (cleaned: string) => string } {
  const kept: string[] = [];
  let out = text;
  for (const re of PATTERNS) {
    out = out.replace(re, (m) => {
      kept.push(m.trim());
      return ` qqmodel${String.fromCharCode(97 + ((kept.length - 1) % 26))}qq `;
    });
  }
  return {
    text: out,
    restore: (cleaned) => cleaned.replace(/qqmodel([a-z])qq/g, (_, c: string) => cased(kept[c.charCodeAt(0) - 97] ?? "")),
  };
}

const CASED: Readonly<Record<string, string>> = {
  iphone: "iPhone", ipad: "iPad", ipod: "iPod", airpods: "AirPods", macbook: "MacBook", imac: "iMac", ps: "PS", xbox: "Xbox",
  rtx: "RTX", gtx: "GTX", rog: "ROG", tuf: "TUF", xps: "XPS", se: "SE", fe: "FE",
};

/** "iphone 18 pro max" as "iPhone 18 Pro Max", "s24" as "S24", "128gb" as "128GB". */
function cased(model: string): string {
  return model
    .split(/\s+/)
    .map((w) => {
      const lower = w.toLowerCase();
      if (CASED[lower]) return CASED[lower]!;
      if (/^[a-z]{1,4}\d/i.test(w)) return w.toUpperCase();
      if (/^\d/.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}
