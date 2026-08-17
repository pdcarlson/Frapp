import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MessageItem } from "./message-item";
import type { ChatMessage } from "@/lib/chat/types";

/**
 * `spec/ui/design-system/components.md` specifies the incoming meta line as
 * `Name · time` with an initials avatar. Until display-name resolution landed
 * this row rendered `Member 2f4a1c` with a uuid-derived avatar, so these assert
 * the resolved rendering and keep the truncated id as the degraded case only.
 */
const VIEWER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: OTHER,
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
    reactions: {},
    actions: [],
    _status: "confirmed",
    ...overrides,
  } as ChatMessage;
}

type NameResolver = (id: string) => string | null;

const nameFor: NameResolver = (id) => (id === OTHER ? "Alice Chen" : null);

function renderItem(msg: ChatMessage, resolver: NameResolver = nameFor) {
  return render(
    <ul>
      <MessageItem
        message={msg}
        viewerId={VIEWER}
        showHeader
        nameFor={resolver}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
      />
    </ul>,
  );
}

describe("MessageItem author rendering", () => {
  it("renders the resolved display name", () => {
    renderItem(message());

    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.queryByText(/^Member /)).not.toBeInTheDocument();
  });

  it("derives the avatar from the name, not the uuid", () => {
    renderItem(message());

    expect(screen.getByText("AC")).toBeInTheDocument();
    expect(screen.queryByText("22")).not.toBeInTheDocument();
  });

  it("falls back to a truncated id when the sender is unresolvable", () => {
    renderItem(message(), () => null);

    expect(screen.getByText("Member 222222")).toBeInTheDocument();
  });

  it("treats an empty resolved name as unresolvable rather than blank", () => {
    // users.display_name is NOT NULL DEFAULT '', so '' is the real missing case.
    renderItem(message(), () => "");

    expect(screen.getByText("Member 222222")).toBeInTheDocument();
  });

  it("still says 'You' for the viewer's own message", () => {
    renderItem(message({ sender_id: VIEWER }));

    expect(screen.getByText("You")).toBeInTheDocument();
  });
});
