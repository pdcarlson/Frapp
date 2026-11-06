import { forwardRef } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  locationSettingsPath,
  turnOnLocationStep,
} from "@/lib/study/location-settings-path";
import {
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  useSheetBackgroundStyle,
  SheetBackToClose,
  useSheetClose,
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
 * back to it later. The path is `locationSettingsPath`'s, the one the Start
 * card's failure line uses too: it differs by OS and by iOS version. The web
 * build has neither a path nor a settings page to open (react-native-web's
 * `Linking` has no `openSettings`, so calling it throws). The helper says so
 * with `null`, and on that answer the line says to allow location for the
 * site in the browser and there is no button; the header's "Not now" closes
 * the sheet.
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
  const closeSheet = useSheetClose(ref);
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const settingsPath = locationSettingsPath();
  const turnOnStep = turnOnLocationStep(settingsPath);
  // The helper's `null` is the one "no Settings here" answer, so the button
  // and the line can't disagree about it.
  const canOpenSettings = settingsPath !== null;

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetView onAccessibilityEscape={closeSheet} style={styles.body}>
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
              Location is turned off for Frapp. {turnOnStep}, then start your
              session.
            </Text>
            {canOpenSettings ? (
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
            ) : null}
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
