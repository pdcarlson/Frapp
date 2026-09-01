import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { TextRenderer } from "./text-renderer";

// #369: the timeline used to render `message.content` as plain text, so a
// sender who typed `**bold**` (per `spec/behavior/chat/README.md`'s "Text
// formatting") saw it echoed back to every reader as literal asterisks.

function message(content: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: "11111111-1111-4111-8111-111111111111",
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content,
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

describe("TextRenderer formatting", () => {
  it("renders bold, italic and inline code instead of literal syntax", () => {
    const { container } = render(
      <TextRenderer message={message("**bold** and *italic* and `code`")} isSelf={false} />,
    );
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("em")).toHaveTextContent("italic");
    expect(container.querySelector("code")).toHaveTextContent("code");
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("`code`");
  });

  it("renders a fenced code block distinctly from inline code", () => {
    const { container } = render(
      <TextRenderer message={message("```\nconst x = 1;\n```")} isSelf={false} />,
    );
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code).toHaveClass("block");
    expect(code).toHaveTextContent("const x = 1;");
  });

  it("renders a safe link as a real, new-tab anchor", () => {
    render(
      <TextRenderer
        message={message("see [the docs](https://example.com/docs)")}
        isSelf={false}
      />,
    );
    const link = screen.getByRole("link", { name: "the docs" });
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("neuters a javascript: link instead of producing an executable href", () => {
    const { container } = render(
      <TextRenderer
        message={message("[click me](javascript:alert(1))")}
        isSelf={false}
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click me");
  });

  it("never injects raw HTML from message content", () => {
    const { container } = render(
      <TextRenderer
        message={message('<img src=x onerror="alert(1)"> and <script>alert(2)</script>')}
        isSelf={false}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    // The raw tags render as inert text — they came in as message content,
    // not markup, and must survive as visible (if ugly) text, not vanish
    // silently, which would be its own kind of surprising.
    expect(container.textContent).toContain("onerror");
  });

  it("does not blow a leading '# ' up into a heading — outside the spec'd formatting set", () => {
    const { container } = render(
      <TextRenderer message={message("# not a heading")} isSelf={false} />,
    );
    expect(container.querySelector("h1")).toBeNull();
    expect(container.textContent).toContain("not a heading");
  });

  it("still shows the deleted-message tombstone unchanged", () => {
    render(<TextRenderer message={message("**bold**", { is_deleted: true })} isSelf={false} />);
    expect(screen.getByText("[message deleted]")).toBeInTheDocument();
  });
});
