import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import * as Sentry from "@sentry/react-native";
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
import { buildMobileSentryOptions, mobileSentryDsn } from "@/lib/sentry/options";

/**
 * Error reporting for the mobile app (issue #1299), reporting to the
 * `frapp-mobile` Sentry project.
 *
 * Initialized at module scope so the SDK is installed before expo-router
 * renders anything — an exception thrown while the first screen mounts is still
 * captured.
 *
 * **No DSN means no initialization at all**, matching `apps/web`'s
 * `instrumentation-client.ts` and the API's `main.ts`. That is what keeps
 * `expo start`, Expo Go, CI and vitest reporting nowhere, and it is why no
 * placeholder DSN exists anywhere in the repo: a missing deployment setting is
 * reported, never papered over (`spec/ui/mobile/patterns.md`).
 *
 * `EXPO_PUBLIC_SENTRY_DSN` is set per build profile in the EAS dashboard —
 * there is no Infisical→EAS sync, so it does not arrive by itself.
 */
const sentryDsn = mobileSentryDsn();
if (sentryDsn) {
  Sentry.init(buildMobileSentryOptions(sentryDsn));
}

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

function RootLayout() {
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

/**
 * `Sentry.wrap` adds the touch-breadcrumb boundary and the app-start profiler.
 *
 * Applied only when Sentry was actually initialized, so a build with no DSN
 * mounts the plain tree — "initializes Sentry not at all" covers the component
 * wrapper too, not just the `init` call.
 */
export default sentryDsn ? Sentry.wrap(RootLayout) : RootLayout;
