/**
 * Sign-in gate.
 *
 * Shown only when a Firebase project is configured. One account can reach this
 * data: the security rules pin it to a single uid, so this screen says who,
 * rather than pretending to be a general login.
 */

import { useEffect, useState } from "react";

import { Alert, Button } from "../components/primitives";
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
  /*
   * ── And no button while the check normally answers ─────────────────────
   *
   * The owner, 6 October 2026, over this card on a phone: "i keep
   * accidentally hitting that". The check answers in a fraction of a second
   * when signed in, and the big green button sat under the thumb for that
   * fraction, opening Google's account chooser for someone already signed
   * in. So while checking, the card says only that it is checking, and the
   * button comes after four seconds, the time a check that has stalled has
   * clearly stalled. Two independent ways bring it, so neither can be the
   * one that locks the owner out, which is what the comment above is about:
   * this timer, and a CSS animation on the button itself (`fms-gate-later`),
   * which shows it after six seconds with no JavaScript at all.
   */
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!checking) return;
    const timer = setTimeout(() => setStalled(true), 4000);
    return () => clearTimeout(timer);
  }, [checking]);
  const waiting = checking && !stalled;

  /*
   * One quiet screen, not a card of paragraphs (the owner, 6 October 2026:
   * "the loading screen ... when opening make it cleaner", "even the login
   * make it clean"). The mark and the name, one line, and the button when
   * there is something to press. The button keeps its place while hidden, so
   * nothing moves when it appears.
   */
  return (
    <div className="fms-gate">
      <main className="fms-gatebox">
        <span aria-hidden className="fms-mark fms-mark--l">
          <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
            <path d="M4 4.5h8M4 8h8M4 11.5h4.5" stroke="var(--on-brand)" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        <h1 className="t-display-l fms-gatetitle">Finances</h1>

        {waiting ? (
          <div className="fms-gatewait" role="status" aria-live="polite">
            <span className="t-body" style={{ color: "var(--ink-3)" }}>
              Opening your ledger
            </span>
            <span className="fms-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
          </div>
        ) : (
          <p className="t-body fms-gateline">
            {auth.status === "wrong-account"
              ? `Signed in as ${auth.email || auth.uid}, which is not the account that owns this ledger.`
              : checking
                ? "This is taking longer than usual. If you are signed in it opens by itself; if not, sign in."
                : "Sign in with the Google account that owns this ledger."}
          </p>
        )}

        {error && (
          <Alert status="over" title="Could not sign in">
            {error}
          </Alert>
        )}

        {auth.status === "wrong-account" ? (
          <Button variant="primary" size="lg" fullWidth onClick={() => void onSignOut()}>
            Sign out
          </Button>
        ) : (
          <div className={waiting ? "fms-gate-later fms-gatebutton" : "fms-gatebutton"}>
            <Button variant="primary" size="lg" fullWidth loading={busy} onClick={() => void go()}>
              Continue with Google
            </Button>
            <p className="t-caption fms-gatenote">Only the owner's account can open it.</p>
          </div>
        )}
      </main>
    </div>
  );
}
