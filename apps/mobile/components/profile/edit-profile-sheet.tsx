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
  applyEdit,
  draftFromProfile,
  hasChanges,
  profilePatch,
  rebaseEdits,
  sameDraft,
  type ProfileDraft,
  type ProfileDraftField,
  type ProfileEdits,
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
 * typed to the profile's value leaves the edits, and on a refetch a field that
 * held no change (spaces aside) follows the new profile
 * (`lib/more/edit-profile.ts` `applyEdit`, `rebaseEdits`, which says how this
 * differs from the web form's `seededFrom` merge).
 *
 * Dismissing, saving or cancelling drops the edits, except that a sheet closed
 * mid-save keeps them until the save settles. `useUpdateUser` caches the row
 * the server saved before it settles, so a save closes onto the saved values
 * rather than flashing the old ones.
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
  const [edits, setEdits] = useState<ProfileEdits | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [focused, setFocused] = useState<ProfileDraftField | null>(null);

  // The profile the edits were typed against. When a refetch moves it, the
  // edits re-base in the same render (React's "adjust state on a prop
  // change"), so no frame shows a field pinned to the old profile.
  const [typedAgainst, setTypedAgainst] = useState<ProfileDraft>(original);
  let typed = edits;
  if (!sameDraft(typedAgainst, original)) {
    typed = rebaseEdits(edits, typedAgainst, original);
    setTypedAgainst(original);
    setEdits(typed);
  }
  const shown: ProfileDraft = { ...original, ...typed };

  const result = profilePatch(original, shown);
  // A refusal is shown only once the member has typed: the sheet must not
  // open on an error for a profile the server already holds.
  const refusal = typed !== null && !result.ok ? result : null;
  const canSave =
    result.ok && hasChanges(result.patch) && !updateUser.isPending;

  const edit = (field: ProfileDraftField) => (value: string) => {
    setSubmitFailed(false);
    setEdits((latest) => applyEdit(latest, original, field, value));
  };

  const reset = useCallback(() => {
    setEdits(null);
    setSubmitFailed(false);
    setFocused(null);
  }, []);

  // Whether the sheet is mounted, from the start of `present()`'s slide up to
  // `onDismiss`. A save can settle after the sheet has closed, and gorhom's
  // `dismiss()` on a dismissed modal leaves it stuck mid-dismiss, so the next
  // `present()` draws nothing (5.2.x `handlePortalRender`). It turns true on
  // `onAnimate`, which fires as the sheet starts to move, so a Cancel during
  // the slide up still closes it, and false only on `onDismiss`: a close
  // animation can be caught and snapped back without another `onAnimate`, and
  // `dismiss()` on a sheet still closing is safe.
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
      // `useUpdateUser` has already cached the row the server saved, so
      // dropping the edits here shows it, not the old values.
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
      onAnimate={(_from, to) => {
        if (to >= 0) presented.current = true;
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
