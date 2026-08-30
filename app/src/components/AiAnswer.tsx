/**
 * How an AI answer is shown, everywhere it is shown.
 *
 * The one rule: the reader must always be able to tell where the sentence came
 * from. An answer written on this device and an answer from a remote model
 * read identically, and treating them as interchangeable is how someone ends
 * up believing a model said something it never saw. So the provenance line is
 * part of the component, not an optional extra a call site can forget.
 */

import type { AiAnswer } from "../data/aiClient";

export function AiAnswerView({ answer }: { answer: AiAnswer }) {
  const fromModel = answer.source === "model";

  return (
    <div>
      <p
        className="t-body"
        style={{ margin: 0, whiteSpace: "pre-wrap", color: "var(--ink-1)" }}
      >
        {answer.text}
      </p>

      <p
        className="t-caption"
        style={{
          margin: "var(--space-2) 0 0",
          color: "var(--ink-3)",
          display: "flex",
          gap: "var(--space-2)",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            border: "1px solid var(--rule)",
            padding: "0 var(--space-1)",
            color: fromModel ? "var(--ink-2)" : "var(--ink-3)",
          }}
        >
          {fromModel ? "Model" : "This device"}
        </span>
        <span>
          {fromModel
            ? `Written by ${answer.model ?? "the provider"} from figures this app calculated.`
            : `Written here from the same figures. ${answer.reason ?? ""}`}
        </span>
      </p>
    </div>
  );
}
