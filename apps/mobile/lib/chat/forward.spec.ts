import { describe, expect, it } from "vitest";
import { forwardedFromOf, type ChatMessage } from "@repo/chat-core/types";
import type { BlockState } from "@repo/chat-core/blocks";
import { TOMBSTONE_TEXT } from "@repo/chat-core/block-copy";
import { selectChannels } from "./channel-list";
import {
  FORWARD_REFUSED_BODY,
  FORWARD_RETRY_BODY,
  FORWARD_UNAVAILABLE_BODY,
  filterForwardDestinations,
  forwardDestinations,
  forwardFailureBody,
  forwardPreviewOf,
  forwardTargetOf,
} from "./forward";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const ALICE = "22222222-2222-4222-8222-222222222222";
const BOB = "33333333-3333-4333-8333-333333333333";
const NAMES = { [ALICE]: "Alice Chen", [BOB]: "Bob Ortiz" };

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

describe("forwardDestinations", () => {
  const channels = selectChannels([
    { id: "c-random", name: "random", type: "PUBLIC", can_post: true },
    {
      id: "c-announce",
      name: "announcements",
      type: "PUBLIC",
      can_post: false,
    },
    { id: "c-general", name: "general", type: "PUBLIC" },
    {
      id: "c-audit",
      name: "chapter-audit",
      type: "PUBLIC",
      is_audit_log: true,
    },
    {
      id: "dm-bob",
      name: `dm-${VIEWER}-${BOB}`,
      type: "DM",
      member_ids: [VIEWER, BOB],
    },
    {
      id: "dm-alice",
      name: `dm-${VIEWER}-${ALICE}`,
      type: "DM",
      member_ids: [VIEWER, ALICE],
      can_post: true,
    },
    {
      id: "dm-hidden",
      name: `dm-${VIEWER}-x`,
      type: "DM",
      member_ids: [VIEWER, "x"],
      hidden: true,
    },
  ]);

  it("offers channels A to Z, then people by name, leaving out what the viewer can't post in", () => {
    expect(forwardDestinations(channels, VIEWER, NAMES)).toEqual([
      { id: "c-general", label: "#general", direct: false },
      { id: "c-random", label: "#random", direct: false },
      { id: "dm-alice", label: "Alice Chen", direct: true },
      { id: "dm-bob", label: "Bob Ortiz", direct: true },
    ]);
  });

  it("finds a channel with or without its #, and a person by part of their name", () => {
    const rows = forwardDestinations(channels, VIEWER, NAMES);
    const ids = (query: string) =>
      filterForwardDestinations(rows, query).map((row) => row.id);
    expect(ids("gen")).toEqual(["c-general"]);
    expect(ids("#GEN")).toEqual(["c-general"]);
    expect(ids("ortiz")).toEqual(["dm-bob"]);
    expect(ids("  ")).toHaveLength(4);
    expect(ids("zzz")).toEqual([]);
  });
});

describe("forwardFailureBody", () => {
  it("says a refusal can't be retried, and anything else can", () => {
    expect(forwardFailureBody({ statusCode: 403 })).toBe(
      FORWARD_UNAVAILABLE_BODY,
    );
    expect(forwardFailureBody({ statusCode: 404 })).toBe(
      FORWARD_UNAVAILABLE_BODY,
    );
    expect(forwardFailureBody({ statusCode: 400 })).toBe(FORWARD_REFUSED_BODY);
    expect(forwardFailureBody({ statusCode: 503 })).toBe(FORWARD_RETRY_BODY);
    expect(forwardFailureBody(new TypeError("Network request failed"))).toBe(
      FORWARD_RETRY_BODY,
    );
  });
});
