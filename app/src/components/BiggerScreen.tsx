/**
 * What a phone shows for a screen that is not for a phone.
 *
 * On a phone the app is for two things: adding an entry, and seeing where the
 * month stands. Debt, Insights, Statements, the Bin and Activity are desks,
 * not pockets: wide tables, side panels, several filters at once. Squeezed
 * onto a phone they were a cropped desktop, so a phone now says plainly where
 * they are and offers the way back, rather than a screen that half works.
 */

import { Button } from "./primitives";
import { Icon } from "./Icon";

export function BiggerScreen({ what, onBack }: { what: string; onBack: () => void }) {
  return (
    <div className="fms-bigger">
      <div className="fms-bigger-card">
        <span aria-hidden className="fms-bigger-icon">
          <Icon name="dashboard" size={20} />
        </span>
        <h2 className="t-display-m" style={{ margin: 0 }}>
          {what} is on a bigger screen
        </h2>
        <p className="t-body" style={{ margin: 0, color: "var(--ink-2)" }}>
          On a phone this app is for adding entries and checking where the month stands. Open it on a
          computer, or widen the window, to use {what}.
        </p>
        <Button variant="primary" onClick={onBack}>
          Back to the Dashboard
        </Button>
      </div>
    </div>
  );
}
