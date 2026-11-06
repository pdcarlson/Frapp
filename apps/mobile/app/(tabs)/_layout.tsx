import { Redirect, Tabs, type ErrorBoundaryProps } from "expo-router";
import type { BottomTabBarProps } from "expo-router/tabs";
import {
  ChatGlyph,
  EventsGlyph,
  MoreGlyph,
  TasksGlyph,
  type TabGlyphProps,
} from "@/components/tab-glyphs";
import { AppErrorScreen } from "@/components/route-error";
import { GlassTabBar } from "@/components/glass-tab-bar";
import { resolveAuthGate } from "@/lib/auth-gate";
import { useAuthSession } from "@/lib/auth-session";
import { useChapterBranding } from "@/lib/chapter-branding";
import { floatingScreenLayout } from "@/lib/floating-chrome";
import { useFrappTheme } from "@/lib/theme";

/**
 * The bar the navigator draws: the glass pill and the quick-actions + beside
 * it (`components/glass-tab-bar.tsx`). Module-level so the navigator doesn't
 * get a new bar component on every render of this layout.
 */
function renderTabBar(props: BottomTabBarProps) {
  return <GlassTabBar {...props} />;
}

/**
 * Options for a screen that takes the whole window, with no tab bar: the chat
 * thread (s05) and the two check-in screens (s18, s22).
 * `spec/ui/mobile/navigation.md` § Tab bar owns which screens and why.
 */
const FULL_WINDOW = { tabBarStyle: { display: "none" as const } };

/**
 * The locked 4-tab IA (spec/ui/mobile/navigation.md §"Tab bar — 4 tabs, locked").
 *
 * There is no Home tab — chat is home. Every route outside these four is
 * registered with `href: null` and reached by navigation only. Those hidden
 * registrations are deliberately exhaustive: this file freezes after S2 (#937's
 * hotspot protocol), so cluster slices add screens without reopening it. A
 * `Tabs.Screen` needs a real backing file, which is why the not-yet-built routes
 * ship as stubs rather than as registrations alone.
 *
 * No screen here gets the navigator's header (#2485). The Canvas board draws
 * none, and every screen here carries its own title (`ScreenShell`, or a bar of
 * its own such as the thread's `‹ #name`), so the header only ever said that
 * title again above it.
 * It never supplied a way back either — a tab route's header renders with no
 * `back` — so a pushed route's way back is whatever it draws itself: s05's `‹`
 * and the close controls on s18 and s22, and the back rows above the title on
 * s07 and s10–s16 (#3022, `spec/ui/mobile/navigation.md` § Back rows).
 * Chat home's chapter mark, which used to ride in the header, is now its
 * title row (`spec/behavior/branding.md` § Chapter mark). The `title`s below
 * still name each route for the tab labels and the web document title.
 */
export default function TabLayout() {
  const { status, chapterId, isChapterResolving } = useAuthSession();
  const { tokens } = useFrappTheme();
  // Inside the tab group the member is always in a chapter, so branding is
  // safe to read here — the auth stack sits outside and stays Frapp-branded.
  const { accent } = useChapterBranding();

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

  const glyphPaint = (focused: boolean): TabGlyphProps => ({
    focused,
    accent,
    muted: tokens.color.text.muted,
  });

  return (
    <Tabs
      // Android's back button returns to the screen the member came from,
      // not to Chat home. Every pushed screen here is a hidden tab, and the
      // tab router's default ("firstRoute") sent each one straight to Chat:
      // back from an event opened on Events landed on Chat, not Events.
      // `spec/ui/mobile/navigation.md` § Back rows.
      backBehavior="history"
      // Each screen in its own error boundary, so one that fails to render
      // leaves the tab bar and the other tabs working (#3378).
      // It also tells each screen whether the floating bar sits over it, so
      // its content can scroll clear of it (`lib/floating-chrome.tsx`).
      screenLayout={floatingScreenLayout}
      // The glass pill and the round + beside it (owner pick 2026-11-06;
      // `spec/ui/mobile/navigation.md` § Tab bar, § Quick actions). It floats
      // over the content, so it takes no room of its own; screens scroll clear
      // of it through `useTabBarClearance`. Android's swipe bar and the iPhone
      // home indicator are cleared by its own `bottom` offset (#3344).
      tabBar={renderTabBar}
      screenOptions={{
        headerShown: false,
      }}
    >
      {/* ── The four locked tabs ─────────────────────────────────────────── */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Chat",
          tabBarIcon: ({ focused }) => <ChatGlyph {...glyphPaint(focused)} />,
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: "Events",
          tabBarIcon: ({ focused }) => <EventsGlyph {...glyphPaint(focused)} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: "Tasks",
          tabBarIcon: ({ focused }) => <TasksGlyph {...glyphPaint(focused)} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ focused }) => <MoreGlyph {...glyphPaint(focused)} />,
        }}
      />

      {/* ── Live routes, reached by navigation ───────────────────────────── */}
      <Tabs.Screen
        name="chat-thread"
        options={{ title: "Thread", href: null, ...FULL_WINDOW }}
      />
      <Tabs.Screen
        name="event-details"
        options={{ title: "Event details", href: null }}
      />
      <Tabs.Screen
        name="notifications"
        options={{ title: "Notifications", href: null }}
      />
      {/* s16's drawn title is "Settings"; the route filename stays
          `preferences.tsx` per spec/ui/mobile/screens.md § Notes. */}
      <Tabs.Screen
        name="preferences"
        options={{ title: "Settings", href: null }}
      />
      {/* Profile keeps its file but leaves the tab bar — reached from More. */}
      <Tabs.Screen name="profile" options={{ title: "Profile", href: null }} />
      <Tabs.Screen
        name="service-hours"
        options={{ title: "Service hours", href: null }}
      />

      {/* ── Pre-registered for the cluster slices ────────────────────────── */}
      <Tabs.Screen
        name="study"
        options={{ title: "Study hours", href: null }}
      />
      <Tabs.Screen name="dues" options={{ title: "Dues", href: null }} />
      <Tabs.Screen
        name="documents"
        options={{ title: "Documents", href: null }}
      />
      <Tabs.Screen
        name="directory"
        options={{ title: "Directory", href: null }}
      />
      <Tabs.Screen name="ask" options={{ title: "Ask", href: null }} />
      <Tabs.Screen
        name="check-in"
        options={{ title: "Check in", href: null, ...FULL_WINDOW }}
      />
      <Tabs.Screen
        name="host-check-in"
        options={{ title: "Host check-in", href: null, ...FULL_WINDOW }}
      />
    </Tabs>
  );
}

/**
 * What expo-router renders if this layout itself fails: the navigator, the
 * tab bar, or a hook above them. A screen's own failure stops at its
 * `screenLayout` boundary first. `components/route-error.tsx` has the rest.
 */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <AppErrorScreen {...props} boundary="tabs" />;
}
