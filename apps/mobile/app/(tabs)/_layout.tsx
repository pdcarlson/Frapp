import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { frappTokens } from "@repo/theme/tokens";
import { usePreviewSession } from "@/lib/preview-session";

const TAB_ICON_SIZE = 20;

const tabIcon = (
  iconName: keyof typeof Ionicons.glyphMap,
  color: string,
  size = TAB_ICON_SIZE,
) => <Ionicons name={iconName} size={size} color={color} />;

export default function TabLayout() {
  const { status } = usePreviewSession();

  if (status === "hydrating") {
    return null;
  }

  if (status === "unauthenticated") {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: frappTokens.color.brand.royalBlue,
        tabBarInactiveTintColor: frappTokens.color.text.muted,
        tabBarStyle: {
          height: 62,
          paddingTop: 6,
          paddingBottom: 6,
        },
        headerTitleStyle: { fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          headerTitle: "Frapp",
          tabBarIcon: ({ color }) => tabIcon("home-outline", color),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarIcon: ({ color }) => tabIcon("chatbubbles-outline", color),
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: "Events",
          tabBarIcon: ({ color }) => tabIcon("calendar-outline", color),
        }}
      />
      <Tabs.Screen
        name="points"
        options={{
          title: "Points",
          tabBarIcon: ({ color }) => tabIcon("trophy-outline", color),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => tabIcon("person-outline", color),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color }) => tabIcon("ellipsis-horizontal-circle-outline", color),
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
