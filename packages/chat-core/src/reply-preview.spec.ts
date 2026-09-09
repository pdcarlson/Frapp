import { describe, expect, it } from "vitest";
import {
  replyPreviewText,
  type MessagePreviewSource,
} from "./reply-preview";

function preview(
  overrides: MessagePreviewSource = {},
): MessagePreviewSource {
  return { content: "hello", is_deleted: false, ...overrides };
}

/**
 * The preview is the only thing standing in for a whole message inside a quote,
 * so each branch here is a case where the naive `message.content` renders an
 * empty or misleading strip. Moved from `apps/web` with `#1727` so mobile and
 * web cannot drift.
 */
describe("replyPreviewText", () => {
  it("uses the message body when there is one", () => {
    expect(replyPreviewText(preview({ content: "hey there" }))).toBe(
      "hey there",
    );
  });

  it("flattens the markdown a message body actually renders", () => {
    expect(
      replyPreviewText(
        preview({
          content:
            "See **the signed** [chapter budget](https://drive.google.com/file/d/1aB/view?usp=sharing) now",
        }),
      ),
    ).toBe("See the signed chapter budget now");
    expect(replyPreviewText(preview({ content: "use `npm ci` first" }))).toBe(
      "use npm ci first",
    );
    expect(replyPreviewText(preview({ content: "_really_ urgent" }))).toBe(
      "really urgent",
    );
  });

  it("never eats an intraword underscore — over-stripping is the real hazard", () => {
    for (const body of [
      "run the reply_to_id migration",
      "Ran run_test and do_thing today",
      "see https://drive.google.com/file/d/1a_b_c_d/view",
      "my_file_name.py is broken",
      "`snake_case_var` is the field",
    ]) {
      expect(replyPreviewText(preview({ content: body }))).toBe(
        body.replace(/`/g, ""),
      );
    }
  });

  it("leaves an unmatched fence alone instead of eating its line", () => {
    expect(
      replyPreviewText(
        preview({
          content: "put it in ``` fences like this and keep reading",
        }),
      ),
    ).toBe("put it in ``` fences like this and keep reading");
    expect(replyPreviewText(preview({ content: "```code``` inline" }))).toBe(
      "code inline",
    );
    expect(
      replyPreviewText(preview({ content: "```\ncode\n``` trailing words" })),
    ).toBe("code ``` trailing words");
  });

  it("honours backslash escapes, adding no punctuation of its own", () => {
    expect(
      replyPreviewText(preview({ content: "a \\*not emphasis\\* b" })),
    ).toBe("a *not emphasis* b");
    expect(replyPreviewText(preview({ content: "a \\_nope\\_ b" }))).toBe(
      "a _nope_ b",
    );
  });

  it("treats emoji-flanked underscores as intraword, as CommonMark does", () => {
    expect(replyPreviewText(preview({ content: "🎉_party_🎉" }))).toBe(
      "🎉_party_🎉",
    );
  });

  it("keeps balanced parens in a link destination out of the preview", () => {
    expect(
      replyPreviewText(
        preview({
          content: "[wiki](https://en.wikipedia.org/wiki/Foo_(bar))",
        }),
      ),
    ).toBe("wiki");
  });

  it("stays fast on a hostile body", () => {
    const started = performance.now();
    replyPreviewText(preview({ content: "[".repeat(10_000) }));
    expect(performance.now() - started).toBeLessThan(20);
  });

  it("leaves bare asterisks alone rather than eating them", () => {
    expect(replyPreviewText(preview({ content: "2 * 3 * 4" }))).toBe(
      "2 * 3 * 4",
    );
  });

  it("collapses newlines, so a multi-paragraph parent stays one line", () => {
    expect(
      replyPreviewText(
        preview({ content: "first line\n\n  second line " }),
      ),
    ).toBe("first line second line");
  });

  it("says a deleted parent is deleted rather than quoting its blanked body", () => {
    expect(
      replyPreviewText(preview({ is_deleted: true, content: "" })),
    ).toBe("[message deleted]");
  });

  it("prefers the tombstone even when a deleted row still carries content", () => {
    expect(
      replyPreviewText(preview({ is_deleted: true, content: "leftover" })),
    ).toBe("[message deleted]");
  });

  it("describes a file-only message, which is a valid send with no body", () => {
    expect(
      replyPreviewText(preview({ content: "", attachment_count: 1 })),
    ).toBe("Attachment");
    expect(
      replyPreviewText(preview({ content: "", attachment_count: 3 })),
    ).toBe("3 attachments");
  });

  it("names the card kind when a card carries no free text", () => {
    expect(replyPreviewText(preview({ content: "", kind: "poll" }))).toBe(
      "Poll",
    );
    expect(replyPreviewText(preview({ content: "", kind: "event" }))).toBe(
      "Event",
    );
  });

  it("names a bookmark-shaped row with no kind as Message, not a blank", () => {
    expect(replyPreviewText({ content: "", is_deleted: false })).toBe(
      "Message",
    );
  });

  it("falls back to a generic label for a kind the map does not name", () => {
    expect(
      replyPreviewText(preview({ content: "", kind: "imported" })),
    ).toBe("Message");
  });
});
