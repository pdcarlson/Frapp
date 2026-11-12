import { forwardRef, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { useCorrectMemberProfile } from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import {
  correctionDraft,
  correctionPatch,
  DISPLAY_NAME_MAX_LENGTH,
  PROFILE_FIELD_COPY,
  type ProfileCorrectionDraft,
} from "@repo/validation";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useSheetVisit,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";

/**
 * An officer fixes another member's name or graduation year (#4367), from
 * the profile's `⋯` where the API says `viewer_can_edit_profile`. The mobile
 * half of web's `MemberCorrectionDialog`; both take their rules and wording
 * from `correctionPatch` in `@repo/validation`. Nothing else on someone's
 * profile is an officer's to change (`spec/behavior/members.md` § Profiles,
 * Officer corrections).
 *
 * Stacked over the profile, as {@link MemberClassSheet} is: nothing saves
 * until Save, only what changed is sent, and a refusal shows once Save is
 * pressed, never on a keystroke.
 */
export interface MemberCorrectionSession {
  memberId: string;
  /** How the profile names them, for the title. */
  label: string;
  /** Their stored name, `""` when none is set: what the field opens on. */
  name: string;
  graduationYear: number | null;
}

/** Two fields and a button: a fixed detent tall enough with the keyboard up. */
const SNAP_POINTS = ["60%"];

/** Four digits at the body size, plus padding. */
const YEAR_FIELD_WIDTH = 96;

export const MemberCorrectionSheet = forwardRef<
  BottomSheetModal,
  { session: MemberCorrectionSession | null }
>(function MemberCorrectionSheet({ session }, ref) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const backgroundStyle = useSheetBackgroundStyle();
  const closeSheet = useSheetClose(ref);
  const correct = useCorrectMemberProfile();

  const [original, setOriginal] = useState<ProfileCorrectionDraft>({
    name: "",
    graduationYear: "",
  });
  const [draft, setDraft] = useState<ProfileCorrectionDraft>(original);
  const [focused, setFocused] = useState<keyof ProfileCorrectionDraft | null>(
    null,
  );
  const [refusal, setRefusal] = useState<{
    field: keyof ProfileCorrectionDraft;
    message: string;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // A new opening starts from the member's saved values.
  useEffect(() => {
    if (!session) return;
    const opening = correctionDraft({
      displayName: session.name,
      graduationYear: session.graduationYear,
    });
    setOriginal(opening);
    setDraft(opening);
    setRefusal(null);
    setSaveError(null);
  }, [session]);

  const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
    useSheetVisit(ref);
  // Set the moment Save sends, so two taps in one batch send once.
  const sending = useRef(false);

  function edit(next: Partial<ProfileCorrectionDraft>) {
    setSaveError(null);
    setRefusal(null);
    setDraft((current) => ({ ...current, ...next }));
  }

  function save() {
    if (!session || correct.isPending || sending.current) return;
    const result = correctionPatch(original, draft);
    if (!result.ok) {
      setRefusal({ field: result.field, message: result.message });
      return;
    }
    if (Object.keys(result.patch).length === 0) {
      dismiss();
      return;
    }
    sending.current = true;
    setSaveError(null);
    const sentFrom = visit();
    correct.mutate(
      { id: session.memberId, ...result.patch },
      {
        // The hook refetches the member reads, so the profile under the sheet
        // shows the new name once this closes.
        onSuccess: () => {
          if (isSameVisit(sentFrom)) dismiss();
        },
        onError: (error) =>
          setSaveError(
            errorCopy(error, "That didn't save. Try again in a moment.", {
              // The route's refusals are sentences for members ("You can only
              // edit the profiles of members ranked below you.").
              serverWritesForMembers: true,
            }),
          ),
        onSettled: () => {
          sending.current = false;
        },
      },
    );
  }

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      snapPoints={SNAP_POINTS}
      enableDynamicSizing={false}
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      backdropComponent={SheetScrim}
      handleComponent={SheetGrabber}
      onAnimate={onAnimate}
      onDismiss={markClosed}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <SheetHeader
          title={session ? `Edit ${session.label}'s profile` : "Edit profile"}
          onCancel={dismiss}
        />

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>
            {PROFILE_FIELD_COPY.displayName.label}
          </Text>
          <BottomSheetTextInput
            value={draft.name}
            onChangeText={(text) => edit({ name: text })}
            editable={!correct.isPending}
            onFocus={() => setFocused("name")}
            onBlur={() => setFocused(null)}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            autoCapitalize="words"
            autoCorrect={false}
            accessibilityLabel={PROFILE_FIELD_COPY.displayName.label}
            style={[
              styles.field,
              focused === "name" ? styles.fieldFocused : null,
              refusal?.field === "name" ? styles.fieldInvalid : null,
            ]}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>
            {PROFILE_FIELD_COPY.graduationYear.accessibleLabel}
          </Text>
          <BottomSheetTextInput
            value={draft.graduationYear}
            onChangeText={(text) => edit({ graduationYear: text })}
            editable={!correct.isPending}
            onFocus={() => setFocused("graduationYear")}
            onBlur={() => setFocused(null)}
            maxLength={4}
            keyboardType="number-pad"
            placeholder={PROFILE_FIELD_COPY.graduationYear.placeholder}
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel={
              PROFILE_FIELD_COPY.graduationYear.accessibleLabel
            }
            style={[
              styles.field,
              styles.yearField,
              focused === "graduationYear" ? styles.fieldFocused : null,
              refusal?.field === "graduationYear" ? styles.fieldInvalid : null,
            ]}
          />
        </View>

        {refusal || saveError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {refusal?.message ?? saveError}
          </Text>
        ) : null}

        <Text style={styles.note}>
          The rest of their profile is theirs to change.
        </Text>

        <SheetPrimaryButton
          label={correct.isPending ? "Saving…" : "Save"}
          onPress={save}
          disabled={!session || correct.isPending}
          accent={accent}
          onAccent={tokens.color.gold.onHouse}
        />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.lg,
    },
    fieldGroup: {
      gap: tokens.spacing.sm,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    field: fieldStyles.field,
    yearField: {
      width: YEAR_FIELD_WIDTH,
    },
    fieldFocused: fieldStyles.fieldFocused,
    fieldInvalid: {
      borderColor: tokens.color.semantic.destructive,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
