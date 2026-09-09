/**
 * Binds remote push to the app: token lifecycle, foreground presentation, and
 * the navigation a tapped notification asks for.
 *
 * Web has no equivalent — `spec/behavior/notifications.md` says push delivery is
 * mobile-only by design.
 *
 * ## Why this is a hook, and why `components/app-runtime.tsx` mounts it high
 *
 * `app/_layout.tsx` is one of the seven frozen hotspot files
 * (`spec/ui/mobile/navigation.md` § Hotspot freeze), so the shape here follows
 * `lib/chat/use-chat-runtime.ts`: module singletons plus a once-per-process
 * boot, called from a hook rather than a provider.
 *
 * It is mounted at the root rather than from a screen, which is a departure
 * from how chat wires itself, for two reasons that are specific to push:
 *
 * - **Tab screens mount lazily.** A tap that deep-links straight to
 *   `/chat-thread` need never mount `(tabs)/index.tsx`, so a runtime hosted
 *   there would miss the very cold-start read it exists to perform.
 * - `(tabs)/index.tsx` deliberately does *not* call `useChatRuntime()`, because
 *   that would reconfigure the realtime manager from a list screen. Hanging a
 *   second app-wide runtime off it would repeat exactly that mistake.
 *
 * Mounting above the auth gate means this starts before anyone is routed. That
 * is handled rather than avoided: a cold-start target is **held pending** until
 * the session has restored, and dropped if the member signs out first. It waits
 * on the chapter claim having been *read*, never on it having a value — see the
 * comment on the release effect, and `lib/auth-gate.ts` for why the difference
 * is the whole ballgame: a missing claim is a normal working state, not a
 * reason to hold a deep link forever (`lib/auth-gate.ts`).
 *
 * ## The token lifecycle
 *
 * The signal is `lib/auth-token.ts`'s pub/sub, not the Supabase auth event:
 * `auth-session.tsx` discards the event name, but `writeAuthToken` and
 * `clearAuthToken` both notify, so the SecureStore mirror *is* the sign-in /
 * sign-out edge. `useIsApiAuthenticated()` already reads it that way.
 *
 * Expo can also rotate the token while the member stays signed in. That is
 * not an auth edge, so a second subscription (`addPushTokenListener` via
 * `push.ts`) re-reads the Expo token and runs the same register path. A
 * rotation while signed out must not POST.
 *
 * Registration failure is deliberately quiet. Push is an enhancement over an
 * in-app history (s14) that renders without it, so a failed register logs and
 * waits for the next auth edge or token rotation rather than taking a toast to
 * a member who can do nothing about it.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  useMarkNotificationRead,
  useRegisterPushToken,
  useRemovePushToken,
} from "@repo/hooks";
import { useAuthSession } from "../auth-session";
import { useIsApiAuthenticated } from "../use-is-api-authenticated";
import { asRoute } from "../href";
import {
  addNotificationResponseListener,
  addPushTokenListener,
  configureForegroundPresentation,
  ensureAndroidChannel,
  getExpoPushToken,
  isPushAvailable,
  takeLastNotificationResponse,
} from "./push";
import {
  clearStoredPushTokenRow,
  readStoredPushTokenRow,
  writeStoredPushTokenRow,
} from "./push-registration";
import {
  deregisterStoredPushToken,
  registerCurrentPushToken,
  sessionOwnsPushRegistration,
} from "./push-token-lifecycle";
import {
  NOTIFICATION_FALLBACK_PATHNAME,
  notificationHref,
  notificationIdFrom,
  resolveNotificationTarget,
} from "./targets";
import type { NotificationTarget } from "./targets";
import type { PushNotificationResponse } from "./push-types";

let handlerConfigured = false;

export function usePushRuntime(): void {
  const router = useRouter();
  const isAuthenticated = useIsApiAuthenticated();
  const { isChapterResolving, status } = useAuthSession();
  const registerToken = useRegisterPushToken();
  const removeToken = useRemovePushToken();
  const markRead = useMarkNotificationRead();

  /**
   * A tap read before the member could be sent anywhere. Held in state rather
   * than a ref so its arrival re-runs the release effect below.
   *
   * The `notificationId` rides along rather than being spent on arrival: both
   * the navigation *and* the read-receipt are authenticated actions, and a
   * `PATCH /v1/notifications/{id}/read` fired from a cold start before the
   * session is restored is just a 401. Releasing them together also means a
   * member who signs out before the app settles has neither happen, which is
   * the honest outcome — they never saw it.
   */
  const [pendingTap, setPendingTap] = useState<{
    target: NotificationTarget;
    notificationId: string | null;
  } | null>(null);

  // Mutation objects are new every render; the effects below must not re-run on
  // that, only on the auth edges they actually care about.
  const registerRef = useRef(registerToken);
  const removeRef = useRef(removeToken);
  const markReadRef = useRef(markRead);
  const authRef = useRef({ isAuthenticated, status });
  useLayoutEffect(() => {
    registerRef.current = registerToken;
    removeRef.current = removeToken;
    markReadRef.current = markRead;
    authRef.current = { isAuthenticated, status };
  }, [registerToken, removeToken, markRead, isAuthenticated, status]);

  const handleResponse = useCallback((response: PushNotificationResponse) => {
    const data = response.notification.request.content.data;
    setPendingTap({
      target: resolveNotificationTarget(data),
      notificationId: notificationIdFrom(data),
    });
  }, []);

  // Foreground presentation, once per process. Without a handler the OS hides
  // notifications while the app is open, which reads as "push is broken" to
  // anyone testing with the app in front of them.
  useEffect(() => {
    if (handlerConfigured) return;
    handlerConfigured = true;
    configureForegroundPresentation();
    // The Android channel is created here, not only inside
    // `requestPushPermission()`. Its other caller is the primer's "Turn on"
    // (`PushPrimerCard`, hosted on the welcome screen since #958), which a
    // member may never tap — so relying on that alone would leave the
    // `"default"` channel uncreated for them, while `app.json`'s plugin
    // config points FCM's `default_notification_channel_id` at it. The
    // study-pause notice (#1065) is a **local** notification that needs no
    // token and therefore works in a real build today; it would have landed in
    // expo's fallback channel with the wrong name and importance.
    //
    // Creating a channel is not a permission request and shows the member
    // nothing — the "channel before permission" ordering in `patterns.md` is
    // satisfied a fortiori by doing it at boot.
    void ensureAndroidChannel();
  }, []);

  // The tap that launched the app. Read once — `takeLastNotificationResponse`
  // clears it, without which the same tap re-navigates on every remount.
  useEffect(() => {
    const response = takeLastNotificationResponse();
    if (response) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- cold-start notification tap; takeLastNotificationResponse is a one-shot external event
      handleResponse(response);
    }
  }, [handleResponse]);

  // Taps while the app is already running.
  useEffect(() => {
    const subscription = addNotificationResponseListener(handleResponse);
    return () => subscription?.remove();
  }, [handleResponse]);

  // Release a held tap once there is somewhere safe to send the member.
  useEffect(() => {
    if (!pendingTap) return;

    if (status === "unauthenticated") {
      // They signed out between the tap and now; the destination is no longer
      // theirs to open.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- drop a held tap after sign-out so it cannot navigate a later session
      setPendingTap(null);
      return;
    }
    // Wait on the claim *read*, never on the claim's value. `lib/auth-gate.ts`
    // spells out why at length: a token with no `active_chapter_id` is a
    // normal working state (no membership yet, or the hook disabled as
    // incident mitigation), so `chapterId` can be `null` for a signed-in
    // member. Gating on it would have made this effect return on those taps —
    // the same outage that gate refuses to ship, reintroduced in a second
    // place. The API resolves a sole membership server-side, so a null claim is
    // a normal working state, not a reason to swallow a deep link.
    if (status === "hydrating" || isChapterResolving || !isAuthenticated)
      return;

    const { target, notificationId } = pendingTap;
    setPendingTap(null);
    if (notificationId) markReadRef.current.mutate(notificationId);
    // The same fallback check `app/(tabs)/notifications.tsx` makes: an
    // unrecognized payload resolves to the notification list, and pushing that
    // from a tap that arrived *as* a notification stacks the list on itself.
    if (target.pathname !== NOTIFICATION_FALLBACK_PATHNAME || target.params) {
      router.push(asRoute(notificationHref(target)));
    }
  }, [pendingTap, status, isChapterResolving, isAuthenticated, router]);

  const tokenLifecycleDeps = {
    getToken: getExpoPushToken,
    register: (body: { token: string }) =>
      registerRef.current.mutateAsync(body),
    remove: (id: string) => removeRef.current.mutateAsync(id),
    readStored: readStoredPushTokenRow,
    writeStored: writeStoredPushTokenRow,
    clearStored: clearStoredPushTokenRow,
    warn: (message: string, error?: unknown) => {
      if (error === undefined) console.warn(message);
      else console.warn(message, error);
    },
  };

  // Token lifecycle. Keyed on `isAuthenticated`, which is the SecureStore
  // mirror — the same edge `useIsApiAuthenticated` reports.
  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;

    // Both conditions, deliberately. `signOut` sets `status` synchronously while
    // `isAuthenticated` only flips once `clearAuthToken()` has round-tripped
    // through SecureStore, so there is a committed render carrying
    // `(isAuthenticated: true, status: "unauthenticated")`. Keying register on
    // `isAuthenticated` alone re-registers a token *during* sign-out, creating a
    // row the deregister that follows can no longer see — the "a token MUST NOT
    // outlive the session that created it" rule, inverted.
    if (sessionOwnsPushRegistration(isAuthenticated, status)) {
      if (isPushAvailable()) {
        void registerCurrentPushToken({
          ...tokenLifecycleDeps,
          isCancelled,
        });
      }
    } else if (status === "unauthenticated") {
      // Only on a real sign-out. `status === "hydrating"` also reports
      // unauthenticated-ish state at launch, and deregistering there would
      // delete a perfectly good row on every cold start.
      void deregisterStoredPushToken({
        ...tokenLifecycleDeps,
        isCancelled,
      });
    }

    return () => {
      cancelled = true;
    };
    // tokenLifecycleDeps is a per-render bag of refs — same reason the
    // mutation objects themselves are not effect deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [isAuthenticated, status]);

  // Mid-session token rotation. Auth edges above never see this: Expo can
  // roll the token while the member stays signed in, and nothing in that
  // path re-reads it. The listener is subscribed for the process lifetime;
  // the handler no-ops unless the session currently owns a registration, so
  // a rotation while signed out cannot POST a row for a signed-out member.
  useEffect(() => {
    let cancelled = false;
    const subscription = addPushTokenListener(() => {
      if (cancelled) return;
      const auth = authRef.current;
      if (!sessionOwnsPushRegistration(auth.isAuthenticated, auth.status)) {
        return;
      }
      if (!isPushAvailable()) return;
      void registerCurrentPushToken({
        ...tokenLifecycleDeps,
        isCancelled: () => cancelled,
      });
    });
    return () => {
      cancelled = true;
      subscription?.remove();
    };
    // Subscribe once; the handler reads authRef / mutation refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, []);
}
