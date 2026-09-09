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

import { UNAVAILABLE_QUOTE, DELETED_MESSAGE_PLACEHOLDER } from "@repo/chat-core/reply-preview";
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
function renderBubble(
  message: ChatMessage,
  replyParent?: ChatMessage | null,
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MessageBubble
          message={message}
          viewerId={VIEWER}
          nameFor={() => "Casey"}
          replyParent={replyParent}
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

const PARENT_ID = "msg-parent";

function parentRow(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return message({
    id: PARENT_ID,
    content: "the original",
    sender_id: OTHER,
    ...overrides,
  });
}

describe("reply quote (#1727)", () => {
  it("renders the quoted parent above an incoming reply", () => {
    const flat = JSON.stringify(
      renderBubble(
        message({ reply_to_id: PARENT_ID, content: "agreed" }),
        parentRow(),
      ).toJSON(),
    );
    expect(flat).toContain("the original");
    expect(flat).toContain("Casey");
    expect(flat).toContain("agreed");
  });

  it("says so when the parent is outside the loaded window", () => {
    // Nothing backfills older history (#1571). Rendering nothing would make
    // this reply indistinguishable from a plain message.
    const flat = JSON.stringify(
      renderBubble(
        message({ reply_to_id: PARENT_ID, content: "agreed" }),
        null,
      ).toJSON(),
    );
    expect(flat).toContain(UNAVAILABLE_QUOTE);
    expect(flat).not.toContain("the original");
  });

  it("does not quote on a message that is not a reply", () => {
    const flat = JSON.stringify(
      renderBubble(message({ content: "hello" })).toJSON(),
    );
    expect(flat).not.toContain(UNAVAILABLE_QUOTE);
  });

  it("hides the quote on a deleted reply", () => {
    const flat = JSON.stringify(
      renderBubble(
        message({
          reply_to_id: PARENT_ID,
          is_deleted: true,
          content: "",
        }),
        parentRow(),
      ).toJSON(),
    );
    expect(flat).not.toContain("the original");
    expect(flat).toContain(DELETED_MESSAGE_PLACEHOLDER);
  });

  it("quotes a deleted parent as the tombstone, not as a blank", () => {
    const flat = JSON.stringify(
      renderBubble(
        message({ reply_to_id: PARENT_ID, content: "agreed" }),
        parentRow({ is_deleted: true, content: "" }),
      ).toJSON(),
    );
    expect(flat).toContain("[message deleted]");
    expect(flat).toContain("agreed");
  });

  it("flattens markdown in the parent using the shared preview rules", () => {
    // Mobile bubbles still print `content` raw (no markdown renderer on this
    // surface). The quote uses the web preview rules on purpose (#1727), so
    // `_really_ urgent` becomes `really urgent` in the strip even though the
    // parent row would still show the underscores.
    const flat = JSON.stringify(
      renderBubble(
        message({ reply_to_id: PARENT_ID, content: "agreed" }),
        parentRow({ content: "_really_ urgent" }),
      ).toJSON(),
    );
    expect(flat).toContain("really urgent");
    expect(flat).not.toContain("_really_");
  });

  it("still quotes on a self bubble", () => {
    const flat = JSON.stringify(
      renderBubble(
        message({
          sender_id: VIEWER,
          reply_to_id: PARENT_ID,
          content: "agreed",
        }),
        parentRow(),
      ).toJSON(),
    );
    expect(flat).toContain("the original");
    expect(flat).toContain("agreed");
  });
});

describe("self-bubble delivery status (#1910)", () => {
  const DESTRUCTIVE = "#F85149";

  it("renders an unconfirmed row as a muted note, not as delivered", () => {
    const flat = JSON.stringify(
      renderBubble(
        message({
          sender_id: VIEWER,
          _status: "unconfirmed",
          _error:
            "Not confirmed — these points may or may not have been recorded.",
        }),
      ).toJSON(),
    );

    expect(flat).toContain("Not confirmed — these points may or may not have been recorded.");
    expect(flat).not.toContain("Send failed");
    expect(flat).not.toContain("Discard this message");
    expect(flat).not.toContain("Retry sending this message");
    // Delivered rows offer the first-reaction chip; a placeholder must not.
    expect(flat).not.toContain("👍 +");
    // Not a known failure — red is what makes an officer re-type the command.
    expect(flat).not.toContain(DESTRUCTIVE);
  });

  it("never offers discard on an unconfirmed row even when a handler is wired", () => {
    // renderBubble always wires onDiscard. The control must not appear.
    const flat = JSON.stringify(
      renderBubble(
        message({ sender_id: VIEWER, _status: "unconfirmed" }),
      ).toJSON(),
    );
    expect(flat).toContain("Not confirmed");
    expect(flat).not.toContain("Discard");
  });

  it("renders a recorded row as a muted don't-run-again note, with no retry", () => {
    const flat = JSON.stringify(
      renderBubble(
        message({
          sender_id: VIEWER,
          _status: "recorded",
          _error:
            "Points recorded — the chat card didn't post. Don't run this command again.",
        }),
      ).toJSON(),
    );

    expect(flat).toContain("Don't run this command again.");
    expect(flat).not.toContain("Discard this message");
    expect(flat).not.toContain("Retry sending this message");
    expect(flat).not.toContain(DESTRUCTIVE);
  });

  it("keeps failed rows red with retry and discard", () => {
    const flat = JSON.stringify(
      renderBubble(
        message({ sender_id: VIEWER, _status: "failed" }),
      ).toJSON(),
    );

    expect(flat).toContain("Send failed");
    expect(flat).toContain("Retry sending this message");
    expect(flat).toContain("Discard this message");
    expect(flat).toContain(DESTRUCTIVE);
  });

  it("keeps a confirmed self bubble on the time-only meta line", () => {
    const flat = JSON.stringify(
      renderBubble(message({ sender_id: VIEWER, _status: "confirmed" })).toJSON(),
    );

    expect(flat).not.toContain("Not confirmed");
    expect(flat).not.toContain("Send failed");
    expect(flat).not.toContain("sending");
    expect(flat).toContain("👍 +");
  });

  it("still shows sending on a pending self bubble", () => {
    const flat = JSON.stringify(
      renderBubble(message({ sender_id: VIEWER, _status: "pending" })).toJSON(),
    );
    expect(flat).toContain("sending");
    expect(flat).not.toContain("Discard this message");
  });
});

