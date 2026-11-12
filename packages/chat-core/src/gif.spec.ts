import { describe, expect, it } from "vitest";
import { canEditMessage } from "./message-actions";
import { replyPreviewText } from "./reply-preview";
import { messageGifOf, type MessageGif } from "./types";

const GIF: MessageGif = {
  provider: "klipy",
  id: "dance-party",
  title: "Dance party",
  url: "https://static.klipy.com/ii/abc/dance.webp",
  width: 498,
  height: 280,
};

/** GIF messages (#4631): `spec/behavior/chat/README.md` § GIFs. */
describe("messageGifOf", () => {
  it("reads the server's metadata.gif", () => {
    expect(messageGifOf({ gif: GIF })).toEqual(GIF);
  });

  it("finds none on a message without one", () => {
    expect(messageGifOf(null)).toBeNull();
    expect(messageGifOf({})).toBeNull();
    expect(messageGifOf({ gif: "dance" })).toBeNull();
  });

  it("draws nothing it couldn't size or load safely", () => {
    expect(
      messageGifOf({ gif: { ...GIF, url: "http://x.test/a.gif" } }),
    ).toBeNull();
    expect(
      messageGifOf({ gif: { ...GIF, url: "javascript:alert(1)" } }),
    ).toBeNull();
    expect(messageGifOf({ gif: { ...GIF, width: 0 } })).toBeNull();
    expect(messageGifOf({ gif: { ...GIF, height: 1.5 } })).toBeNull();
    expect(messageGifOf({ gif: { ...GIF, width: 100_000 } })).toBeNull();
  });

  it("fills a missing title or id with empty text rather than dropping the GIF", () => {
    expect(
      messageGifOf({ gif: { url: GIF.url, width: 10, height: 10 } }),
    ).toEqual({
      provider: "",
      id: "",
      title: "",
      url: GIF.url,
      width: 10,
      height: 10,
    });
  });
});

describe("a GIF message", () => {
  it("offers no Edit, even to its sender", () => {
    expect(
      canEditMessage({ sender_id: "me", kind: "text", gif: GIF }, "me"),
    ).toBe(false);
  });

  it("reads GIF in a reply quote", () => {
    expect(replyPreviewText({ content: "", is_deleted: false, gif: GIF })).toBe(
      "GIF",
    );
  });
});
