import { forwardRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import {
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import {
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  sheetFieldStyles,
  SheetScrim,
  useSheetBackgroundStyle,
  SheetBackToClose,
  useSheetClose,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { MONO_FONT_FAMILY, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s18's manual code entry, for a member whose camera won't scan the host's QR.
 *
 * A sheet rather than a field on the scanner, so it rises with the keyboard
 * the way the New task sheet does (`spec/ui/mobile/patterns.md` § Bottom
 * sheets). The field used to sit at the foot of the scanner with no keyboard
 * handling at all, and on Android the app-wide `KeyboardProvider` stops the
 * window resizing, so the keyboard opened over the code being typed (#3354).
 * `BottomSheetTextInput` coordinates with the keyboard itself, so no
 * `KeyboardAvoidingArea` is needed. The board draws the entry point as a
 * plain "Enter code manually" link under the viewport, which a sheet keeps.
 *
 * Presentational only. The screen owns the code, the submit, the outcome, and
 * the modal's visit tracking (`useSheetVisit`), because a successful check-in
 * from here replaces the whole scanner and has to close this sheet with it.
 */
type ManualCodeSheetProps = {
  code: string;
  onChangeCode: (next: string) => void;
  onSubmit: () => void;
  submitDisabled: boolean;
  submitting: boolean;
  /** Why the last manual submit failed, or why no write can be sent. */
  notices: string[];
  /** Wired to the disabled button, not only printed above it. */
  accessibilityHint?: string;
  onAnimate: (from: number, to: number) => void;
  onDismiss: () => void;
  onCancel: () => void;
};

export const ManualCodeSheet = forwardRef<
  BottomSheetModal,
  ManualCodeSheetProps
>(function ManualCodeSheet(
  {
    code,
    onChangeCode,
    onSubmit,
    submitDisabled,
    submitting,
    notices,
    accessibilityHint,
    onAnimate,
    onDismiss,
    onCancel,
  },
  ref,
) {
  const closeSheet = useSheetClose(ref);
  const { tokens } = useFrappTheme();
  const { accent, accentPrimary, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const backgroundStyle = useSheetBackgroundStyle();
  const [focused, setFocused] = useState(false);

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      backdropComponent={SheetScrim}
      handleComponent={SheetGrabber}
      onAnimate={onAnimate}
      onDismiss={() => {
        setFocused(false);
        onDismiss();
      }}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetView onAccessibilityEscape={closeSheet} style={styles.body}>
        <SheetHeader title="Enter code" onCancel={onCancel} />
        <BottomSheetTextInput
          accessibilityLabel="Manual check-in code"
          value={code}
          onChangeText={onChangeCode}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={submitDisabled ? undefined : onSubmit}
          placeholder="4KQ-88"
          placeholderTextColor={tokens.color.text.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="go"
          style={[
            styles.field,
            styles.code,
            focused ? styles.fieldFocused : null,
          ]}
        />
        {notices.map((notice) => (
          <Text key={notice} accessibilityRole="alert" style={styles.notice}>
            {notice}
          </Text>
        ))}
        <SheetPrimaryButton
          label={submitting ? "Checking in…" : "Check in"}
          onPress={onSubmit}
          disabled={submitDisabled}
          // The solid fill and the foreground contrast-corrected for it, not
          // the text-role `accent` (`lib/chapter-branding.ts`).
          accent={accentPrimary}
          onAccent={accentOnPrimary}
          accessibilityHint={accessibilityHint}
        />
      </BottomSheetView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens, accent: string) {
  const field = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.sm,
    },
    field: field.field,
    fieldFocused: field.fieldFocused,
    // The host shows the code in mono (s22), so the member types it in the
    // same face: `0` and `O` stay apart.
    code: {
      fontFamily: MONO_FONT_FAMILY,
      letterSpacing: 1,
    },
    notice: {
      color: tokens.color.semantic.destructive,
      ...typeRole(tokens.typography.role.caption),
    },
  });
}
