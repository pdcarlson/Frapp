import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useNetworkState } from "expo-network";
import { View } from "react-native";
import { NetworkBanner } from "@/components/network-banner";
import { PreviewSessionProvider } from "@/lib/preview-session";

export default function RootLayout() {
  const networkState = useNetworkState();

  return (
    <View style={{ flex: 1 }}>
      <NetworkBanner
        isOnline={networkState.isConnected ?? null}
        isInternetReachable={networkState.isInternetReachable ?? null}
      />
      <StatusBar style="auto" />
      <PreviewSessionProvider>
        <Stack>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </PreviewSessionProvider>
    </View>
  );
}
