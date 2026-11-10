/**
 * Keeps the in-app notification list in step with the member's other devices
 * (#3929), mounted once, app-wide, from `components/app-runtime.tsx`.
 *
 * Two jobs:
 *
 * - **The change ping.** The database sends a contentless `{table, op}`
 *   broadcast on the private topic `notif:<users.id>` whenever one of the
 *   member's `notifications` rows is inserted or updated, a read on another
 *   device included. Web's drawer has listened for it since #867; mobile heard
 *   nothing, so a row read on web stayed unread here until the app next came
 *   to the foreground. The ping carries no row: it only refetches the lists
 *   through the API, which stays the enforcing layer (`notifications` is
 *   RLS-on with no policy). The topic and event come from
 *   `@repo/chat-core/change-topics`, the definition web uses, and the attach
 *   goes through `@repo/chat-core/topic-attach` (realtime-resilience rule 1).
 *   A ping missed while the socket is down is covered by the refetch on
 *   foreground that `refetchOnWindowFocus` already does.
 *
 * - **Seen on screen.** Opening the screen a non-chat notification points at
 *   reads it, on every device (`seen-screens.ts`). Only while the app is in
 *   the foreground: a route left up behind the lock screen shows nobody
 *   anything.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { usePathname } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  invalidateNotificationLists,
  useMarkNotificationScreensSeen,
  useViewerUserId,
} from "@repo/hooks";
import { CHANGE_EVENT, changeTopic } from "@repo/chat-core/change-topics";
import { attachTopicChannel } from "@repo/chat-core/topic-attach";
import { getSupabaseClient } from "@/lib/supabase";
import { useIsApiAuthenticated } from "@/lib/use-is-api-authenticated";
import { notificationScreensForPathname } from "./seen-screens";

function subscribeToAppState(onChange: () => void): () => void {
  const subscription = AppState.addEventListener("change", onChange);
  return () => subscription.remove();
}

function isAppActive(): boolean {
  return AppState.currentState === "active";
}

export function useNotificationSyncRuntime(): void {
  const queryClient = useQueryClient();
  const supabase = useMemo(() => getSupabaseClient(), []);
  // Above the auth gate, like the chat binding: `/v1/users/me` is read only
  // once someone is signed in.
  const signedIn = useIsApiAuthenticated();
  const viewerId = useViewerUserId({ enabled: signedIn });

  useEffect(() => {
    // No member, no topic: never attach to a shared `notif:null`.
    if (!supabase || !viewerId) return undefined;
    return attachTopicChannel(
      supabase,
      changeTopic("notifications", viewerId),
      (channel) =>
        channel.on("broadcast", { event: CHANGE_EVENT }, () => {
          void invalidateNotificationLists(queryClient);
        }),
      // Private routes the join through `realtime.messages` RLS, which is what
      // limits this topic to its own member.
      { private: true },
    );
  }, [queryClient, supabase, viewerId]);

  const pathname = usePathname();
  const appActive = useSyncExternalStore(
    subscribeToAppState,
    isAppActive,
    isAppActive,
  );
  useMarkNotificationScreensSeen(notificationScreensForPathname(pathname), {
    enabled: signedIn && appActive,
  });
}
