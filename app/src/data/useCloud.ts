/**
 * Cloud connection state.
 *
 * One hook so `App.tsx` asks a single question: "is there a signed-in owner,
 * and what is their uid?", instead of knowing anything about Firebase.
 *
 * With no `VITE_FIREBASE_*` variables set this reports `configured: false` and
 * never touches the network, which is what keeps the app working on a fresh
 * clone and in tests.
 */

import { useCallback, useEffect, useState } from "react";

import { isConfigured } from "./firebase";
import { signIn, signOutOwner, watchAuth, type AuthState } from "./auth";

export interface Cloud {
  /** Whether a Firebase project is wired up at all. */
  readonly configured: boolean;
  readonly auth: AuthState;
  /** Non-null only when the signed-in user is the owner. */
  readonly uid: string | null;
  readonly signIn: () => Promise<void>;
  readonly signOut: () => Promise<void>;
}

export function useCloud(): Cloud {
  const configured = isConfigured();
  const [auth, setAuth] = useState<AuthState>(
    configured ? { status: "loading" } : { status: "signed-out" },
  );

  useEffect(() => {
    if (!configured) return;
    return watchAuth(setAuth);
  }, [configured]);

  const doSignIn = useCallback(async () => {
    try {
      await signIn();
    } catch (e) {
      // A closed popup is a normal outcome, not an error worth surfacing.
      const code = (e as { code?: string }).code ?? "";
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        throw e;
      }
    }
  }, []);

  return {
    configured,
    auth,
    uid: auth.status === "ready" ? auth.uid : null,
    signIn: doSignIn,
    signOut: signOutOwner,
  };
}
