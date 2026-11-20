import { useEffect } from "react";
import { hashKey, useQueryClient, type Query } from "@tanstack/react-query";
import { selectMessages } from "@repo/chat-core/cache";
import { chatMessagesKey, type ChannelCache } from "@repo/chat-core/types";
import { CHANNEL_LIST_KEY, chatBlockKeys } from "@repo/hooks";
import { useAuthSession } from "@/lib/auth-session";
import {
  readFirstPaint,
  seedFirstPaint,
  toCacheableRows,
  withTail,
  writeFirstPaintAnswer,
  writeFirstPaintTails,
  type StoredTail,
} from "./first-paint-cache";

/**
 * How a busy timeline's tail is rewritten: once it has settled for
 * `debounceMs`, and at least every `maxWaitMs` while messages keep arriving
 * (web's `TAIL_WRITE_TIMING`, `use-first-chunk-cache.ts`).
 */
export const TAIL_WRITE_TIMING = { debounceMs: 1_000, maxWaitMs: 5_000 };

const ME_HASH = hashKey(["user", "me"]);
const CHANNELS_HASH = hashKey(CHANNEL_LIST_KEY);

/** The channel a chat-messages query is for, or null for any other query. */
function tailChannelOf(query: Query): string | null {
  const channelId = query.queryKey[1];
  return typeof channelId === "string" &&
    query.queryHash === hashKey(chatMessagesKey(channelId))
    ? channelId
    : null;
}

/**
 * Seeds the query cache from what the phone kept of chat at launch, and keeps
 * the server's answers for the next one (`first-paint-cache.ts`, #5768).
 * Mounted once, from `components/app-runtime.tsx`, above the screens, so the
 * seed lands before chat home and the thread mount on it.
 *
 * **Only answers fetched under the current scope are kept.** A sign-out, an
 * account swap and a chapter switch clear the query cache from an effect
 * after the scope has already changed here, so for a moment the cache can
 * hold the outgoing scope's answers beside the incoming scope's key. A query
 * is trusted only once a fetch has started on it since this scope's
 * subscription began (`fetch` action), so none of those can be written under
 * the new key, and neither can a seed, which is never a fetch: the copy keeps
 * its age until the server's answer replaces it.
 */
export function useFirstPaintCacheRuntime(): void {
  const queryClient = useQueryClient();
  const { status, userId, chapterId, isChapterResolving } = useAuthSession();
  const scopeUser =
    status === "authenticated" && userId && !isChapterResolving ? userId : null;

  useEffect(() => {
    if (!scopeUser) return;
    const user = scopeUser;
    const chapter = chapterId;
    const blocksHash = chapter ? hashKey(chatBlockKeys.list(chapter)) : null;
    let cancelled = false;
    let tails: StoredTail[] = [];
    let tailsRead = false;
    const dirtyTails = new Set<string>();
    let firstDirtyAt = 0;
    let tailTimer: ReturnType<typeof setTimeout> | null = null;
    const trusted = new WeakSet<Query>();
    const lastWritten = new Map<string, string>();

    void readFirstPaint(user, chapter).then((kept) => {
      if (cancelled) return;
      tails = kept.tails;
      tailsRead = true;
      seedFirstPaint(queryClient, chapter, kept);
      // A timeline that loaded before the disk answered is written now, in
      // front of the kept ones.
      if (dirtyTails.size > 0) scheduleTails(true);
    });

    function writeTails(): void {
      tailTimer = null;
      firstDirtyAt = 0;
      if (cancelled || !tailsRead) return;
      const now = Date.now();
      for (const channelId of dirtyTails) {
        const cache = queryClient.getQueryData<ChannelCache>(
          chatMessagesKey(channelId),
        );
        const rows = toCacheableRows(selectMessages(cache));
        if (rows.length > 0)
          tails = withTail(tails, { channelId, rows, cachedAt: now });
      }
      dirtyTails.clear();
      writeFirstPaintTails(user, chapter, tails);
    }

    function scheduleTails(now = false): void {
      if (!tailsRead) return;
      if (tailTimer) clearTimeout(tailTimer);
      const at = Date.now();
      if (firstDirtyAt === 0) firstDirtyAt = at;
      if (now || at - firstDirtyAt >= TAIL_WRITE_TIMING.maxWaitMs) {
        writeTails();
        return;
      }
      tailTimer = setTimeout(writeTails, TAIL_WRITE_TIMING.debounceMs);
    }

    function keepAnswer(
      part: "me" | "channels" | "blocks",
      data: unknown,
      updatedAt: number,
    ): void {
      const serialized = JSON.stringify(data);
      if (lastWritten.get(part) === serialized) return;
      lastWritten.set(part, serialized);
      writeFirstPaintAnswer(user, chapter, part, data, updatedAt);
    }

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (cancelled || event.type !== "updated") return;
      const { query, action } = event;
      if (action.type === "fetch") {
        trusted.add(query);
        return;
      }
      if (action.type !== "success" || !trusted.has(query)) return;
      const { data, dataUpdatedAt } = query.state;
      if (data === undefined) return;

      const channelId = tailChannelOf(query);
      if (channelId) {
        // Realtime merges arrive as manual updates and count: the tail is the
        // timeline as the member last saw it.
        dirtyTails.add(channelId);
        scheduleTails();
        return;
      }
      if (action.manual) return;
      if (query.queryHash === ME_HASH) keepAnswer("me", data, dataUpdatedAt);
      else if (query.queryHash === CHANNELS_HASH) {
        keepAnswer("channels", data, dataUpdatedAt);
      } else if (blocksHash && query.queryHash === blocksHash) {
        const ids = (data as { ids?: unknown }).ids;
        if (Array.isArray(ids)) keepAnswer("blocks", { ids }, dataUpdatedAt);
      }
    });

    return () => {
      cancelled = true;
      if (tailTimer) clearTimeout(tailTimer);
      unsubscribe();
    };
  }, [queryClient, scopeUser, chapterId]);
}
