/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { reactionActionType } from "@repo/chat-core/types";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * How a chat card reaches the actions sheet from its reactions (#3416).
 * `ReactionRow` draws the `+` only for a caller that passes `onLongPress`,
 * and a chip forwards its long press through the same prop, so every card
 * kind depends on `ChatCardShell` passing the row's actions there. The
 * announcement card stands in for the rest: they all take the shell whole.
 */

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

import { AnnouncementCard } from "./announcement-card";
import { ADD_REACTION_A11Y_LABEL } from "./message-item";

const VIEWER = "viewer-1";
const OTHER = "other-1";

function message(): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: OTHER,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: "Chapter at 8",
    kind: "announcement",
    payload: null,
    reply_to_id: null,
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: "2026-11-04T18:00:00.000Z",
    client_message_id: "client-1",
    attachment_count: 0,
    sender_blocked: false,
    _blockEvaluated: true,
    reactions: { [reactionActionType("🔥")]: [OTHER] },
    actions: [],
    _status: "confirmed",
  } as unknown as ChatMessage;
}

function mount() {
  const onOpenActions = vi.fn();
  const onReact = vi.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <AnnouncementCard
          message={message()}
          viewerId={VIEWER}
          isConfirmed
          onRetry={vi.fn()}
          onDiscard={vi.fn()}
          onReact={onReact}
          onUnreact={vi.fn()}
          onOpenActions={onOpenActions}
          body="Chapter at 8"
        />
      </FrappThemeProvider>,
    );
  });
  return { tree, onOpenActions, onReact };
}

const pressable = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === label,
  );

describe("a card's reactions", () => {
  it("follows them with a + that opens the message actions", () => {
    const { tree, onOpenActions } = mount();
    const add = pressable(tree, ADD_REACTION_A11Y_LABEL);

    act(() => add.props.onPress());
    expect(onOpenActions).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("opens the message actions on a long press of a reaction chip, not a toggle", () => {
    const { tree, onOpenActions, onReact } = mount();
    const chip = pressable(tree, "🔥, 1");

    act(() => chip.props.onLongPress());
    expect(onOpenActions).toHaveBeenCalledTimes(1);
    expect(onReact).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
