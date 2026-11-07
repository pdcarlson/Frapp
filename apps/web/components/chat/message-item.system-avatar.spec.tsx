import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import { NOBODY_BLOCKED } from "@/tests/block-list";
import { MessageItem } from "./message-item";

// Radix draws `AvatarImage` only once the image loads, which jsdom never does,
// so `message-item.spec.tsx` cannot see which image a row asks for. Here the
// image is a stub that records its `src`, so the source is under test (#3347).
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  AvatarImage: ({ src }: { src: string }) => (
    <span data-testid="avatar-image" data-src={src} />
  ),
  AvatarFallback: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));
vi.mock("./message-attachments", () => ({
  MessageAttachments: () => <ul data-testid="attachments" />,
}));

const VIEWER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function message(overrides: Partial<ChatMessage>): ChatMessage {
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
    mentions: [],
    reactions: {},
    actions: [],
    _status: "confirmed",
    ...overrides,
  } as ChatMessage;
}

function avatarSrc(msg: ChatMessage, avatarUrl?: string): string | null {
  const { queryByTestId } = render(
    <div role="list">
      <MessageItem
        blockState={NOBODY_BLOCKED}
        message={msg}
        viewerId={VIEWER}
        showHeader
        nameFor={() => null}
        avatarUrl={avatarUrl}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        isTapRevealed={false}
        onToggleTapReveal={vi.fn()}
      />
    </div>,
  );
  return queryByTestId("avatar-image")?.getAttribute("data-src") ?? null;
}

describe("MessageItem system avatar source", () => {
  it("asks for the synced crest for the system sender", () => {
    expect(
      avatarSrc(message({ sender_id: SYSTEM_SENDER_ID, kind: "system_audit" })),
    ).toBe("/brand/system-avatar.png");
  });

  it("keeps a member's own photo", () => {
    expect(avatarSrc(message({}), "https://example.test/a.png")).toBe(
      "https://example.test/a.png",
    );
  });
});
