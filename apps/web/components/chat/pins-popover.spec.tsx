import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { PinsPanel } from "./pins-popover";
import type { ChatMessage } from "@repo/chat-core/types";

const OTHER = "22222222-2222-4222-8222-222222222222";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: OTHER,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: "the dues link",
    kind: "text",
    payload: null,
    reply_to_id: null,
    is_pinned: true,
    pinned_at: new Date(2026, 7, 16, 17, 9).toISOString(),
    edited_at: null,
    is_deleted: false,
    created_at: new Date(2026, 7, 16, 17, 9).toISOString(),
    client_message_id: "client-1",
    attachment_count: 0,
    reactions: {},
    actions: [],
    _status: "confirmed",
    ...overrides,
  } as ChatMessage;
}

const nameFor = (id: string) => (id === OTHER ? "Alice Chen" : null);

describe("PinsPanel", () => {
  it("says pins the block list hides are hidden, never that nothing is pinned (#2313)", () => {
    render(
      <PinsPanel
        messages={[]}
        hidden={{ blocked: 2, held: 1 }}
        nameFor={nameFor}
      />,
    );
    expect(
      screen.getByText("2 pinned messages are hidden by your block list."),
    ).toBeInTheDocument();
    // Held pins are not the block list's doing yet: it cannot vouch for them.
    expect(
      screen.getByText("1 pinned message is waiting on your block list."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nothing pinned yet/)).not.toBeInTheDocument();
  });

  it("lists the pins it may show, and says the rest are hidden", () => {
    render(
      <PinsPanel
        messages={[message()]}
        hidden={{ blocked: 1, held: 0 }}
        nameFor={nameFor}
      />,
    );
    expect(screen.getByText("the dues link")).toBeInTheDocument();
    expect(
      screen.getByText("1 pinned message is hidden by your block list."),
    ).toBeInTheDocument();
  });

  it("previews a pinned poll by its kind noun, not an empty block", () => {
    render(
      <PinsPanel
        messages={[message({ id: "poll-1", content: "", kind: "poll" })]}
        nameFor={nameFor}
      />,
    );

    expect(screen.getByText("Poll")).toBeInTheDocument();
  });

  it("previews a file-only pin as an attachment count", () => {
    render(
      <PinsPanel
        messages={[message({ id: "file-1", content: "", attachment_count: 3 })]}
        nameFor={nameFor}
      />,
    );

    expect(screen.getByText("3 attachments")).toBeInTheDocument();
  });

  it("jumps to the message a row names", async () => {
    const onJump = vi.fn();
    render(
      <PinsPanel messages={[message()]} nameFor={nameFor} onJump={onJump} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /dues link/ }));

    expect(onJump).toHaveBeenCalledWith("msg-1");
  });
});
