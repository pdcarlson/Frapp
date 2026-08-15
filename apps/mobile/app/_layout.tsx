import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useNetworkState } from "expo-network";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import {
  Figtree_400Regular,
  Figtree_600SemiBold,
  Figtree_700Bold,
  useFonts,
} from "@expo-google-fonts/figtree";
import * as SplashScreen from "expo-splash-screen";
import { NetworkBanner } from "@/components/network-banner";
import { FrappProvider } from "@/lib/frapp-client";
import { AnalyticsProvider } from "@/lib/analytics-provider";
import { AuthSessionProvider } from "@/lib/auth-session";
import { KeyboardProviderGuarded } from "@/lib/keyboard";
import { FrappThemeProvider, useFrappTheme } from "@/lib/theme";

// Hold the splash until Figtree is registered, so no screen ever paints in the
// system font and then re-renders. hideAsync runs on error too — a failed font
// load falls back to the system face rather than stranding the splash.
void SplashScreen.preventAutoHideAsync();

function RootLayoutContent() {
  const { tokens } = useFrappTheme();
  const networkState = useNetworkState();

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.surface.background }}>
      <NetworkBanner
        isOnline={networkState.isConnected ?? null}
        isInternetReachable={networkState.isInternetReachable ?? null}
      />
      {/* Signet is dark-only, so the status bar is statically light-on-dark. */}
      <StatusBar style="light" />
      <Stack>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Figtree_400Regular,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    // Gesture handling must wrap everything that hosts gestures, and gorhom
    // sheets read safe-area insets for their detents, so both providers sit
    // outside the app-state providers.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <FrappThemeProvider>
          {/*
            AuthSessionProvider sits outside FrappProvider: the API client reads its
            resolved chapter id, and the auth session itself talks only to Supabase,
            so there is no cycle between them.
          */}
          <AuthSessionProvider>
            <FrappProvider>
              <AnalyticsProvider>
                <KeyboardProviderGuarded>
                  <BottomSheetModalProvider>
                    <RootLayoutContent />
                  </BottomSheetModalProvider>
                </KeyboardProviderGuarded>
              </AnalyticsProvider>
            </FrappProvider>
          </AuthSessionProvider>
        </FrappThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
