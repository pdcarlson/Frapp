import { useUnreadFirstPaintRuntime } from "@/lib/chat/unread-first-paint";
import { useChatRealtimeBinding } from "@/lib/chat/use-chat-runtime";
import { useConnectionRuntime } from "@/lib/connection/use-connection";
import { useBadgeSyncRuntime } from "@/lib/notifications/use-badge-sync";
import { useNotificationSyncRuntime } from "@/lib/notifications/use-notification-sync";
import { usePushRuntime } from "@/lib/notifications/use-push-runtime";
import { useOnboardingRedirect } from "@/lib/onboarding/use-onboarding-redirect";

/**
 * The app-wide runtimes that have no screen to live on.
 *
 * Renders nothing. It exists because `app/_layout.tsx` is a frozen hotspot file
 * (`spec/ui/mobile/navigation.md` § Hotspot freeze) and adding two hook calls
 * to it directly would mean editing it again for every future runtime —
 * whereas a component mounted once takes a single line and never needs
 * revisiting. `NetworkBanner` already sits beside it for the same reason.
 *
 * These runtimes have to be above the auth gate rather than on a screen:
 *
 * - **Push** must read the notification that launched the app before the
 *   member is routed anywhere, and tab screens mount lazily — a tap deep-linking
 *   to `/chat-thread` need never mount the chat list.
 * - **Connection** drives the banner, which renders app-wide, and TanStack's
 *   `onlineManager`, which is process-global.
 *
 * - **Chat realtime** (#3698). Each thread still subscribes its own channel,
 *   refcounted, from `lib/chat/use-chat-runtime.ts`; what lives here is the
 *   manager's binding to the app's clients, because its inbox keeps chat home's
 *   badges, the Messages order and the app badge live before any thread has
 *   been opened, and its resume catches up when the app comes back from the
 *   background. It binds only once a member is signed in.
 *
 * **Onboarding** is here for the same freeze: `(app)/_layout.tsx`
 * cannot learn about join/welcome without becoming an integrator PR, so walking
 * a member out of the tabs onto s02/s03 lives here.
 *
 * **Badge sync** reacts to the same notification and chat
 * queries wherever they're already fetched, and needs no screen of its own
 * (`lib/notifications/use-badge-sync.ts`).
 *
 * **Unread first paint** (#4006) seeds those chat counts from the last server
 * answer and lights channels whose pushes are still in the tray, so the marks
 * don't wait on the request (`lib/chat/unread-first-paint.ts`).
 *
 * **Notification sync** (#3929) listens for the member's `notif:<users.id>`
 * change ping, so a notification read on another device reads here within
 * seconds, and reads the notices about whichever screen is open
 * (`lib/notifications/use-notification-sync.ts`).
 */
export function AppRuntime(): null {
  useConnectionRuntime();
  useChatRealtimeBinding();
  usePushRuntime();
  useOnboardingRedirect();
  useBadgeSyncRuntime();
  useUnreadFirstPaintRuntime();
  useNotificationSyncRuntime();
  return null;
}
