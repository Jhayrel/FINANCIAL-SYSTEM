/**
 * An answer, with the structure it was written with.
 *
 * ── Why this is a shared component and not a helper inside one screen ──────
 *
 * It lived inside `AskPanel`, so the chat was the only place a model answer
 * was parsed. Everywhere else printed the text raw, and the owner saw the
 * markers: "**Check for any large Gcash outflows or fees that were not
 * entered**" on the investigation panel, 26 September 2026, asterisks and
 * all. The model writes the same way wherever it is asked; only one screen
 * was reading it.
 *
 * Parsed rather than stripped, then rendered as real elements: no asterisk
 * reaches the screen, which is what the no-Markdown rule was protecting, and
 * a four month comparison gets a line per month instead of one long
 * sentence. Nothing here builds HTML from the model's text: `readRich`
 * returns data and this turns it into React elements.
 */

import { readRich } from "../domain/richText";

export function Rich({ text, size = "t-caption" }: { text: string; size?: "t-caption" | "t-body" }) {
  const blocks = readRich(text);

  // Nothing parsed: show it exactly as it came, rather than nothing at all.
  if (blocks.length === 0) {
    return (
      <p className={size} style={{ margin: 0, whiteSpace: "pre-wrap" }}>
        {text}
      </p>
    );
  }

  return (
    <div className="fms-rich">
      {blocks.map((block, i) =>
        block.kind === "list" ? (
          block.ordered ? (
            // Numbered as the model numbered it: a ranking keeps its order and its numbers.
            <ol
              key={i}
              className="fms-richlist fms-richlist--ordered"
              // The counter starts where the model's numbering did ("3." after a paragraph).
              {...(block.start ? { start: block.start, style: { counterReset: `fms-rich ${block.start - 1}` } } : {})}
            >
              {block.items.map((item, j) => (
                <li key={j} className={size}>
                  {item.map((span, k) =>
                    span.bold ? <strong key={k}>{span.text}</strong> : <span key={k}>{span.text}</span>,
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <ul key={i} className="fms-richlist">
              {block.items.map((item, j) => (
                <li key={j} className={size}>
                  {item.map((span, k) =>
                    span.bold ? <strong key={k}>{span.text}</strong> : <span key={k}>{span.text}</span>,
                  )}
                </li>
              ))}
            </ul>
          )
        ) : (
          <p key={i} className={size} style={{ margin: 0 }}>
            {block.spans.map((span, k) =>
              span.bold ? <strong key={k}>{span.text}</strong> : <span key={k}>{span.text}</span>,
            )}
          </p>
        ),
      )}
    </div>
  );
}
