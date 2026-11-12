import { describe, expect, it } from "vitest";
import {
  POLLS_GATE_ERROR_COPY,
  POLLS_GATE_LOADING_COPY,
  POLLS_OFF_COPY,
  buildPollMessage,
  canClosePoll,
  isPollCardClosed,
  isMultiChoicePoll,
  currentPollPicks,
  makePollOptionId,
  POLL_PICKS_PENDING_MS,
  pollCardFooter,
  pollChoiceHint,
  pollOptionPercent,
  pollVotePayload,
  tallyPollVotes,
  pollCardEyebrow,
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
      {
        question: "Who's driving Saturday?",
        options: ["Me", "Not me"],
        closesAt,
      },
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

  it("writes no deadline for a poll that doesn't close (#3896)", () => {
    const { payload } = buildPollMessage({
      question: "Standing lunch order?",
      options: ["Subs", "Pizza"],
      closesAt: null,
    });
    expect(payload.closes_at).toBeNull();
    const message = { payload } as unknown as ChatMessage;
    expect(readPollPayload(message)).toEqual(payload);
    // It never closes on its own, and says so; a timed card reads as before.
    const farFuture = Date.parse("2999-01-01T00:00:00.000Z");
    expect(isPollCardClosed(payload, farFuture)).toBe(false);
    expect(pollCardEyebrow(payload, farFuture)).toBe("Poll · No end date");
    const timed = { ...payload, closes_at: "2026-11-10T18:30:00.000Z" };
    expect(pollCardEyebrow(timed, closesAt.getTime() - 1)).toBe("Poll");
    expect(pollCardEyebrow(timed, closesAt.getTime() + 1)).toBe(
      "Poll · Closed",
    );
    // Closed early by its creator, it reads closed like any other.
    expect(
      pollCardEyebrow(
        { ...payload, closed_at: "2026-11-10T18:30:00.000Z" },
        farFuture,
      ),
    ).toBe("Poll · Closed");
  });

  it("reads a card with a missing or empty deadline as having none", () => {
    const options = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ];
    for (const payload of [
      { question: "Q?", options },
      { question: "Q?", options, closes_at: "" },
      { question: "Q?", options, closes_at: null },
    ]) {
      const message = { payload } as unknown as ChatMessage;
      expect(readPollPayload(message)?.closes_at).toBeNull();
    }
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

describe("a multi-choice poll card (#3793)", () => {
  const options = [
    { id: "a", label: "Fri" },
    { id: "b", label: "Sat" },
    { id: "c", label: "Sun" },
  ];
  const single = { question: "Which day?", options, closes_at: null };
  const multi = { ...single, choice_mode: "multi" as const };
  const votes = (rows: [string, unknown][]) =>
    ({
      actions: rows.map(([user_id, option_id], i) => ({
        id: `v${i}`,
        user_id,
        action_type: "vote",
        payload: { option_id },
      })),
    }) as unknown as ChatMessage;

  it("builds the mode onto the card only when asked, and reads it back", () => {
    const input = { question: "Which days?", options: ["Fri", "Sat"], closesAt: null };
    const one = buildPollMessage(input).payload;
    expect(one).not.toHaveProperty("choice_mode");
    expect(isMultiChoicePoll(one)).toBe(false);
    const many = buildPollMessage({ ...input, multiple: true }).payload;
    expect(many.choice_mode).toBe("multi");
    expect(readPollPayload({ payload: many } as unknown as ChatMessage)).toEqual(many);
  });

  it("reads a card without the mode, or marked single, as single-choice", () => {
    const read = (payload: object) =>
      readPollPayload({ payload } as unknown as ChatMessage)!;
    expect(read(single)).not.toHaveProperty("choice_mode");
    expect(read({ ...single, choice_mode: "single" })).not.toHaveProperty("choice_mode");
    expect(read({ ...single, choice_mode: null })).not.toHaveProperty("choice_mode");
    // Anything else votes as multi on the server, so it reads as multi here.
    expect(read({ ...single, choice_mode: "many" }).choice_mode).toBe("multi");
  });

  it("tallies a single-choice card as before", () => {
    const tally = tallyPollVotes(
      votes([["u1", "a"], ["u2", "a"], ["me", "b"], ["u3", "zzz"]]),
      options,
      "me",
    );
    expect(tally).toEqual({
      byOption: { a: 2, b: 1, c: 0 },
      total: 3,
      voters: 3,
      myVotes: ["b"],
    });
    expect(pollOptionPercent(single, tally, "a")).toBe(67);
    expect(pollCardFooter(single, tally, true)).toBe(
      "3 votes · your vote is highlighted",
    );
    expect(pollChoiceHint(single, false)).toBeNull();
  });

  it("counts every pick, and each member once", () => {
    const tally = tallyPollVotes(
      votes([
        ["u1", ["a", "b"]],
        ["me", ["c", "a", "a", "zzz"]],
        ["u2", "b"], // an older build's single pick on the same card
        ["u3", []], // cleared
      ]),
      options,
      "me",
    );
    expect(tally).toEqual({
      byOption: { a: 2, b: 2, c: 1 },
      total: 5,
      voters: 3,
      myVotes: ["a", "c"],
    });
    // A share of the three voters, so the options needn't add up to 100.
    expect(pollOptionPercent(multi, tally, "a")).toBe(67);
    expect(pollOptionPercent(multi, tally, "c")).toBe(33);
    expect(pollCardFooter(multi, tally, true)).toBe(
      "3 people voted · your choices are highlighted",
    );
  });

  it("says who voted, and what an empty card says, in the footer", () => {
    const none = tallyPollVotes(votes([["u3", []]]), options, "me");
    expect(pollCardFooter(multi, none, true)).toBe(
      "No votes yet · be the first to vote.",
    );
    expect(pollCardFooter(multi, none, false)).toBe("No votes yet.");
    const one = tallyPollVotes(votes([["u1", ["a", "b"]]]), options, "me");
    expect(pollCardFooter(multi, one, true)).toBe("1 person voted");
    expect(pollOptionPercent(multi, none, "a")).toBe(0);
  });

  it("selects and clears on a multi-choice card, and replaces on a single one", () => {
    // Single-choice: the tapped option, whatever was picked before.
    expect(pollVotePayload(single, ["a"], "b")).toEqual({ option_id: "b" });
    expect(pollVotePayload(single, ["a"], "a")).toEqual({ option_id: "a" });
    // Multi-choice: add, in the card's order; tap again to clear.
    expect(pollVotePayload(multi, [], "c")).toEqual({ option_id: ["c"] });
    expect(pollVotePayload(multi, ["c"], "a")).toEqual({ option_id: ["a", "c"] });
    expect(pollVotePayload(multi, ["a", "c"], "a")).toEqual({ option_id: ["c"] });
    expect(pollVotePayload(multi, ["c"], "c")).toEqual({ option_id: [] });
  });

  it("builds a quick second tap on the first, not on a card that hasn't caught up", () => {
    const NOW = 1_000_000;
    // Tap Fri: the card still shows no picks, and the tap is remembered.
    const first = pollVotePayload(multi, currentPollPicks([], null, NOW), "a");
    expect(first).toEqual({ option_id: ["a"] });
    const pending = { picks: first.option_id as string[], at: NOW };
    // Tap Sat before the answer lands: both picks go, not Sat alone.
    expect(
      pollVotePayload(multi, currentPollPicks([], pending, NOW + 300), "b"),
    ).toEqual({ option_id: ["a", "b"] });
    // Much later the card's own picks are the truth again.
    expect(
      currentPollPicks(["c"], pending, NOW + POLL_PICKS_PENDING_MS),
    ).toEqual(["c"]);
  });

  it("tells a member they can pick several", () => {
    expect(pollChoiceHint(multi, false)).toBe("Select one or more");
    expect(pollChoiceHint(multi, true)).toBe("More than one choice was allowed");
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

  const ON = { pollsGate: "on" as const, canManageChannels: false };
  const MOD = { pollsGate: "on" as const, canManageChannels: true };

  it("offers Close poll to the creator of an open, confirmed card", () => {
    expect(canClosePoll(asMessage(open), open, "creator", NOW, ON)).toBe(true);
    // Anyone else without channels:manage, or an unresolved viewer.
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

  it("offers it to a member who manages channels on anyone's open card (#4046)", () => {
    const noDeadline = { ...open, closes_at: null };
    expect(
      canClosePoll(asMessage(noDeadline), noDeadline, "officer", NOW, MOD),
    ).toBe(true);
    // Still not on a closed or deleted card, nor to an unresolved viewer.
    expect(canClosePoll(asMessage(closed), closed, "officer", NOW, MOD)).toBe(
      false,
    );
    const deleted = asMessage(open, { is_deleted: true });
    expect(canClosePoll(deleted, open, "officer", NOW, MOD)).toBe(false);
    expect(canClosePoll(asMessage(open), open, null, NOW, MOD)).toBe(false);
  });

  it("withholds it where the close route would refuse", () => {
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
