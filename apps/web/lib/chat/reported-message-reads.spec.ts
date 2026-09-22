import { describe, expect, it } from "vitest";
import { chatMessagesKey } from "@repo/chat-core";
import { readsMessageContent } from "@repo/hooks";

/*
 * `useRemoveReportedMessage` (`@repo/hooks`) refetches every cached read that
 * can still show a removed message's text, and the web chat timeline is the one
 * it matters most for: `use-chat-channel.ts` caches it under `chatMessagesKey`
 * with `staleTime: Infinity`, and only a channel the member has open hears the
 * realtime echo of the soft delete.
 *
 * `@repo/hooks` does not depend on `@repo/chat-core`, so it spells that key's
 * shape rather than importing it. This app depends on both, which makes it the
 * one place the two can be held together: if chat-core re-roots or re-orders
 * the timeline key, this fails instead of the removed text quietly coming back
 * on the officer's next visit to the channel.
 */
describe("readsMessageContent against chat-core's timeline key", () => {
  it("matches the key the web timeline is cached under", () => {
    expect(readsMessageContent(chatMessagesKey("channel-1"), "chapter-1")).toBe(
      true,
    );
  });
});
