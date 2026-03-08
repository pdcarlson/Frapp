import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const tabIcon = (
  iconName: keyof typeof Ionicons.glyphMap,
  color: string,
  size = 20,
) => <Ionicons name={iconName} size={size} color={color} />;

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#2563eb",
        tabBarInactiveTintColor: "#64748b",
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
    </Tabs>
  );
}
