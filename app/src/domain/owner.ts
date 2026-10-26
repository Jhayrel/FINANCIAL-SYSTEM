/**
 * The owner's own details: who the ledger belongs to.
 *
 * The owner, 27 October 2026: "IN DATA lets add a section to add owners
 * information address gmail use etc change gmail etc / also make sure it sync
 * to the whole system and even ai knows me". Kept in the settings document as
 * its own section (`owner`), so it syncs between devices and goes into a
 * backup like the rest of Settings.
 *
 * Where each part is used:
 *
 * - **name**: "Issued to" on a statement and the activity trail PDF, and the
 *   chat's list of the owner's own names (money sent to yourself).
 * - **callMe**: what the assistant calls them; the name when empty.
 * - **about**: a few words the assistant reads with every question.
 * - **email, phone, address**: only theirs to read in Settings, unless
 *   `shareContact` is on; then the assistant is given them too. Off by
 *   default, because each question goes to an outside AI provider.
 *
 * The Google account they sign in with is not here and cannot be changed
 * here: the database is locked to that one account (`firestore.rules`,
 * `isOwner`). Settings shows it, read only, and says so.
 */

export interface OwnerDetails {
  readonly name: string;
  readonly callMe: string;
  readonly email: string;
  readonly phone: string;
  readonly address: string;
  readonly about: string;
  /** The assistant may be given the e-mail, phone and address. */
  readonly shareContact: boolean;
}

export const NO_OWNER: OwnerDetails = { name: "", callMe: "", email: "", phone: "", address: "", about: "", shareContact: false };

/** How long each part may be, so a pasted page never fills the settings document. */
export const OWNER_LIMITS = { name: 80, callMe: 40, email: 120, phone: 40, address: 240, about: 400 } as const;

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Whatever storage holds, as details: a missing or broken part is empty, never a crash. */
export function normaliseOwner(raw: unknown): OwnerDetails {
  if (!raw || typeof raw !== "object") return NO_OWNER;
  const o = raw as Partial<Record<keyof OwnerDetails, unknown>>;
  return {
    name: text(o.name, OWNER_LIMITS.name),
    callMe: text(o.callMe, OWNER_LIMITS.callMe),
    email: text(o.email, OWNER_LIMITS.email),
    phone: text(o.phone, OWNER_LIMITS.phone),
    address: text(o.address, OWNER_LIMITS.address),
    about: text(o.about, OWNER_LIMITS.about),
    shareContact: o.shareContact === true,
  };
}

export const isBlankOwner = (o: OwnerDetails): boolean => !o.name && !o.callMe && !o.email && !o.phone && !o.address && !o.about;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** What is wrong with each part, in words for under its field. Empty parts are fine: every one is optional. */
export function checkOwner(o: OwnerDetails): Partial<Record<keyof OwnerDetails, string>> {
  const out: Partial<Record<keyof OwnerDetails, string>> = {};
  if (o.email && !EMAIL.test(o.email)) out.email = "That is not an e-mail address. It looks like name@gmail.com.";
  if (o.phone) {
    const digits = o.phone.replace(/\D/g, "").length;
    if (!/^[+\d\s().-]+$/.test(o.phone)) out.phone = "Use digits only, with + ( ) - or spaces if you like.";
    else if (digits < 7 || digits > 15) out.phone = "A phone number has 7 to 15 digits, like 0917 123 4567.";
  }
  return out;
}

/**
 * The name on a statement or the activity PDF: the one they gave, else the
 * Google account's name. An e-mail address is not a name and is never used.
 */
export function ownerName(o: OwnerDetails | undefined, accountName = ""): string {
  const given = o?.name.trim() ?? "";
  if (given) return given;
  const fallback = accountName.trim();
  return fallback && !fallback.includes("@") ? fallback : "";
}

