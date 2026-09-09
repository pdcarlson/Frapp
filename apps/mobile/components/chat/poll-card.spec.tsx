/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { FrappThemeProvider } from "@/lib/theme";
import { UNCONFIRMED_NOTE, RECORDED_NOTE } from "@/lib/chat/delivery-status";

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

import { PollCard } from "./poll-card";

const VIEWER = "11111111-1111-4111-8111-111111111111";

function poll(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: VIEWER,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: "Lunch?",
    kind: "poll",
    payload: {
      question: "Lunch?",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      closes_at: "",
    },
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

function renderPoll(message: ChatMessage): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <PollCard
          message={message}
          viewerId={VIEWER}
          isConfirmed={message._status === "confirmed"}
          nameFor={() => "Casey"}
          onVote={vi.fn()}
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

describe("PollCard delivery status (#1910)", () => {
  it("does not render an unconfirmed poll as a fully-sent card", () => {
    const flat = JSON.stringify(
      renderPoll(poll({ _status: "unconfirmed" })).toJSON(),
    );
    expect(flat).toContain(UNCONFIRMED_NOTE);
    expect(flat).not.toContain("Discard this message");
    expect(flat).not.toContain("Retry sending this message");
    expect(flat).not.toContain("Send failed");
  });

  it("renders recorded as a don't-run-again note with no discard", () => {
    const flat = JSON.stringify(
      renderPoll(poll({ _status: "recorded" })).toJSON(),
    );
    expect(flat).toContain(RECORDED_NOTE);
    expect(flat).not.toContain("Discard this message");
    expect(flat).not.toContain("Retry sending this message");
  });

  it("keeps retry and discard on a failed poll", () => {
    const flat = JSON.stringify(
      renderPoll(poll({ _status: "failed" })).toJSON(),
    );
    expect(flat).toContain("Send failed");
    expect(flat).toContain("Retry sending this message");
    expect(flat).toContain("Discard this message");
  });
});
