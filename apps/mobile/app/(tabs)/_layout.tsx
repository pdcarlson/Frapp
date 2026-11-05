import { Redirect, Tabs, type ErrorBoundaryProps } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ChatGlyph,
  EventsGlyph,
  MoreGlyph,
  TabLabel,
  TasksGlyph,
  type TabGlyphProps,
} from "@/components/tab-glyphs";
import { StyleSheet } from "react-native";
import { AppErrorScreen } from "@/components/route-error";
import { GlassSurface } from "@/components/glass-surface";
import { resolveAuthGate } from "@/lib/auth-gate";
import { useAuthSession } from "@/lib/auth-session";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  FLOATING_TAB_BAR,
  floatingScreenLayout,
  floatingTabBarBottom,
} from "@/lib/floating-chrome";
import { useFrappTheme } from "@/lib/theme";

/** 6pt of padding above and below the bar's content (#3344). */
const TAB_BAR_PADDING = 6;

/** The capsule's own radius: half its height, so the ends are round. */
const TAB_BAR_RADIUS = FLOATING_TAB_BAR.height / 2;

/** The glass under the floating bar. Module-level so the bar doesn't remount it. */
function TabBarGlass() {
  return (
    <GlassSurface
      style={[StyleSheet.absoluteFill, { borderRadius: TAB_BAR_RADIUS }]}
    />
  );
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
  // Android draws the app edge to edge, so the swipe bar (and the iPhone home
  // indicator) sits over the bottom of the window. The floating bar clears it
  // by its own `bottom` offset rather than by padding (#3344).
  const { bottom: bottomInset } = useSafeAreaInsets();

  const destination = resolveAuthGate({ status, chapterId, isChapterResolving });

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
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: accent,
        tabBarInactiveTintColor: tokens.color.text.muted,
        // A glass capsule floating over the content (owner pick 2026-11-05,
        // "Floating bar, no glow"; `spec/ui/mobile/navigation.md` § Tab bar).
        // The glass is `surface-1`, the ladder's nav step and web's chrome
        // fill, over a blur where the device has one (`GlassSurface`). No
        // shadow and no glow: elevation is the edge and the sheen.
        tabBarStyle: {
          position: "absolute",
          left: FLOATING_TAB_BAR.side,
          right: FLOATING_TAB_BAR.side,
          bottom: floatingTabBarBottom(bottomInset),
          height: FLOATING_TAB_BAR.height,
          paddingTop: TAB_BAR_PADDING,
          paddingBottom: TAB_BAR_PADDING,
          borderRadius: TAB_BAR_RADIUS,
          borderTopWidth: 0,
          backgroundColor: "transparent",
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarBackground: TabBarGlass,
        // iconography.md §1 rule 2: the active tab pairs the accent duotone
        // glyph with a 700-weight label, and takes no pill or container shape.
        // The weight has to come from the label component, not
        // `tabBarLabelStyle` — that is one static style for both states.
        tabBarLabel: ({ focused, color, children }) => (
          <TabLabel focused={focused} color={color}>
            {children}
          </TabLabel>
        ),
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
      <Tabs.Screen name="study" options={{ title: "Study hours", href: null }} />
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
