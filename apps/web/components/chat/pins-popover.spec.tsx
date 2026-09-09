import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { PinsPopover } from "./pins-popover";
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

describe("PinsPopover", () => {
  it("previews a pinned poll by its kind noun, not an empty block", async () => {
    render(
      <PinsPopover
        messages={[message({ id: "poll-1", content: "", kind: "poll" })]}
        nameFor={nameFor}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "1 pinned messages" }),
    );

    expect(screen.getByText("Poll")).toBeInTheDocument();
  });

  it("previews a file-only pin as an attachment count", async () => {
    render(
      <PinsPopover
        messages={[
          message({ id: "file-1", content: "", attachment_count: 3 }),
        ]}
        nameFor={nameFor}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "1 pinned messages" }),
    );

    expect(screen.getByText("3 attachments")).toBeInTheDocument();
  });

  it("jumps and dismisses so the panel does not cover the message", async () => {
    const onJump = vi.fn();
    render(
      <PinsPopover
        messages={[message()]}
        nameFor={nameFor}
        onJump={onJump}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "1 pinned messages" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /dues link/ }));

    expect(onJump).toHaveBeenCalledWith("msg-1");
    expect(
      screen.queryByText("Pinned in this channel"),
    ).not.toBeInTheDocument();
  });
});
