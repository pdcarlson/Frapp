import { forwardRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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
 * the only honest next step is Settings.
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
            · Location is read only while Frapp is open — never in the background.
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
              Location is turned off for Frapp, and iOS won&apos;t ask again.
              Turn it on in Settings → Frapp → Location, then start your session.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onDismiss}
              style={({ pressed }) => [
                styles.secondary,
                pressed ? styles.secondaryPressed : null,
              ]}
            >
              <Text style={styles.secondaryLabel}>Close</Text>
            </Pressable>
          </>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg + 2,
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
    secondary: {
      height: tokens.touch.buttonLarge,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      alignItems: "center",
      justifyContent: "center",
      marginTop: tokens.spacing.md,
    },
    secondaryPressed: {
      opacity: 0.85,
    },
    secondaryLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
  });
}
