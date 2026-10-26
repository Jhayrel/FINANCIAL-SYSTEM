/**
 * The activity trail as a PDF, and the details each change holds (26 October
 * 2026: "Add more details also i can export it as pdf with all details").
 */
import { describe, expect, it } from "vitest";

import type { ActivityEvent } from "../domain/activity";
import { byDay, eventDetails, trailFilename, trailSummary } from "../domain/activityExport";
import { activityPdf, spanWords } from "./activityPdf";
import { INTER_BOLD, INTER_REGULAR } from "./fonts";
import { fromBase64, parseTtf } from "./writer";

const at = (day: string, h: number, m = 0): string => new Date(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:07`).toISOString();

const events: ActivityEvent[] = [
  {
    id: "3",
    at: at("2026-10-26", 9, 27),
    actor: "ai",
    via: "ai_chat",
    action: "transaction.update",
    summary: "Changed #3812: amount.",
    recordNumber: 3812,
    model: "this device",
    before: "2026-09-20 | Transfer | Maya | Cash | - | PHP 1,018.00 | Withdrawn",
    after: "2026-09-20 | Transfer | Maya | Cash | - | PHP 300.00 | Withdrawn",
  },
  {
    id: "2",
    at: at("2026-10-26", 8, 5),
    actor: "owner",
    via: "manual",
    action: "transaction.create",
    summary: "Added #3955, Parking, PHP 37.00.",
    recordNumber: 3955,
    after: "2026-10-26 | Spending | Gcash | - | Parking | PHP 37.00 | Paid",
  },
  { id: "1", at: at("2026-10-25", 22, 1), actor: "owner", via: "manual", action: "budget.update", summary: "November 2026 budget: Changed from ₱14,000.00 to ₱18,000.00." },
];

describe("what each change holds", () => {
  it("lists every detail, blank fields left out", () => {
    const details = eventDetails(events[1]!);
    expect(details.map((d) => d.label)).toEqual(["When", "Who", "How", "Kind", "Entry", "For", "Type", "Item", "From", "Amount", "Status"]);
    expect(details.find((d) => d.label === "When")?.value).toBe("October 26, 2026, 8:05:07 AM");
    expect(details.find((d) => d.label === "How")?.value).toBe("Typed on a screen");
    expect(details.find((d) => d.label === "Amount")?.value).toBe("₱37.00");
    expect(eventDetails(events[0]!).find((d) => d.label === "Model")?.value).toBe("this device");
  });

  it("sums the trail and names its span", () => {
    const s = trailSummary(events);
    expect(s).toMatchObject({ total: 3, added: 1, edited: 1, budgetOrSettings: 1, byAssistant: 1, from: "2026-10-25", to: "2026-10-26" });
    expect(spanWords(s)).toBe("October 25 to 26, 2026");
    expect(trailFilename(s)).toBe("activity-2026-10-25-to-2026-10-26.pdf");
    expect(byDay(events).map((g) => [g.day, g.events.length])).toEqual([
      ["2026-10-26", 2],
      ["2026-10-25", 1],
    ]);
  });
});

describe("the PDF", () => {
  const font = parseTtf(fromBase64(INTER_REGULAR), "Inter-Regular");
  const bold = parseTtf(fromBase64(INTER_BOLD), "Inter-Bold");
  const hexOf = (text: string, f = font): string => [...text].map((ch) => (f.cmap.get(ch.codePointAt(0)!) ?? 0).toString(16).padStart(4, "0")).join("");

  it("draws the band, every day, every change and its edit, and the closing line", async () => {
    const bytes = await activityPdf({ events, showing: "Everyone, all changes", issuedTo: "Ana Cruz", issuedAt: new Date(2026, 9, 26, 10, 44), compress: false });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text).toContain(hexOf("ACTIVITY TRAIL", bold));
    expect(text).toContain(hexOf("Monday, October 26, 2026", bold));
    expect(text).toContain(hexOf("Sunday, October 25, 2026", bold));
    expect(text).toContain(hexOf("Changed #3812: amount."));
    // The edit field by field, in words: the font has no arrow.
    expect(text).toContain(hexOf("Amount: ₱1,018.00 to ₱300.00"));
    expect(text).toContain(hexOf("Ana Cruz", bold));
    expect(text).toContain(hexOf("**Nothing Follows**", bold));
  });

  it("says so when nothing is shown", async () => {
    const bytes = await activityPdf({ events: [], showing: "You, budget", issuedTo: "", issuedAt: new Date(2026, 9, 26), compress: false });
    expect(new TextDecoder("latin1").decode(bytes)).toContain(hexOf("No changes in what is shown."));
  });
});
