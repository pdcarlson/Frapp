import { describe, expect, it } from "vitest";
import {
  POLLS_GATE_ERROR_COPY,
  POLLS_GATE_LOADING_COPY,
  POLLS_OFF_COPY,
  buildPollMessage,
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
