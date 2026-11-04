import { forwardRef, useCallback, useMemo, useRef, useState } from "react";
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
 * ## The draft holds only what the member typed
 *
 * `edits` holds the fields the member has typed into, and every other field
 * shows the profile as it stands. So the sheet always opens on the latest
 * profile, with no "reset on present" step to forget, and a refetch that lands
 * mid-edit (a return to the app refetches `/v1/users/me`) updates the fields
 * the member left alone instead of freezing them. Those fields equal the
 * profile, so `profilePatch` leaves them out of the save, and a value another
 * device set is written back over only in a field the member changed. A field
 * typed back to its old value leaves `edits` and follows the profile again.
 * That is the web form's rule too (`apps/web/components/profile/profile-panel.tsx`,
 * `seededFrom`): it keeps a field only while it differs from the profile.
 *
 * Dismissing, saving or cancelling drops the edits, except that a sheet closed
 * mid-save keeps them until the save settles. `useUpdateUser` writes the saved
 * fields into the cached profile before it settles, so a save closes onto the
 * saved values rather than flashing the old ones.
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
  const [edits, setEdits] = useState<Partial<ProfileDraft> | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [focused, setFocused] = useState<ProfileDraftField | null>(null);
  const shown: ProfileDraft = { ...original, ...edits };

  const result = profilePatch(original, shown);
  // A refusal is shown only once the member has typed: the sheet must not
  // open on an error for a profile the server already holds.
  const refusal = edits !== null && !result.ok ? result : null;
  const canSave =
    result.ok && hasChanges(result.patch) && !updateUser.isPending;

  // A field typed back to the profile's value leaves `edits`, so it follows
  // the profile again rather than pinning the value it had when it was typed.
  const edit = (field: ProfileDraftField) => (value: string) => {
    setSubmitFailed(false);
    setEdits((current) => {
      const next = { ...current };
      if (value === original[field]) delete next[field];
      else next[field] = value;
      return next;
    });
  };

  const reset = useCallback(() => {
    setEdits(null);
    setSubmitFailed(false);
    setFocused(null);
  }, []);

  // Whether the sheet is up. A save can settle after the sheet has closed, and
  // gorhom's `dismiss()` on a closed modal leaves it stuck mid-dismiss, so the
  // next `present()` draws nothing (5.2.x `handlePortalRender`).
  const presented = useRef(false);

  const dismiss = useCallback(() => {
    if (!presented.current) return;
    if (typeof ref === "function" || !ref?.current) return;
    ref.current.dismiss();
  }, [ref]);

  // However the sheet closes mid-save (Cancel, a swipe, the scrim), the edits
  // stay until the save settles: the PATCH is already sent, and a failure has
  // to reopen on what was typed.
  const closed = () => {
    presented.current = false;
    if (updateUser.isPending) setFocused(null);
    else reset();
  };

  const cancel = () => {
    if (!updateUser.isPending) reset();
    dismiss();
  };

  const save = () => {
    // `canSave`, not only the button's `disabled`, stands between a save in
    // flight and a second PATCH.
    if (!result.ok || !canSave) return;
    setSubmitFailed(false);
    updateUser.mutate(result.patch, {
      // `useUpdateUser` has already written the saved fields into the cached
      // profile, so dropping the edits here shows them, not the old values.
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
      onChange={(index) => {
        presented.current = index >= 0;
      }}
      onDismiss={closed}
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
