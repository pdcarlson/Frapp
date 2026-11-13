/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  forwardedFromOf,
  type ChatMessage,
  type RawForwardedFrom,
} from "@repo/chat-core/types";
import type { BlockState } from "@repo/chat-core/blocks";
import { TOMBSTONE_TEXT } from "@repo/chat-core/block-copy";
import {
  FORWARDED_LABEL,
  FORWARDED_ORIGINAL_DELETED,
} from "@repo/chat-core/forwarded";
import { formatRelativeDayTime } from "@repo/formatting";
import { FrappThemeProvider } from "@/lib/theme";

// The forward card on the phone (#4864): "Forwarded", the original's author
// and time, its channel only where the viewer's list holds it and it isn't a
// conversation, its text, its GIF and its file count; the block placeholder
// for a blocked author, and the deleted line for a blanked copy. Rendered
// through the thread's row, so the wiring (beneath the comment, alone for an
// empty one, masked by the block list) is what is tested.

const CHANNELS = [
  { id: "chan-src", name: "general", type: "PUBLIC" },
  { id: "dm-1", name: "dm-a-b", type: "DM", member_ids: [] },
];

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useChannels: () => ({ data: CHANNELS, isPending: false }),
    useMessageAttachments: () => ({
      isPending: false,
      isError: false,
      data: [],
    }),
  };
});

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#C49A3A",
    accentPrimary: "#C49A3A",
    accentOnPrimary: "#2B2009",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
  }),
}));

import { ForwardedCard } from "./forwarded-card";
import { ThreadMessageRow } from "./thread-message-row";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const AUTHOR = "22222222-2222-4222-8222-222222222222";
const FORWARDER = "33333333-3333-4333-8333-333333333333";

const ORIGINAL_AT = new Date(2026, 10, 12, 20, 0).toISOString();

const nameFor = (id: string) =>
  id === AUTHOR ? "Alice Chen" : id === FORWARDER ? "Jake Smith" : null;

function copy(overrides: Partial<RawForwardedFrom> = {}) {
  return forwardedFromOf({
    message_id: "orig-1",
    channel_id: "chan-src",
    sender_id: AUTHOR,
    author_name: "Alice (then)",
    content: "see you at **8**",
    gif: null,
    attachment_count: 0,
    created_at: ORIGINAL_AT,
    ...overrides,
  })!;
}

function forward(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    channel_id: "chan-dest",
    sender_id: FORWARDER,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: "",
    kind: "text",
    payload: null,
    reply_to_id: null,
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: new Date(2026, 10, 13, 18, 0).toISOString(),
    client_message_id: "client-1",
    attachment_count: 0,
    mentions: [],
    sender_blocked: false,
    _blockEvaluated: true,
    reactions: {},
    actions: [],
    _status: "confirmed",
    forwarded_from: copy(),
    ...overrides,
  };
}

function blockState(ids: string[] = []): BlockState {
  return {
    status: "ready",
    ids: new Set(ids),
    unblocked: new Set(),
    cleared: new Set(),
  };
}

