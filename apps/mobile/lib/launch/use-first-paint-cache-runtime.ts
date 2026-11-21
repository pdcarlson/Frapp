import { useEffect } from "react";
import { hashKey, useQueryClient, type Query } from "@tanstack/react-query";
import { statusOf } from "@repo/api-sdk";
import { selectMessages } from "@repo/chat-core/cache";
import { TAIL_ROW_FORMAT, toCacheableRows } from "@repo/chat-core/first-chunk";
import {
  chatMessagesChannelId,
  chatMessagesKey,
  type ChannelCache,
} from "@repo/chat-core/types";
import { CHANNEL_LIST_KEY, chatBlockKeys } from "@repo/hooks";
import { useAuthSession } from "@/lib/auth-session";
import {
  firstPaintGeneration,
  readFirstPaint,
  seedFirstPaint,
  withTail,
  withoutTail,
  writeKeptBlockFloor,
  writeKeptChannels,
  writeKeptMe,
  writeKeptTails,
  type KeptTail,
} from "./first-paint-cache";
import { holdBlockFloor } from "./kept-block-floor";

/**
 * How a busy timeline's tail is rewritten: once it has settled for
 * `debounceMs`, and at least every `maxWaitMs` while messages keep arriving
 * (web's `TAIL_WRITE_TIMING`, `use-first-chunk-cache.ts`).
 */
export const TAIL_WRITE_TIMING = { debounceMs: 1_000, maxWaitMs: 5_000 };

const ME_HASH = hashKey(["user", "me"]);
const CHANNELS_HASH = hashKey(CHANNEL_LIST_KEY);

/** A timeline read the member can no longer make: its kept tail goes. */
function refused(error: unknown): boolean {
  const status = statusOf(error);
  return status === 403 || status === 404;
}

/**
 * Seeds the query cache from what the phone kept of chat at launch, and keeps
 * the server's answers for the next one (`first-paint-cache.ts`, #5768).
 * Mounted once, first in `components/app-runtime.tsx`, above the screens, so
 * the seed lands before chat home and the thread mount on it, and its
 * listener is on the query cache before any fetch of the same commit starts.
 *
 * **Only answers fetched under the current scope are kept.** A sign-out, an
 * account swap and a chapter switch clear the query cache from an effect
 * after the scope has already changed here, so for a moment the cache can
 * hold the outgoing scope's answers beside the incoming scope's key. A query
 * counts only once a fetch has started on it since this scope began (`fetch`
 * action), so none of those can be written under the new key.
 *
 * **A seed is never written back.** A seed is a manual update, and a
 * timeline's realtime merges are manual updates too, so a timeline is written
 * only once the server has answered it in this scope (a non-manual success);
 * a kept tail is never rewritten with a fresh date before then.
 *
 * **Only timelines on screen are written.** A read-ahead (a prefetch, with no
 * observer) would otherwise push the channel the member actually opened out of
 * the kept three.
 *
 * Every write carries the generation it started under, so one still pending
 * when the member signs out is dropped rather than landing after the wipe.
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
    const generation = firstPaintGeneration();
    const blocksHash = chapter ? hashKey(chatBlockKeys.list(chapter)) : null;
    let cancelled = false;
    let tails: KeptTail[] = [];
    let tailsRead = false;
    const dirtyTails = new Set<string>();
    const droppedTails = new Set<string>();
    let firstDirtyAt = 0;
    let tailTimer: ReturnType<typeof setTimeout> | null = null;
    const fetched = new WeakSet<Query>();
    const answered = new WeakSet<Query>();
    const lastWritten = new Map<string, string>();

    void readFirstPaint(user, chapter).then((kept) => {
      if (cancelled) return;
      tails = kept.tails;
      tailsRead = true;
      seedFirstPaint(queryClient, kept);
      holdBlockFloor(kept.blockFloor);
      // A timeline that loaded (or was refused) before the disk answered is
      // written now, in front of the kept ones.
      if (dirtyTails.size > 0 || droppedTails.size > 0) scheduleTails(true);
    });

    function writeTails(): void {
      tailTimer = null;
      firstDirtyAt = 0;
      if (cancelled || !tailsRead) return;
      const now = Date.now();
      for (const channelId of droppedTails)
        tails = withoutTail(tails, channelId);
      droppedTails.clear();
      for (const channelId of dirtyTails) {
        const cache = queryClient.getQueryData<ChannelCache>(
          chatMessagesKey(channelId),
        );
        const rows = toCacheableRows(selectMessages(cache));
        if (rows.length > 0) {
          tails = withTail(tails, {
            channelId,
            rows,
            cachedAt: now,
            rowFormat: TAIL_ROW_FORMAT,
          });
        }
      }
      dirtyTails.clear();
      writeKeptTails(generation, user, chapter, tails);
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

    /** Skips an answer identical to the one this scope last wrote. */
    function changed(part: string, data: unknown): boolean {
      const serialized = JSON.stringify(data);
      if (lastWritten.get(part) === serialized) return false;
      lastWritten.set(part, serialized);
      return true;
    }

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (cancelled || event.type !== "updated") return;
      const { query, action } = event;
      if (action.type === "fetch") {
        fetched.add(query);
        return;
      }
      if (!fetched.has(query)) return;
      const channelId = chatMessagesChannelId(query.queryKey);

      if (action.type === "error") {
        if (channelId && refused(action.error)) {
          dirtyTails.delete(channelId);
          droppedTails.add(channelId);
          scheduleTails();
        }
        return;
      }
      if (action.type !== "success") return;
      if (!action.manual) answered.add(query);
      const { data, dataUpdatedAt } = query.state;
      if (data === undefined) return;

      if (channelId) {
        // Realtime merges arrive as manual updates and count once the server
        // has answered: the tail is the timeline as the member last saw it.
        if (!answered.has(query) || query.getObserversCount() === 0) return;
        droppedTails.delete(channelId);
        dirtyTails.add(channelId);
        scheduleTails();
        return;
      }
      if (action.manual) return;
      if (query.queryHash === ME_HASH) {
        if (changed("me", data))
          writeKeptMe(generation, user, data, dataUpdatedAt);
      } else if (query.queryHash === CHANNELS_HASH) {
        if (changed("channels", data)) {
          writeKeptChannels(generation, user, chapter, data, dataUpdatedAt);
        }
      } else if (blocksHash && query.queryHash === blocksHash) {
        const ids = (data as { ids?: unknown }).ids;
        if (
          Array.isArray(ids) &&
          ids.every((id) => typeof id === "string") &&
          changed("blocks", ids)
        ) {
          writeKeptBlockFloor(generation, user, chapter, ids as string[]);
        }
      }
    });

    return () => {
      cancelled = true;
      if (tailTimer) clearTimeout(tailTimer);
      unsubscribe();
      holdBlockFloor(null);
    };
  }, [queryClient, scopeUser, chapterId]);
}
