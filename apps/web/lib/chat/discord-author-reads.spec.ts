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

    await refreshTimelinesForDiscordAuthor(client, ME);

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

    await refreshTimelinesForDiscordAuthor(client, ME);

    expect(client.getQueryData(chatMessagesKey("chan-closed"))).toBeUndefined();
    expect(client.getQueryData(["profile", "me"])).toEqual({ id: "me" });
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
