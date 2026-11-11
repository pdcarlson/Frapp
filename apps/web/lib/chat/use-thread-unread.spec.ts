import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { threadVersion } from "./use-thread-unread";

const row = (thread: ChatMessage["thread"]) => ({ thread }) as ChatMessage;

describe("threadVersion (#4297)", () => {
  it("is empty when no loaded message has a thread, so nothing is read", () => {
    expect(threadVersion([row(null), row(undefined)])).toBe("");
  });

  it("changes when a parent's last reply moves, and only then", () => {
    const before = [
      row({ reply_count: 1, last_reply_at: "2026-11-11T20:00:00Z", recent_sender_ids: [] }),
      row(null),
    ];
    const same = [...before];
    const after = [
      row({ reply_count: 2, last_reply_at: "2026-11-11T20:05:00Z", recent_sender_ids: [] }),
      row(null),
    ];
    expect(threadVersion(same)).toBe(threadVersion(before));
    expect(threadVersion(after)).not.toBe(threadVersion(before));
  });

  it("changes when a newly loaded parent brings a thread", () => {
    const one = [row({ reply_count: 1, last_reply_at: "2026-11-11T20:00:00Z", recent_sender_ids: [] })];
    const two = [
      row({ reply_count: 4, last_reply_at: "2026-11-10T09:00:00Z", recent_sender_ids: [] }),
      ...one,
    ];
    expect(threadVersion(two)).not.toBe(threadVersion(one));
  });
});
