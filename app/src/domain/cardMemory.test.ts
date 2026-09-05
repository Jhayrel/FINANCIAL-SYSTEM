/**
 * A card survives a refresh.
 *
 * Cards were deliberately not stored, on the reasoning that a decision in
 * progress should not come back tomorrow offering to add a row that was
 * already added. The cost of that landed on the owner: eight cards read off a
 * statement, one interruption, and a refresh threw all eight away. They asked
 * for it to stop, and the thing the old reasoning feared now has its own
 * guard, since `duplicatesOf` marks a card whose row is already in the ledger.
 *
 * The collection takes creates and refuses updates, so a card that changes
 * writes a second message with the same id and the state is replayed. These
 * tests are that replay.
 */

import { describe, expect, it } from "vitest";

import { proposed, carded, cardsIn, type StoredCard, type ChatMessage } from "./chat";

const card = (over: Partial<StoredCard>): StoredCard => ({
  id: "c-1",
  kind: "proposal",
  state: "open",
  draft: { date: "2026-09-05", flow: "Spending", item: "Food", amount: 50000 },
  sourceRef: "read on this device",
  confidence: "high",
  adjustments: ["Booked as Food, which you have used 70 times."],
  ...over,
});

describe("a card, into the record and back", () => {
  it("comes back with everything it went in with", () => {
    const back = carded(proposed(card({}), "New entry: 2026-09-05 Spending Food PHP 500.00"));
    expect(back?.id).toBe("c-1");
    expect(back?.state).toBe("open");
    expect(back?.draft["item"]).toBe("Food");
    expect(back?.adjustments).toEqual(["Booked as Food, which you have used 70 times."]);
  });

  it("says what it is in words as well, for a reader and for the model", () => {
    const message = proposed(card({}), "New entry: 2026-09-05 Spending Food PHP 500.00");
    expect(message.text).toBe("New entry: 2026-09-05 Spending Food PHP 500.00");
  });

  it("is not a card when the message is an ordinary one", () => {
    const plain: ChatMessage = { id: "m1", at: "2026-09-05T00:00:00Z", role: "you", text: "hello" };
    expect(carded(plain)).toBeNull();
  });

  it("survives nonsense in the field rather than throwing", () => {
    const broken: ChatMessage = {
      id: "m1",
      at: "2026-09-05T00:00:00Z",
      role: "assistant",
      text: "x",
      card: "{not json",
    };
    expect(carded(broken)).toBeNull();
  });
});

describe("the state is replayed, because the record cannot be edited", () => {
  const at = (n: number): string => `2026-09-05T0${n}:00:00.000Z`;
  const withTime = (m: ChatMessage, t: string): ChatMessage => ({ ...m, at: t, id: t });

  it("takes the last state a card was written in", () => {
    const history = [
      withTime(proposed(card({ state: "open" }), "New entry"), at(1)),
      withTime(proposed(card({ state: "added", recordNumber: 505 }), "Added"), at(2)),
    ];
    const final = cardsIn(history);
    expect(final.get("c-1")?.state).toBe("added");
    expect(final.get("c-1")?.recordNumber).toBe(505);
  });

  it("does not care what order the messages arrive in", () => {
    const first = withTime(proposed(card({ state: "open" }), "New entry"), at(1));
    const last = withTime(proposed(card({ state: "discarded" }), "Discarded"), at(3));
    expect(cardsIn([last, first]).get("c-1")?.state).toBe("discarded");
  });

  it("keeps several cards apart", () => {
    const history = [
      withTime(proposed(card({ id: "c-1", state: "added" }), "Added"), at(1)),
      withTime(proposed(card({ id: "c-2", state: "open" }), "New entry"), at(2)),
      withTime(proposed(card({ id: "c-3", state: "discarded" }), "Discarded"), at(3)),
    ];
    const final = cardsIn(history);
    expect(final.size).toBe(3);
    expect(final.get("c-1")?.state).toBe("added");
    expect(final.get("c-2")?.state).toBe("open");
    expect(final.get("c-3")?.state).toBe("discarded");
  });

  /**
   * A correction is the same card, not a second one. Amending a card keeps
   * its id, so the record shows one entry that changed rather than two
   * entries that look like a duplicate.
   */
  it("shows a corrected card once, carrying the correction", () => {
    const history = [
      withTime(proposed(card({ state: "open" }), "New entry"), at(1)),
      withTime(
        proposed(
          card({ state: "open", draft: { date: "2026-09-05", flow: "Spending", item: "Food", amount: 70000 } }),
          "New entry",
        ),
        at(2),
      ),
    ];
    const final = cardsIn(history);
    expect(final.size).toBe(1);
    expect(final.get("c-1")?.draft["amount"]).toBe(70000);
  });

  it("finds nothing in a conversation with no cards in it", () => {
    const plain: ChatMessage = { id: "m1", at: at(1), role: "you", text: "how is this month" };
    expect(cardsIn([plain]).size).toBe(0);
  });
});

describe("a debt card is kept the same way", () => {
  it("comes back as a debt card, in its final state", () => {
    const history = [
      proposed(card({ id: "d-1", kind: "debt", state: "open" }), "Debt movement"),
      proposed(card({ id: "d-1", kind: "debt", state: "settled" }), "Added"),
    ];
    const final = cardsIn(history);
    expect(final.get("d-1")?.kind).toBe("debt");
    expect(final.get("d-1")?.state).toBe("settled");
  });
});

describe("what is never stored", () => {
  it("refuses a card too big to hold, rather than storing half of one", () => {
    const huge = card({ adjustments: [("x".repeat(5000))] });
    expect(proposed(huge, "New entry").card).toBeUndefined();
  });

  it("still says what it was in words when the card itself would not fit", () => {
    const huge = card({ adjustments: [("x".repeat(5000))] });
    expect(proposed(huge, "New entry: 2026-09-05 Spending Food PHP 500.00").text).toContain("Food");
  });
});
