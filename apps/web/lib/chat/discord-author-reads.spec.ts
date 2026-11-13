import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { emptyCache, mergeServerRow } from "@repo/chat-core/cache";
import {
  chatMessagesKey,
  type ChannelCache,
  type RawChatMessage,
} from "@repo/chat-core/types";
import { refreshTimelinesForDiscordAuthor } from "./discord-author-reads";

/*
 * #4543: after a Discord link or unlink, an open timeline (staleTime
 * Infinity, so nothing else refetches it) must re-read when it holds the
 * account's imported messages, and only then: a refetch drops the older
 * pages the member scrolled through (#1571).
 */

const ME = "1100000000000000001";
const SOMEONE_ELSE = "1100000000000000002";

function imported(id: string, channelId: string, externalId: string) {
  return {
    id,
    channel_id: channelId,
    sender_id: null,
    author_name: "jkslayer",
    author_external_id: externalId,
    content: "from the Discord archive",
    kind: "imported",
    created_at: "2026-01-01T12:00:00Z",
    client_message_id: null,
  } as RawChatMessage;
}

function timeline(...rows: RawChatMessage[]): ChannelCache {
  return rows.reduce(mergeServerRow, emptyCache());
}

/** Caches `cache` under the channel's key; `open` keeps an observer on it, as the chat panel does. */
function seed(
  client: QueryClient,
  channelId: string,
  cache: ChannelCache,
  open: boolean,
) {
  const queryFn = vi.fn(async () => cache);
  client.setQueryData(chatMessagesKey(channelId), cache);
  if (open) {
    new QueryObserver(client, {
      queryKey: chatMessagesKey(channelId),
      queryFn,
      staleTime: Infinity,
    }).subscribe(() => {});
  }
  return queryFn;
}

describe("refreshTimelinesForDiscordAuthor", () => {
  it("refetches an open timeline holding the account's imported messages, and no other", async () => {
    const client = new QueryClient();
    const mine = seed(
      client,
      "chan-mine",
      timeline(imported("m-1", "chan-mine", ME)),
      true,
    );
    const theirs = seed(
      client,
      "chan-theirs",
      timeline(imported("m-2", "chan-theirs", SOMEONE_ELSE)),
      true,
    );

    await refreshTimelinesForDiscordAuthor(client, [ME]);

    expect(mine).toHaveBeenCalledTimes(1);
    expect(theirs).not.toHaveBeenCalled();
    expect(
      client.getQueryState(chatMessagesKey("chan-theirs"))?.isInvalidated,
    ).toBe(false);
  });

  it("drops a timeline no screen shows, whatever it holds", async () => {
    const client = new QueryClient();
    seed(
      client,
      "chan-closed",
      timeline(imported("m-1", "chan-closed", SOMEONE_ELSE)),
      false,
    );
    client.setQueryData(["profile", "me"], { id: "me" });

    await refreshTimelinesForDiscordAuthor(client, [ME]);

    expect(client.getQueryData(chatMessagesKey("chan-closed"))).toBeUndefined();
    expect(client.getQueryData(["profile", "me"])).toEqual({ id: "me" });
  });

  it("on a re-link, also refetches a timeline holding only the replaced account's messages", async () => {
    const client = new QueryClient();
    const replaced = seed(
      client,
      "chan-old",
      timeline(imported("m-1", "chan-old", SOMEONE_ELSE)),
      true,
    );

    await refreshTimelinesForDiscordAuthor(client, [ME, SOMEONE_ELSE]);

    expect(replaced).toHaveBeenCalledTimes(1);
  });

  // The link-return race: the open thread's first read left before the link
  // committed and is still out, so its cache holds nothing to match.
  it("cancels an open timeline's read still in flight and reads it again", async () => {
    const client = new QueryClient();
    let release: (cache: ChannelCache) => void = () => {};
    const fresh = timeline(imported("m-1", "chan-loading", ME));
    const queryFn = vi
      .fn<() => Promise<ChannelCache>>()
      .mockImplementationOnce(
        () => new Promise<ChannelCache>((resolve) => (release = resolve)),
      )
      .mockResolvedValue(fresh);
    new QueryObserver(client, {
      queryKey: chatMessagesKey("chan-loading"),
      queryFn,
      staleTime: Infinity,
    }).subscribe(() => {});
    expect(
      client.getQueryState(chatMessagesKey("chan-loading"))?.fetchStatus,
    ).toBe("fetching");

    await refreshTimelinesForDiscordAuthor(client, [ME]);
    // The stale first read lands late; it must not be what the cache keeps.
    release(
      timeline({
        ...imported("m-1", "chan-loading", ME),
        author_name: "stale",
      } as RawChatMessage),
    );

    await vi.waitFor(() =>
      expect(client.getQueryData(chatMessagesKey("chan-loading"))).toBe(fresh),
    );
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("without the account's id, refetches every open timeline holding an imported message", async () => {
    const client = new QueryClient();
    const archive = seed(
      client,
      "chan-archive",
      timeline(imported("m-1", "chan-archive", SOMEONE_ELSE)),
      true,
    );
    const live = seed(
      client,
      "chan-live",
      timeline({
        ...imported("m-2", "chan-live", ME),
        author_external_id: null,
        sender_id: "u-1",
        kind: "text",
      } as RawChatMessage),
      true,
    );

    await refreshTimelinesForDiscordAuthor(client, null);

    expect(archive).toHaveBeenCalledTimes(1);
    expect(live).not.toHaveBeenCalled();
  });
});
