import { describe, expect, it } from "vitest";
import { SYSTEM_SENDER_ID } from "@repo/validation";
import {
  channelPreviewLine,
  type ChannelLatestMessage,
  type PreviewAuthorLabel,
} from "./channel-preview";

const VIEWER = "user-viewer";
const NAMES: Record<string, string> = {
  "user-jake": "Jake Morales",
  "user-paul": "Paul Carlson",
};
// Stands in for `resolveAuthorLabel` bound to a roster and the viewer.
const authorLabel: PreviewAuthorLabel = (author) =>
  author.sender_id === VIEWER
    ? "You"
    : ((author.sender_id && NAMES[author.sender_id]) ??
      author.author_name ??
      "Unknown member");

function latest(over: Partial<ChannelLatestMessage>): ChannelLatestMessage {
  return {
    channel_id: "ch-1",
    message_id: "m-1",
    sender_id: "user-jake",
    author_name: null,
    content: "I've got the van, 3 seats left",
    kind: "text",
    payload: null,
    attachment_count: 0,
    created_at: "2026-11-06T22:14:00Z",
    ...over,
  };
}

const channel = { isDirect: false, viewerId: VIEWER, authorLabel };
const dm = { isDirect: true, viewerId: VIEWER, authorLabel };

describe("channelPreviewLine", () => {
  it("leads a channel message with the sender's first name", () => {
    expect(channelPreviewLine(latest({}), channel)).toBe(
      "Jake: I've got the van, 3 seats left",
    );
  });

  it("says You for the viewer's own message, in a channel and a DM", () => {
    const own = latest({ sender_id: VIEWER, content: "see you at 6" });
    expect(channelPreviewLine(own, channel)).toBe("You: see you at 6");
    expect(channelPreviewLine(own, dm)).toBe("You: see you at 6");
  });

  it("drops the other person's name in a DM, which the row already shows", () => {
    expect(
      channelPreviewLine(latest({ content: "minutes doc is uploaded" }), dm),
    ).toBe("minutes doc is uploaded");
  });

  it("flattens markdown and newlines to one line", () => {
    expect(
      channelPreviewLine(latest({ content: "**Dinner** at\n6 in the [hall](https://x.y)" }), channel),
    ).toBe("Jake: Dinner at 6 in the hall");
  });

  it("names a file-only message and a card with no text", () => {
    expect(
      channelPreviewLine(latest({ content: "", attachment_count: 1 }), channel),
    ).toBe("Jake: Attachment");
    expect(
      channelPreviewLine(latest({ content: "", kind: "event" }), channel),
    ).toBe("Jake: Event");
  });

  it("reads an audit line as the thread draws it", () => {
    const row = latest({
      sender_id: SYSTEM_SENDER_ID,
      content: "",
      kind: "system_audit",
      payload: {
        action: "chapter_profile_updated",
        actor_user_id: "user-paul",
        diff: { accent_color: {} },
      },
    });
    expect(channelPreviewLine(row, channel)).toBe(
      "Paul updated the chapter profile",
    );
  });

  it("gives a server notice its text alone, with no sender", () => {
    const welcome = latest({
      sender_id: SYSTEM_SENDER_ID,
      content: "Welcome to the Tau Nu chapter of FIJI.",
      kind: "system_audit",
    });
    expect(channelPreviewLine(welcome, channel)).toBe(
      "Welcome to the Tau Nu chapter of FIJI.",
    );
  });

  it("names an imported author by the name the archive recorded", () => {
    const imported = latest({
      sender_id: null,
      author_name: "kyle_r",
      kind: "imported",
      content: "old news",
    });
    expect(channelPreviewLine(imported, channel)).toBe("kyle_r: old news");
  });
});
