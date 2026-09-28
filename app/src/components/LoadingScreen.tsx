/**
 * What a screen looks like while its figures are arriving.
 *
 * The owner, 28 September 2026: "add loading screen align to the brand when
 * you cannot show something or the data is fetching. I dont like simple
 * loading screen ... maybe boxes or data loading like social media". The
 * screen was one line of text in an empty card.
 *
 * So the screen is drawn as its own outline: the Dashboard's card with its
 * figure and its rows, the Database's search, filters and rows, the Add
 * form's kinds and fields. The boxes come in once, top to bottom, and then
 * breathe slowly while they wait; they never sweep (no shimmer, style guide
 * 2.5), and with reduced motion they hold still. A line above them says what
 * has arrived, because the wait is for three things and each one lands on
 * its own: the accounts, the entries and the budget.
 *
 * Neutral surfaces only. A flow colour means a direction of money (rule
 * D3), and nothing here is money yet.
 */

import type { CSSProperties, ReactNode } from "react";

import { Icon } from "./Icon";

export type LoadingShape = "dashboard" | "list" | "form" | "cards" | "calendar" | "chat";

export interface Arrived {
  readonly accounts: boolean;
  readonly entries: boolean;
  readonly budget: boolean;
}

/** One box. `order` staggers its first appearance, top to bottom. */
function Bone({ w = "100%", h = 14, order = 0, round = false, style }: { w?: string | number; h?: number; order?: number; round?: boolean; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      className={round ? "fms-bone fms-bone--round" : "fms-bone"}
      style={{ width: w, height: h, animationDelay: `${Math.min(order, 14) * 45}ms, ${Math.min(order, 14) * 45 + 450}ms`, ...style }}
    />
  );
}

/** A row of a list: what it was and its badge, the figure on the right, and the line under it. */
function Row({ order, wide = 46 }: { order: number; wide?: number }) {
  return (
    <div className="fms-bone-row">
      <div className="fms-bone-stack">
        <div className="fms-bone-line">
          <Bone w={`${wide}%`} h={14} order={order} />
          <Bone w={56} h={16} order={order} round />
        </div>
        <Bone w={`${Math.max(24, wide - 14)}%`} h={11} order={order + 1} />
      </div>
      <Bone w={72} h={14} order={order} />
    </div>
  );
}

function Card({ children, order = 0 }: { children: ReactNode; order?: number }) {
  return (
    <div className="fms-bone-card">
      <div className="fms-bone-head">
        <Bone w="38%" h={18} order={order} />
        <Bone w={88} h={32} order={order} style={{ borderRadius: "var(--radius-md)" }} />
      </div>
      {children}
    </div>
  );
}