/** What the assistant calls them. */
export function callName(o: OwnerDetails | undefined, accountName = ""): string {
  const call = o?.callMe.trim() ?? "";
  if (call) return call;
  const full = ownerName(o, accountName);
  return full.split(" ")[0] ?? "";
}

/** Which parts changed, in words, for the activity trail. Never the values: the trail only says what was touched. */
export function ownerChanges(before: OwnerDetails, after: OwnerDetails): string[] {
  const NAMES: Record<keyof OwnerDetails, string> = {
    name: "name",
    callMe: "what to call you",
    email: "contact e-mail",
    phone: "phone",
    address: "address",
    about: "about you",
    shareContact: after.shareContact ? "the assistant may see your contact details" : "the assistant no longer sees your contact details",
  };
  return (Object.keys(NAMES) as (keyof OwnerDetails)[]).filter((k) => before[k] !== after[k]).map((k) => NAMES[k]);
}

/**
 * The lines the assistant is given about the owner, ahead of the figures.
 * Contact details only when they allowed it.
 */
export function ownerLines(o: OwnerDetails | undefined, accountName = ""): string[] {
  const name = ownerName(o, accountName);
  const call = callName(o, accountName);
  const lines: string[] = [];
  if (name) lines.push(`The owner is ${name}${call && call !== name ? `; call them ${call}` : ""}.`);
  else if (call) lines.push(`Call the owner ${call}.`);
  if (o?.about) lines.push(`What they said about themselves: ${o.about}`);
  if (o?.shareContact) {
    const contact = [o.email ? `e-mail ${o.email}` : "", o.phone ? `phone ${o.phone}` : "", o.address ? `address ${o.address}` : ""].filter(Boolean);
    if (contact.length > 0) lines.push(`Their contact details, which they allowed you to see: ${contact.join("; ")}.`);
  }
  return lines;
}

// ── From the chat ────────────────────────────────────────────────────────

/** The parts the chat can change. "About you" is written in Settings, where there is room for it. */
export type OwnerField = "name" | "callMe" | "email" | "phone" | "address";

export type OwnerAsk =
  | { readonly kind: "show"; readonly field: OwnerField | "about" | "all" }
  | { readonly kind: "set"; readonly field: OwnerField; readonly value: string };

export const OWNER_FIELD_LABEL: Record<OwnerField | "about", string> = {
  name: "Your name",
  callMe: "What to call you",
  email: "Contact e-mail",
  phone: "Phone",
  address: "Address",
  about: "About you",
};

function fieldOf(words: string): OwnerField | "about" | null {
  const w = words.trim().toLowerCase();
  if (/^(?:full\s+)?name$/.test(w)) return "name";
  if (/^nick\s?name$/.test(w)) return "callMe";
  if (/^(?:contact\s+)?(?:e-?mail|gmail)(?:\s+address)?$/.test(w)) return "email";
  if (/^(?:phone|mobile|cellphone|cell|contact)(?:\s+number)?$|^number$|^cp$/.test(w)) return "phone";
  if (/^(?:home\s+)?address$/.test(w)) return "address";
  if (/^(?:about|bio|profile)$/.test(w)) return "about";
  return null;
}

