"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { attachRealtimeChannel } from "@/lib/realtime/supabase-realtime";
import { chapterPresenceTopic } from "@/lib/realtime/presence-topics";
import {
  PRESENCE_HEARTBEAT_MS,
  presenceMapFrom,
  presenceStatusFor,
  type PresenceStatus,
  type RawPresenceState,
} from "@/lib/realtime/presence-status";

/**
 * Chapter-wide Realtime Presence for the member directory.
 *
 * Attach/teardown is `attachRealtimeChannel`'s job, not this hook's — it
 * already serializes attach and release per topic and frees an occupied topic
 * before minting on it, which is the invariant #783/#817 were paid for and
 * which `realtime-resilience` rule 1 requires every subscriber to inherit
 * rather than reimplement. This hook only adds what is presence-specific:
 * tracking the viewer, keeping that track alive, and reducing the presence
 * state into something the directory can render.
 *
 * **No Postgres writes.** Presence is ephemeral per ADR-02 — it lives on the
 * Realtime socket and nowhere else, so nothing here persists and a member going
 * offline leaves no row to clean up.
 */

/** Events that count as "the member is still using the app". */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "scroll",
  "focus",
] as const;

/**
 * Floor on how often an activity event may re-stamp the timestamp.
 *
 * Activity is high-frequency (every keystroke, every scroll frame) and the
 * value only feeds a 5-minute threshold, so stamping on each event would burn
 * work to no observable effect. Throttling to the heartbeat interval means at
 * most one write per heartbeat, and the worst-case error is one interval of
 * staleness against a 5-minute window.
 */
const ACTIVITY_THROTTLE_MS = PRESENCE_HEARTBEAT_MS;

export type ChapterPresence = {
  /** `userId` → last activity timestamp, for members currently present. */
  presentSince: Map<string, number>;
  /** Status for one member. Absent from the map → `"offline"`. */
  statusOf: (userId: string) => PresenceStatus;
  /** False until the first `sync` lands, so callers can avoid rendering everyone Offline. */
  isReady: boolean;
};

type Options = {
  chapterId: string | null | undefined;
  viewerId: string | null | undefined;
  enabled?: boolean;
};

export function useChapterPresence({
  chapterId,
  viewerId,
  enabled = true,
}: Options): ChapterPresence {
  /**
   * The roster, stamped with the chapter it came from.
   *
   * Carrying the chapter id *inside* the state is what lets a chapter switch
   * be handled by derivation rather than by clearing state from the effect
   * body — a synchronous `setState` there cascades renders, and React's lint
   * rule rightly refuses it. A roster whose stamp no longer matches the active
   * chapter simply stops matching below, so the previous chapter's members can
   * never be rendered against the new one. Presence is the one surface where
   * stale data is a positive claim about a named person, not just missing data.
   */
  const [roster, setRoster] = useState<{
    chapterId: string | null;
    byUser: Map<string, number>;
  }>(() => ({ chapterId: null, byUser: new Map() }));

  // Re-render on a wall-clock tick so a member who stops interacting crosses
  // into Idle on their own. Presence state alone cannot do this: nothing is
  // broadcast when someone simply stops typing, so without a local tick the
  // row would keep reading Online until the next unrelated sync.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || !chapterId) return undefined;
    const interval = setInterval(
      () => setTick((n) => n + 1),
      PRESENCE_HEARTBEAT_MS,
    );
    return () => clearInterval(interval);
  }, [enabled, chapterId]);

  useEffect(() => {
    if (!enabled || !chapterId) return undefined;

    const topic = chapterPresenceTopic(chapterId);
    let channel: RealtimeChannel | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let detached = false;
    // Last activity we have stamped for the viewer. Seeded at attach time: a
    // member who opens the directory and reads without touching anything is
    // active, not idle.
    let lastActiveAt = Date.now();
    let lastStampedAt = 0;

    function readState() {
      if (!channel || detached) return;
      const state = channel.presenceState() as unknown as RawPresenceState;
      // Stamped with the chapter it was read for — see `roster` above.
      setRoster({ chapterId, byUser: presenceMapFrom(state) });
    }

    function track() {
      if (!channel || !viewerId || detached) return;
      // Fire-and-forget, exactly as chat's own track is: a failed track costs
      // one member one status dot, and a rejection escaping here would surface
      // as an unhandled rejection in a React commit.
      void channel.track({ userId: viewerId, ts: lastActiveAt });
    }

    function onActivity() {
      const now = Date.now();
      lastActiveAt = now;
      if (now - lastStampedAt < ACTIVITY_THROTTLE_MS) return;
      lastStampedAt = now;
      track();
    }

    const detach = attachRealtimeChannel(topic, (realtimeChannel) => {
      channel = realtimeChannel;
      realtimeChannel.on("presence", { event: "sync" }, readState);
      realtimeChannel.on("presence", { event: "join" }, readState);
      realtimeChannel.on("presence", { event: "leave" }, readState);
      // `attachRealtimeChannel` owns `subscribe()`, so the initial track cannot
      // hang off a SUBSCRIBED callback here. The heartbeat below is what gets
      // the viewer into the map, and its first tick is immediate.
      return realtimeChannel;
    });

    if (viewerId) {
      lastStampedAt = Date.now();
      // `track()` before SUBSCRIBED is a no-op on the wire, so the interval
      // both seeds and sustains membership. Supabase drops a member who stops
      // re-tracking, which is what makes leaving the page read as Offline.
      heartbeat = setInterval(track, PRESENCE_HEARTBEAT_MS);
      track();
      for (const event of ACTIVITY_EVENTS) {
        window.addEventListener(event, onActivity, { passive: true });
      }
      document.addEventListener("visibilitychange", onActivity);
    }

    return () => {
      detached = true;
      if (heartbeat) clearInterval(heartbeat);
      if (viewerId) {
        for (const event of ACTIVITY_EVENTS) {
          window.removeEventListener(event, onActivity);
        }
        document.removeEventListener("visibilitychange", onActivity);
      }
      channel = null;
      detach();
    };
  }, [enabled, chapterId, viewerId]);

  // A roster stamped with a different chapter — or one held while the hook is
  // disabled — is not evidence about the chapter being displayed, so it is
  // dropped here rather than cleared from the effect.
  const isCurrent = Boolean(enabled && chapterId && roster.chapterId === chapterId);
  const presentSince = useMemo(
    () => (isCurrent ? roster.byUser : new Map<string, number>()),
    [isCurrent, roster.byUser],
  );

  const statusOf = useCallback(
    (userId: string) => presenceStatusFor(presentSince.get(userId), Date.now()),
    [presentSince],
  );

  return { presentSince, statusOf, isReady: isCurrent };
}
