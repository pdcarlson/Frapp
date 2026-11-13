import { describe, expect, it, test } from "vitest";
import {
  channelAllowsThreadReplies,
  channelAllowsThreads,
  messageCanStartThread,
  canActOnMessage,
  canDeleteMessage,
  canEditMessage,
  canReportMessage,
  channelAllowsReplies,
  copyableText,
  isOwnMessage,
  isOwnPostedAnswer,
  isCardMessage,
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

describe("an Ask Frapp answer posted to the channel (#4713)", () => {
  const SYSTEM = "00000000-0000-0000-0000-000000000000";
  const posted = (askedBy: unknown) => ({
    sender_id: SYSTEM,
    kind: "ask_answer" as const,
    payload: { asked_by: askedBy },
  });

  it("is the asker's to delete, though the row is the Frapp sender's", () => {
    expect(isOwnPostedAnswer(posted(VIEWER), VIEWER)).toBe(true);
    expect(canDeleteMessage(posted(VIEWER), VIEWER, false)).toBe(true);
  });

  it("is not another member's to delete without channels:manage", () => {
    expect(canDeleteMessage(posted("user-2"), VIEWER, false)).toBe(false);
    expect(canDeleteMessage(posted("user-2"), VIEWER, true)).toBe(true);
  });

  it("reads the asker from this kind alone, so a payload naming the viewer on another kind grants nothing", () => {
    const poll = {
      sender_id: "user-2",
      kind: "poll" as const,
      payload: { asked_by: VIEWER },
    };
    expect(isOwnPostedAnswer(poll, VIEWER)).toBe(false);
    expect(canDeleteMessage(poll, VIEWER, false)).toBe(false);
  });

  it("is nobody's for a signed-out viewer or a payload with no asker", () => {
    expect(isOwnPostedAnswer(posted(null), null)).toBe(false);
    expect(isOwnPostedAnswer(posted(undefined), VIEWER)).toBe(false);
    expect(
      isOwnPostedAnswer({ kind: "ask_answer", payload: null }, VIEWER),
    ).toBe(false);
  });

  it("is not the asker's to report, and is anyone else's", () => {
    const row = (askedBy: string) => ({
      ...posted(askedBy),
      _status: "confirmed" as const,
      is_deleted: false,
    });
    expect(canReportMessage(row(VIEWER), VIEWER)).toBe(false);
    expect(canReportMessage(row("user-2"), VIEWER)).toBe(true);
  });

  it("is a card, so it is never edited", () => {
    expect(isCardMessage({ kind: "ask_answer" })).toBe(true);
    expect(canEditMessage(posted(VIEWER), VIEWER)).toBe(false);
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
    expect(channelAllowsReplies({ can_post: false, is_read_only: false })).toBe(
      false,
    );
  });

  // #3722: a quote reply is a post, so whoever may post may quote, in a
  // channel with a who-can-post list too.
  it("allows them to a poster in a channel with a who-can-post list", () => {
    expect(channelAllowsReplies({ can_post: true, is_read_only: true })).toBe(
      true,
    );
    expect(channelAllowsReplies({ can_post: false, is_read_only: true })).toBe(
      false,
    );
  });
});

describe("isCardMessage", () => {
  it("draws text and imported rows as text, cards as cards", () => {
    expect(isCardMessage({ kind: "text" })).toBe(false);
    expect(isCardMessage({ kind: "imported" })).toBe(false);
    expect(isCardMessage({ kind: null })).toBe(false);
    expect(isCardMessage({ kind: "poll" })).toBe(true);
    expect(isCardMessage({ kind: "event" })).toBe(true);
  });
});

describe("copyableText", () => {
  const base = {
    content: "hey **all**",
    kind: "text" as const,
    is_deleted: false,
  };

  it("copies the body as written", () => {
    expect(copyableText(base)).toBe("hey **all**");
    expect(copyableText({ ...base, kind: "imported" as const })).toBe(
      "hey **all**",
    );
  });

  it("offers nothing for a card, a deleted message or an empty body", () => {
    expect(copyableText({ ...base, kind: "poll" as const })).toBeNull();
    expect(copyableText({ ...base, is_deleted: true })).toBeNull();
    expect(copyableText({ ...base, content: "  \n" })).toBeNull();
  });
});

describe("message-thread access (#3785)", () => {
  test("threads are offered in channels and group DMs, not 1:1 DMs or the audit log", () => {
    expect(channelAllowsThreads({ type: "PUBLIC" })).toBe(true);
    expect(channelAllowsThreads({ type: "GROUP_DM" })).toBe(true);
    expect(channelAllowsThreads({ type: "DM" })).toBe(false);
    expect(channelAllowsThreads({ type: "PUBLIC", is_audit_log: true })).toBe(
      false,
    );
  });

  test("Start thread is offered on a plain message, card included, and nowhere else", () => {
    const base = {
      thread_root_id: null,
      thread: null,
      is_deleted: false,
      kind: "text",
    };
    expect(messageCanStartThread(base)).toBe(true);
    expect(messageCanStartThread({ ...base, kind: "poll" })).toBe(true);
    expect(messageCanStartThread({ ...base, thread_root_id: "root" })).toBe(
      false,
    );
    expect(
      messageCanStartThread({
        ...base,
        thread: { reply_count: 1, last_reply_at: null, recent_sender_ids: [] },
      }),
    ).toBe(false);
    expect(messageCanStartThread({ ...base, is_deleted: true })).toBe(false);
    expect(messageCanStartThread({ ...base, kind: "imported" })).toBe(false);
  });

  test("any reader of a read-only channel may reply in its threads", () => {
    expect(
      channelAllowsThreadReplies({ can_post: false, is_read_only: true }),
    ).toBe(true);
    expect(channelAllowsThreadReplies({ can_post: true })).toBe(true);
    expect(
      channelAllowsThreadReplies({ can_post: false, is_read_only: false }),
    ).toBe(false);
  });
});
