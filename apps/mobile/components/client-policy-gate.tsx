import { type ReactNode, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Linking from "expo-linking";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import { useClientPolicy } from "@/lib/client-policy";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** `spec/ui/design-system/writing.md` § Update required (mobile, global). */
export const UPDATE_REQUIRED_COPY = {
  title: "This version of Frapp is out of date",
  body: "It's no longer supported. Update to the latest version to keep using Frapp.",
  cta: "Update Frapp",
  noLink: "Open your app store and update Frapp from there.",
  linkFailed:
    "Couldn't open the update link. Open your app store and update Frapp from there.",
} as const;

/**
 * The minimum-version gate (#2526): when the API says this build is below the
 * deployment's minimum, a full-screen update prompt covers the whole app and
 * nothing behind it can be reached.
 *
 * It wraps the app rather than being a route, for two reasons. A route can be
 * left by a deep link or a push tap, and this must not be leavable. And it has
 * to sit above `BottomSheetModalProvider`, whose portal would otherwise draw an
 * open sheet over it; `app/_layout.tsx` mounts it just outside that provider.
 * While it blocks, the app underneath stays mounted (so push and auth keep
 * their state) but takes no touches and is hidden from screen readers.
 */
export function ClientPolicyGate({ children }: { children: ReactNode }) {
  const { updateRequired, updateUrl } = useClientPolicy();

  return (
    <View style={gateStyles.fill}>
      {/* One native view either way; toggling these props on a flattened
          wrapper would re-parent the whole app (patterns.md § Overlays). */}
      <View
        style={gateStyles.fill}
        collapsable={false}
        pointerEvents={updateRequired ? "none" : "auto"}
        accessibilityElementsHidden={updateRequired}
        importantForAccessibility={
          updateRequired ? "no-hide-descendants" : "auto"
        }
      >
        {children}
      </View>
      {updateRequired ? <UpdateRequiredScreen updateUrl={updateUrl} /> : null}
    </View>
  );
}

function UpdateRequiredScreen({ updateUrl }: { updateUrl: string | null }) {
  const { tokens } = useFrappTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(tokens);
  const [linkFailed, setLinkFailed] = useState(false);

  useEffect(() => {
    // A keyboard open underneath would otherwise stay up over the prompt.
    Keyboard.dismiss();
    AccessibilityInfo.announceForAccessibility(UPDATE_REQUIRED_COPY.title);
    // Android's back button would pop the navigator hidden underneath.
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => true,
    );
    return () => subscription.remove();
  }, []);

  async function openUpdate(url: string) {
    setLinkFailed(false);
    try {
      // The OS, not an in-app browser: a store link opens the store app.
      await Linking.openURL(url);
    } catch {
      setLinkFailed(true);
      // The line below speaks through its live region on Android. VoiceOver
      // has no live regions and focus stays on the button, so say it on iOS.
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(UPDATE_REQUIRED_COPY.linkFailed);
      }
    }
  }

  return (
    <View
      accessibilityViewIsModal
      style={[
        styles.screen,
        {
          paddingTop: insets.top + tokens.spacing.xl,
          paddingBottom: insets.bottom + tokens.spacing.xl,
        },
      ]}
    >
      <Text accessibilityRole="header" style={styles.title}>
        {UPDATE_REQUIRED_COPY.title}
      </Text>
      <Text style={styles.body}>{UPDATE_REQUIRED_COPY.body}</Text>

      {updateUrl ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void openUpdate(updateUrl);
          }}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>{UPDATE_REQUIRED_COPY.cta}</Text>
        </Pressable>
      ) : (
        <Text style={styles.body}>{UPDATE_REQUIRED_COPY.noLink}</Text>
      )}

      {linkFailed ? (
        <Text accessibilityLiveRegion="polite" style={styles.errorText}>
          {UPDATE_REQUIRED_COPY.linkFailed}
        </Text>
      ) : null}
    </View>
  );
}

const gateStyles = StyleSheet.create({
  fill: { flex: 1 },
});

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    screen: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      justifyContent: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.xl,
      backgroundColor: tokens.color.surface.background,
    },
    title: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    primaryButton: {
      marginTop: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.gold.house,
      minHeight: tokens.touch.button,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.onHouse,
    },
    errorText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
