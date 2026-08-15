import { Redirect, Tabs } from "expo-router";
import { ChapterHeaderTitle } from "@/components/chapter-header-title";
import {
  ChatGlyph,
  EventsGlyph,
  MoreGlyph,
  TasksGlyph,
  type TabGlyphProps,
} from "@/components/tab-glyphs";
import { resolveAuthGate } from "@/lib/auth-gate";
import { useAuthSession } from "@/lib/auth-session";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The locked 4-tab IA (spec/ui/mobile/navigation.md §"Tab bar — 4 tabs, locked").
 *
 * There is no Home tab — chat is home. Every route outside these four is
 * registered with `href: null` and reached by navigation only. Those hidden
 * registrations are deliberately exhaustive: this file freezes after S2 (#937's
 * hotspot protocol), so cluster slices add screens without reopening it. A
 * `Tabs.Screen` needs a real backing file, which is why the not-yet-built routes
 * ship as stubs rather than as registrations alone.
 */
export default function TabLayout() {
  const { status, chapterId, isChapterResolving } = useAuthSession();
  const { tokens } = useFrappTheme();
  // Inside the tab group the member is always in a chapter, so branding is
  // safe to read here — the auth stack sits outside and stays Frapp-branded.
  const { accent } = useChapterBranding();

  const destination = resolveAuthGate({ status, chapterId, isChapterResolving });

  if (destination === "hold") {
    return null;
  }

  if (destination === "sign-in") {
    return <Redirect href="/(auth)/sign-in" />;
  }

  // No claim means nothing in this group can address a chapter (#764).
  if (destination === "picker") {
    return <Redirect href="/(auth)/chapter-picker" />;
  }

  const glyphPaint = (focused: boolean): TabGlyphProps => ({
    focused,
    accent,
    muted: tokens.color.text.muted,
  });

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: accent,
        tabBarInactiveTintColor: tokens.color.text.muted,
        tabBarStyle: {
          height: 62,
          paddingTop: 6,
          paddingBottom: 6,
          backgroundColor: tokens.color.surface.card,
          borderTopColor: tokens.color.border.hairline,
        },
        // iconography.md §1 rule 2: the active tab pairs the accent duotone
        // glyph with a 700-weight label, and takes no pill or container shape.
        tabBarLabelStyle: {
          ...typeRole(tokens.typography.role.caption),
          fontSize: 10.5,
        },
        headerTitleStyle: {
          ...typeRole(tokens.typography.role.title),
          color: tokens.color.text.foreground,
        },
        headerStyle: { backgroundColor: tokens.color.surface.card },
      }}
    >
      {/* ── The four locked tabs ─────────────────────────────────────────── */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Chat",
          headerTitle: ({ style }) => <ChapterHeaderTitle style={style} />,
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
      <Tabs.Screen name="chat-thread" options={{ title: "Thread", href: null }} />
      <Tabs.Screen
        name="event-details"
        options={{ title: "Event details", href: null }}
      />
      <Tabs.Screen
        name="notifications"
        options={{ title: "Notifications", href: null }}
      />
      {/* s16's drawn title is "Settings"; the route filename stays
          `preferences.tsx` per spec/ui/mobile/screens.md:37. */}
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
        options={{ title: "Check in", href: null }}
      />
      <Tabs.Screen
        name="host-check-in"
        options={{ title: "Host check-in", href: null }}
      />

      {/* THROWAWAY (#937 S1): Expo Go smoke screen, deleted before Phase 2 exit. */}
      <Tabs.Screen
        name="sheet-demo"
        options={{
          title: "Sheet Demo",
          href: null,
        }}
      />
    </Tabs>
  );
}
