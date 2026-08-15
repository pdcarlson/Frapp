import { Redirect, Tabs } from "expo-router";
import type { ColorValue } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ChapterHeaderTitle } from "@/components/chapter-header-title";
import { useAuthSession } from "@/lib/auth-session";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useFrappTheme } from "@/lib/theme";

const TAB_ICON_SIZE = 20;

// `color` is ColorValue, not string: expo-router hands tabBarIcon the resolved
// tab tint, which RN 0.86 types as ColorValue (string | OpaqueColorValue).
const tabIcon = (
  iconName: keyof typeof Ionicons.glyphMap,
  color: ColorValue,
  size = TAB_ICON_SIZE,
) => <Ionicons name={iconName} size={size} color={color} />;

const TAB_ICON_NAMES = {
  home: { inactive: "home-outline", active: "home" },
  chat: { inactive: "chatbubbles-outline", active: "chatbubbles" },
  events: { inactive: "calendar-outline", active: "calendar" },
  points: { inactive: "trophy-outline", active: "trophy" },
  profile: { inactive: "person-outline", active: "person" },
  more: {
    inactive: "ellipsis-horizontal-circle-outline",
    active: "ellipsis-horizontal-circle",
  },
} as const;

export default function TabLayout() {
  const { status } = useAuthSession();
  const { tokens } = useFrappTheme();
  // Inside the tab group the member is always in a chapter, so branding is
  // safe to read here — the auth stack sits outside and stays Frapp-branded.
  const { accent } = useChapterBranding();

  if (status === "hydrating") {
    return null;
  }

  if (status === "unauthenticated") {
    return <Redirect href="/(auth)/sign-in" />;
  }

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
          borderTopColor: tokens.color.surface.border,
        },
        headerTitleStyle: { fontWeight: "700", color: tokens.color.text.primary },
        headerStyle: { backgroundColor: tokens.color.surface.card },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          headerTitle: ({ style }) => <ChapterHeaderTitle style={style} />,
          tabBarIcon: ({ color, focused }) =>
            tabIcon(
              focused ? TAB_ICON_NAMES.home.active : TAB_ICON_NAMES.home.inactive,
              color,
            ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          headerTitle: ({ style }) => (
            <ChapterHeaderTitle label="Chat" style={style} />
          ),
          tabBarIcon: ({ color, focused }) =>
            tabIcon(
              focused ? TAB_ICON_NAMES.chat.active : TAB_ICON_NAMES.chat.inactive,
              color,
            ),
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: "Events",
          tabBarIcon: ({ color, focused }) =>
            tabIcon(
              focused
                ? TAB_ICON_NAMES.events.active
                : TAB_ICON_NAMES.events.inactive,
              color,
            ),
        }}
      />
      <Tabs.Screen
        name="points"
        options={{
          title: "Points",
          tabBarIcon: ({ color, focused }) =>
            tabIcon(
              focused
                ? TAB_ICON_NAMES.points.active
                : TAB_ICON_NAMES.points.inactive,
              color,
            ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) =>
            tabIcon(
              focused
                ? TAB_ICON_NAMES.profile.active
                : TAB_ICON_NAMES.profile.inactive,
              color,
            ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color, focused }) =>
            tabIcon(
              focused ? TAB_ICON_NAMES.more.active : TAB_ICON_NAMES.more.inactive,
              color,
            ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Notifications",
          href: null,
        }}
      />
      <Tabs.Screen
        name="preferences"
        options={{
          title: "Preferences",
          href: null,
        }}
      />
      <Tabs.Screen
        name="event-details"
        options={{
          title: "Event Details",
          href: null,
        }}
      />
      <Tabs.Screen
        name="points-details"
        options={{
          title: "Points Details",
          href: null,
        }}
      />
      <Tabs.Screen
        name="chat-thread"
        options={{
          title: "Chat Thread",
          href: null,
        }}
      />
      <Tabs.Screen
        name="task-center"
        options={{
          title: "Task Center",
          href: null,
        }}
      />
      <Tabs.Screen
        name="service-hours"
        options={{
          title: "Service Hours",
          href: null,
        }}
      />
      <Tabs.Screen
        name="documents-reports"
        options={{
          title: "Documents & Reports",
          href: null,
        }}
      />
      <Tabs.Screen
        name="onboarding-tour"
        options={{
          title: "Onboarding Tutorial",
          href: null,
        }}
      />
      <Tabs.Screen
        name="notification-targets"
        options={{
          title: "Notification Destinations",
          href: null,
        }}
      />
    </Tabs>
  );
}
