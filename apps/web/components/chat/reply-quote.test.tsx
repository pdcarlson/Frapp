import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import {
  QuotedMessage,
  UNAVAILABLE_QUOTE,
  replyPreviewText,
} from "./reply-quote";
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

  it("flattens the markdown a message body actually renders", () => {
    // The body renders through `MessageMarkdown`, so quoting the SOURCE makes
    // the quote disagree with the message it stands for. Worse, a quote is one
    // truncated line, so a raw link's URL eats the whole strip and the reader
    // sees punctuation and a file id instead of the text they remember.
    expect(
      replyPreviewText(
        message({
          content:
            "See **the signed** [chapter budget](https://drive.google.com/file/d/1aB/view?usp=sharing) now",
        }),
      ),
    ).toBe("See the signed chapter budget now");
    expect(replyPreviewText(message({ content: "use `npm ci` first" }))).toBe(
      "use npm ci first",
    );
    expect(replyPreviewText(message({ content: "_really_ urgent" }))).toBe(
      "really urgent",
    );
  });

  it("never eats an intraword underscore — over-stripping is the real hazard", () => {
    // CommonMark (and therefore `react-markdown`, which renders the bubble)
    // does not treat intraword `_` as emphasis. An earlier cut did, so the
    // quote said something the sender never typed — in the one line standing in
    // for their message. Identifiers, filenames and Drive ids are full of them.
    for (const body of [
      "run the reply_to_id migration",
      "Ran run_test and do_thing today",
      "see https://drive.google.com/file/d/1a_b_c_d/view",
      "my_file_name.py is broken",
      "`snake_case_var` is the field",
    ]) {
      expect(replyPreviewText(message({ content: body }))).toBe(
        body.replace(/`/g, ""),
      );
    }
  });

  it("lets a fence delete itself, never the rest of its line", () => {
    // `/```[^\n]*\n?/` ate everything after an inline triple-backtick, which is
    // content loss rather than an unstripped marker.
    expect(
      replyPreviewText(
        message({ content: "put it in ``` fences like this and keep reading" }),
      ),
    ).toBe("put it in fences like this and keep reading");
    expect(
      replyPreviewText(message({ content: "```\ncode\n``` trailing words" })),
    ).toBe("code trailing words");
  });

  it("stays fast on a hostile body", () => {
    // The link pattern backtracks quadratically on unmatched `[`, and this runs
    // uncached on every render of a quoted row inside a virtualized list. 10,000
    // brackets — plantable by any member, under the 10,000-char content cap —
    // measured 74ms per call before the input was bounded.
    const started = performance.now();
    replyPreviewText(message({ content: "[".repeat(10_000) }));
    expect(performance.now() - started).toBeLessThan(20);
  });

  it("leaves bare asterisks alone rather than eating them", () => {
    // Emphasis needs a non-space after the opener; `2 * 3 * 4` is arithmetic,
    // not italics, and a preview that silently deleted the operators would
    // misreport what was said.
    expect(replyPreviewText(message({ content: "2 * 3 * 4" }))).toBe("2 * 3 * 4");
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

  it("says so when the quoted message is outside the loaded window", () => {
    // Not an edge case: nothing backfills older history (#1571), so every reply
    // to a message older than the one loaded window lands here. Rendering
    // nothing would make such a reply indistinguishable from a plain message.
    render(<QuotedMessage author={null} preview={null} />);
    expect(screen.getByText(UNAVAILABLE_QUOTE)).toBeInTheDocument();
  });

  it("never becomes a control when the message is unavailable", () => {
    // The parent it would navigate to is the thing that is missing, so offering
    // `onOpen` must not produce a button that opens an empty panel.
    render(
      <QuotedMessage author={null} preview={null} onOpen={vi.fn()} />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shares one rule and indent across both variants", () => {
    // The unavailable branch used to re-type the class string, in the one file
    // whose stated purpose is that the two cannot drift — and it is the branch
    // nobody re-screenshots, because it only appears for old parents.
    const { container: loaded } = render(
      <QuotedMessage author="Alice Chen" preview="hey" />,
    );
    const { container: missing } = render(
      <QuotedMessage author={null} preview={null} />,
    );
    for (const cls of ["border-l-2", "border-border", "pl-2", "text-[12.5px]"]) {
      expect(loaded.firstElementChild).toHaveClass(cls);
      expect(missing.firstElementChild).toHaveClass(cls);
    }
  });
});
