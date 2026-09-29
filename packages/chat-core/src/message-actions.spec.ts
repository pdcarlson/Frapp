import { describe, expect, it } from "vitest";
import {
  canActOnMessage,
  canDeleteMessage,
  canEditMessage,
  channelAllowsReplies,
  isOwnMessage,
  rendersAsBubble,
  replyTargetId,
} from "./message-actions";

const VIEWER = "user-1";

describe("isOwnMessage", () => {
  it("is the viewer's message only when the sender is the viewer", () => {
    expect(isOwnMessage({ sender_id: VIEWER }, VIEWER)).toBe(true);
    expect(isOwnMessage({ sender_id: "user-2" }, VIEWER)).toBe(false);
  });

  it("never makes an authorless imported row anyone's, even for a null viewer", () => {
    expect(isOwnMessage({ sender_id: null }, null)).toBe(false);
    expect(isOwnMessage({ sender_id: null }, VIEWER)).toBe(false);
  });
});

describe("canActOnMessage", () => {
  it("needs a confirmed, undeleted row", () => {
    expect(canActOnMessage({ _status: "confirmed", is_deleted: false })).toBe(
      true,
    );
    expect(canActOnMessage({ _status: "pending", is_deleted: false })).toBe(
      false,
    );
    expect(canActOnMessage({ _status: "failed", is_deleted: false })).toBe(
      false,
    );
    expect(canActOnMessage({ _status: "confirmed", is_deleted: true })).toBe(
      false,
    );
  });
});

describe("canEditMessage", () => {
  it("offers Edit on your own text message", () => {
    expect(canEditMessage({ sender_id: VIEWER, kind: "text" }, VIEWER)).toBe(
      true,
    );
  });

  it("never on someone else's message, whatever the viewer can manage", () => {
    expect(canEditMessage({ sender_id: "user-2", kind: "text" }, VIEWER)).toBe(
      false,
    );
  });

  it("never on a card or an imported row", () => {
    expect(canEditMessage({ sender_id: VIEWER, kind: "poll" }, VIEWER)).toBe(
      false,
    );
    expect(
      canEditMessage({ sender_id: VIEWER, kind: "announcement" }, VIEWER),
    ).toBe(false);
    expect(
      canEditMessage({ sender_id: VIEWER, kind: "imported" }, VIEWER),
    ).toBe(false);
    expect(canEditMessage({ sender_id: null, kind: "imported" }, null)).toBe(
      false,
    );
  });
});

describe("canDeleteMessage", () => {
  it("offers Delete on your own message", () => {
    expect(canDeleteMessage({ sender_id: VIEWER }, VIEWER, false)).toBe(true);
  });

  it("offers Delete on anyone's message with channels:manage", () => {
    expect(canDeleteMessage({ sender_id: "user-2" }, VIEWER, true)).toBe(true);
    expect(canDeleteMessage({ sender_id: null }, VIEWER, true)).toBe(true);
  });

  it("withholds it otherwise", () => {
    expect(canDeleteMessage({ sender_id: "user-2" }, VIEWER, false)).toBe(
      false,
    );
    expect(canDeleteMessage({ sender_id: null }, VIEWER, false)).toBe(false);
  });
});

describe("replyTargetId", () => {
  it("replies to a root message directly", () => {
    expect(replyTargetId({ id: "m1", reply_to_id: null })).toBe("m1");
  });

  it("replies to a reply's root, not the reply", () => {
    expect(replyTargetId({ id: "m2", reply_to_id: "m1" })).toBe("m1");
  });
});

describe("channelAllowsReplies", () => {
  it("allows replies where the viewer can post", () => {
    expect(channelAllowsReplies({ can_post: true, is_read_only: false })).toBe(
      true,
    );
    expect(channelAllowsReplies({})).toBe(true);
  });

  it("refuses them to an alumnus in an ordinary channel", () => {
    expect(
      channelAllowsReplies({ can_post: false, is_read_only: false }),
    ).toBe(false);
  });

  it("refuses them in #announcements even to someone who may post there", () => {
    expect(channelAllowsReplies({ can_post: true, is_read_only: true })).toBe(
      false,
    );
  });
});

describe("rendersAsBubble", () => {
  it("draws text and imported rows as bubbles, cards as cards", () => {
    expect(rendersAsBubble({ kind: "text" })).toBe(true);
    expect(rendersAsBubble({ kind: "imported" })).toBe(true);
    expect(rendersAsBubble({ kind: null })).toBe(true);
    expect(rendersAsBubble({ kind: "poll" })).toBe(false);
    expect(rendersAsBubble({ kind: "event" })).toBe(false);
  });
});
