import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CHAT_MESSAGE_CONTENT_MAX_LENGTH, extractMentionTokens } from "@repo/validation";
import type { ChatMessage } from "@repo/chat-core/types";
import { MAX_MESSAGE_MARKDOWN_DEPTH, skipsMarkdownParse } from "@repo/chat-core/markdown";
import {
  COSTLY_MARKDOWN_BODIES,
  NEAR_BUDGET_MARKDOWN_BODY,
} from "@repo/chat-core/test/markdown-parse-budget.fixtures";
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
      <TextRenderer message={message("**bold** and *italic* and `code`")} />,
    );
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("em")).toHaveTextContent("italic");
    expect(container.querySelector("code")).toHaveTextContent("code");
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("`code`");
  });

  it("renders a fenced code block distinctly from inline code", () => {
    const { container } = render(
      <TextRenderer message={message("```\nconst x = 1;\n```")} />,
    );
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    // A full-width inline-block: its own box, inside the body's inline flow.
    expect(code).toHaveClass("inline-block", "w-full");
    expect(code).toHaveTextContent("const x = 1;");
  });

  it("renders a safe link as a real, new-tab anchor", () => {
    render(
      <TextRenderer
        message={message("see [the docs](https://example.com/docs)")}
       
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
       
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click me");
  });

  it("neuters a tab-obfuscated javascript: link", () => {
    const { container } = render(
      <TextRenderer
        message={message("[click me](jav\tascript:alert(1))")}
       
      />,
    );
    expect(container.querySelector("a")).toBeNull();
  });

  it("neuters a protocol-relative link instead of linking off-site", () => {
    const { container } = render(
      <TextRenderer
        message={message("[click me](//attacker.example/login)")}
       
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click me");
  });

  it("still links a normal relative path on this site", () => {
    render(
      <TextRenderer message={message("see [settings](/settings)")} />,
    );
    const link = screen.getByRole("link", { name: "settings" });
    expect(link).toHaveAttribute("href", "/settings");
  });

  it("never injects raw HTML from message content", () => {
    const { container } = render(
      <TextRenderer
        message={message('<img src=x onerror="alert(1)"> and <script>alert(2)</script>')}
       
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
      <TextRenderer message={message("# not a heading")} />,
    );
    expect(container.querySelector("h1")).toBeNull();
    expect(container.textContent).toContain("not a heading");
  });

  it("still shows the deleted-message tombstone unchanged", () => {
    render(<TextRenderer message={message("**bold**", { is_deleted: true })} />);
    expect(screen.getByText("[message deleted]")).toBeInTheDocument();
  });
});

/**
 * The §11 in-body mention chip — `components.md` carried it as a TODO-DESIGN,
 * and staging showed why it mattered: `@Name` rendered as plain body text, so a
 * message that addressed you looked exactly like one that did not.
 *
 * Two rules these pin, both of which a "make mentions stand out" change is
 * likely to break in passing. The chip goes on the **handle only** — a message
 * that mentions you is still the sender's message, so the row is never
 * retinted — and the run it wraps is decided by the *server's* tokenizer, so
 * the UI never claims a mention the API did not see.
 */
