"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { attachRealtimeChannel } from "@/lib/realtime/supabase-realtime";
import {
  CHANGE_EVENT,
  changeTopic,
  type ChangeTable,
} from "@/lib/realtime/change-topics";

type Options = {
  /** Table whose changes should invalidate. Must emit a ping — see `change-topics.ts`. */
  table: ChangeTable;
  /**
   * Id the ping is scoped to. Mirrors the column this subscription used to
   * filter on: `users.id` for notifications, `chapters.id` for events,
   * `events.id` for attendance.
   *
   * Nullable because both real sources are: `frappUser.userId` is `null` until
   * the profile resolves and `activeChapterId` is `null` before a chapter is
   * picked. A nullish scope suppresses the subscription entirely rather than
   * minting a shared `notif:null` topic.
   */
  scopeId: string | null | undefined;
  /**
   * Query keys to invalidate on every change. Keys are passed straight to
   * `queryClient.invalidateQueries({ queryKey })`.
   *
   * The same subscription can invalidate more than one key to keep caches
   * consistent (e.g. attendance changes invalidate the event detail too).
   */
  invalidate?: readonly (readonly unknown[])[];
  /** Gate the subscription when data isn't available yet. */
  enabled?: boolean;
};

/**
 * Refetch-on-change for a scoped slice of a table.
 *
 * **Carrier: private broadcast, not `postgres_changes`.** This hook used to open
 * a `postgres_changes` subscription, which never delivered anything in any
 * environment — `supabase_realtime` contained no tables at all, verified against
 * prod and staging on 2026-08-16 (#867). Publishing these tables would have
 * fixed delivery, but Realtime evaluates the same RLS policy PostgREST does, so
 * the SELECT policy needed to make the events flow would equally have opened
 * `notifications` / `events` / `event_attendance` to direct browser reads —
 * bypassing every guard that enforces access in the API today.
 *
 * These three subscribers never read the changed row: this hook's whole body is
 * `invalidateQueries`, and the refetch goes back through the API where the real
 * authorization lives. So the database sends a contentless
 * `{table, op}` ping on a scoped private topic instead, and the tables stay
 * default-deny. Chat is the opposite case — it merges `payload.new` into a
 * cache — so it keeps `postgres_changes` plus a row-level policy.
 *
 * The subscription is gated by `enabled` and by a defined `scopeId`, so we never
 * attach to a topic with an empty scope (`notif:`), which would be a topic other
 * clients could collide on.
 */
export function useRealtimeTable({
  table,
  scopeId,
  invalidate = [],
  enabled = true,
}: Options) {
  const queryClient = useQueryClient();

  // Keep the latest invalidate value in a ref so the effect callback always
  // reads the current keys without needing a stable array reference.
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  // Serialize to a stable string so inline array literals don't cause the
  // effect to re-run on every render.
  const invalidateKey = JSON.stringify(invalidate);

  useEffect(() => {
    if (!enabled || !scopeId) return undefined;
    const topic = changeTopic(table, scopeId);
    const detach = attachRealtimeChannel(
      topic,
      (channel) =>
        channel.on("broadcast", { event: CHANGE_EVENT }, () => {
          for (const key of invalidateRef.current) {
            queryClient.invalidateQueries({ queryKey: [...key] });
          }
        }),
      { private: true },
    );
    return detach;
  }, [enabled, invalidateKey, queryClient, scopeId, table]);
}
