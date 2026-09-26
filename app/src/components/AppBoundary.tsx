/**
 * The last catch, for the whole app.
 *
 * 27 September 2026: the owner opened the app on the PC and got a black
 * window and nothing else. A screen that throws is caught by `ScreenBoundary`,
 * but the parts around the screens (the menu, the header, the bell, the AI
 * panel) had nothing above them, so one of them failing took React's whole
 * tree down and left only the page's background colour.
 *
 * This says what happened instead, in words the owner can send back: the
 * message, and where it happened, with a button that copies both. Nothing is
 * lost by it: entries, budgets and settings are in the database, not in the
 * page.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

import { Alert, Button } from "./primitives";

interface Props {
  readonly children: ReactNode;
  /** What stopped, for the heading: "The app", "The AI assistant". */
  readonly what?: string;
  /** Shown under the message when there is a way on besides reloading. */
  readonly onClose?: () => void;
}

interface State {
  readonly error: Error | null;
  readonly where: string;
  readonly copied: boolean;
}

export class AppBoundary extends Component<Props, State> {
  override state: State = { error: null, where: "", copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The first few components on the way down: enough to find it, short enough to read.
    const where = (info.componentStack ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(" < ");
    this.setState({ where });
    console.error(`${this.props.what ?? "The app"} stopped:`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { error, where, copied } = this.state;
    if (!error) return this.props.children;
    const what = this.props.what ?? "The app";
    const details = [`${what} stopped: ${error.message}`, where ? `Where: ${where}` : "", error.stack ? error.stack.split("\n").slice(0, 4).join(" | ") : ""]
      .filter(Boolean)
      .join("\n");

    return (
      <div role="alert" className="fms-appstop">
        <Alert status="over" title={`${what} stopped while drawing the page`}>
          Nothing you saved is affected: entries, budgets and settings are kept in the database, not in the page.
          Reload to carry on. If it happens again, press Copy the details and send them, so the cause can be fixed.
        </Alert>
        <p className="t-caption fms-appstop-details">{details}</p>
        <div className="fms-addrow">
          <Button variant="primary" onClick={() => window.location.reload()}>
            Reload
          </Button>
          <Button
            onClick={() => {
              void navigator.clipboard?.writeText(details).then(
                () => this.setState({ copied: true }),
                () => this.setState({ copied: false }),
              );
            }}
          >
            {copied ? "Copied" : "Copy the details"}
          </Button>
          {this.props.onClose && (
            <Button variant="ghost" onClick={() => { this.setState({ error: null }); this.props.onClose?.(); }}>
              Close it
            </Button>
          )}
        </div>
      </div>
    );
  }
}
