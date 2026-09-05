import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { QuotedMessage, ReplyQuote, replyPreviewText } from "./reply-quote";
import type { ChatMessage } from "@repo/chat-core/types";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: "22222222-2222-4222-8222-222222222222",
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
  } as ChatMessage;
}

/**
 * The preview is the only thing standing in for a whole message inside a quote,
 * so each branch here is a case where the naive `message.content` renders an
 * empty or misleading strip.
 */
describe("replyPreviewText", () => {
  it("uses the message body when there is one", () => {
    expect(replyPreviewText(message({ content: "hey there" }))).toBe(
      "hey there",
    );
  });

  it("collapses newlines, so a multi-paragraph parent stays one line", () => {
    // Not cosmetic: the strip is a single row above the composer, and a raw
    // multi-line body would set its height before CSS truncation applied.
    expect(
      replyPreviewText(message({ content: "first line\n\n  second line " })),
    ).toBe("first line second line");
  });

  it("says a deleted parent is deleted rather than quoting its blanked body", () => {
    // A deleted message's `content` is replaced server-side; falling through to
    // it would render an empty quote that reads as a rendering bug.
    expect(
      replyPreviewText(message({ is_deleted: true, content: "" })),
    ).toBe("[message deleted]");
  });

  it("prefers the tombstone even when a deleted row still carries content", () => {
    expect(
      replyPreviewText(message({ is_deleted: true, content: "leftover" })),
    ).toBe("[message deleted]");
  });

  it("describes a file-only message, which is a valid send with no body", () => {
    expect(
      replyPreviewText(message({ content: "", attachment_count: 1 })),
    ).toBe("Attachment");
    expect(
      replyPreviewText(message({ content: "", attachment_count: 3 })),
    ).toBe("3 attachments");
  });

  it("names the card kind when a card carries no free text", () => {
    expect(replyPreviewText(message({ content: "", kind: "poll" }))).toBe(
      "Poll",
    );
    expect(replyPreviewText(message({ content: "", kind: "event" }))).toBe(
      "Event",
    );
  });

  it("falls back to a generic label for a kind the map does not name", () => {
    // A kind must still quote as *something* — a blank strip beside an author
    // name reads as broken layout, not as missing data. `imported` is a real
    // kind deliberately absent from `KIND_LABELS` (an archive message is a
    // bubble, so it normally quotes by its body), which makes it the honest
    // fixture for the fallback: a made-up kind would only prove TypeScript
    // rejects made-up kinds.
    expect(replyPreviewText(message({ content: "", kind: "imported" }))).toBe(
      "Message",
    );
  });
});

describe("QuotedMessage", () => {
  it("renders as static text when it has nowhere to navigate", () => {
    render(<QuotedMessage author="Alice Chen" preview="hey there" />);
    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.getByText("hey there")).toBeInTheDocument();
    // The composer's staged-reply strip quotes a message with no thread to
    // open. Rendering a button there would be an inert control.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is a button when it can open the quoted message", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <QuotedMessage author="Alice Chen" preview="hey there" onOpen={onOpen} />,
    );
    await user.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("ReplyQuote", () => {
  it("quotes the parent when it is loaded", () => {
    render(<ReplyQuote parent={message({ content: "the parent" })} author="Alice Chen" />);
    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.getByText("the parent")).toBeInTheDocument();
  });

  it("says so when the parent is outside the loaded window", () => {
    // Not an edge case: nothing backfills older history (#1571), so every reply
    // to a message older than the one loaded window lands here. Rendering
    // nothing would make such a reply indistinguishable from a plain message.
    render(<ReplyQuote parent={null} author="" />);
    expect(screen.getByText(/isn’t loaded/i)).toBeInTheDocument();
  });
});
