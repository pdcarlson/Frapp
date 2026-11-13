"use client";

/**
 * Binds the chat realtime manager (a module singleton) for the whole
 * dashboard, not just `/chat` (#3745).
 *
 * The manager's inbox (`chat:inbox:global`) reports every new message the
 * member may read, and `useChatActivityHandler` re-reads the unread counts
 * from it (#3698). The nav's Chat row lights from those counts on every page
 * (`use-chat-has-unread.ts`), so the inbox has to be joined on every page: bound inside
 * `ChatProvider`, which mounts only while the chat panel is open (#3779; it
 * was only on `/chat` before), a message arriving while the member was on
 * Events with chat closed would light nothing until the counts went stale (15 s) or the
 * tab regained focus. Mobile binds app-wide the same way
 * (`useChatRealtimeBinding` in `apps/mobile/lib/chat/use-chat-runtime.ts`).
 *
 * Called once, from `DashboardShell`. `ChatProvider` keeps what is chat's
 * alone (the outbox flush, the first-chunk cache) and never touches the
 * manager's lifecycle, so its remount each time the chat panel opens cannot
 * tear a shell-owned manager down (`realtime-resilience` rule 1). Threads
 * still subscribe and release their own channels (`use-chat-channel.ts`), so
 * closing the chat panel releases the open thread's topic. What `configure()`
 * joins stays up on every page: the inbox, and also the global reactions topic
 * and the typing tick, which nothing reads while chat is closed (#3899).
 */

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useChatActivityHandler, useFrappClient } from "@repo/hooks";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { getRealtimeClient } from "@/lib/realtime/supabase-realtime";
import {
  chatRealtime,
  createBackfillFetcher,
} from "@repo/chat-core/realtime-manager";

function isTabVisible(): boolean {
  return document.visibilityState === "visible";
}

export function useChatRealtimeBinding(): void {
  const queryClient = useQueryClient();
  const apiClient = useFrappClient();
  const { userId } = useFrappUser();
  const supabase = useMemo(() => getRealtimeClient(), []);

  /*
    Re-reads the unread counts when the inbox reports a message, or re-stamps
    the open channel read when the message landed in it while the tab is
    visible (#3698).
  */
  const onMessageActivity = useChatActivityHandler(
    userId ?? null,
    isTabVisible,
  );

  /*
    Bind the manager to this mount's clients, and rebind it when the viewer
    resolves or changes.

    Rebinding is a plain `configure`, never `destroy()` first (#3002). The live
    `userId` answers after the thread has often already subscribed its channel,
    from the first-chunk channel list. `destroy()` dropped that subscription,
    and the thread's subscribe effect, keyed on the channel, never ran again:
    the thread went quiet for good, with the pill still reading live and no
    polling behind it. `configure` follows the viewer itself: it tracks a
    viewer who resolves after the join on the channel already joined, and
    rejoins every channel and the inbox for a different one, so presence names
    the right member (ADR-10). `supabase` is fixed for the mount and
    `queryClient` is the app's one client, so a rebind never has to move a
    channel to another client.

    A child's effects run before its parent's, so on a cold load of `/chat` the
    thread subscribes before this configures; `configure` attaches that
    waiting channel.
  */
  /*
    Not before the first viewer is known (#4709). A first bind with no viewer
    joined the inbox, and the viewer resolving a moment later rejoined it,
    which owes a resync: on every cold open that re-stamped the open channel
    read and re-read the unread counts the open had just read, two more
    requests in the burst. The open's own reads (`/v1/users/me` among them)
    land together, so the wait is short, and a thread that subscribes first
    waits for this `configure` the way #3002 already provides for.

    Mobile has always waited this way (`boundRef` in
    `apps/mobile/lib/chat/use-chat-runtime.ts`), and like it, once bound, a
    `null` viewer still rebinds at once: an in-place account swap must not
    keep the previous member's channels joined until the new member's
    `/v1/users/me` answers.
  */
  const bound = useRef(false);
  useEffect(() => {
    if (!userId && !bound.current) return;
    bound.current = true;
    chatRealtime.configure({
      queryClient,
      supabase,
      viewerId: userId ?? null,
      backfill: createBackfillFetcher(apiClient),
      onMessageActivity,
    });
  }, [queryClient, supabase, apiClient, userId, onMessageActivity]);

  /*
    A tab that comes back from hidden may have been throttled or frozen, its
    socket dead without the client knowing yet. Catch up now rather than at
    the next heartbeat (#3698). The online edge is the manager's own.
  */
  useEffect(() => {
    const onVisibility = () => {
      if (isTabVisible()) chatRealtime.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Torn down only when the dashboard itself unmounts (sign-out, leaving for
  // a route outside it), never on a trip in or out of `/chat`.
  useEffect(() => () => chatRealtime.destroy(), []);
}
