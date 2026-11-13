import { describe, expect, it } from "vitest";
import { forwardedFromOf, type ChatMessage } from "./types";
import type { BlockState } from "./blocks";
import { TOMBSTONE_TEXT } from "./block-copy";
import { forwardPreviewOf, forwardTargetOf } from "./forward";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const ALICE = "22222222-2222-4222-8222-222222222222";
const BOB = "33333333-3333-4333-8333-333333333333";

const READY: BlockState = {
  status: "ready",
  ids: new Set(),
  unblocked: new Set(),
  cleared: new Set(),
};

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    channel_id: "chan-1",
    sender_id: ALICE,
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
    created_at: "2026-11-13T18:00:00.000Z",
    client_message_id: "c1",
    attachment_count: 2,
    mentions: [],
    sender_blocked: false,
    _blockEvaluated: true,
    reactions: {},
    actions: [],
    _status: "confirmed",
    ...overrides,
  };
}

const inner = forwardedFromOf({
  message_id: "orig",
  channel_id: "chan-0",
  sender_id: BOB,
  author_name: "Bob",
  content: "the original",
  gif: null,
  attachment_count: 0,
  created_at: "2026-11-01T00:00:00.000Z",
})!;

describe("forwardPreviewOf (#4864)", () => {
  it("copies a plain message as itself", () => {
    expect(forwardPreviewOf(message())).toEqual({
      message_id: "m1",
      channel_id: "chan-1",
      sender_id: ALICE,
      author_name: null,
      content: "hello",
      gif: null,
      attachment_count: 2,
      created_at: "2026-11-13T18:00:00.000Z",
      deleted: false,
      sender_blocked: false,
    });
  });

  it("passes on a forward's copy when it has no comment, so cards never nest", () => {
    expect(
      forwardPreviewOf(message({ content: " ", forwarded_from: inner })),
    ).toBe(inner);
  });

  it("copies the comment, not the inner copy, when there is one", () => {
    const preview = forwardPreviewOf(
      message({ content: "my take", forwarded_from: inner }),
    );
    expect(preview.message_id).toBe("m1");
    expect(preview.content).toBe("my take");
  });
});

describe("forwardTargetOf", () => {
  it("is absent where the message can't be forwarded", () => {
    expect(forwardTargetOf(message(), false, READY, VIEWER)).toBeUndefined();
  });

  it("hides an inner copy whose author the viewer blocked", () => {
    const target = forwardTargetOf(
      message({ content: "", forwarded_from: inner }),
      true,
      { ...READY, ids: new Set([BOB]) },
      VIEWER,
    );
    expect(target?.messageId).toBe("m1");
    expect(target?.hidden).toBe(TOMBSTONE_TEXT);
  });

  it("draws the message's own copy", () => {
    expect(forwardTargetOf(message(), true, READY, VIEWER)?.hidden).toBeNull();
  });
});
