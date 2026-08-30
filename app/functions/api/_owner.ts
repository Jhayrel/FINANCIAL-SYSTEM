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
 * needs.
 */

/** Google's signing certificates for Firebase ID tokens. Rotated regularly. */
const CERT_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

interface CertCache {
  readonly at: number;
  readonly keys: Record<string, string>;
}

let certs: CertCache | null = null;
/** Google rotates daily; an hour keeps this cheap without going stale. */
const CERT_TTL_MS = 60 * 60 * 1000;

async function signingCerts(): Promise<Record<string, string>> {
  if (certs && Date.now() - certs.at < CERT_TTL_MS) return certs.keys;

  const response = await fetch(CERT_URL);
  if (!response.ok) throw new Error("cert fetch failed");

  const keys = (await response.json()) as Record<string, string>;
  certs = { at: Date.now(), keys };
  return keys;
}

const decode = (segment: string): Uint8Array => {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
};

const decodeJson = (segment: string): Record<string, unknown> =>
  JSON.parse(new TextDecoder().decode(decode(segment))) as Record<string, unknown>;

/** Turn a PEM certificate into the public key inside it. */
async function publicKeyOf(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");

  const der = Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0));

  /**
   * WebCrypto imports keys, not certificates, so the SubjectPublicKeyInfo has
   * to be located inside the X.509 structure. Rather than write an ASN.1
   * parser, this finds the RSA algorithm identifier, which is the sequence
   * immediately preceding the key in every certificate of this kind.
   */
  const marker = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];
  let start = -1;
  for (let i = 0; i + marker.length <= der.length; i++) {
    if (marker.every((byte, j) => der[i + j] === byte)) {
      start = i;
      break;
    }
  }
  if (start === -1) throw new Error("no public key in certificate");

  // Step back over the SEQUENCE header that wraps algorithm and key together.
  let spkiStart = start - 4;
  if (der[spkiStart] !== 0x30) spkiStart = start - 3;
  if (der[spkiStart] !== 0x30) throw new Error("unexpected certificate layout");

  return crypto.subtle.importKey(
    "spki",
    der.slice(spkiStart).buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

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
  const pem = (await signingCerts())[kid];
  if (!pem) return { ok: false, reason: "Token was not signed by a key Google publishes." };

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    await publicKeyOf(pem),
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