function renderRow(
  message: ChatMessage,
  options: { blocked?: string[]; replyParent?: ChatMessage | null } = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ThreadMessageRow
          row={{ message, visibility: "visible" }}
          startsRun
          startsDay={false}
          viewerId={VIEWER}
          nameFor={nameFor}
          replyParent={options.replyParent}
          blockState={blockState(options.blocked)}
          onVote={vi.fn()}
          onClosePoll={vi.fn()}
          onCloseCard={vi.fn()}
          onRetry={vi.fn()}
          onDiscard={vi.fn()}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
          onOpenActions={vi.fn()}
          onJumpToMessage={vi.fn()}
          onUnblock={vi.fn()}
          maskedRefresh={new Map()}
          onReload={vi.fn()}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function flat(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

function card(tree: ReactTestRenderer) {
  return tree.root.findAll((node) => node.props.testID === "forwarded-card");
}

describe("ForwardedCard in the thread (#4864)", () => {
  it("draws the label, the roster's name for the author, the time, the channel and the text", () => {
    const tree = renderRow(forward());
    expect(card(tree).length).toBeGreaterThan(0);
    const drawn = flat(tree);
    expect(drawn).toContain(FORWARDED_LABEL);
    expect(drawn).toContain("Alice Chen");
    expect(drawn).not.toContain("Alice (then)");
    expect(drawn).toContain(formatRelativeDayTime(ORIGINAL_AT));
    expect(drawn).toContain("in #general");
    expect(drawn).toContain("see you at ");
    // Markdown is drawn, not printed raw.
    expect(drawn).not.toContain("**8**");
  });

  it("falls back to the copy's name when the roster doesn't hold the author", () => {
    const tree = renderRow(
      forward({ forwarded_from: copy({ sender_id: "nobody" }) }),
    );
    expect(flat(tree)).toContain("Alice (then)");
  });

  it("draws the forwarder's comment above the card", () => {
    const tree = renderRow(forward({ content: "look at this" }));
    const drawn = flat(tree);
    expect(drawn.indexOf("look at this")).toBeLessThan(
      drawn.indexOf(FORWARDED_LABEL),
    );
  });

  it("names no conversation, and no channel the viewer's list lacks", () => {
    for (const channelId of ["dm-1", "chan-private"]) {
      const tree = renderRow(
        forward({ forwarded_from: copy({ channel_id: channelId }) }),
      );
      expect(flat(tree)).not.toContain("in #");
    }
  });

  it("counts the original's files rather than drawing them", () => {
    expect(
      flat(
        renderRow(forward({ forwarded_from: copy({ attachment_count: 1 }) })),
      ),
    ).toContain("1 attachment");
    expect(
      flat(
        renderRow(forward({ forwarded_from: copy({ attachment_count: 3 }) })),
      ),
    ).toContain("3 attachments");
  });

  it("draws the original's GIF", () => {
    const gif = {
      provider: "klipy",
      id: "g1",
      title: "party",
      url: "https://static.klipy.com/g1.webp",
      width: 200,
      height: 100,
    };
    const tree = renderRow(
      forward({ forwarded_from: copy({ content: "", gif }) }),
    );
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "GIF: party",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("says the original was deleted for a blanked copy", () => {
    const tree = renderRow(
      forward({
        forwarded_from: copy({
          deleted: true,
          content: "",
          sender_id: null,
          author_name: null,
        }),
      }),
    );
    const drawn = flat(tree);
    expect(drawn).toContain(FORWARDED_ORIGINAL_DELETED);
    expect(drawn).not.toContain("Alice");
  });

  it("draws a blocked author's copy as the block placeholder, nothing of theirs", () => {
    const tree = renderRow(
      forward({ forwarded_from: copy({ attachment_count: 2 }) }),
      { blocked: [AUTHOR] },
    );
    const drawn = flat(tree);
    expect(drawn).toContain(FORWARDED_LABEL);
    expect(drawn).toContain(TOMBSTONE_TEXT);
    expect(drawn).not.toContain("see you at");
    expect(drawn).not.toContain("Alice");
    expect(drawn).not.toContain("attachments");
  });

  it("draws no card on a deleted forward", () => {
    const tree = renderRow(forward({ is_deleted: true }));
    expect(card(tree)).toHaveLength(0);
  });

  it("quotes a forwarded parent's copy only where the list clears its author", () => {
    const reply = forward({
      id: "r1",
      client_message_id: "client-r1",
      sender_id: VIEWER,
      content: "agreed",
      forwarded_from: null,
      reply_to_id: "m1",
    });
    const parent = forward();
    expect(flat(renderRow(reply, { replyParent: parent }))).toContain(
      "Forwarded: see you at",
    );
    const masked = flat(
      renderRow(reply, { replyParent: parent, blocked: [AUTHOR] }),
    );
    expect(masked).not.toContain("see you at");
  });
});

describe("ForwardedCard on its own", () => {
  it("draws the viewer's own original as You", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <ForwardedCard
            forwarded={copy({ sender_id: VIEWER })}
            hidden={null}
            nameFor={nameFor}
            viewerId={VIEWER}
          />
        </FrappThemeProvider>,
      );
    });
    expect(flat(tree)).toContain("You");
  });
});
