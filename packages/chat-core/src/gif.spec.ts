import { describe, expect, it } from "vitest";
import { canEditMessage } from "./message-actions";
import { replyPreviewText } from "./reply-preview";
import { gifBoxSize, messageGifOf, type MessageGif } from "./types";

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

  it("draws nothing from a host but the provider's, whoever wrote the row", () => {
    expect(
      messageGifOf({ gif: { ...GIF, url: "https://tracker.test/pixel.webp" } }),
    ).toBeNull();
    expect(
      messageGifOf({
        gif: { ...GIF, url: "https://static.klipy.com.evil.test/a.webp" },
      }),
    ).toBeNull();
    expect(
      messageGifOf({ gif: { ...GIF, url: "https://media.klipy.com/a.webp" } }),
    ).not.toBeNull();
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

describe("gifBoxSize", () => {
  const max = { width: 300, height: 200 };

  it("fits the box, keeping the shape", () => {
    expect(gifBoxSize({ width: 498, height: 280 }, max)).toEqual({
      width: 300,
      height: 169,
    });
    expect(gifBoxSize({ width: 300, height: 600 }, max)).toEqual({
      width: 100,
      height: 200,
    });
  });

  it("never grows a small GIF", () => {
    expect(gifBoxSize({ width: 120, height: 90 }, max)).toEqual({
      width: 120,
      height: 90,
    });
  });

  it("never draws a side under a pixel", () => {
    expect(gifBoxSize({ width: 4096, height: 1 }, max).height).toBe(1);
    expect(gifBoxSize({ width: 1, height: 4096 }, max).width).toBe(1);
  });
});
