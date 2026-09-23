import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  chatMessagesKey,
  emptyCache,
  mergeServerRow,
  optimisticMessage,
  selectMessages,
  upsertOptimistic,
  type ChannelCache,
  type RawChatMessage,
} from "@repo/chat-core";
import { readsRemovedMessage } from "@repo/hooks";
import { reportedMessageTimeline } from "./reported-message-reads";

/*
 * The web timeline's half of an officer's report-scoped removal. What is pinned
 * here is the reason it is a patch and not a refetch: the timeline cache holds
 * the member's unsent outbox rows, and `use-chat-channel.ts`'s `queryFn`
 * rebuilds the cache without them. So a removal must blank the one row, leave
 * the outbox rows where they are, and refetch a timeline only when the outcome
 * is unknown and that timeline holds the message.
 */

function row(overrides: Partial<RawChatMessage> = {}): RawChatMessage {
  return {
    id: "m-1",
    channel_id: "chan-1",
    sender_id: "u-sender",
    content: "you should quit the chapter",
    kind: "text",
    created_at: "2026-09-22T11:50:00Z",
    client_message_id: "cm-1",
    ...overrides,
  };
}

/** A timeline holding the reported message, a second message, and an unsent outbox row. */
function timelineWithOutbox(channelId = "chan-1"): ChannelCache {
  let cache = mergeServerRow(emptyCache(), row({ channel_id: channelId }));
  cache = mergeServerRow(
    cache,
    row({
      id: "m-2",
      channel_id: channelId,
      client_message_id: "cm-2",
      content: "an ordinary message",
      created_at: "2026-09-22T11:51:00Z",
    }),
  );
  return upsertOptimistic(
    cache,
    optimisticMessage({
      clientMessageId: "cm-unsent",
      channelId,
      senderId: "u-officer",
      content: "not sent yet",
    }),
  );
}

describe("reportedMessageTimeline.markRemoved", () => {
  it("blanks the removed message in its channel's cached timeline and keeps the outbox row", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(chatMessagesKey("chan-1"), timelineWithOutbox());

    reportedMessageTimeline.markRemoved(queryClient, "chan-1", "m-1");

    const cache = queryClient.getQueryData<ChannelCache>(
      chatMessagesKey("chan-1"),
    );
    const messages = selectMessages(cache);
    expect(messages.find((m) => m.id === "m-1")).toMatchObject({
      content: "[message deleted]",
      is_deleted: true,
    });
    expect(messages.find((m) => m.id === "m-2")?.content).toBe(
      "an ordinary message",
    );
    expect(messages.find((m) => m.id === "cm-unsent")).toMatchObject({
      content: "not sent yet",
      _status: "pending",
    });
    // A patch, not a refetch: nothing was marked stale.
    expect(
      queryClient.getQueryState(chatMessagesKey("chan-1"))?.isInvalidated,
    ).toBe(false);
  });

  it("touches no other channel's timeline", () => {
    const queryClient = new QueryClient();
    const other = timelineWithOutbox("chan-2");
    queryClient.setQueryData(chatMessagesKey("chan-2"), other);

    reportedMessageTimeline.markRemoved(queryClient, "chan-1", "m-1");

    expect(queryClient.getQueryData(chatMessagesKey("chan-2"))).toBe(other);
    // Nor does it create a cache for a channel that had none — a DM the
    // officer is not in is never cached, and must not start to be.
    expect(queryClient.getQueryData(chatMessagesKey("chan-1"))).toBeUndefined();
  });
});

describe("reportedMessageTimeline.refetchHolding", () => {
  it("refetches only the cached timelines that hold the message", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(chatMessagesKey("chan-1"), timelineWithOutbox());
    queryClient.setQueryData(
      chatMessagesKey("chan-2"),
      mergeServerRow(
        emptyCache(),
        row({ id: "m-9", channel_id: "chan-2", client_message_id: "cm-9" }),
      ),
    );

    reportedMessageTimeline.refetchHolding(queryClient, "m-1");

    const stale = (channelId: string) =>
      queryClient.getQueryState(chatMessagesKey(channelId))?.isInvalidated;
    expect(stale("chan-1")).toBe(true);
    expect(stale("chan-2")).toBe(false);
  });
});

/*
 * `@repo/hooks` spells the non-timeline keys a removal refetches, and leaves
 * the timeline to this module. This app depends on chat-core, which makes it
 * the one place that division can be held: if chat-core re-roots the timeline
 * key, the hooks predicate must still not match it — a refetch there costs the
 * outbox — and this module must still find it.
 */
describe("the division between the hooks predicate and this module", () => {
  it("keeps chat-core's timeline key out of the hooks predicate", () => {
    for (const channelId of ["chan-1", null]) {
      expect(
        readsRemovedMessage(chatMessagesKey("chan-1"), {
          chapterId: "chap-1",
          messageId: "m-1",
          channelId,
        }),
      ).toBe(false);
    }
  });
});
