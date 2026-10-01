import { describe, expect, it } from "vitest";
import type { ThreadRow } from "@repo/chat-core/blocks";
import type { ChatMessage } from "@repo/chat-core/types";
import { threadLayout } from "./thread-layout";

function row(id: string, overrides: Partial<ChatMessage> = {}): ThreadRow {
  return {
    visibility: "visible",
    message: {
      id,
      client_message_id: `c-${id}`,
      channel_id: "chan-1",
      sender_id: "u1",
      author_name: null,
      author_avatar_path: null,
      author_external_id: null,
      content: id,
      kind: "text",
      payload: null,
      reply_to_id: null,
      is_pinned: false,
      pinned_at: null,
      edited_at: null,
      is_deleted: false,
      created_at: new Date(2026, 8, 28, 17, 0).toISOString(),
      attachment_count: 0,
      reactions: {},
      actions: [],
      _status: "confirmed",
      ...overrides,
    } as ChatMessage,
  };
}

describe("threadLayout", () => {
  it("groups oldest first and keys each row by its list key", () => {
    const layout = threadLayout([
      row("a", { created_at: new Date(2026, 8, 28, 23, 58).toISOString() }),
      row("b", { created_at: new Date(2026, 8, 28, 23, 59).toISOString() }),
      row("c", { created_at: new Date(2026, 8, 29, 0, 1).toISOString() }),
    ]);
    expect(layout.get("c-a")).toEqual({ startsRun: true, startsDay: true });
    expect(layout.get("c-b")).toEqual({ startsRun: false, startsDay: false });
    // The divider lands above the first row of the new day — which would be
    // "a", not "c", if the inverted list were grouped instead.
    expect(layout.get("c-c")).toEqual({ startsRun: true, startsDay: true });
  });
});
