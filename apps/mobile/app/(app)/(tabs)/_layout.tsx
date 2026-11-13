import { Tabs, type ErrorBoundaryProps } from "expo-router";
import type { BottomTabBarProps } from "expo-router/tabs";
import {
  ActivityTabGlyph,
  ChatGlyph,
  EventsGlyph,
  type TabGlyphProps,
} from "@/components/tab-glyphs";
import { YouTabAvatar } from "@/components/you-tab-avatar";
import { AppErrorScreen } from "@/components/route-error";
import { GlassTabBar } from "@/components/glass-tab-bar";
import { TourHost } from "@/components/onboarding/tour";
import { WhatsNewHost } from "@/components/whats-new/whats-new-host";
import { MeetFrappAiHost } from "@/components/ai/meet-frapp-ai-host";
import { SCREEN_TITLES } from "@/lib/back-target";
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
 * The 4-tab IA (spec/ui/mobile/navigation.md § Tab bar): Chat, Activity,
 * Calendar (the `events` route) and You, owner pick 2026-11-12 (#4610). The
 * task board left the bar for a pushed screen: a member's tasks are
 * Activity's first rows and dots on the calendar. You (#3839) is the member's
 * profile and the hub More used to be, drawn as their own avatar.
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

  const glyphPaint = (focused: boolean): TabGlyphProps => ({
    focused,
    accent,
    muted: tokens.color.text.muted,
  });

  return (
    // The first-run tour's host wraps the navigator, so its dim covers the
    // screens and the floating bar both (`components/onboarding/tour.tsx`).
    <TourHost>
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
        {/* ── The four tabs ────────────────────────────────────────────────── */}
        <Tabs.Screen
          name="index"
          options={{
            title: SCREEN_TITLES.index,
            tabBarIcon: ({ focused }) => <ChatGlyph {...glyphPaint(focused)} />,
          }}
        />
        <Tabs.Screen
          name="activity"
          options={{
            title: SCREEN_TITLES.activity,
            tabBarIcon: ({ focused }) => (
              <ActivityTabGlyph {...glyphPaint(focused)} />
            ),
          }}
        />
        <Tabs.Screen
          name="events"
          options={{
            title: SCREEN_TITLES.events,
            tabBarIcon: ({ focused }) => (
              <EventsGlyph {...glyphPaint(focused)} />
            ),
          }}
        />
        <Tabs.Screen
          name="you"
          options={{
            title: SCREEN_TITLES.you,
            tabBarIcon: ({ focused }) => (
              <YouTabAvatar focused={focused} accent={accent} />
            ),
          }}
        />
      </Tabs>
      {/* What's new opens by itself once after an update brings a new entry
          or new lines, never on a launch the tour is due (`lib/whats-new.ts`). */}
      <WhatsNewHost />
      {/* Meet Frapp AI, once, for an account that never answered it, after
          What's new if both are due (`lib/startup-sheets.ts`). */}
      <MeetFrappAiHost />
    </TourHost>
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
