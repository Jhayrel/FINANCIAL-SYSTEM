/**
 * Proving the caller is the owner.
 *
 * ── Why this is not optional ──────────────────────────────────────────────
 *
 * `/api/ai` spends someone's money. It holds provider keys and forwards
 * whatever text it is given to a rate limited account. Published on a public
 * URL with no check, it is a free LLM proxy for anyone who finds it, paid for
 * by the owner, and the first sign of that would be the AI quietly failing
 * because the quota was gone.
 *
 * Firestore is protected by security rules keyed on the uid. This gives the
 * endpoint the same protection: a Firebase ID token, verified here, and a uid
 * that has to match the owner's.
 *
 * ── Why the token is verified rather than trusted ─────────────────────────
 *
 * A JWT is three base64 segments and anyone can write one that claims any uid.
 * Reading the payload without checking the signature would be exactly as good
 * as no check at all. So the signature is verified against Google's published
 * certificates, and the issuer, audience and expiry are checked too: a valid
 * signature on a token minted for a different project is still not a token for
 * this app.
 *
 * There is no Admin SDK here. Workers have WebCrypto, which is all RS256
 * needs, given the keys in a form it accepts. See `JWK_URL` below for why the
 * form matters more than it sounds like it should.
 */

/**
 * Google's signing keys for Firebase ID tokens, as JWK.
 *
 * There is an X.509 endpoint too, and using it was a mistake worth recording:
 * WebCrypto imports keys, not certificates, so a certificate has to be taken
 * apart to find the SubjectPublicKeyInfo inside it. Doing that by scanning for
 * the RSA algorithm identifier and slicing to the end of the buffer produces
 * something that is not a valid SPKI, because the certificate's own signature
 * trails the key. Every one of Google's four certificates failed to import.
 *
 * That failure would have rejected every genuine token while still looking
 * like a working security check, which is the worst way for this to be wrong.
 * The JWK endpoint publishes the same keys in the form WebCrypto already
 * accepts, so there is no parsing to get wrong.
 */
const JWK_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

interface Jwk {
  readonly kid?: string;
  readonly alg?: string;
}

interface KeyCache {
  readonly at: number;
  readonly keys: Map<string, CryptoKey>;
}

let cache: KeyCache | null = null;
/** Google rotates daily; an hour keeps this cheap without going stale. */
const CACHE_TTL_MS = 60 * 60 * 1000;

async function signingKeys(): Promise<Map<string, CryptoKey>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.keys;

  const response = await fetch(JWK_URL);
  if (!response.ok) throw new Error("key fetch failed");

  const { keys: published } = (await response.json()) as { keys?: Jwk[] };
  const keys = new Map<string, CryptoKey>();

  for (const jwk of published ?? []) {
    if (!jwk.kid || jwk.alg !== "RS256") continue;
    keys.set(
      jwk.kid,
      await crypto.subtle.importKey(
        "jwk",
        jwk as JsonWebKey,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      ),
    );
  }

  cache = { at: Date.now(), keys };
  return keys;
}

const decode = (segment: string): Uint8Array => {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
};

const decodeJson = (segment: string): Record<string, unknown> =>
  JSON.parse(new TextDecoder().decode(decode(segment))) as Record<string, unknown>;

export interface OwnerCheck {
  readonly ok: boolean;
  /** Safe to show. Never says which part of a token failed in detail. */
  readonly reason?: string;
}

/**
 * @param token    the raw Bearer value
 * @param projectId  the Firebase project the token must have been minted for
 * @param ownerUid   the only uid allowed through, when one is configured
 */
export async function verifyOwner(
  token: string,
  projectId: string,
  ownerUid?: string,
): Promise<OwnerCheck> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "Malformed token." };

  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeJson(headerPart);
    payload = decodeJson(payloadPart);
  } catch {
    return { ok: false, reason: "Malformed token." };
  }

  if (header.alg !== "RS256") return { ok: false, reason: "Unexpected token algorithm." };

  const kid = typeof header.kid === "string" ? header.kid : "";
  const key = (await signingKeys()).get(kid);
  if (!key) return { ok: false, reason: "Token was not signed by a key Google publishes." };

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decode(signaturePart).buffer as ArrayBuffer,
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) return { ok: false, reason: "Token signature does not verify." };

  // A real signature on a token for another project is still not for us.
  if (payload.aud !== projectId) return { ok: false, reason: "Token is for a different project." };
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    return { ok: false, reason: "Token has the wrong issuer." };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    return { ok: false, reason: "Token has expired. Reload the page." };
  }

  const uid = typeof payload.sub === "string" ? payload.sub : "";
  if (!uid) return { ok: false, reason: "Token names no user." };
  if (ownerUid && uid !== ownerUid) return { ok: false, reason: "This is not your database." };

  return { ok: true };
}
