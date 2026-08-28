/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { reactionActionType } from "@repo/chat-core/types";
import { formatMessageTime, groupReactions } from "./message-bubble";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: OTHER,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: "hello",
    kind: "text",
    payload: null,
    reply_to_id: null,
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: new Date(2026, 7, 16, 17, 9).toISOString(),
    client_message_id: "client-1",
    attachment_count: 0,
    reactions: {},
    actions: [],
    _status: "confirmed",
    ...overrides,
  };
}

// `senderLabel` moved to `lib/chat/display-name.ts` when the display-name
// resolution landed, and its cases moved with it — see `display-name.spec.ts`.
// It no longer takes a `ChatMessage`, so it needs none of this file's factory.

describe("formatMessageTime", () => {
  it("renders a clock time", () => {
    // Asserts the minutes only. `toLocaleTimeString` is locale-dependent — the
    // same instant is "5:09 PM" under en-US and "17:09" under en-GB or de-DE —
    // so pinning the hour would fail on any runner whose locale is not US, for
    // no real defect.
    expect(
      formatMessageTime(new Date(2026, 7, 16, 17, 9).toISOString()),
    ).toMatch(/:09/);
  });

  it("returns an empty string rather than 'Invalid Date'", () => {
    expect(formatMessageTime("banana")).toBe("");
  });
});

describe("groupReactions", () => {
  it("decodes the action type back to its emoji and counts the users", () => {
    const groups = groupReactions(
      message({ reactions: { [reactionActionType("👍")]: [VIEWER, OTHER] } }),
      VIEWER,
    );

    expect(groups).toEqual([
      {
        emoji: "👍",
        actionType: reactionActionType("👍"),
        count: 2,
        mine: true,
      },
    ]);
  });

  it("marks a reaction as not mine when the viewer is absent", () => {
    const groups = groupReactions(
      message({ reactions: { [reactionActionType("🔥")]: [OTHER] } }),
      VIEWER,
    );

    expect(groups[0]?.mine).toBe(false);
  });

  it("never marks a reaction mine when there is no viewer id", () => {
    // The wrong id here is the documented C1 trap: using the Supabase auth uid
    // instead of `users.id` renders fine but silently breaks own-reaction
    // state and the RLS-scoped delete behind `unreact`.
    const groups = groupReactions(
      message({ reactions: { [reactionActionType("🔥")]: [OTHER] } }),
      null,
    );

    expect(groups[0]?.mine).toBe(false);
  });

  it("drops emptied groups and non-reaction action types", () => {
    const groups = groupReactions(
      message({
        reactions: {
          [reactionActionType("👍")]: [],
          "rsvp:going": [VIEWER],
          [reactionActionType("✅")]: [OTHER],
        },
      }),
      VIEWER,
    );

    // A card action is not a reaction and must not render as a chip; an emptied
    // group would otherwise render as a chip reading "0".
    expect(groups.map((g) => g.emoji)).toEqual(["✅"]);
  });

  it("survives a message with no reactions at all", () => {
    expect(groupReactions(message(), VIEWER)).toEqual([]);
  });
});
