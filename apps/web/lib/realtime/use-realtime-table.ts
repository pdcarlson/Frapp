"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { attachRealtimeChannel } from "@/lib/realtime/supabase-realtime";

type RealtimeEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

type Options = {
  /** Supabase table name in the `public` schema, e.g. `event_attendance`. */
  table: string;
  /** Optional `column=eq.value` filter, e.g. `event_id=eq.${eventId}`. */
  filter?: string;
  /** Defaults to `*` (all change events). */
  event?: RealtimeEvent;
  /**
   * Query keys to invalidate on every matching change. Keys are passed
   * straight to `queryClient.invalidateQueries({ queryKey })`.
   *
   * The same subscription can invalidate more than one key to keep caches
   * consistent (e.g. attendance changes invalidate the event detail too).
   */
  invalidate?: readonly (readonly unknown[])[];
  /** Gate the subscription when data isn't available yet. */
  enabled?: boolean;
};

/**
 * Subscribe to Supabase Postgres changes on a single table and trigger
 * TanStack query invalidations when they arrive.
 *
 * This is the primary realtime primitive for the dashboard: chat uses it for
 * message lists, notifications uses it for the bell badge, attendance uses
 * it for the live check-in pulse. Hooks that need the raw payload (e.g. chat
 * optimistic updates) can call `attachRealtimeChannel` directly.
 *
 * The subscription is gated by `enabled` so we never attach to an invalid
 * filter (e.g. `event_id=eq.` with an empty event id), which would silently
 * match the entire table.
 */
export function useRealtimeTable({
  table,
  filter,
  event = "*",
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
    if (!enabled) return undefined;
    const topic = filter ? `${table}:${filter}` : `${table}:all`;
    const detach = attachRealtimeChannel(topic, (channel) =>
      channel.on(
        "postgres_changes" as never,
        // The Supabase types for `postgres_changes` require a literal event;
        // the cast lets us accept the broader '*' union in a single hook.
        {
          event,
          schema: "public",
          table,
          ...(filter ? { filter } : {}),
        } as unknown as {
          event: RealtimeEvent;
          schema: string;
          table: string;
          filter?: string;
        },
        () => {
          for (const key of invalidateRef.current) {
            queryClient.invalidateQueries({ queryKey: [...key] });
          }
        },
      ),
    );
    return detach;
  }, [enabled, event, filter, invalidateKey, queryClient, table]);
}
