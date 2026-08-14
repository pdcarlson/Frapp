import { describe, expect, it } from "vitest";

import {
  isPollClosed,
  validateCardPollVote,
  validateIndexedPollVote,
} from "./index";

const NOW = new Date("2026-08-14T12:00:00.000Z");

describe("isPollClosed", () => {
  it("treats an absent deadline as never closing", () => {
    expect(isPollClosed(null, NOW)).toBe(false);
    expect(isPollClosed(undefined, NOW)).toBe(false);
  });

  it("closes on the boundary, not after it", () => {
    // A vote landing exactly on the deadline has missed it.
    expect(isPollClosed(NOW.toISOString(), NOW)).toBe(true);
    expect(isPollClosed("2026-08-14T12:00:00.001Z", NOW)).toBe(false);
  });

  it("does not treat an unparseable deadline as closed", () => {
    // Refusing every vote on a poll whose metadata is malformed would turn a
    // data bug into an outage for that poll.
    expect(isPollClosed("not-a-date", NOW)).toBe(false);
  });
});

/**
 * The two validators exist because the two vote paths store different things:
 * `poll_votes` keys by numeric `option_index`, `chat_message_actions` by string
 * `payload.option_id`. Same rules, different encodings — so each rule is
 * asserted against both, and a divergence shows up as a failure here rather
 * than as one surface accepting what the other rejects (#871).
 */
describe("poll vote rules", () => {
  describe("closed polls", () => {
    it("rejects on both paths", () => {
      expect(
        validateIndexedPollVote({
          expiresAt: "2020-01-01T00:00:00.000Z",
          optionCount: 2,
          optionIndexes: [0],
          choiceMode: "single",
          now: NOW,
        }),
      ).toEqual({ reason: "closed" });

      expect(
        validateCardPollVote({
          closesAt: "2020-01-01T00:00:00.000Z",
          optionIds: ["a", "b"],
          selected: ["a"],
          choiceMode: "single",
          now: NOW,
        }),
      ).toEqual({ reason: "closed" });
    });
  });

  describe("unknown options", () => {
    it("rejects an out-of-range index", () => {
      expect(
        validateIndexedPollVote({
          expiresAt: null,
          optionCount: 2,
          optionIndexes: [2],
          choiceMode: "multi",
          now: NOW,
        }),
      ).toEqual({ reason: "unknown_option", option: 2 });
    });

    it("rejects a negative or non-integer index", () => {
      for (const index of [-1, 1.5]) {
        expect(
          validateIndexedPollVote({
            expiresAt: null,
            optionCount: 3,
            optionIndexes: [index],
            choiceMode: "multi",
            now: NOW,
          }),
        ).toEqual({ reason: "unknown_option", option: index });
      }
    });

    it("rejects an id that is not on the card", () => {
      expect(
        validateCardPollVote({
          closesAt: null,
          optionIds: ["a", "b"],
          selected: ["z"],
          choiceMode: "multi",
          now: NOW,
        }),
      ).toEqual({ reason: "unknown_option", option: "z" });
    });
  });

  describe("cardinality", () => {
    it("requires exactly one selection on a single-choice poll", () => {
      for (const selected of [[], ["a", "b"]]) {
        expect(
          validateCardPollVote({
            closesAt: null,
            optionIds: ["a", "b"],
            selected,
            choiceMode: "single",
            now: NOW,
          }),
        ).toEqual({ reason: "cardinality", selected: selected.length });
      }
    });

    it("allows zero selections on a multi-choice poll", () => {
      // Clearing a vote is how the polls surface removes a previous answer.
      expect(
        validateIndexedPollVote({
          expiresAt: null,
          optionCount: 3,
          optionIndexes: [],
          choiceMode: "multi",
          now: NOW,
        }),
      ).toBeNull();
    });

    it("allows several selections on a multi-choice poll", () => {
      expect(
        validateCardPollVote({
          closesAt: null,
          optionIds: ["a", "b", "c"],
          selected: ["a", "c"],
          choiceMode: "multi",
          now: NOW,
        }),
      ).toBeNull();
    });
  });

  it("accepts a well-formed vote on both paths", () => {
    expect(
      validateIndexedPollVote({
        expiresAt: "2030-01-01T00:00:00.000Z",
        optionCount: 2,
        optionIndexes: [1],
        choiceMode: "single",
        now: NOW,
      }),
    ).toBeNull();

    expect(
      validateCardPollVote({
        closesAt: "2030-01-01T00:00:00.000Z",
        optionIds: ["a", "b"],
        selected: ["b"],
        choiceMode: "single",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("checks closure before options", () => {
    // A closed poll reports "closed" even when the selection is also invalid,
    // so the member is told the actionable thing rather than a detail about a
    // poll they can no longer vote in.
    expect(
      validateCardPollVote({
        closesAt: "2020-01-01T00:00:00.000Z",
        optionIds: ["a"],
        selected: ["z"],
        choiceMode: "single",
        now: NOW,
      }),
    ).toEqual({ reason: "closed" });
  });
});