function Shape({ shape }: { shape: LoadingShape }) {
  switch (shape) {
    case "dashboard":
      return (
        <>
          <Card>
            <Bone w="28%" h={12} order={1} />
            <div className="fms-bone-hero">
              <span aria-hidden className="fms-bone-peso">₱</span>
              <Bone w="44%" h={30} order={2} />
            </div>
            <Bone w="36%" h={12} order={3} />
            <div className="fms-bone-rows">
              {[4, 5, 6, 7].map((o) => (
                <div key={o} className="fms-bone-pair">
                  <Bone w={`${30 + (o % 3) * 8}%`} h={12} order={o} />
                  <Bone w={84} h={12} order={o} />
                </div>
              ))}
            </div>
            <Bone w="100%" h={8} order={8} style={{ borderRadius: "var(--radius-full)" }} />
          </Card>
          <Card order={9}>
            {[10, 11, 12].map((o) => (
              <Row key={o} order={o} wide={40 + (o % 3) * 8} />
            ))}
          </Card>
        </>
      );
    case "list":
      return (
        <div className="fms-bone-card fms-bone-card--flush">
          <div className="fms-bone-tools">
            <Bone w="100%" h={44} order={0} style={{ borderRadius: "var(--radius-md)" }} />
            <div className="fms-bone-line">
              {[1, 1, 1].map((_, i) => (
                <Bone key={i} w="30%" h={36} order={1} round />
              ))}
            </div>
          </div>
          {Array.from({ length: 8 }, (_, i) => (
            <Row key={i} order={2 + i} wide={34 + ((i * 7) % 24)} />
          ))}
        </div>
      );
    case "form":
      return (
        <div className="fms-bone-card">
          <div className="fms-bone-tiles">
            {[0, 1, 2, 3, 4].map((i) => (
              <Bone key={i} w="100%" h={52} order={i} style={{ borderRadius: "var(--radius-md)" }} />
            ))}
          </div>
          {[5, 7, 9, 11, 13].map((o, i) => (
            <div key={o} className="fms-bone-field">
              <Bone w={`${18 + (i % 3) * 6}%`} h={11} order={o} />
              <Bone w="100%" h={i === 0 ? 48 : 44} order={o + 1} style={{ borderRadius: "var(--radius-md)" }} />
            </div>
          ))}
        </div>
      );
    case "calendar":
      return (
        <Card>
          <div className="fms-bone-grid">
            {Array.from({ length: 35 }, (_, i) => (
              <Bone key={i} w="100%" h={36} order={1 + Math.floor(i / 7)} style={{ borderRadius: "var(--radius-sm)" }} />
            ))}
          </div>
        </Card>
      );
    case "chat":
      return (
        <div className="fms-bone-chat">
          <Bone w="62%" h={40} order={0} style={{ borderRadius: "var(--radius-lg)", alignSelf: "flex-end" }} />
          <Bone w="74%" h={56} order={1} style={{ borderRadius: "var(--radius-lg)" }} />
          <Bone w="48%" h={40} order={2} style={{ borderRadius: "var(--radius-lg)", alignSelf: "flex-end" }} />
        </div>
      );
    default:
      return (
        <>
          <Card>
            {[1, 2, 3].map((o) => (
              <Row key={o} order={o} wide={42 + (o % 2) * 10} />
            ))}
          </Card>
          <Card order={4}>
            {[5, 6].map((o) => (
              <Row key={o} order={o} wide={38 + (o % 2) * 12} />
            ))}
          </Card>
        </>
      );
  }
}

/**
 * The outline of a screen, and a line saying what has arrived.
 *
 * `arrived` is left out where there is only one thing to wait for.
 */
export function LoadingScreen({ shape, arrived, label = "Loading your figures" }: { shape: LoadingShape; arrived?: Arrived; label?: string }) {
  const steps: readonly [string, boolean][] = arrived
    ? [
        ["Accounts", arrived.accounts],
        ["Entries", arrived.entries],
        ["Budget", arrived.budget],
      ]
    : [];
  return (
    <div className="fms-loading" role="status" aria-live="polite" aria-label={label}>
      <p className="fms-loading-line t-caption">
        <span className="fms-loading-mark" aria-hidden />
        <span>{label}</span>
        {steps.length > 0 && (
          <span className="fms-loading-steps">
            {steps.map(([name, done]) => (
              <span key={name} className={done ? "fms-loading-step is-done" : "fms-loading-step"}>
                {done ? <Icon name="check" size={14} /> : <span aria-hidden className="fms-loading-dot" />}
                {name}
              </span>
            ))}
          </span>
        )}
      </p>
      <Shape shape={shape} />
    </div>
  );
}

/**
 * Rows of a list still arriving, inside a screen that is already drawn: the
 * activity trail, the assistant's history, what it has learned.
 */
export function LoadingRows({ count = 4, label }: { count?: number; label: string }) {
  return (
    <div className="fms-bone-list" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <Row key={i} order={i} wide={34 + ((i * 11) % 26)} />
      ))}
    </div>
  );
}

/** Which outline a screen waits behind. */
export function loadingShapeFor(screen: string): LoadingShape {
  if (screen === "dashboard") return "dashboard";
  if (screen === "add") return "form";
  if (screen === "insights") return "calendar";
  if (screen === "ai") return "chat";
  if (screen === "database" || screen === "activity" || screen === "bin" || screen === "statements") return "list";
  return "cards";
}
