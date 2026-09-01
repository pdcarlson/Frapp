/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { reactionActionType } from "@repo/chat-core/types";
import { FrappThemeProvider } from "@/lib/theme";

const attachmentHook = vi.hoisted(() => ({
  calls: [] as Array<{ enabled: boolean }>,
}));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useMessageAttachments: (
      _channelId: string,
      _messageId: string,
      enabled: boolean,
    ) => {
      attachmentHook.calls.push({ enabled });
      return { isPending: false, isError: false, data: [] };
    },
  };
});

// `useChapterBranding` reaches for `useCurrentChapter` (`@repo/hooks`), which
// needs `FrappClientProvider` — a client this file's tests, focused on the
// attachment-mount gate, have no reason to provide. `chapter-branding.spec.tsx`
// owns the branding/accent behavior itself.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#C49A3A",
    accentFallbackApplied: false,
    accentPrimary: "#C49A3A",
    accentOnPrimary: "#2B2009",
    logoUrl: null,
    chapterName: null,
  }),
}));

import {
  formatMessageTime,
  groupReactions,
  MessageBubble,
} from "./message-bubble";

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

/**
 * Where the attachment renderer is allowed to mount.
 *
 * The gate lives here rather than in `MessageAttachments` because the query hook
 * inside it reaches for `FrappClientProvider` on render — so "don't fetch" is not
 * enough, the component must not mount at all for the overwhelming majority of
 * rows. #1229.
 */
function renderBubble(message: ChatMessage): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MessageBubble
          message={message}
          viewerId={VIEWER}
          nameFor={() => "Casey"}
          onRetry={vi.fn()}
          onDiscard={vi.fn()}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

describe("attachment rendering is gated on the message", () => {
  beforeEach(() => {
    attachmentHook.calls = [];
  });

  it("mounts the renderer for a message that has attachments", () => {
    renderBubble(message({ attachment_count: 2 }));
    expect(attachmentHook.calls).toEqual([{ enabled: true }]);
  });

  it("does not mount it for a plain text message", () => {
    renderBubble(message({ attachment_count: 0 }));
    expect(attachmentHook.calls).toEqual([]);
  });

  it("does not mount it for a deleted message that had attachments", () => {
    // The API 404s the attachment list for a deleted message, but the client
    // must not offer the affordance in the first place.
    renderBubble(message({ attachment_count: 3, is_deleted: true }));
    expect(attachmentHook.calls).toEqual([]);
  });

  it("no longer renders the open-on-web placeholder", () => {
    // #1228's stopgap. It was honest but it was a dead end, and the acceptance
    // criteria require it deleted rather than left alongside the real renderer.
    const rendered = JSON.stringify(
      renderBubble(message({ attachment_count: 1 })).toJSON(),
    );
    expect(rendered).not.toContain("open on web");
  });
});

// #1007: the self bubble is the one surface that takes the chapter accent
// (components.md:210) via the mocked `useChapterBranding()` pair above.
describe("self bubble takes the chapter accent (#1007)", () => {
  it("fills the bubble with accentPrimary and colours its text accentOnPrimary", () => {
    const rendered = renderBubble(
      message({ sender_id: VIEWER, content: "hello" }),
    ).toJSON();

    // Flatten style arrays the way RN itself would, and pull every resolved
    // backgroundColor/color across the tree — asserting on the JSON string
    // would also pass for a coincidental substring match, and asserting only
    // the outermost node would miss the fill living on a nested View.
    const flat = JSON.stringify(rendered);
    expect(flat).toContain('"backgroundColor":"#C49A3A"');
    expect(flat).toContain('"color":"#2B2009"');
  });

  it("never resolves branding colours for an incoming message", () => {
    // Guards the split in MessageBubble: an incoming row must not call
    // useChapterBranding() at all, so its rendered tree carries neither
    // mocked colour — regression coverage for that isolation, not just this
    // test's own fixture values.
    const rendered = renderBubble(
      message({ sender_id: OTHER, content: "hello" }),
    ).toJSON();

    const flat = JSON.stringify(rendered);
    expect(flat).not.toContain("#C49A3A");
    expect(flat).not.toContain("#2B2009");
  });
});
