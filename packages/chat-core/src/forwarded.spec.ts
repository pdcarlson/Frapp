import { describe, expect, it } from "vitest";
import {
  HELD_QUOTE_TEXT,
  TOMBSTONE_STALE_TEXT,
  TOMBSTONE_TEXT,
} from "./block-copy";
import {
  contradictingRows,
  forwardedSnapshotVisible,
  hasMaskedCopyFrom,
  hiddenForwardedText,
  replaceMaskedCopies,
  withForwardedMasked,
  type BlockState,
} from "./blocks";
import { emptyCache, mergeServerRow, selectMessages } from "./cache";
import { channelPreviewLine } from "./channel-preview";
import {
  FORWARDED_LABEL,
  FORWARDED_ORIGINAL_DELETED,
  forwardedAttachmentLabel,
} from "./forwarded";
import { decorateThread, type GroupableMessage } from "./grouping";
import {
  canForwardMessage,
  copyableText,
  messageActionsFor,
} from "./message-actions";
import { replyPreviewText } from "./reply-preview";
import {
  forwardedFromOf,
  normalizeRow,
  optimisticMessage,
  toRawRow,
  type RawChatMessage,
  type RawForwardedFrom,
} from "./types";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const AUTHOR = "22222222-2222-4222-8222-222222222222";
const FORWARDER = "33333333-3333-4333-8333-333333333333";
const ORIGINAL_ID = "44444444-4444-4444-8444-444444444444";
const SOURCE_CHANNEL = "55555555-5555-4555-8555-555555555555";

const GIF = {
  provider: "klipy",
  id: "g1",
  title: "party",
  url: "https://static.klipy.com/g1.webp",
  width: 200,
  height: 100,
};

function copy(overrides: Partial<RawForwardedFrom> = {}): RawForwardedFrom {
  return {
    message_id: ORIGINAL_ID,
    channel_id: SOURCE_CHANNEL,
    sender_id: AUTHOR,
    author_name: "Alice Chen",
    content: "see you at **8**",
    gif: null,
    attachment_count: 0,
    created_at: "2026-11-12T20:00:00.000Z",
    ...overrides,
  };
}

function row(
  id: string,
  overrides: Partial<RawChatMessage> = {},
): RawChatMessage {
  return {
    id,
    channel_id: "chan-dest",
    sender_id: FORWARDER,
    content: "",
    kind: "text",
    created_at: "2026-11-13T18:00:00.000Z",
    forwarded_from: copy(),
    sender_blocked: false,
    ...overrides,
  };
}

function state(
  status: BlockState["status"],
  ids: string[] = [],
  unblocked: string[] = [],
): BlockState {
  return {
    status,
    ids: new Set(ids),
    unblocked: new Set(unblocked),
    cleared: new Set(),
  };
}

describe("forwardedFromOf", () => {
  it("reads a well-formed copy", () => {
    expect(forwardedFromOf(copy({ gif: GIF, attachment_count: 2 }))).toEqual({
      message_id: ORIGINAL_ID,
      channel_id: SOURCE_CHANNEL,
      sender_id: AUTHOR,
      author_name: "Alice Chen",
      content: "see you at **8**",
      gif: GIF,
      attachment_count: 2,
      created_at: "2026-11-12T20:00:00.000Z",
      deleted: false,
      sender_blocked: false,
    });
  });

  it("is null without the original's id, or for anything but an object", () => {
    expect(forwardedFromOf(null)).toBeNull();
    expect(forwardedFromOf("x")).toBeNull();
    expect(forwardedFromOf([copy()])).toBeNull();
    expect(forwardedFromOf(copy({ message_id: "" }))).toBeNull();
    expect(forwardedFromOf(copy({ message_id: 7 }))).toBeNull();
  });

  it("drops a malformed field rather than trusting it", () => {
    const read = forwardedFromOf(
      copy({
        sender_id: 3,
        author_name: {},
        content: null,
        gif: { ...GIF, url: "https://evil.example/g.webp" },
        attachment_count: Number.NaN,
        created_at: 5,
        sender_blocked: "yes",
      }),
    )!;
    expect(read.sender_id).toBeNull();
    expect(read.author_name).toBeNull();
    expect(read.content).toBe("");
    expect(read.gif).toBeNull();
    expect(read.attachment_count).toBe(0);
    expect(read.created_at).toBe("");
    expect(read.sender_blocked).toBe(false);
  });

  it("blanks a copy whose original was deleted, whatever else it carries", () => {
    const read = forwardedFromOf(
      copy({ deleted: true, gif: GIF, attachment_count: 3 }),
    )!;
    expect(read).toMatchObject({
      message_id: ORIGINAL_ID,
      channel_id: SOURCE_CHANNEL,
      deleted: true,
      sender_id: null,
      author_name: null,
      content: "",
      gif: null,
      attachment_count: 0,
    });
  });
});

