/**
 * Sign-in gate.
 *
 * Shown only when a Firebase project is configured. One account can reach this
 * data: the security rules pin it to a single uid, so this screen says who,
 * rather than pretending to be a general login.
 */

import { useState } from "react";

import { Alert, Button, Card } from "../components/primitives";
import type { AuthState } from "../data/auth";

export function SignIn({
  auth,
  onSignIn,
  onSignOut,
}: {
  auth: AuthState;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onSignIn();
    } catch (e) {
      setError(
        (e as Error).message ||
          "Sign-in did not complete. Check that Google is enabled under Authentication → Sign-in method.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fms-gate">
      <Card>
        <div style={{ display: "grid", gap: "var(--space-4)", maxWidth: 380 }}>
          <div>
            <h1 className="t-display-l" style={{ margin: 0 }}>Finances</h1>
            <p className="t-body" style={{ margin: "var(--space-2) 0 0", color: "var(--ink-2)" }}>
              Your ledger is in Firebase. Sign in with the Google account that owns it.
            </p>
          </div>

          {auth.status === "wrong-account" && (
            <Alert status="warn" title="That is not this database">
              You are signed in as {auth.email || auth.uid}, which is not the owner account. Sign out
              and use the one recorded in the security rules.
            </Alert>
          )}

          {error && <Alert status="over" title="Could not sign in">{error}</Alert>}

          {auth.status === "wrong-account" ? (
            <Button variant="primary" onClick={() => void onSignOut()}>Sign out</Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={busy || auth.status === "loading"}
              onClick={() => void go()}
            >
              Continue with Google
            </Button>
          )}

          <p className="t-caption" style={{ margin: 0, color: "var(--ink-3)" }}>
            Nothing is readable without this. The rules allow exactly one account and deny every
            other request, signed in or not.
          </p>
        </div>
      </Card>
    </div>
  );
}
