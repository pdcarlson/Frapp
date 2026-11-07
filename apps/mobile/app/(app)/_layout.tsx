import { Redirect, Stack, type ErrorBoundaryProps } from "expo-router";
import { AppErrorScreen, stackScreenLayout } from "@/components/route-error";
import { SCREEN_TITLES } from "@/lib/back-target";
import { resolveAuthGate } from "@/lib/auth-gate";
import { useAuthSession } from "@/lib/auth-session";
import { useFrappTheme } from "@/lib/theme";

/**
 * Put the tabs under anything opened by link. A notification tap or a
 * `frapp://event-details` link can open a pushed screen cold; with the tabs
 * anchored under it, its swipe back and its back capsule land on Chat home
 * rather than nowhere.
 */
export const unstable_settings = {
  anchor: "(tabs)",
};

/**
 * Everything a member in a chapter sees: the four tabs, and every other
 * screen pushed over them (`spec/ui/mobile/navigation.md` § Going back).
 *
 * A native stack, so each pushed screen slides in over the tabs and goes back
 * by the platform's own gesture: the edge swipe on iOS, the back button and
 * back gesture on Android. No route turns the gesture off, and a screen that
 * holds it for a moment does so where it holds, with its reason
 * (`useHoldSwipeBack`, s05's photo viewer). They used to be hidden tabs, and a tab
 * switch has no back gesture, so none of them could be swiped away.
 *
 * Pushed screens cover the floating tab bar, as the Canvas board draws s05,
 * s07 and s10–s22; the tabs are one swipe back. No screen gets the stack's
 * header (#2485): each draws its own top, and its way back is the back capsule
 * (`components/back-row.tsx`), s05's `‹`, or the close control on s18 and s22.
 *
 * The auth gate lives here rather than on the tabs so it covers the pushed
 * screens too: a signed-out member who follows a link to one is sent to
 * sign-in like one who opens the app.
 */
export default function AppLayout() {
  const { status, chapterId, isChapterResolving } = useAuthSession();
  const { tokens } = useFrappTheme();

  const destination = resolveAuthGate({
    status,
    chapterId,
    isChapterResolving,
  });

  if (destination === "hold") {
    return null;
  }

  if (destination === "sign-in") {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <Stack
      // Each pushed screen in its own error boundary, as each tab is (#3378).
      screenLayout={stackScreenLayout}
      screenOptions={{
        headerShown: false,
        // The swipe reveals the screen under it, so the window behind both
        // is the app's background, never the platform's white.
        contentStyle: { backgroundColor: tokens.color.surface.background },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="chat-thread"
        options={{ title: SCREEN_TITLES["chat-thread"] }}
      />
      <Stack.Screen
        name="event-details"
        options={{ title: SCREEN_TITLES["event-details"] }}
      />
      <Stack.Screen
        name="notifications"
        options={{ title: SCREEN_TITLES.notifications }}
      />
      {/* s16's drawn title is "Settings"; the route filename stays
          `preferences.tsx` per spec/ui/mobile/screens.md § Notes. */}
      <Stack.Screen
        name="preferences"
        options={{ title: SCREEN_TITLES.preferences }}
      />
      <Stack.Screen name="profile" options={{ title: SCREEN_TITLES.profile }} />
      <Stack.Screen
        name="service-hours"
        options={{ title: SCREEN_TITLES["service-hours"] }}
      />
      <Stack.Screen name="study" options={{ title: SCREEN_TITLES.study }} />
      <Stack.Screen name="dues" options={{ title: SCREEN_TITLES.dues }} />
      <Stack.Screen
        name="documents"
        options={{ title: SCREEN_TITLES.documents }}
      />
      <Stack.Screen
        name="directory"
        options={{ title: SCREEN_TITLES.directory }}
      />
      <Stack.Screen name="invite" options={{ title: SCREEN_TITLES.invite }} />
      {/* A redirect to Chat home, kept for old `frapp://ask` links. */}
      <Stack.Screen name="ask" options={{ title: "Ask" }} />
      <Stack.Screen
        name="check-in"
        options={{ title: SCREEN_TITLES["check-in"] }}
      />
      <Stack.Screen
        name="host-check-in"
        options={{ title: SCREEN_TITLES["host-check-in"] }}
      />
    </Stack>
  );
}

/**
 * What expo-router renders if this layout itself fails: the stack, the gate,
 * or a hook above them. A screen's own failure stops at its `screenLayout`
 * boundary first. `components/route-error.tsx` has the rest.
 */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <AppErrorScreen {...props} boundary="app" />;
}
