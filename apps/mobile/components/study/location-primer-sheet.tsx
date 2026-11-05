import { forwardRef } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  useSheetBackgroundStyle,
} from "@/components/sheet-scaffold";

/**
 * The contextual location primer — `spec/ui/mobile/patterns.md` § Study
 * sessions: "the location primer is contextual — shown on the first
 * Start-session tap, explaining the zone check, never at app launch."
 *
 * The rule is not decoration. iOS shows its permission dialog **once**; a member
 * who declines a prompt they did not understand has to be walked through
 * Settings to undo it. So this explains the zone check first, and only then does
 * the OS get to ask — the same shape `patterns.md` § Push notifications
 * prescribes for push, where declining is "a quiet 'Not now'".
 *
 * It also handles the already-declined case, where nothing will ask again and
 * the only honest next step is Settings, so that branch opens it. Its copy
 * still spells out the path, for a member who lands somewhere else or comes
 * back to it later, and spells out the member's own OS's path, since the way
 * to the switch differs between iOS and Android. Both name the app as Settings
 * lists it, `expo.name`, which `frapp-naming.test.mjs` pins (ADR-25 step 2).
 */
export interface LocationPrimerSheetProps {
  /** False once the OS will no longer prompt — the copy and CTA both change. */
  canAskAgain: boolean;
  onAllow: () => void;
  onDismiss: () => void;
}

export const LocationPrimerSheet = forwardRef<
  BottomSheetModal,
  LocationPrimerSheetProps
>(function LocationPrimerSheet({ canAskAgain, onAllow, onDismiss }, ref) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  // iOS 18 moved every app's page under Settings → Apps.
  const settingsPath =
    Platform.OS === "android"
      ? "Settings → Apps → Frapp → Permissions → Location"
      : "Settings → Apps → Frapp → Location";

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
    >
      <BottomSheetView style={styles.body}>
        <SheetHeader
          title="Location check"
          onCancel={onDismiss}
          // Declining is a quiet "Not now", never a refusal the member has to
          // justify (patterns.md § the primer pattern).
          cancelLabel="Not now"
        />

        <Text style={styles.copy}>
          Frapp confirms you&apos;re in the study zone when you start, and again
          every five minutes while you study. That check is what turns your time
          into chapter points.
        </Text>

        <View style={styles.points}>
          <Text style={styles.point}>
            · Location is read only while Frapp is open, never in the background.
          </Text>
          <Text style={styles.point}>
            · Nothing is stored beyond the zone check itself.
          </Text>
        </View>

        {canAskAgain ? (
          <SheetPrimaryButton
            label="Continue"
            onPress={onAllow}
            accent={accent}
            onAccent={tokens.color.gold.onHouse}
          />
        ) : (
          <>
            <Text style={styles.blocked}>
              Location is turned off for Frapp. Turn it on in {settingsPath},
              then start your session.
            </Text>
            <SheetPrimaryButton
              label="Open Settings"
              onPress={() => {
                // Closed first: the member comes back from Settings to the
                // Start card, not to a sheet still saying location is off.
                onDismiss();
                Linking.openSettings().catch(() => {
                  // Nothing to do: the sentence above says where to go.
                });
              }}
              accent={accent}
              onAccent={tokens.color.gold.onHouse}
            />
          </>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
    },
    copy: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    points: {
      marginTop: tokens.spacing.md,
      gap: tokens.spacing.xs,
    },
    point: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    blocked: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.md,
    },
  });
}
