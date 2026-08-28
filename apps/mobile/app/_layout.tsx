import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
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
import { AppRuntime } from "@/components/app-runtime";
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

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.surface.background }}>
      {/*
        Renders nothing — it starts the app-wide runtimes that have no screen to
        live on (push and connectivity). Both must sit above the auth gate: push
        reads the notification that launched the app before anyone is routed,
        and tab screens mount lazily, so a runtime on a screen would miss it.
        See `components/app-runtime.tsx`.
      */}
      <AppRuntime />
      {/* Reads the connection monitor directly now, rather than being handed a
          second, independent reading of `expo-network` from here. */}
      <NetworkBanner />
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
