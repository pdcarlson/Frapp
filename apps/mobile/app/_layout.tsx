import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useNetworkState } from "expo-network";
import { View } from "react-native";
import { NetworkBanner } from "@/components/network-banner";
import { FrappProvider } from "@/lib/frapp-client";
import { AnalyticsProvider } from "@/lib/analytics-provider";
import { AuthSessionProvider } from "@/lib/auth-session";
import { FrappThemeProvider, useFrappTheme } from "@/lib/theme";

function RootLayoutContent() {
  const { resolvedTheme, tokens } = useFrappTheme();
  const networkState = useNetworkState();

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.surface.canvas }}>
      <NetworkBanner
        isOnline={networkState.isConnected ?? null}
        isInternetReachable={networkState.isInternetReachable ?? null}
      />
      <StatusBar style={resolvedTheme === "dark" ? "light" : "dark"} />
      <Stack>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <FrappThemeProvider>
      {/*
        AuthSessionProvider sits outside FrappProvider: the API client reads its
        resolved chapter id, and the auth session itself talks only to Supabase,
        so there is no cycle between them.
      */}
      <AuthSessionProvider>
        <FrappProvider>
          <AnalyticsProvider>
            <RootLayoutContent />
          </AnalyticsProvider>
        </FrappProvider>
      </AuthSessionProvider>
    </FrappThemeProvider>
  );
}
