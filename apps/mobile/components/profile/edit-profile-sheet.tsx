import { forwardRef, useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { useUpdateUser } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  useSheetBackgroundStyle,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  draftFromProfile,
  hasChanges,
  profilePatch,
  type ProfileDraft,
  type ProfileDraftField,
} from "@/lib/more/edit-profile";
import type { ViewerProfile } from "@/lib/more/profile";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s15's Edit sheet (#3387): the member's name, bio, graduation year, city and
 * company, saved through `PATCH /v1/users/me`. The photo stays on the screen
 * itself (`components/profile/profile-photo.tsx`), where it already edits.
 *
 * The rules (what is sent, what is refused) live in `lib/more/edit-profile.ts`.
 * This file wires them to fields.
 *
 * ## The draft follows the profile until the member types
 *
 * `draft` is `null` until the first keystroke, and the fields show the profile
 * as it stands. So the sheet always opens on the latest profile, with no
 * "reset on present" step to forget, and a refetch that lands while it is
 * closed is what it opens on. Dismissing, saving or cancelling drops the draft.
 *
 * ## A fixed detent, not dynamic sizing
 *
 * Five fields and a bio that grows as it is typed, under a keyboard, don't fit
 * every phone. The body scrolls, so it takes a fixed detent with a
 * `BottomSheetScrollView` as the sheet's direct child, which is the
 * combination `spec/ui/mobile/patterns.md` § Bottom sheets requires of a
 * scrollable sheet.
 */
const SNAP_POINTS = ["88%"];

/** Matches the web profile form's bio field, which draws three lines. */
const BIO_LINES = 3;

export const EditProfileSheet = forwardRef<
  BottomSheetModal,
  { profile: ViewerProfile | null }
>(function EditProfileSheet({ profile }, ref) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const updateUser = useUpdateUser();

  const original = useMemo(() => draftFromProfile(profile), [profile]);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [focused, setFocused] = useState<ProfileDraftField | null>(null);
  const shown = draft ?? original;

  const result = profilePatch(original, shown);
  // A refusal is shown only once the member has typed: the sheet must not
  // open on an error for a profile the server already holds.
  const refusal = draft !== null && !result.ok ? result : null;
  const canSave =
    result.ok && hasChanges(result.patch) && !updateUser.isPending;

  const edit = (field: ProfileDraftField) => (value: string) => {
    setSubmitFailed(false);
    setDraft({ ...shown, [field]: value });
  };

  const reset = useCallback(() => {
    setDraft(null);
    setSubmitFailed(false);
    setFocused(null);
  }, []);

  const dismiss = useCallback(() => {
    if (typeof ref === "function" || !ref?.current) return;
    ref.current.dismiss();
  }, [ref]);

  const cancel = useCallback(() => {
    reset();
    dismiss();
  }, [reset, dismiss]);

  const save = () => {
    // `canSave`, not only the button's `disabled`, stands between a save in
    // flight and a second PATCH.
    if (!result.ok || !canSave) return;
    setSubmitFailed(false);
    updateUser.mutate(result.patch, {
      onSuccess: () => {
        reset();
        dismiss();
      },
      // The draft stays, so nothing typed is lost to a dropped connection.
      onError: () => setSubmitFailed(true),
    });
  };

  const field = (
    name: ProfileDraftField,
    label: string,
    options: {
      placeholder: string;
      multiline?: boolean;
      keyboardType?: "number-pad";
      autoCapitalize?: "words" | "sentences";
      maxLength?: number;
    },
  ) => (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <BottomSheetTextInput
        value={shown[name]}
        onChangeText={edit(name)}
        onFocus={() => setFocused(name)}
        onBlur={() =>
          setFocused((current) => (current === name ? null : current))
        }
        placeholder={options.placeholder}
        placeholderTextColor={tokens.color.text.muted}
        accessibilityLabel={label}
        keyboardType={options.keyboardType}
        autoCapitalize={options.autoCapitalize}
        maxLength={options.maxLength}
        multiline={options.multiline}
        numberOfLines={options.multiline ? BIO_LINES : undefined}
        textAlignVertical={options.multiline ? "top" : undefined}
        style={[
          styles.field,
          options.multiline ? styles.fieldMultiline : null,
          focused === name ? styles.fieldFocused : null,
          refusal?.field === name ? styles.fieldInvalid : null,
        ]}
      />
      {refusal?.field === name ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {refusal.message}
        </Text>
      ) : null}
    </View>
  );

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={SNAP_POINTS}
      enableDynamicSizing={false}
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      backdropComponent={SheetScrim}
      handleComponent={SheetGrabber}
      onDismiss={reset}
    >
      <BottomSheetScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <SheetHeader title="Edit profile" onCancel={cancel} />

        {field("displayName", "Name", {
          placeholder: "Your full name",
          autoCapitalize: "words",
        })}
        {field("bio", "Bio", {
          placeholder: "Major, year, anything brothers should know.",
          multiline: true,
          autoCapitalize: "sentences",
        })}
        {field("graduationYear", "Graduation year", {
          placeholder: "2027",
          keyboardType: "number-pad",
          maxLength: 4,
        })}
        {field("city", "City", {
          placeholder: "Optional, for the alumni directory",
          autoCapitalize: "words",
        })}
        {field("company", "Company", {
          placeholder: "Optional, for the alumni directory",
          autoCapitalize: "words",
        })}

        {submitFailed ? (
          <Text accessibilityRole="alert" style={styles.error}>
            That didn&apos;t save. Your changes are still here, so try again.
          </Text>
        ) : null}

        <SheetPrimaryButton
          label={updateUser.isPending ? "Saving…" : "Save"}
          onPress={save}
          disabled={!canSave}
          accessibilityHint={refusal?.message}
          accent={accent}
          onAccent={tokens.color.gold.onHouse}
        />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    fieldGroup: {
      gap: tokens.spacing.xs,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    // `new-task-sheet.tsx`'s field, so the two sheets' inputs read as one.
    field: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    fieldMultiline: {
      minHeight:
        (tokens.typography.role.body.lineHeight ??
          tokens.typography.role.body.size) *
          BIO_LINES +
        tokens.spacing.sm * 2,
    },
    fieldFocused: {
      borderColor: tokens.color.gold.house,
    },
    fieldInvalid: {
      borderColor: tokens.color.semantic.destructive,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
