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

  it("neuters a tab-obfuscated javascript: link", () => {
    const { container } = render(
      <TextRenderer
        message={message("[click me](jav\tascript:alert(1))")}
        isSelf={false}
      />,
    );
    expect(container.querySelector("a")).toBeNull();
  });

  it("neuters a protocol-relative link instead of linking off-site", () => {
    const { container } = render(
      <TextRenderer
        message={message("[click me](//attacker.example/login)")}
        isSelf={false}
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click me");
  });

  it("still links a normal relative path on this site", () => {
    render(
      <TextRenderer message={message("see [settings](/settings)")} isSelf={false} />,
    );
    const link = screen.getByRole("link", { name: "settings" });
    expect(link).toHaveAttribute("href", "/settings");
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

/**
 * The §11 in-bubble mention highlight — `components.md` carried it as a
 * TODO-DESIGN, and staging showed why it mattered: `@Name` rendered as plain
 * body text, so a message that addressed you looked exactly like one that did
 * not.
 *
 * Two rules these pin, both of which a "make mentions stand out" change is
 * likely to break in passing. The chip goes on the **handle only** — retinting
 * the bubble would overwrite the one thing a bubble's fill already says, whose
 * message this is — and the run it wraps is decided by the *server's*
 * tokenizer, so the UI never claims a mention the API did not see.
 */
describe("TextRenderer mention chips", () => {
  function chips(container: HTMLElement) {
    return Array.from(container.querySelectorAll("mark"));
  }

  it("chips the handle in an incoming bubble", () => {
    const { container } = render(
      <TextRenderer message={message("morning @Alice, agenda attached")} isSelf={false} />,
    );

    const [chip] = chips(container);
    expect(chip?.textContent).toBe("@Alice");
    expect(chip?.className).toContain("bg-mention-chip");
    expect(chip?.className).toContain("text-mention-chip-text");
    // The token the server would resolve, not the label the reader sees — the
    // two differ the moment a mention ends a sentence.
    expect(chip?.getAttribute("data-mention")).toBe("Alice");
  });

  it("chips the handle in a self bubble too, with the same recipe", () => {
    const { container } = render(
      <TextRenderer message={message("thanks @Alice")} isSelf />,
    );

    const [chip] = chips(container);
    expect(chip?.textContent).toBe("@Alice");
    // Identical paint on both sides: the chip is opaque precisely so it does
    // not have to know whether the chapter accent under it is light or dark.
    expect(chip?.className).toContain("bg-mention-chip");
    expect(chip?.className).toContain("text-mention-chip-text");
  });

  it("leaves the bubble's own fill alone on both sides", () => {
    // "Don't retint the whole bubble." A mention is an address inside someone's
    // message; the bubble still has to say whose message it is.
    const incoming = render(
      <TextRenderer message={message("ping @Alice")} isSelf={false} />,
    );
    const incomingBubble = incoming.container.querySelector('[class*="rounded-"]');
    expect(incomingBubble?.className).toContain("bg-card");
    expect(incomingBubble?.className).not.toContain("mention");
    incoming.unmount();

    const self = render(<TextRenderer message={message("ping @Alice")} isSelf />);
    const selfBubble = self.container.querySelector('[class*="rounded-"]');
    expect(selfBubble?.className).toContain("bg-primary");
    expect(selfBubble?.className).not.toContain("mention");
  });

  it("chips every occurrence, not just the first", () => {
    const { container } = render(
      <TextRenderer message={message("@Alice and @Bob and @Alice again")} isSelf={false} />,
    );

    expect(chips(container).map((c) => c.textContent)).toEqual([
      "@Alice",
      "@Bob",
      "@Alice",
    ]);
  });

  it("reaches a handle inside bold and italic text", () => {
    const { container } = render(
      <TextRenderer message={message("**ping @Alice** and *cc @Bob*")} isSelf={false} />,
    );

    expect(chips(container).map((c) => c.textContent)).toEqual(["@Alice", "@Bob"]);
    expect(container.querySelector("strong")?.textContent).toContain("@Alice");
  });

  it("leaves a handle inside code alone — that is documenting one, not making one", () => {
    const { container } = render(
      <TextRenderer message={message("type `@channel` to address everyone")} isSelf={false} />,
    );

    expect(chips(container)).toHaveLength(0);
    expect(container.querySelector("code")?.textContent).toBe("@channel");
  });

  it("does not chip an email address", () => {
    // The shared tokenizer's lookbehind is what stops this; asserting it here
    // is what catches a renderer that stops using the shared tokenizer.
    const { container } = render(
      <TextRenderer message={message("mail alice@example.com about it")} isSelf={false} />,
    );

    expect(chips(container)).toHaveLength(0);
  });

  it("keeps the trailing punctuation outside the chip", () => {
    // `@jane.` tokenises as `jane`, so the stop is prose and must stay prose —
    // chipping it would paint a run nobody was notified about.
    const { container } = render(
      <TextRenderer message={message("over to @Alice.")} isSelf={false} />,
    );

    const [chip] = chips(container);
    expect(chip?.textContent).toBe("@Alice");
    expect(container.textContent).toBe("over to @Alice.");
  });

  it("still renders no raw HTML through the chip path", () => {
    // The chip is the first thing to add an element to the allowlist, so the
    // XSS-safe guarantee is re-asserted with a mention in the same message.
    const { container } = render(
      <TextRenderer
        message={message('@Alice <img src=x onerror="alert(1)"> <mark>hi</mark>')}
        isSelf={false}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    // The one `mark` is the chip this renderer made, never the one the message
    // typed — `unwrapDisallowed` cannot promote authored text to an element.
    expect(chips(container).map((c) => c.textContent)).toEqual(["@Alice"]);
    expect(container.textContent).toContain("<mark>hi</mark>");
  });
});
