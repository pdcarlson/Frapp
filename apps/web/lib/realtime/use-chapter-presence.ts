"use client";

import {
  useSharedChapterPresence,
  type PresenceActivitySource,
  type PresenceAttach,
  type PresenceChannel,
} from "@repo/hooks/use-chapter-presence";
import type { OwnStatus } from "@repo/hooks/member-status";
import { attachRealtimeChannel } from "@/lib/realtime/supabase-realtime";

export type { ChapterPresence } from "@repo/hooks/use-chapter-presence";

/**
 * Web's binding of the shared chapter-presence hook
 * (`@repo/hooks/use-chapter-presence`, which holds the reasoning): web's
 * Realtime client, and the window's own events as activity. Mounted once, by
 * `ChapterPresenceProvider`.
 */

/** Events that count as "the member is still using the app". */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "scroll", "focus"] as const;

const attach: PresenceAttach = (topic, configure, options) =>
  attachRealtimeChannel(
    topic,
    (channel) => {
      configure(channel as unknown as PresenceChannel);
      return channel;
    },
    options,
  );

const activity: PresenceActivitySource = {
  subscribe(onActivity) {
    function onEvent() {
      // `visibilitychange` fires in both directions. Stamping on *hide* would
      // reset the idle clock at the moment the member walks away, so someone
      // who alt-tabs 10s before crossing into Idle would read Online for a
      // further five minutes.
      if (document.visibilityState !== "visible") return;
      onActivity();
    }
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onEvent, { passive: true });
    }
    document.addEventListener("visibilitychange", onEvent);
    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onEvent);
      }
      document.removeEventListener("visibilitychange", onEvent);
    };
  },
};

export function useChapterPresence(options: {
  chapterId: string | null | undefined;
  viewerId: string | null | undefined;
  enabled?: boolean;
  own?: OwnStatus | null;
  away?: boolean;
}) {
  return useSharedChapterPresence({ ...options, attach, activity });
}
