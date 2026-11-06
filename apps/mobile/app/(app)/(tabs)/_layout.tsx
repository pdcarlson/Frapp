import { Tabs, type ErrorBoundaryProps } from "expo-router";
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
import { SCREEN_TITLES } from "@/lib/back-target";
import { GlassSurface } from "@/components/glass-surface";
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
 * The locked 4-tab IA (spec/ui/mobile/navigation.md §"Tab bar — 4 tabs, locked").
 *
 * There is no Home tab — chat is home. This navigator holds only the four
 * tabs. Every other screen in the app is pushed onto the stack above it
 * (`app/(app)/_layout.tsx`), so it slides in over the tabs and goes back by
 * the platform's own gesture: the edge swipe on iOS, the back button or back
 * gesture on Android (`spec/ui/mobile/navigation.md` § Going back). They used
 * to be hidden tabs here (`href: null`), and a tab switch has no back gesture
 * at all, which is why none of them could be swiped away.
 *
 * No screen here gets the navigator's header (#2485). The Canvas board draws
 * none, and every screen here carries its own title (`ScreenShell`), so the
 * header only ever said that title again above it.
 * Chat home's chapter mark, which used to ride in the header, is now its
 * title row (`spec/behavior/branding.md` § Chapter mark). The `title`s below
 * name each route for the tab labels, the web document title and the back
 * capsule of a screen pushed over the tab (`lib/back-target.ts`).
 *
 * The auth gate runs a level up, in `app/(app)/_layout.tsx`, so it covers the
 * pushed screens too.
 */
export default function TabLayout() {
  const { tokens } = useFrappTheme();
  // Inside the app group the member is always in a chapter, so branding is
  // safe to read here — the auth stack sits outside and stays Frapp-branded.
  const { accent } = useChapterBranding();
  // Android draws the app edge to edge, so the swipe bar (and the iPhone home
  // indicator) sits over the bottom of the window. The floating bar clears it
  // by its own `bottom` offset rather than by padding (#3344).
  const { bottom: bottomInset } = useSafeAreaInsets();

  const glyphPaint = (focused: boolean): TabGlyphProps => ({
    focused,
    accent,
    muted: tokens.color.text.muted,
  });

  return (
    <Tabs
      // On a tab, Android's back button returns to the tab the member came
      // from rather than straight to Chat (the default, "firstRoute").
      // Pushed screens sit on the stack above and pop first.
      // `spec/ui/mobile/navigation.md` § Going back.
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
          title: SCREEN_TITLES.index,
          tabBarIcon: ({ focused }) => <ChatGlyph {...glyphPaint(focused)} />,
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: SCREEN_TITLES.events,
          tabBarIcon: ({ focused }) => <EventsGlyph {...glyphPaint(focused)} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: SCREEN_TITLES.tasks,
          tabBarIcon: ({ focused }) => <TasksGlyph {...glyphPaint(focused)} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: SCREEN_TITLES.more,
          tabBarIcon: ({ focused }) => <MoreGlyph {...glyphPaint(focused)} />,
        }}
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
