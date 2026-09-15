/**
 * The screen the owner is on, kept where the assistant can read it.
 *
 * One value, not React state: nothing re-renders because of it, and the
 * assistant reads it at the moment a question is sent. The app sets a short
 * report for every screen (`useReportScreenFallback`); a screen with more to
 * say sets its own after that (`useReportScreen`), because a child's effects
 * run after the app's layout effects. See `domain/screenContext.ts`.
 */

import { useEffect, useLayoutEffect, type DependencyList } from "react";

import type { ScreenReport } from "../domain/screenContext";

let current: ScreenReport | null = null;

export const currentScreen = (): ScreenReport | null => current;

export function reportScreen(report: ScreenReport): void {
  current = report;
}

/** A screen says what it shows, whenever what it shows changes. */
export function useReportScreen(build: () => ScreenReport, deps: DependencyList): void {
  useEffect(() => {
    reportScreen(build());
    // The caller names what the report depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** The app's own short report, set before the screen's fuller one. */
export function useReportScreenFallback(build: () => ScreenReport | null, deps: DependencyList): void {
  useLayoutEffect(() => {
    const report = build();
    if (report) reportScreen(report);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