describe("normalizeRow / toRawRow / optimisticMessage", () => {
  it("carries the copy both ways", () => {
    const message = normalizeRow(row("m1"));
    expect(message.forwarded_from?.content).toBe("see you at **8**");
    expect(normalizeRow(toRawRow(message)).forwarded_from).toEqual(
      message.forwarded_from,
    );
  });

  it("is null on an ordinary message and on an optimistic one", () => {
    expect(
      normalizeRow(row("m1", { forwarded_from: undefined })).forwarded_from,
    ).toBeNull();
    expect(
      optimisticMessage({
        clientMessageId: "c1",
        channelId: "chan",
        senderId: VIEWER,
        content: "hi",
      }).forwarded_from,
    ).toBeNull();
  });
});

describe("forwarded copy", () => {
  it("names the label and the deleted line", () => {
    expect(FORWARDED_LABEL).toBe("Forwarded");
    expect(FORWARDED_ORIGINAL_DELETED).toBe("Original message was deleted");
  });

  it("counts the original's files", () => {
    expect(forwardedAttachmentLabel(0)).toBeNull();
    expect(forwardedAttachmentLabel(1)).toBe("1 attachment");
    expect(forwardedAttachmentLabel(4)).toBe("4 attachments");
    expect(forwardedAttachmentLabel(Number.NaN)).toBeNull();
  });
});

describe("replyPreviewText for a forward", () => {
  const forward = (raw: Partial<RawForwardedFrom>, content = "") =>
    normalizeRow(row("m1", { content, forwarded_from: copy(raw) }));

  it("previews an empty-comment forward as its copy, flattened", () => {
    expect(replyPreviewText(forward({}))).toBe("Forwarded: see you at 8");
  });

  it("names a GIF, and a file-only, deleted or masked original only as a message", () => {
    expect(replyPreviewText(forward({ content: "", gif: GIF }))).toBe(
      "Forwarded a GIF",
    );
    expect(
      replyPreviewText(forward({ content: "", attachment_count: 2 })),
    ).toBe("Forwarded a message");
    expect(replyPreviewText(forward({ deleted: true }))).toBe(
      "Forwarded a message",
    );
    expect(replyPreviewText(forward({ sender_blocked: true }))).toBe(
      "Forwarded a message",
    );
  });

  it("previews the comment when there is one", () => {
    expect(replyPreviewText(forward({}, "look at this"))).toBe("look at this");
  });

  it("still reads a deleted forward as deleted", () => {
    const deleted = { ...forward({}), is_deleted: true };
    expect(replyPreviewText(deleted)).toBe("[message deleted]");
  });
});

describe("channelPreviewLine for a forward", () => {
  it("prefixes the forwarder's name to the copy's line", () => {
    expect(
      channelPreviewLine(
        {
          channel_id: "chan-dest",
          message_id: "m1",
          sender_id: FORWARDER,
          author_name: null,
          content: "",
          kind: "text",
          payload: null,
          attachment_count: 0,
          created_at: "2026-11-13T18:00:00.000Z",
          forwarded_from: copy({ content: "van leaves at 6" }),
        },
        {
          isOneToOne: false,
          viewerId: VIEWER,
          nameOf: () => "Jake Smith",
          fallbackLabel: () => "Member",
        },
      ),
    ).toBe("Jake: Forwarded: van leaves at 6");
  });
});

