import { describe, expect, it } from "vitest";
import {
  CHAT_CATCH_UP_COPY,
  ChatCatchUpRequestSchema,
  chatCatchUpGroupOf,
  chatCatchUpNotes,
  chatCatchUpOfferLine,
  chatCatchUpSince,
  chatCatchUpTooLittleLine,
  chatCatchUpUnavailableLine,
  chatCatchUpWhen,
} from "./chat-catch-up";

const CHANNEL = "0b8f6f0e-6f0a-4c1e-9d2b-0a1b2c3d4e5f";
const ROOT = "1b8f6f0e-6f0a-4c1e-9d2b-0a1b2c3d4e5f";

describe("ChatCatchUpRequestSchema", () => {
  it("takes exactly one of a thread, a moment and an unread stretch", () => {
    const since = "2026-11-12T10:00:00.000Z";
    expect(
      ChatCatchUpRequestSchema.safeParse({ channel_id: CHANNEL, since }).success,
    ).toBe(true);
    expect(
      ChatCatchUpRequestSchema.safeParse({
        channel_id: CHANNEL,
        thread_root_id: ROOT,
      }).success,
    ).toBe(true);
    expect(
      ChatCatchUpRequestSchema.safeParse({
        channel_id: CHANNEL,
        unread: { count: 140, as_of: since },
      }).success,
    ).toBe(true);
    expect(
      ChatCatchUpRequestSchema.safeParse({ channel_id: CHANNEL }).success,
    ).toBe(false);
    expect(
      ChatCatchUpRequestSchema.safeParse({
        channel_id: CHANNEL,
        since,
        thread_root_id: ROOT,
      }).success,
    ).toBe(false);
  });

  it("refuses an unread count of zero or beyond the cap", () => {
    const as_of = "2026-11-12T10:00:00.000Z";
    for (const count of [0, 5001, 1.5]) {
      expect(
        ChatCatchUpRequestSchema.safeParse({
          channel_id: CHANNEL,
          unread: { count, as_of },
        }).success,
      ).toBe(false);
    }
  });
});

describe("catch-up copy", () => {
  it("counts the offer in full words", () => {
    expect(chatCatchUpOfferLine(1)).toBe(
      "1 new message since you were last here.",
    );
    expect(chatCatchUpOfferLine(1400)).toBe(
      "1,400 new messages since you were last here.",
    );
  });

  it("puts a kind it does not know under the last group", () => {
    expect(chatCatchUpGroupOf("decision")).toBe("decision");
    expect(chatCatchUpGroupOf("vote")).toBe("topic");
  });

  it("falls back for a reason it does not know", () => {
    expect(chatCatchUpUnavailableLine("chat_off")).toBe(
      CHAT_CATCH_UP_COPY.unavailable.chat_off,
    );
    expect(chatCatchUpUnavailableLine("later")).toBe(
      CHAT_CATCH_UP_COPY.unavailable.not_available,
    );
    expect(chatCatchUpUnavailableLine(null)).toBe(
      CHAT_CATCH_UP_COPY.unavailable.not_available,
    );
  });

  it("says consent is why when messages were left out of too few", () => {
    expect(
      chatCatchUpTooLittleLine({ messages_read: 0, left_out_messages: 9 }),
    ).toBe("None of the messages here can be summarized.");
    expect(
      chatCatchUpTooLittleLine({ messages_read: 2, left_out_messages: 9 }),
    ).toBe("Only 2 messages here can be summarized, which is too few to shorten.");
    expect(
      chatCatchUpTooLittleLine({ messages_read: 1, left_out_messages: 0 }),
    ).toBe("There is only 1 message here, so there is nothing to shorten.");
  });

  it("notes what was read, what was dropped and what was left out", () => {
    expect(
      chatCatchUpNotes({
        status: "summarized",
        messages_read: 300,
        messages_total: 1200,
        left_out_messages: 0,
        unverified_points: 0,
      }),
    ).toEqual(["From the most recent 300 of 1,200 messages."]);
    const notes = chatCatchUpNotes({
      status: "summarized",
      messages_read: 40,
      messages_total: 40,
      left_out_messages: 3,
      unverified_points: 1,
    });
    expect(notes[0]).toBe("From 40 messages.");
    expect(notes[1]).toBe(CHAT_CATCH_UP_COPY.unverified);
    expect(notes).toHaveLength(3);
    // Not summarized: only the left-out line, and only when true.
    expect(
      chatCatchUpNotes({
        status: "too_little",
        messages_read: 2,
        messages_total: 2,
        left_out_messages: 0,
        unverified_points: 0,
      }),
    ).toEqual([]);
  });

  it("turns a range into the moment it starts", () => {
    const now = new Date("2026-11-12T12:00:00.000Z");
    expect(chatCatchUpSince("day", now)).toBe("2026-11-11T12:00:00.000Z");
    expect(chatCatchUpSince("week", now)).toBe("2026-11-05T12:00:00.000Z");
  });

  it("writes a message's time out in full", () => {
    const now = new Date(2026, 10, 12, 18, 0);
    expect(chatCatchUpWhen(new Date(2026, 10, 12, 9, 5).toISOString(), now)).toBe(
      "Today, 9:05 AM",
    );
    expect(chatCatchUpWhen(new Date(2026, 10, 10, 17, 0).toISOString(), now)).toBe(
      "Tuesday, November 10, 5:00 PM",
    );
    expect(chatCatchUpWhen(new Date(2025, 11, 31, 17, 0).toISOString(), now)).toBe(
      "Wednesday, December 31, 2025, 5:00 PM",
    );
    expect(chatCatchUpWhen("not a date", now)).toBe("");
  });
});
