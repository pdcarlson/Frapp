import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

/**
 * The screen's half: that s05 hands every row its placement from
 * `threadLayout` over the oldest-first rows. Read from source the way the
 * other thread wiring specs are, until the screen renders under test (#2705).
 */
describe("s05 wires the layout into its rows", () => {
  const THREAD = readFileSync(
    join(
      fileURLToPath(new URL(".", import.meta.url)),
      "../..",
      "app/(tabs)/chat-thread.tsx",
    ),
    "utf8",
  );

  it("computes it from the oldest-first rows, not the inverted list", () => {
    expect(THREAD).toMatch(/threadLayout\(thread\.rows\)/);
    expect(THREAD).not.toMatch(/threadLayout\(inverted\)/);
    expect(THREAD).not.toMatch(/decorateThread\(/);
  });

  it("passes each row its own placement, not a constant", () => {
    const item = THREAD.slice(THREAD.indexOf("<ThreadMessageRow"));
    expect(item).toMatch(/startsRun=\{placement\?\.startsRun \?\? true\}/);
    expect(item).toMatch(/startsDay=\{placement\?\.startsDay \?\? false\}/);
    expect(THREAD).toMatch(
      /const placement = layout\.get\(item\.message\.client_message_id\);/,
    );
  });
});
