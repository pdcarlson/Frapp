import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useNetworkState } from "expo-network";
import { View } from "react-native";
import { NetworkBanner } from "@/components/network-banner";
import { PreviewSessionProvider } from "@/lib/preview-session";
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
      <PreviewSessionProvider>
        <Stack>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </PreviewSessionProvider>
    </View>
  );
}

export default function RootLayout() {
  return (
    <FrappThemeProvider>
      <RootLayoutContent />
    </FrappThemeProvider>
  );
}
