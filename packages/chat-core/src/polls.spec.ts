import { describe, expect, it } from "vitest";
import {
  POLLS_GATE_ERROR_COPY,
  POLLS_GATE_LOADING_COPY,
  POLLS_OFF_COPY,
  buildPollMessage,
  canClosePoll,
  isPollCardClosed,
  makePollOptionId,
  pollsGateOf,
  pollsGateReason,
  readPollPayload,
} from "./polls";
import type { ChatMessage } from "./types";

describe("pollsGateOf (#3012)", () => {
  it("answers from the cache whatever the read is doing", () => {
    for (const fetchStatus of ["fetching", "paused", "idle"] as const) {
      expect(pollsGateOf({ pollsEnabled: true, fetchStatus })).toBe("on");
      expect(pollsGateOf({ pollsEnabled: false, fetchStatus })).toBe("off");
    }
  });

  it("is loading only while a read with nothing cached is running", () => {
    expect(
      pollsGateOf({ pollsEnabled: undefined, fetchStatus: "fetching" }),
    ).toBe("loading");
  });

  it("fails closed, not open, on a failed, paused or disabled read with nothing cached", () => {
    // Nothing is checking in any of these, so "Checking…" would be a lie and
    // a live Vote would contradict design-system §4.
    expect(
      pollsGateOf({ pollsEnabled: undefined, fetchStatus: "paused" }),
    ).toBe("error");
    expect(pollsGateOf({ pollsEnabled: undefined, fetchStatus: "idle" })).toBe(
      "error",
    );
  });
});

describe("pollsGateReason (#3012)", () => {
  const open = { isClosed: false, isConfirmed: true };

  it("says why an open, confirmed poll's Vote is withdrawn", () => {
    expect(pollsGateReason("on", open)).toBeNull();
    expect(pollsGateReason("off", open)).toBe(POLLS_OFF_COPY);
    expect(pollsGateReason("loading", open)).toBe(POLLS_GATE_LOADING_COPY);
    expect(pollsGateReason("error", open)).toBe(POLLS_GATE_ERROR_COPY);
  });

  it("gives no reason to a card that takes no vote anyway", () => {
    for (const gate of ["off", "loading", "error"] as const) {
      expect(pollsGateReason(gate, { ...open, isClosed: true })).toBeNull();
      // A pending or failed row: its delivery chrome already says why, and a
      // refused send says POLLS_OFF_COPY there.
      expect(pollsGateReason(gate, { ...open, isConfirmed: false })).toBeNull();
    }
  });
});

describe("buildPollMessage (#3701)", () => {
  const closesAt = new Date("2026-11-10T18:30:00.000Z");

  it("puts the question in content and the card in payload, options in order", () => {
    let n = 0;
    const built = buildPollMessage(
      { question: "Who's driving Saturday?", options: ["Me", "Not me"], closesAt },
      () => `o${++n}`,
    );
    expect(built).toEqual({
      content: "Who's driving Saturday?",
      payload: {
        question: "Who's driving Saturday?",
        options: [
          { id: "o1", label: "Me" },
          { id: "o2", label: "Not me" },
        ],
        closes_at: "2026-11-10T18:30:00.000Z",
      },
    });
  });

  it("builds a payload both cards read back unchanged", () => {
    const { payload } = buildPollMessage({
      question: "Formal date?",
      options: ["Mar 7", "Mar 14", "Mar 21"],
      closesAt,
    });
    const message = { payload } as unknown as ChatMessage;
    expect(readPollPayload(message)).toEqual(payload);
  });

  it("gives every option its own id by default", () => {
    const { payload } = buildPollMessage({
      question: "Q?",
      options: Array.from({ length: 10 }, (_, i) => `Option ${i + 1}`),
      closesAt,
    });
    expect(new Set(payload.options.map((o) => o.id)).size).toBe(10);
    expect(makePollOptionId()).toMatch(/^[a-z0-9]+$/);
  });
});

describe("a poll card closed early (#3794)", () => {
  const NOW = Date.parse("2026-06-01T12:00:00.000Z");
  const open = {
    question: "Who is driving Saturday?",
    options: [
      { id: "a", label: "Me" },
      { id: "b", label: "Not me" },
    ],
    closes_at: "2999-01-01T00:00:00.000Z",
  };
  const closed = {
    ...open,
    closed_at: "2026-06-01T11:00:00.000Z",
    closed_by: "creator",
  };
  const asMessage = (payload: object, over: Partial<ChatMessage> = {}) =>
    ({
      sender_id: "creator",
      _status: "confirmed",
      is_deleted: false,
      payload,
      ...over,
    }) as unknown as ChatMessage;

  it("reads closed_at back off the card, and adds nothing to an open one", () => {
    expect(readPollPayload(asMessage(closed))).toEqual(closed);
    expect(readPollPayload(asMessage(open))).toEqual(open);
    expect(readPollPayload(asMessage(open))).not.toHaveProperty("closed_at");
  });

  it("is closed once closed early, whatever the deadline says", () => {
    expect(isPollCardClosed(open, NOW)).toBe(false);
    expect(isPollCardClosed(closed, NOW)).toBe(true);
  });

  it("is still closed by its deadline, and never by one that doesn't parse", () => {
    expect(
      isPollCardClosed({ ...open, closes_at: "2026-06-01T11:59:59.000Z" }, NOW),
    ).toBe(true);
    expect(isPollCardClosed({ ...open, closes_at: "" }, NOW)).toBe(false);
    expect(isPollCardClosed({ ...open, closes_at: "soon" }, NOW)).toBe(false);
  });

  const ON = { pollsGate: "on" as const, canCreatePolls: true };

  it("offers Close poll to the creator of an open, confirmed card only", () => {
    expect(canClosePoll(asMessage(open), open, "creator", NOW, ON)).toBe(true);
    // Anyone else, or an unresolved viewer.
    expect(canClosePoll(asMessage(open), open, "member", NOW, ON)).toBe(false);
    expect(canClosePoll(asMessage(open), open, null, NOW, ON)).toBe(false);
    // Already closed, early or by its deadline.
    expect(canClosePoll(asMessage(closed), closed, "creator", NOW, ON)).toBe(
      false,
    );
    const lapsed = { ...open, closes_at: "2026-01-01T00:00:00.000Z" };
    expect(canClosePoll(asMessage(lapsed), lapsed, "creator", NOW, ON)).toBe(
      false,
    );
    // A row the server doesn't have yet, or a deleted one.
    const pending = asMessage(open, { _status: "pending" });
    expect(canClosePoll(pending, open, "creator", NOW, ON)).toBe(false);
    const deleted = asMessage(open, { is_deleted: true });
    expect(canClosePoll(deleted, open, "creator", NOW, ON)).toBe(false);
  });

  it("withholds it where the close route would refuse the creator", () => {
    // No polls:create: a New Member can post a card (#3007) but not close it.
    expect(
      canClosePoll(asMessage(open), open, "creator", NOW, {
        ...ON,
        canCreatePolls: false,
      }),
    ).toBe(false);
    // Polls off, or not yet known to be on.
    for (const pollsGate of ["off", "loading", "error"] as const) {
      expect(
        canClosePoll(asMessage(open), open, "creator", NOW, {
          ...ON,
          pollsGate,
        }),
      ).toBe(false);
    }
  });
});
