"use client";

/**
 * The identity chat's **outbound** on-disk rows (drafts, outbox) are written
 * under — one hook, so the drafts table and the outbox can never disagree about
 * whose work they are holding.
 *
 * Both halves are read from local state rather than fetched:
 *
 * - `useAuthUserId()` is the Supabase auth uid, resolved from the stored
 *   session. See `offline-queue.ts` for why this and not `useViewerUserId()` —
 *   briefly, it is the subject of the token a flush POSTs under, and it does not
 *   cost a round trip an offline composer cannot make.
 * - `activeChapterId` is the persisted chapter store, corrected by the token's
 *   `active_chapter_id` claim (`useClaimChapterSync`).
 *
 * `null` until both have resolved. Callers treat that as "no persistence yet",
 * which is the same posture they already take for SSR and for a browser with
 * IndexedDB switched off: the composer still works, the keystrokes are still in
 * memory, nothing is written anywhere it could later be read under the wrong
 * identity. That window is short and closes before a send is possible at all —
 * `offline-queue.ts` walks through why.
 */

import { useMemo } from "react";
import { useAuthUserId } from "@/lib/auth/use-auth-user-id";
import { useChapterStore } from "@/lib/stores/chapter-store";
import type { ChatOutboundScope } from "./offline-queue";

export function useChatOutboundScope(): ChatOutboundScope | null {
  const userId = useAuthUserId();
  const chapterId = useChapterStore((s) => s.activeChapterId);
  return useMemo(
    () => (userId && chapterId ? { userId, chapterId } : null),
    [userId, chapterId],
  );
}
