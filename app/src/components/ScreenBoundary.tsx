/**
 * One screen failing, not the whole app.
 *
 * The owner asked what happens if the Add page has a bug. The answer was a
 * blank window: nothing caught a screen that threw while drawing, so one bad
 * row on one screen took the navigation, the other screens and the way back
 * with it, and it looked as if the data had gone.
 *
 * This catches it for the screen alone. It says what happened and that the
 * data is safe, which it is: entries, budgets and settings live in the store,
 * not in the screen, and a half-typed entry on Add is kept in the session.
 * The screen can be tried again, left for the Dashboard, or the app reloaded.
 * Keyed by screen in App, so moving to another screen starts it fresh.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

import { Alert, Button } from "./primitives";

interface Props {
  readonly children: ReactNode;
  /** The screen's name, for the message. */
  readonly where: string;
  readonly onHome: () => void;
}

interface State {
  readonly error: Error | null;
}

export class ScreenBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept in the console for finding the cause; the screen says the rest.
    console.error(`${this.props.where} stopped working:`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div role="alert" style={{ display: "grid", gap: "var(--space-3)", maxWidth: 680 }}>
        <Alert status="over" title={`${this.props.where} stopped working`}>
          Nothing you saved is affected: entries, budgets and settings are kept apart from this screen, and a
          half-typed entry on Add is still there. The rest of the app works. What went wrong: {error.message}
        </Alert>
        <div className="fms-addrow">
          <Button variant="primary" onClick={() => this.setState({ error: null })}>
            Try this screen again
          </Button>
          <Button onClick={this.props.onHome}>Go to the Dashboard</Button>
          <Button variant="ghost" onClick={() => window.location.reload()}>
            Reload the app
          </Button>
        </div>
      </div>
    );
  }
}
