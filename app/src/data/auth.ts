/**
 * Authentication.
 *
 * One user, but real auth: the security rules key off the uid, so without a
 * sign-in the database is unreachable, which is the point.
 *
 * `VITE_OWNER_UID` is checked here as well as in the rules. The rules are the
 * only thing that actually protects the data; this check exists so that a
 * wrong account gets a clear "this is not your database" instead of a wall of
 * permission-denied errors from every read.
 */

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";

import { authClient, ownerUid } from "./firebase";

export type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  /** Signed in as someone who is not the owner. Data stays out of reach. */
  | { status: "wrong-account"; email: string; uid: string }
  | { status: "ready"; uid: string; email: string; name: string };

export function watchAuth(onChange: (state: AuthState) => void): () => void {
  return onAuthStateChanged(authClient(), (user: User | null) => {
    if (!user) {
      onChange({ status: "signed-out" });
      return;
    }

    const owner = ownerUid();
    if (owner && user.uid !== owner) {
      onChange({ status: "wrong-account", email: user.email ?? "", uid: user.uid });
      return;
    }

    onChange({
      status: "ready",
      uid: user.uid,
      email: user.email ?? "",
      name: user.displayName ?? user.email ?? "You",
    });
  });
}

export async function signIn(): Promise<void> {
  const provider = new GoogleAuthProvider();
  // Always show the chooser. Silently reusing a session is how you end up
  // signed in as the wrong Google account and unable to tell why.
  provider.setCustomParameters({ prompt: "select_account" });
  await signInWithPopup(authClient(), provider);
}

export async function signOutOwner(): Promise<void> {
  await signOut(authClient());
}

/**
 * A short-lived token proving who is calling, for the AI endpoint.
 *
 * The endpoint spends the owner's provider quota, so it verifies this rather
 * than taking the caller's word. Firebase refreshes the token on its own; this
 * only reads the current one.
 *
 * Null when signed out, or when Firebase is not configured at all, which is
 * the case in local development. Callers treat that as "no model available"
 * and fall back, rather than as an error.
 */
export async function idToken(): Promise<string | null> {
  try {
    return (await authClient().currentUser?.getIdToken()) ?? null;
  } catch {
    return null;
  }
}
