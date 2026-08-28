import { useConnectionRuntime } from "@/lib/connection/use-connection";
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
 * Both runtimes have to be above the auth gate rather than on a screen:
 *
 * - **Push** must read the notification that launched the app before the
 *   member is routed anywhere, and tab screens mount lazily — a tap deep-linking
 *   to `/chat-thread` need never mount the chat list.
 * - **Connection** drives the banner, which renders app-wide, and TanStack's
 *   `onlineManager`, which is process-global.
 *
 * Chat is the deliberate exception: `lib/chat/use-chat-runtime.ts` stays a
 * per-screen hook because configuring the realtime manager is a chat concern
 * with per-screen refcounting, not an app-wide one.
 *
 * **Onboarding** is the third runtime for the same freeze: `(tabs)/_layout.tsx`
 * cannot learn about join/welcome without becoming an integrator PR, so walking
 * a member out of the tabs onto s02/s03 lives here.
 */
export function AppRuntime(): null {
  useConnectionRuntime();
  usePushRuntime();
  useOnboardingRedirect();
  return null;
}