describe("copyableText for a forward", () => {
  it("copies the copy's text when there is no comment", () => {
    expect(copyableText(normalizeRow(row("m1")))).toBe("see you at **8**");
  });

  it("copies the comment when there is one", () => {
    expect(copyableText(normalizeRow(row("m1", { content: "fyi" })))).toBe(
      "fyi",
    );
  });

  it("copies nothing from a deleted, masked or text-free original", () => {
    for (const raw of [
      { deleted: true },
      { sender_blocked: true },
      { content: "   ", gif: GIF },
    ]) {
      expect(
        copyableText(normalizeRow(row("m1", { forwarded_from: copy(raw) }))),
      ).toBeNull();
    }
  });
});

describe("grouping", () => {
  it("starts a run on a forward, as on a reply", () => {
    const base: GroupableMessage = {
      sender_id: FORWARDER,
      created_at: "2026-11-13T18:00:00.000Z",
      kind: "text",
    };
    const starts = decorateThread([
      { message: base, visibility: "visible" },
      {
        message: {
          ...base,
          created_at: "2026-11-13T18:00:30.000Z",
          forwarded_from: copy(),
        },
        visibility: "visible",
      },
    ]).map((entry) => entry.startsRun);
    expect(starts).toEqual([true, true]);
  });
});

describe("canForwardMessage", () => {
  const confirmed = normalizeRow(
    row("m1", { forwarded_from: null, content: "hi" }),
  );

  it("offers a confirmed plain-text message, GIF and files included, whoever sent it", () => {
    expect(canForwardMessage(confirmed)).toBe(true);
    expect(
      canForwardMessage(
        normalizeRow(row("m9", { sender_id: VIEWER, content: "mine" })),
      ),
    ).toBe(true);
    expect(canForwardMessage({ ...confirmed, content: "", gif: GIF })).toBe(
      true,
    );
    expect(
      canForwardMessage({ ...confirmed, content: "", attachment_count: 2 }),
    ).toBe(true);
  });

  it("never offers a card, an import, a deleted row or one the server hasn't confirmed", () => {
    expect(canForwardMessage({ ...confirmed, kind: "poll" })).toBe(false);
    expect(canForwardMessage({ ...confirmed, kind: "system_audit" })).toBe(
      false,
    );
    expect(canForwardMessage({ ...confirmed, kind: "imported" })).toBe(false);
    expect(canForwardMessage({ ...confirmed, is_deleted: true })).toBe(false);
    for (const status of ["pending", "failed", "unconfirmed"] as const) {
      expect(canForwardMessage({ ...confirmed, _status: status })).toBe(false);
    }
  });

  it("offers a forward again, unless it is only a deleted original's copy", () => {
    expect(canForwardMessage(normalizeRow(row("m2")))).toBe(true);
    const blank = normalizeRow(
      row("m3", { forwarded_from: copy({ deleted: true }) }),
    );
    expect(canForwardMessage(blank)).toBe(false);
    expect(canForwardMessage({ ...blank, content: "my words" })).toBe(true);
  });

  it("rides messageActionsFor whatever the open channel allows", () => {
    const actions = messageActionsFor(confirmed, VIEWER, {
      isMember: () => true,
      canReply: false,
      canPost: false,
      canManageChannel: false,
    });
    expect(actions.canForward).toBe(true);
    expect(
      messageActionsFor({ ...confirmed, _status: "pending" }, VIEWER, {
        isMember: () => true,
        canReply: true,
        canPost: true,
        canManageChannel: false,
      }).canForward,
    ).toBe(false);
  });
});

