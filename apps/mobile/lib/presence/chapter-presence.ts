/**
 * Chapter presence on the phone (#3917): the phone publishes the member on
 * `presence:chapter:<chapterId>` and reads everyone else's dot off it, as web
 * does. The hook itself is shared with web (`@repo/hooks/use-chapter-presence`,
 * which holds the reasoning); this file binds it to the phone.
 *
 * - **One channel, foreground only.** The runtime holds exactly one extra
 *   Realtime channel, on the socket chat already keeps open, and only while
 *   the app is in the foreground. Switching away first publishes the member
 *   as `away` (Idle), then, `AWAY_RELEASE_DELAY_MS` later, releases the topic
 *   through the shared `releaseTopic` (`realtime-resilience` rule 1), which
 *   takes their entry off it. Every member who saw the away entry keeps them
 *   Idle for `AWAY_GRACE_MS` (five minutes, Shawn's call), then Offline. The
 *   return re-joins. The OS may freeze the app before the away publish goes
 *   out; then the member reads Offline once their socket drops, which is the
 *   honest fallback.
 * - **Gated on the link, not on `isOffline`** (rule 7). Realtime is a
 *   different service from `/health`, so three failed API probes must not make
 *   every member read Offline. `connectionMonitor.linkDown()` is the link half
 *   of the one monitor (rule 3), so this adds no `expo-network` subscription.
 * - **The foreground is the activity.** The phone has no app-wide touch
 *   listener (the root layout is frozen, `navigation.md` § Hotspot freeze),
 *   and the OS locks an untouched phone, which backgrounds the app. So a phone
 *   in the foreground counts as in use: the return stamps activity, and a
 *   refresh every `FOREGROUND_REFRESH_MS` keeps a member who is reading from
 *   crossing into Idle. A member who disables auto-lock and walks away reads
 *   Online, the trade Slack's and Discord's phone apps make too.
 * - **Invisible never tracks, and DND, Idle and the custom line ride the
 *   entry**, from the member's own status (`lib/account/own-status.ts`), as on
 *   web. Nothing is published until that status is known.
 *
 * The runtime is a hook, mounted once by `components/app-runtime.tsx` above
 * the auth gate; screens read one member at a time through `usePresenceOf()`
 * in `./presence-store.ts`, which costs a store read, not a channel.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useActiveChapterId, useViewerUserId } from "@repo/hooks";
import {
  useSharedChapterPresence,
  type PresenceActivitySource,
  type PresenceAttach,
  type PresenceChannel,
} from "@repo/hooks/use-chapter-presence";
import { attachTopicChannel } from "@repo/chat-core/topic-attach";
import { getSupabaseClient } from "@/lib/supabase";
import { useIsApiAuthenticated } from "@/lib/use-is-api-authenticated";
import { connectionMonitor } from "@/lib/connection/monitor";
import { useOwnStatus, useOwnStatusSync } from "@/lib/account/own-status";
import { PRESENCE_NOT_READY, setChapterPresence } from "./presence-store";

/**
 * How often a phone in the foreground re-stamps its activity: well inside the
 * five-minute Idle threshold, and a quarter of web's worst case (one publish
 * per 30 seconds of activity), since each one is a diff sent to every member
 * of the chapter.
 */
export const FOREGROUND_REFRESH_MS = 2 * 60 * 1000;

/**
 * How long the channel stays up after switching away, so the `away` publish
 * reaches the topic before the release. iOS gives a backgrounded app a few
 * seconds before it freezes it; this stays well inside that.
 */
export const AWAY_RELEASE_DELAY_MS = 1500;

/**
 * `background` only, the line the connection monitor draws: `inactive` is
 * the app switcher or Control Center, with the app still running.
 */
function isForeground(): boolean {
  return AppState.currentState !== "background";
}

/**
 * Whether the app is in the foreground, and whether a switch away is still
 * inside `AWAY_RELEASE_DELAY_MS`, when the channel stays up to say `away`.
 */
function useForeground(): { foreground: boolean; releasing: boolean } {
  const [state, setState] = useState(() => ({
    foreground: isForeground(),
    releasing: false,
  }));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const subscription = AppState.addEventListener("change", () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (isForeground()) {
        setState({ foreground: true, releasing: false });
        return;
      }
      setState((previous) =>
        previous.foreground ? { foreground: false, releasing: true } : previous,
      );
      timer = setTimeout(() => {
        timer = null;
        setState((previous) =>
          previous.foreground ? previous : { foreground: false, releasing: false },
        );
      }, AWAY_RELEASE_DELAY_MS);
    });
    return () => {
      subscription.remove();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
  return state;
}

function subscribeToLink(onChange: () => void): () => void {
  return connectionMonitor.subscribeLinkDown(onChange);
}

function isLinkDown(): boolean {
  return connectionMonitor.linkDown();
}

const attach: PresenceAttach = (topic, configure, options) => {
  const client = getSupabaseClient();
  if (!client) return () => undefined;
  return attachTopicChannel(
    client,
    topic,
    (channel) => {
      configure(channel as unknown as PresenceChannel);
      return channel;
    },
    options,
  );
};

const phoneActivity: PresenceActivitySource = {
  latest: () => (isForeground() ? Date.now() : null),
  subscribe(onActivity) {
    const interval = setInterval(() => {
      if (isForeground()) onActivity();
    }, FOREGROUND_REFRESH_MS);
    // The return to the foreground is activity even when the channel never
    // let go (the OS froze the app inside `AWAY_RELEASE_DELAY_MS`), where no
    // re-attach reads `latest`.
    const subscription = AppState.addEventListener("change", () => {
      if (isForeground()) onActivity();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  },
};

/** Starts chapter presence. Mount exactly once, from `AppRuntime`. */
export function useChapterPresenceRuntime(): void {
  const signedIn = useIsApiAuthenticated();
  const viewerId = useViewerUserId({ enabled: signedIn });
  const chapterId = useActiveChapterId();
  // `null` until the member's settings load, which holds the publish back.
  // A failed read stays unknown too: the phone has no last-seen status to
  // fall back on, and a saved Invisible must not go out as Online.
  const own = useOwnStatus({ enabled: signedIn, unknownOnError: true });
  // Keeps that status current across devices while the app is open.
  useOwnStatusSync();
  const { foreground, releasing } = useForeground();
  const linkDown = useSyncExternalStore(subscribeToLink, isLinkDown, isLinkDown);
  const hasClient = useMemo(() => getSupabaseClient() !== null, []);

  const presence = useSharedChapterPresence({
    attach,
    activity: phoneActivity,
    chapterId: signedIn ? chapterId : null,
    viewerId,
    enabled: signedIn && hasClient && (foreground || releasing) && !linkDown,
    own,
    away: !foreground,
  });

  useEffect(() => {
    setChapterPresence(presence);
  }, [presence]);
  useEffect(() => () => setChapterPresence(PRESENCE_NOT_READY), []);
}
