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

  /**
   * One render path, and it always has a button on it.
   *
   * ── Why there is no longer a loading branch ───────────────────────────────
   *
   * There was, twice. Refreshing while signed in briefly showed the whole
   * sign-in card, which reads as being logged out, so the card was replaced
   * with a quiet "Checking your sign-in" while Firebase decided. That is fine
   * for the 200ms it normally takes and a total lockout when it does not
   * finish: no heading, no button, nothing to press. It did not finish.
   *
   * The second attempt kept the placeholder but gave it a 1.5 second deadline.
   * That is a better shape and still the wrong one, because it leaves a window
   * where the only escape is a timer firing correctly, and it locked the owner
   * out again.
   *
   * `onAuthStateChanged` usually answers immediately but can stay silent
   * rather than fail: blocked storage, a blocked request, an unauthorised
   * domain. None of those throw, so nothing downstream ever learns.
   *
   * So the card renders unconditionally now. Only the wording changes while
   * the check runs, which fixes the flash the first attempt was chasing at no
   * risk at all. A cosmetic flash was never worth a state the owner cannot get
   * out of, and this has no such state left to get into.
   */
  const checking = auth.status === "loading";

  return (
    <div className="fms-gate">
      <Card>
        <div style={{ display: "grid", gap: "var(--space-4)", maxWidth: 380 }}>
          <div>
            <h1 className="t-display-l" style={{ margin: 0 }}>Finances</h1>
            <p className="t-body" style={{ margin: "var(--space-2) 0 0", color: "var(--ink-2)" }}>
              {/*
                The only thing the loading state changes. Saying "sign in" to
                someone who is already signed in and merely being checked is
                what read as being logged out; saying this does not, and it
                costs no branch and no timer.
              */}
              {checking
                ? "Checking whether you are already signed in."
                : "Your ledger is in Firebase. Sign in with the Google account that owns it."}
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
            The check can stay silent rather than fail, so this never claims
            anything is wrong. It says what is happening and points at the
            button, which works either way: signing in resolves the state.
          */}
          {checking && (
            <Alert status="info" title="This usually takes a moment">
              If it stays like this, the check has been blocked rather than answered. Signing in
              below works regardless.
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