/** A value that fits the part it is for, or null: "my phone is broken" is not a phone number. */
function fits(field: OwnerField, value: string): string | null {
  const v = value.trim().replace(/^["']|["']$/g, "").replace(/[.!]+$/, "").trim();
  if (!v) return null;
  const words = v.split(/\s+/).length;
  switch (field) {
    case "email":
      return EMAIL.test(v) ? v : null;
    case "phone":
      return checkOwner({ ...NO_OWNER, phone: v }).phone ? null : v;
    case "name":
      return words <= 6 && !/\d/.test(v) && v.length <= OWNER_LIMITS.name ? v : null;
    case "callMe":
      return words <= 3 && !/\d/.test(v) && v.length <= OWNER_LIMITS.callMe ? v : null;
    case "address":
      return words >= 2 && v.length <= OWNER_LIMITS.address ? v : null;
  }
}

/**
 * "Who am I", "what's my email", "my email is jay@gmail.com", "call me Jay",
 * "change my address to 12 Rizal St, Bangued". Null for anything else,
 * which leaves "my phone is broken" and "my name is on the receipt" alone.
 */
export function readOwnerAsk(text: string): OwnerAsk | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length > 200) return null;
  if (/^(?:who am i|what do you know about me|what do you know of me|do you know (?:me|who i am)|tell me about (?:me|myself)|(?:show )?my (?:details|info(?:rmation)?|profile)|ano(?:ng)? alam mo (?:tungkol )?sa akin)\s*\??$/i.test(t)) {
    return { kind: "show", field: "all" };
  }
  const asked = /^(?:what(?:'s| is| are)|do you know|ano(?:ng)?(?: ang)?)\s+my\s+([a-z -]+?)\s*\??$/i.exec(t);
  if (asked) {
    const field = fieldOf(asked[1] ?? "");
    if (field) return { kind: "show", field };
  }
  const call = /^(?:please\s+|pls\s+)?(?:just\s+)?call me\s+(.+)$/i.exec(t);
  if (call) {
    const value = fits("callMe", call[1] ?? "");
    return value ? { kind: "set", field: "callMe", value } : null;
  }
  const set = /^(?:please\s+|pls\s+)?(?:change|update|set|edit|make)\s+my\s+([a-z -]+?)\s+(?:to|as|into)\s+(.+)$/i.exec(t) ?? /^my\s+([a-z -]+?)\s+is\s+(?:now\s+)?(.+)$/i.exec(t);
  if (set) {
    const field = fieldOf(set[1] ?? "");
    if (!field || field === "about") return null;
    const value = fits(field, set[2] ?? "");
    return value ? { kind: "set", field, value } : null;
  }
  return null;
}

/** The answer to a "show": what is saved, and where it came from. */
export function ownerAnswer(o: OwnerDetails | undefined, field: OwnerField | "about" | "all", accountName = ""): string {
  const d = o ?? NO_OWNER;
  if (field === "all") {
    const lines = [
      d.name ? `- Name: ${d.name}` : "",
      d.callMe ? `- I call you: ${d.callMe}` : "",
      d.email ? `- Contact e-mail: ${d.email}` : "",
      d.phone ? `- Phone: ${d.phone}` : "",
      d.address ? `- Address: ${d.address}` : "",
      d.about ? `- About you: ${d.about}` : "",
    ].filter(Boolean);
    if (lines.length === 0) {
      const who = ownerName(d, accountName);
      return `${who ? `You are ${who}, going by your Google account. ` : ""}Nothing else is saved about you yet. Tell me, like "my name is Juan Dela Cruz" or "call me Jay", or fill in You in Settings, Data.`;
    }
    return [
      "What your details say, from Settings, Data, You:",
      ...lines,
      d.shareContact ? "The AI model is given all of it with your questions." : "The AI model is given your name and what you wrote about yourself; your e-mail, phone and address stay on this app unless you turn that on in Settings, Data, You.",
    ].join("\n");
  }
  const value = field === "about" ? d.about : d[field];
  const label = OWNER_FIELD_LABEL[field].replace(/^Your /, "").toLowerCase();
  if (value) return field === "callMe" ? `I call you ${value}.` : `Your ${label} is ${value}.`;
  const example: Record<OwnerField | "about", string> = {
    name: '"my name is Juan Dela Cruz"',
    callMe: '"call me Jay"',
    email: '"my email is name@gmail.com"',
    phone: '"my phone is 0917 123 4567"',
    address: '"my address is 12 Rizal Street, Bangued"',
    about: "a few words in Settings, Data, You",
  };
  return `No ${label} is saved yet. Tell me, like ${example[field]}, or fill it in under You in Settings, Data.`;
}