describe("TextRenderer mention chips", () => {
  function chips(container: HTMLElement) {
    return Array.from(container.querySelectorAll("mark"));
  }

  it("chips the handle", () => {
    const { container } = render(
      <TextRenderer message={message("morning @Alice, agenda attached")} />,
    );

    const [chip] = chips(container);
    expect(chip?.textContent).toBe("@Alice");
    expect(chip?.className).toContain("bg-mention-chip");
    expect(chip?.className).toContain("text-mention-chip-text");
    // The token the server would resolve, not the label the reader sees — the
    // two differ the moment a mention ends a sentence.
    expect(chip?.getAttribute("data-mention")).toBe("Alice");
  });

  it("leaves the body around the chip untinted", () => {
    // "Don't retint the message." A mention is an address inside someone's
    // message; the body keeps the plain foreground.
    const { container } = render(<TextRenderer message={message("ping @Alice")} />);
    const body = container.querySelector('[data-slot="message-body"]');
    expect(body?.className).toContain("text-foreground");
    expect(body?.className).not.toContain("mention");
  });

  it("chips every occurrence, not just the first", () => {
    const { container } = render(
      <TextRenderer message={message("@Alice and @Bob and @Alice again")} />,
    );

    expect(chips(container).map((c) => c.textContent)).toEqual([
      "@Alice",
      "@Bob",
      "@Alice",
    ]);
  });

  it("reaches a handle inside bold and italic text", () => {
    const { container } = render(
      <TextRenderer message={message("**ping @Alice** and *cc @Bob*")} />,
    );

    expect(chips(container).map((c) => c.textContent)).toEqual(["@Alice", "@Bob"]);
    expect(container.querySelector("strong")?.textContent).toContain("@Alice");
  });

  it("leaves a handle inside code alone — that is documenting one, not making one", () => {
    const { container } = render(
      <TextRenderer message={message("type `@channel` to address everyone")} />,
    );

    expect(chips(container)).toHaveLength(0);
    expect(container.querySelector("code")?.textContent).toBe("@channel");
  });

  it("does not chip a handle the server never saw — an entity-escaped `@`", () => {
    // The forgery this closes. `&#64;` carries no literal `@`, so the API
    // resolves nobody and notifies nobody — but CommonMark decodes it before a
    // remark plugin ever sees the text, so tokenizing the *rendered* string
    // paints a "she was addressed" chip on a message that addressed her to no
    // one. Any member can type it.
    const { container } = render(
      <TextRenderer
        message={message("&#64;PresidentJane please approve the budget")}
       
      />,
    );

    expect(extractMentionTokens("&#64;PresidentJane please approve the budget")).toEqual([]);
    expect(chips(container)).toHaveLength(0);
    // The text still reads as the author typed it; only the chip is withheld.
    expect(container.textContent).toContain("@PresidentJane");
  });

  it("chips the real handle in a message that also carries a forged one", () => {
    // The filter is per handle, not per message — one bad token must not
    // suppress the genuine mention beside it, or the fix would be a new bug.
    const { container } = render(
      <TextRenderer message={message("@Bob and &#64;Alice")} />,
    );

    expect(chips(container).map((c) => c.textContent)).toEqual(["@Bob"]);
    expect(container.textContent).toContain("@Alice");
  });

  it("does not chip an email address", () => {
    // The shared tokenizer's lookbehind is what stops this; asserting it here
    // is what catches a renderer that stops using the shared tokenizer.
    const { container } = render(
      <TextRenderer message={message("mail alice@example.com about it")} />,
    );

    expect(chips(container)).toHaveLength(0);
  });

  it("keeps the trailing punctuation outside the chip", () => {
    // `@jane.` tokenises as `jane`, so the stop is prose and must stay prose —
    // chipping it would paint a run nobody was notified about.
    const { container } = render(
      <TextRenderer message={message("over to @Alice.")} />,
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
       
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    // The one `mark` is the chip this renderer made, never the one the message
    // typed — `unwrapDisallowed` cannot promote authored text to an element.
    expect(chips(container).map((c) => c.textContent)).toEqual(["@Alice"]);
    expect(container.textContent).toContain("<mark>hi</mark>");
  });
});

/**
 * #2209. A body within the length cap can still nest thousands of levels deep,
 * and every markdown pass after the parse recurses once per level. Before the
 * depth cap, `"> ".repeat(4999) + "hi"` threw `RangeError: Maximum call stack
 * size exceeded` during render, which took down the whole `/chat` content
 * column for everyone who opened the channel. These pin the deliberate
 * replacement: a body past the cap renders as its raw text, and one inside it
 * formats as before.
 */
describe("TextRenderer over-nested bodies", () => {
  function fillToCap(prefix: string, tail: string): string {
    return prefix.repeat(Math.floor((CHAT_MESSAGE_CONTENT_MAX_LENGTH - tail.length) / prefix.length)) + tail;
  }

  it.each([
    ["nested blockquotes", fillToCap("> ", "hi")],
    ["nested list items", fillToCap("- ", "hi")],
  ])("renders a cap-length body of %s as its raw text instead of throwing", (_label, body) => {
    expect(body.length).toBeLessThanOrEqual(CHAT_MESSAGE_CONTENT_MAX_LENGTH);
    expect(body.length).toBeGreaterThan(CHAT_MESSAGE_CONTENT_MAX_LENGTH - 2);

    const { container } = render(<TextRenderer message={message(body)} />);

    const body_ = container.querySelector('[data-slot="message-body"]');
    expect(body_?.textContent).toBe(body);
  });

  it("renders a deep emphasis run as its raw text instead of throwing", () => {
    const run = "*".repeat(4999);
    const body = `${run}a${run}`;

    const { container } = render(<TextRenderer message={message(body)} />);

    expect(container.querySelector("strong, em")).toBeNull();
    expect(drawn(container.querySelector('[data-slot="message-body"]')!)).toBe(body);
  });

  it("formats a body nested exactly to the cap, and flattens one level past it", () => {
    // root → blockquote × n → paragraph → strong → text is n + 3 deep.
    const atCap = "> ".repeat(MAX_MESSAGE_MARKDOWN_DEPTH - 3) + "**bold**";
    const pastCap = "> " + atCap;

    const formatted = render(<TextRenderer message={message(atCap)} />);
    expect(formatted.container.querySelector("strong")).toHaveTextContent("bold");
    expect(formatted.container.textContent).not.toContain("**");
    formatted.unmount();

    const flattened = render(<TextRenderer message={message(pastCap)} />);
    expect(flattened.container.querySelector("strong")).toBeNull();
    expect(flattened.container.textContent).toBe(pastCap);
  });

  it("still chips a mention and renders no raw HTML in a flattened body", () => {
    const body = fillToCap("> ", '@Alice <img src=x onerror="alert(1)">');

    const { container } = render(<TextRenderer message={message(body)} />);

    expect(container.querySelector("img")).toBeNull();
    expect(Array.from(container.querySelectorAll("mark")).map((m) => m.textContent)).toEqual([
      "@Alice",
    ]);
    expect(container.textContent).toBe(body);
  });
});

/**
 * #2664. Bodies within the length cap that remark was slow to parse (Node 24,
 * remark-parse alone), most of them for hundreds of milliseconds to seconds,
 * on every mount, for everyone who opened the channel. `skipsMarkdownParse`
 * now reads them off the source and they render as their raw text. The bodies
 * are shared with chat-core's and mobile's specs.
 *
 * Where the parse would render something else (a link, emphasis, a decoded
 * entity, an unwrapped quote or list), rendering the body exactly as typed
 * proves the parse was skipped. Where it would render the same text (a run
 * the depth cap flattens, raw HTML shown as typed), the loose time bound is
 * what tells.
 */
describe("TextRenderer bodies too costly to parse", () => {
  it.each(COSTLY_MARKDOWN_BODIES.map((c) => [c.label, c.body]))(
    "renders %s as its raw text, without the slow parse",
    (_label, body) => {
      expect(body.length).toBeLessThanOrEqual(CHAT_MESSAGE_CONTENT_MAX_LENGTH);
      expect(skipsMarkdownParse(body)).toBe(true);

      const started = performance.now();
      const { container } = render(<TextRenderer message={message(body)} />);
      // Timed only on one line. A body of thousands of lines costs jsdom a
      // `<br>` per line even as raw text (about 0.5 s on CI), and each of
      // those carries quote or list markers a parse would strip, so the
      // raw-text assertion below is the proof for them.
      if (!body.includes("\n")) {
        expect(performance.now() - started).toBeLessThan(500);
      }

      expect(container.querySelector("strong, em, a")).toBeNull();
      // The raw-text path keeps every character but a line's leading
      // indentation, which `remark-breaks` drops at each break.
      expect(drawn(container.querySelector('[data-slot="message-body"]')!)).toBe(
        body.replace(/\n[ \t]+/g, "\n"),
      );
    },
  );

  it("parses a body just inside the budget quickly", () => {
    // It goes through the parse (and then the depth cap flattens it), and
    // stays far from the seconds the bodies above took.
    const body = NEAR_BUDGET_MARKDOWN_BODY;
    expect(skipsMarkdownParse(body)).toBe(false);

    const started = performance.now();
    const { container } = render(<TextRenderer message={message(body)} />);
    expect(performance.now() - started).toBeLessThan(1_000);
    // Deeper than the cap, so it renders as its raw text after the parse.
    expect(drawn(container.querySelector('[data-slot="message-body"]')!)).toBe(body);
  });
});

/**
 * The compact layout's body (`components.md` §11, #2873): no bubble, markers
 * inline after the last line, and nothing at all for an attachment-only
 * message.
 */
describe("TextRenderer compact body", () => {
  it("draws no text row for an attachment-only message (the empty bubble)", () => {
    const { container } = render(<TextRenderer message={message("")} />);
    // Nothing at all: an empty 25px line box is the regression, slot or not.
    expect(container).toBeEmptyDOMElement();
  });

  it("treats whitespace-only content as attachment-only too", () => {
    const { container } = render(<TextRenderer message={message("  \n ")} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("leaves an attachment-only message's marker to the row", () => {
    // `MessageItem` draws it on a line under the attachment instead.
    const { container } = render(
      <TextRenderer message={message("")} trailing={<span>Pinned</span>} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("puts the trailing marker inside the body, after the text", () => {
    const { container } = render(
      <TextRenderer
        message={message("first\n\nsecond")}
        trailing={<span>(edited)</span>}
      />,
    );
    const body = container.querySelector('[data-slot="message-body"]')!;
    expect(body.lastElementChild?.textContent).toBe("(edited)");
    // The body is one inline flow, so the marker sits on its last line.
    expect(drawn(body)).toBe("first\n\nsecond(edited)");
  });

  it.each([
    ["a list", "Items:\n\n- one\n- two"],
    ["a quote", "> quoted"],
    ["a code block", "```\nx = 1\n```"],
  ])("drops the trailing marker to its own line under %s", (_, content) => {
    const { container } = render(
      <TextRenderer message={message(content)} trailing={<span>(edited)</span>} />,
    );
    const body = container.querySelector('[data-slot="message-body"]')!;
    expect(drawn(body)).toMatch(/\n\(edited\)$/);
  });

  it("mutes a body still sending", () => {
    const { container } = render(<TextRenderer message={message("hi")} muted />);
    const body = container.querySelector('[data-slot="message-body"]');
    expect(body?.className).toContain("text-muted-foreground");
    expect(body?.className.split(" ")).not.toContain("text-foreground");
  });
});

/**
 * The body as `pre-wrap` draws it: its text, with each `<br>` as the line
 * break it is. Everything in the body is inline (paragraphs, and code blocks
 * as inline-blocks), so this string is the drawn line structure. jsdom has no
 * layout, so the specs assert on it rather than on measured lines.
 */
function drawn(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  if (node.nodeName === "BR") return "\n";
  return Array.from(node.childNodes).map(drawn).join("");
}

/**
 * Each line break in a body draws once (#2934). hast follows every `<br>` with
 * a `"\n"`, and wraps an unwrapped list or quote in `"\n"` separators; under
 * the body's `pre-wrap` those used to draw a second break and an opening
 * empty line.
 */
describe("TextRenderer line breaks", () => {
  // A body that ends in a list or a quote ends with a newline, for the
  // trailing markers (see the compact-body specs); with nothing after it,
  // that newline draws no line, so it is left out of the expected text.
  function lines(content: string): string {
    return drawn(body(content)).replace(/\n$/, "");
  }

  function body(content: string): Element {
    const { container } = render(<TextRenderer message={message(content)} />);
    return container.querySelector('[data-slot="message-body"]')!;
  }

  it.each([
    ["a single newline as one break", "line one\nline two", "line one\nline two"],
    ["a blank line as one blank line", "Hey\n\nSee you", "Hey\n\nSee you"],
    ["two trailing spaces as one break", "line one  \nline two", "line one\nline two"],
    ["a trailing backslash as one break", "line one\\\nline two", "line one\nline two"],
    ["an opening list without an empty first line", "- a\n- b", "a\nb"],
    ["an opening quote without an empty first line", "> quoted\nafter", "quoted\nafter"],
    ["a paragraph then a list with one blank line", "Items:\n\n- a\n- b", "Items:\n\na\nb"],
    ["a list then a paragraph with one blank line", "- a\n- b\n\nAfter", "a\nb\n\nAfter"],
  ])("draws %s", (_, content, expected) => {
    expect(lines(content)).toBe(expected);
  });

  it("never follows a <br> with a newline the pre-wrap body would draw again", () => {
    const el = body("one\ntwo  \nthree\\\nfour");
    const brs = el.querySelectorAll("br");
    expect(brs).toHaveLength(3);
    for (const br of brs) {
      expect(br.nextSibling?.nodeValue ?? "").not.toMatch(/^\n/);
    }
  });

  it("keeps a fenced code block's own lines, a blank line from the text around it", () => {
    const el = body("before\n\n```\nx = 1\ny = 2\n```\n\nafter");
    const code = el.querySelector("code")!;
    expect(code.textContent).toBe("x = 1\ny = 2\n");
    expect(code.className).toContain("whitespace-pre");
    expect(drawn(el)).toBe("before\n\nx = 1\ny = 2\n\n\nafter");
  });

  it("draws paragraphs inline, so pre-wrap's newlines are the only breaks", () => {
    const el = body("first\n\nsecond");
    for (const p of el.querySelectorAll("p")) {
      expect(p.className.split(" ")).toContain("inline");
    }
  });
});
