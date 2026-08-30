/**
 * Sign-in gate.
 *
 * Shown only when a Firebase project is configured. One account can reach this
 * data: the security rules pin it to a single uid, so this screen says who,
 * rather than pretending to be a general login.
 */

import { useEffect, useState } from "react";

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

  /**
   * Restoring a session is not the same as having no session.
   *
   * Firebase takes a moment to say whether someone is already signed in, and
   * that moment used to render the whole sign-in card, so refreshing while
   * perfectly signed in flashed "Sign in with the Google account that owns it"
   * every single time, which reads as being logged out.
   *
   * ── Why this waits rather than just hiding the card ───────────────────────
   *
   * The first version of this returned the placeholder for as long as the
   * status said loading, with nothing else on the page. That is fine while the
   * check takes 200ms and a lockout if it never finishes: no heading, no
   * button, no way to sign in, and nothing saying why. It happened.
   *
   * `onAuthStateChanged` normally fires within a moment, but it can hang: a
   * blocked third-party request, an offline start, or a misconfigured project
   * all leave it silent rather than failing. So the quiet placeholder is only
   * borrowed for a second and a half. After that the real card comes back,
   * because a card you can press beats a truthful status you cannot.
   */
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    if (auth.status !== "loading") return;
    const timer = setTimeout(() => setWaited(true), 1500);
    return () => clearTimeout(timer);
  }, [auth.status]);

  if (auth.status === "loading" && !waited) {
    return (
      <div className="fms-gate">
        <p className="t-body" style={{ color: "var(--ink-3)" }} role="status">
          Checking your sign-in
        </p>
      </div>
    );
  }

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

          {/*
            Still loading after the wait. Something is wrong rather than slow,
            so say what and let the button be pressed anyway: signing in
            resolves the state, so the way out is the thing already on screen.
          */}
          {auth.status === "loading" && (
            <Alert status="warn" title="Still checking who is signed in">
              Firebase has not answered yet. That usually means the connection is blocked or the
              page opened offline. Signing in below works regardless.
            </Alert>
          )}

          {auth.status === "wrong-account" ? (
            <Button variant="primary" onClick={() => void onSignOut()}>Sign out</Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={busy}
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
