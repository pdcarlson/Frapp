import { describe, expect, it } from "vitest";
import type { BlockState, ThreadRow } from "@repo/chat-core/blocks";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  THREAD_HEADER_FALLBACK_TITLE,
  threadHeaderLines,
} from "./thread-header";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const MILES = "22222222-2222-4222-8222-222222222222";
const GONE = "33333333-3333-4333-8333-333333333333";
const names: Record<string, string> = { [MILES]: "Miles Guerrero" };
const nameFor = (id: string) => names[id] ?? null;
const BLOCKED = "44444444-4444-4444-8444-444444444444";
const READY: BlockState = {
  status: "ready",
  ids: new Set([BLOCKED]),
  unblocked: new Set(),
  cleared: new Set(),
};

function row(
  overrides: Partial<ChatMessage> = {},
  visibility: ThreadRow["visibility"] = "visible",
): ThreadRow {
  return {
    visibility,
    message: {
      id: "root",
      sender_id: MILES,
      content: "who is bringing the canopy tent saturday",
      kind: "text",
      attachment_count: 0,
      is_deleted: false,
      author_name: null,
      ...overrides,
    } as ChatMessage,
  };
}

const lines = (root: ThreadRow | null) =>
  threadHeaderLines({
    root,
    viewerId: VIEWER,
    nameFor,
    channelTitle: "#general",
    blockState: READY,
  });

/** The phone's open-thread header (#4297, slice 5; proposal option B). */
describe("threadHeaderLines", () => {
  it("names the thread by the parent's words, over its author and channel", () => {
    expect(lines(row())).toEqual({
      title: "who is bringing the canopy tent saturday",
      subtitle: "Miles Guerrero · #general",
    });
  });

  it("uses the words a quote of the parent shows: one line, no markdown", () => {
    expect(
      lines(row({ content: "**Saturday**\nwho has the tent?" })).title,
    ).toBe("Saturday who has the tent?");
    expect(lines(row({ content: "", attachment_count: 2 })).title).toBe(
      "2 attachments",
    );
  });

  it("calls the viewer's own parent You, and a departed author by their fallback label", () => {
    expect(lines(row({ sender_id: VIEWER })).subtitle).toBe("You · #general");
    expect(lines(row({ sender_id: GONE })).subtitle).toMatch(
      /^Member [0-9a-f]{6} · #general$/,
    );
  });

  it("says Thread over the channel alone while loading, deleted, or from someone blocked", () => {
    const fallback = {
      title: THREAD_HEADER_FALLBACK_TITLE,
      subtitle: "#general",
    };
    expect(lines(null)).toEqual(fallback);
    expect(lines(row({ is_deleted: true }))).toEqual(fallback);
    expect(lines(row({}, "tombstone"))).toEqual(fallback);
  });

  it("never shows the copy of a forward whose original author the viewer blocked (#4864)", () => {
    const forwarded = (sender_id: string) =>
      row({
        content: "",
        forwarded_from: {
          message_id: "orig",
          channel_id: "chan-2",
          sender_id,
          author_name: "Someone",
          content: "the original words",
          gif: null,
          attachment_count: 0,
          created_at: "2026-11-12T18:00:00.000Z",
          deleted: false,
          sender_blocked: false,
        },
      });
    expect(lines(forwarded(BLOCKED)).title).toBe("Forwarded a message");
    expect(lines(forwarded(GONE)).title).toBe("Forwarded: the original words");
  });
});