describe("masking a forward's copy", () => {
  const evaluated = normalizeRow(row("m1"));
  const echoed = normalizeRow(row("m1", { sender_blocked: undefined }));

  it("shows a copy the list clears", () => {
    expect(
      hiddenForwardedText(
        evaluated.forwarded_from!,
        evaluated,
        state("ready"),
        VIEWER,
      ),
    ).toBeNull();
  });

  it("hides a blocked author's copy on every path, with the tombstone's words", () => {
    for (const message of [evaluated, echoed]) {
      expect(
        hiddenForwardedText(
          message.forwarded_from!,
          message,
          state("ready", [AUTHOR]),
          VIEWER,
        ),
      ).toBe(TOMBSTONE_TEXT);
    }
  });

  it("hides a copy the server withheld, and the stale words after a confirmed unblock", () => {
    const masked = normalizeRow(
      row("m1", {
        forwarded_from: copy({ content: "", sender_blocked: true }),
      }),
    );
    expect(
      hiddenForwardedText(
        masked.forwarded_from!,
        masked,
        state("ready"),
        VIEWER,
      ),
    ).toBe(TOMBSTONE_TEXT);
    expect(
      hiddenForwardedText(
        masked.forwarded_from!,
        masked,
        state("ready", [], [AUTHOR]),
        VIEWER,
      ),
    ).toBe(TOMBSTONE_STALE_TEXT);
  });

  it("holds an echoed copy while the list can't be read", () => {
    expect(
      hiddenForwardedText(
        echoed.forwarded_from!,
        echoed,
        state("unavailable"),
        VIEWER,
      ),
    ).toBe(HELD_QUOTE_TEXT);
  });

  it("never masks the viewer's own words, or a deleted original's blank copy", () => {
    const own = normalizeRow(
      row("m1", { forwarded_from: copy({ sender_id: VIEWER }) }),
    );
    expect(
      forwardedSnapshotVisible(
        own.forwarded_from!,
        own,
        state("unavailable"),
        VIEWER,
      ),
    ).toBe(true);
    const blank = normalizeRow(
      row("m1", { forwarded_from: copy({ deleted: true }) }),
    );
    expect(
      forwardedSnapshotVisible(
        { ...blank.forwarded_from!, sender_id: AUTHOR },
        blank,
        state("ready", [AUTHOR]),
        VIEWER,
      ),
    ).toBe(true);
  });

  it("empties a hidden copy for the preview and the clipboard", () => {
    const masked = withForwardedMasked(
      evaluated,
      state("ready", [AUTHOR]),
      VIEWER,
    );
    expect(masked.forwarded_from).toMatchObject({
      content: "",
      gif: null,
      attachment_count: 0,
      sender_blocked: true,
    });
    expect(replyPreviewText(masked)).toBe("Forwarded a message");
    expect(copyableText(masked)).toBeNull();
    expect(withForwardedMasked(evaluated, state("ready"), VIEWER)).toBe(
      evaluated,
    );
  });

  it("carries the server's verdict onto the row's echo", () => {
    const masked = row("m1", {
      forwarded_from: copy({ content: "", sender_blocked: true }),
    });
    let cache = mergeServerRow(emptyCache(), masked);
    cache = mergeServerRow(cache, {
      ...row("m1", { is_pinned: true }),
      sender_blocked: undefined,
    });
    const [message] = selectMessages(cache);
    expect(message!.forwarded_from?.sender_blocked).toBe(true);
    expect(
      forwardedSnapshotVisible(
        message!.forwarded_from!,
        message!,
        state("ready"),
        VIEWER,
      ),
    ).toBe(false);
  });

  it("counts as a contradiction of a ready list and as a masked copy to re-read", () => {
    const masked = row("m1", {
      forwarded_from: copy({ content: "", sender_blocked: true }),
    });
    const cache = mergeServerRow(emptyCache(), masked);
    expect(contradictingRows(selectMessages(cache), state("ready"))).toEqual([
      "m1",
    ]);
    expect(hasMaskedCopyFrom(cache, AUTHOR)).toBe(true);
    expect(hasMaskedCopyFrom(cache, FORWARDER)).toBe(false);

    const next = replaceMaskedCopies(
      cache,
      [row("m1", { forwarded_from: copy({ sender_blocked: false }) })],
      AUTHOR,
    );
    const [restored] = selectMessages(next);
    expect(restored!.forwarded_from).toMatchObject({
      content: "see you at **8**",
      sender_blocked: false,
    });
  });
});
