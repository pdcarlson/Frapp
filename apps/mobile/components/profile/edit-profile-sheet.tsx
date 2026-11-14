import { forwardRef, useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { useFieldReveal, useUpdateUser } from "@repo/hooks";
import {
  BIRTHDAY_COPY,
  BIRTHDAY_VISIBILITIES,
  MAJOR_MAX_LENGTH,
  parseBirthdayVisibility,
  PHONE_MAX_LENGTH,
  PROFILE_ALUMNI_SECTION,
  PROFILE_FIELD_COPY,
  showsAfterGraduation,
} from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import {
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  sheetFieldStyles,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetVisit,
  SheetBackToClose,
  useSheetClose,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { Segmented } from "@/components/segmented";
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
 * s15's Edit sheet (#3387): the member's name, phone (#3711), major,
 * graduation year, bio,
 * and, from their graduation year on, city and company (`showsAfterGraduation`
 * in @repo/validation), saved through `PATCH /v1/users/me`. The photo stays on the screen
 * itself (`components/profile/profile-photo.tsx`), where it already edits.
 *
 * The rules (what is sent, what is refused) live in `lib/more/edit-profile.ts`.
 * This file wires them to fields.
 *
 * ## The draft holds only what the member typed
 *
 * `edits` holds the fields the member has typed into, and every other field
 * shows the profile as it stands. So the sheet always opens on the latest
 * profile, with no "reset on present" step to forget, and a `/v1/users/me`
 * refetch that lands mid-edit (such as on a return to the app once the profile
 * is stale) updates the fields the member left alone instead of freezing them.
 * Those fields equal the profile, so `profilePatch` leaves them out of the
 * save, and a value another device set is written back over only in a field
 * the member changed. A field typed to the profile's value leaves the edits,
 * and on a refetch a moved field that held no change (spaces aside) follows
 * the new profile
 * (`lib/more/edit-profile.ts` `applyEdit`, `rebaseEdits`, which says how this
 * differs from the web form's `seededFrom` merge, #3392).
 *
 * Dismissing, saving or cancelling drops the edits, except that a sheet closed
 * mid-save keeps them until the save settles, and a save closes only the visit
 * it was sent from (`useSheetVisit` in `sheet-scaffold.tsx`). Before it settles,
 * `useUpdateUser` writes the row the server saved over the cached profile when
 * it is the same account's (a loaded s15 always has it cached), so a save
 * closes onto the saved values rather than flashing the old ones.
 *
 * So a swipe or scrim close outside a save drops the edits rather than
 * keeping them for the next visit, the exception to the sheets'
 * keep-the-draft rule (`spec/ui/mobile/patterns.md` § Bottom sheets, "A draft
 * outlives a close", which says why: `rebaseEdits` keeps a typed field over a
 * profile that moves under it, right within one visit and wrong across one).
 *
 * ## A fixed detent, not dynamic sizing
 *
 * Six fields and a bio that grows as it is typed, under a keyboard, don't fit
 * every phone. The body scrolls, so it takes a fixed detent with a
 * `BottomSheetScrollView` as the sheet's direct child, which is the
 * combination `spec/ui/mobile/patterns.md` § Bottom sheets requires of a
 * scrollable sheet.
 */
const SNAP_POINTS = ["88%"];

const copy = PROFILE_FIELD_COPY;

/**
 * The graduation year's width beside Major: four digits at the body size plus
 * the field's padding, rounded up to the grid (foundations §9).
 */
const YEAR_FIELD_WIDTH = 96;

const VISIBILITY_OPTIONS = BIRTHDAY_VISIBILITIES.map((value) => ({
  value,
  label: BIRTHDAY_COPY.visibility[value],
}));

/** Matches the web profile form's bio field, which draws three lines. */
const BIO_LINES = 3;

export const EditProfileSheet = forwardRef<
  BottomSheetModal,
  { profile: ViewerProfile | null }
>(function EditProfileSheet({ profile }, ref) {
  const closeSheet = useSheetClose(ref);
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const backgroundStyle = useSheetBackgroundStyle();
  const updateUser = useUpdateUser();

  const original = useMemo(() => draftFromProfile(profile), [profile]);
  const [edits, setEdits] = useState<ProfileEdits | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [focused, setFocused] = useState<ProfileDraftField | null>(null);
  // When a refusal shows: once the member leaves the field or presses Save,
  // never on the keystroke that is still on its way to a valid value
  // (`useFieldReveal`, components.md § Text input, "When an error shows").
  const reveal = useFieldReveal<ProfileDraftField>();

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
  // A refusal exists only once the member has typed (the sheet must not open
  // on an error for a profile the server already holds), and shows only once
  // `reveal` says so.
  const refusal = typed !== null && !result.ok ? result : null;
  const shownRefusal =
    refusal !== null && reveal.shows(refusal.field) ? refusal : null;
  // Save stays pressable while a typed field is refused, so pressing it can
  // say why rather than sit there greyed out with the error still hidden. With
  // nothing typed there is nothing to save, even over a stored value the
  // form would refuse (a blank name), so Save is off.
  const dirty = typed !== null && (result.ok ? hasChanges(result.patch) : true);
  // City and Company wait for the graduation year (`showsAfterGraduation`):
  // the year as typed, and the stored City and Company, so clearing one
  // doesn't hide the field mid-edit.
  const yearShown = shown.graduationYear.trim();
  const afterGraduation = showsAfterGraduation({
    graduationYear: /^\d+$/.test(yearShown) ? Number(yearShown) : null,
    city: original.city,
    company: original.company,
  });
  const canSave = dirty && !updateUser.isPending;

  const edit = (field: ProfileDraftField) => (value: string) => {
    setSubmitFailed(false);
    setEdits((latest) => applyEdit(latest, original, field, value));
  };

  const resetReveal = reveal.reset;
  const reset = useCallback(() => {
    setEdits(null);
    setSubmitFailed(false);
    setFocused(null);
    resetReveal();
  }, [resetReveal]);

  // A save can settle after the sheet has closed: see `useSheetVisit`.
  const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
    useSheetVisit(ref);

  // However the sheet closes mid-save (Cancel, a swipe, the scrim), the edits
  // stay until the save settles: the PATCH is already sent, and a failure has
  // to reopen on what was typed.
  const closed = () => {
    markClosed();
    if (updateUser.isPending) setFocused(null);
    else reset();
  };

  const cancel = () => {
    if (!updateUser.isPending) reset();
    dismiss();
  };

  // Set the moment Save sends, before `isPending` reaches a render: two taps
  // handled in one batch both see the same render's `canSave`.
  const sending = useRef(false);

  const save = () => {
    // `canSave` and `sending`, not only the button's `disabled`, stand
    // between a save in flight and a second PATCH.
    if (!canSave || sending.current) return;
    if (!result.ok) {
      // Shows the refusal; nothing is sent.
      reveal.submit();
      return;
    }
    sending.current = true;
    setSubmitFailed(false);
    const sentFrom = visit();
    updateUser.mutate(result.patch, {
      // `useUpdateUser` has already written the row the server saved over
      // this account's cached profile, so dropping the edits here shows it,
      // not the old values. The fields are
      // read-only while the save runs, so these edits are all it sent. A
      // sheet closed and reopened since then is the member's new visit, and
      // the save doesn't close it under them.
      onSuccess: () => {
        reset();
        if (isSameVisit(sentFrom)) dismiss();
      },
      // The draft stays, so nothing typed is lost to a dropped connection.
      onError: () => setSubmitFailed(true),
      onSettled: () => {
        sending.current = false;
      },
    });
  };

  const field = (
    name: ProfileDraftField,
    label: string,
    options: {
      placeholder: string;
      multiline?: boolean;
      keyboardType?: "number-pad" | "phone-pad";
      /** iOS autofill: the phone field offers the member's own number. */
      textContentType?: "telephoneNumber";
      /** A quiet line under the field, replaced by its refusal when there is one. */
      hint?: string;
      autoCapitalize?: "words" | "sentences";
      maxLength?: number;
      /** What a screen reader announces, when the label is abbreviated. */
      accessibleLabel?: string;
      /** A field sharing a row: its share of the width. */
      grow?: boolean;
    },
  ) => (
    <View
      style={[
        styles.fieldGroup,
        options.grow === undefined
          ? null
          : options.grow
            ? styles.fieldGrow
            : styles.fieldNarrow,
      ]}
    >
      <Text style={styles.label}>{label}</Text>
      <BottomSheetTextInput
        value={shown[name]}
        onChangeText={edit(name)}
        // Read-only while a save runs: the save sent what was typed when Save
        // was pressed, and anything typed after it would be dropped unsent.
        editable={!updateUser.isPending}
        onFocus={() => setFocused(name)}
        onBlur={() => {
          setFocused((current) => (current === name ? null : current));
          reveal.blur(name);
        }}
        placeholder={options.placeholder}
        placeholderTextColor={tokens.color.text.muted}
        accessibilityLabel={options.accessibleLabel ?? label}
        keyboardType={options.keyboardType}
        textContentType={options.textContentType}
        autoCapitalize={options.autoCapitalize}
        maxLength={options.maxLength}
        multiline={options.multiline}
        numberOfLines={options.multiline ? BIO_LINES : undefined}
        textAlignVertical={options.multiline ? "top" : undefined}
        style={[
          styles.field,
          options.multiline ? styles.fieldMultiline : null,
          focused === name ? styles.fieldFocused : null,
          shownRefusal?.field === name ? styles.fieldInvalid : null,
        ]}
      />
      {/* A field sharing a row says what's wrong under the whole row
          (`rowError`), not inside its own narrow column. */}
      {shownRefusal?.field === name && options.grow === undefined ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {shownRefusal.message}
        </Text>
      ) : options.hint ? (
        <Text style={styles.hint}>{options.hint}</Text>
      ) : null}
    </View>
  );

  const rowError = (fields: ProfileDraftField[]) =>
    shownRefusal !== null && fields.includes(shownRefusal.field) ? (
      <Text accessibilityRole="alert" style={styles.error}>
        {shownRefusal.message}
      </Text>
    ) : null;

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
      onDismiss={closed}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <SheetHeader title="Edit profile" onCancel={cancel} />

        {field("displayName", copy.displayName.label, {
          placeholder: copy.displayName.placeholder,
          autoCapitalize: "words",
        })}
        {field("phone", copy.phone.label, {
          placeholder: copy.phone.placeholder,
          keyboardType: "phone-pad",
          textContentType: "telephoneNumber",
          maxLength: PHONE_MAX_LENGTH,
          hint: copy.phone.hint,
        })}
        <View style={styles.row}>
          {field("major", copy.major.label, {
            placeholder: copy.major.placeholder,
            autoCapitalize: "words",
            maxLength: MAJOR_MAX_LENGTH,
            grow: true,
          })}
          {field("graduationYear", copy.graduationYear.label, {
            accessibleLabel: copy.graduationYear.accessibleLabel,
            placeholder: copy.graduationYear.placeholder,
            keyboardType: "number-pad",
            maxLength: 4,
            grow: false,
          })}
        </View>
        {rowError(["major", "graduationYear"])}
        {/* The birthday (#4959): month, day and an optional year as digits,
            then who can see it, beside it rather than behind a menu, the way
            Facebook's birthday field shows its audience. */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{BIRTHDAY_COPY.label}</Text>
        </View>
        <View style={styles.row}>
          {field("birthdayMonth", BIRTHDAY_COPY.monthLabel, {
            accessibleLabel: "Birthday month, 1 to 12",
            placeholder: "MM",
            keyboardType: "number-pad",
            maxLength: 2,
            grow: true,
          })}
          {field("birthdayDay", BIRTHDAY_COPY.dayLabel, {
            accessibleLabel: "Birthday day",
            placeholder: "DD",
            keyboardType: "number-pad",
            maxLength: 2,
            grow: true,
          })}
          {field("birthdayYear", BIRTHDAY_COPY.yearLabel, {
            accessibleLabel: "Birth year, optional",
            placeholder: "YYYY",
            keyboardType: "number-pad",
            maxLength: 4,
            grow: true,
          })}
        </View>
        {rowError(["birthdayMonth", "birthdayDay", "birthdayYear"]) ?? (
          <Text style={styles.hint}>{BIRTHDAY_COPY.yearHint}</Text>
        )}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{BIRTHDAY_COPY.visibilityLabel}</Text>
          <Segmented
            options={VISIBILITY_OPTIONS}
            value={parseBirthdayVisibility(shown.birthdayVisibility)}
            onChange={(next) => edit("birthdayVisibility")(next)}
            accessibilityLabel={BIRTHDAY_COPY.visibilityLabel}
            disabled={updateUser.isPending}
          />
          <Text style={styles.hint}>
            {
              BIRTHDAY_COPY.visibilityHint[
                parseBirthdayVisibility(shown.birthdayVisibility)
              ]
            }
          </Text>
        </View>
        {field("bio", copy.bio.label, {
          placeholder: copy.bio.placeholder,
          multiline: true,
          autoCapitalize: "sentences",
        })}

        {afterGraduation ? (
          <>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>
                {PROFILE_ALUMNI_SECTION.title}
              </Text>
              <Text style={styles.sectionHint}>
                {PROFILE_ALUMNI_SECTION.hint}
              </Text>
            </View>
            {field("city", copy.city.label, {
              placeholder: copy.city.placeholder,
              autoCapitalize: "words",
            })}
            {field("company", copy.company.label, {
              placeholder: copy.company.placeholder,
              autoCapitalize: "words",
            })}
          </>
        ) : null}

        {submitFailed ? (
          <Text accessibilityRole="alert" style={styles.error}>
            That didn&apos;t save. Your changes are still here, so try again.
          </Text>
        ) : null}

        <SheetPrimaryButton
          label={updateUser.isPending ? "Saving…" : "Save"}
          onPress={save}
          disabled={!canSave}
          accessibilityHint={shownRefusal?.message}
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
    // foundations §9's rhythm: 8 between a label and its field, 16 between
    // fields, 24 before a new section (the section head's top margin).
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.lg,
    },
    fieldGroup: {
      gap: tokens.spacing.sm,
    },
    row: {
      flexDirection: "row",
      gap: tokens.spacing.lg,
    },
    fieldGrow: {
      flex: 1,
    },
    fieldNarrow: {
      width: YEAR_FIELD_WIDTH,
    },
    sectionHead: {
      marginTop: tokens.spacing.sm,
      gap: tokens.spacing.xs,
    },
    sectionTitle: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    sectionHint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    field: fieldStyles.field,
    fieldMultiline: {
      // Body's leading back, which the single-line `field` drops for iOS.
      ...fieldStyles.fieldMultilineText,
      minHeight:
        (tokens.typography.role.body.lineHeight ??
          tokens.typography.role.body.size) *
          BIO_LINES +
        tokens.spacing.sm * 2,
    },
    fieldFocused: fieldStyles.fieldFocused,
    fieldInvalid: {
      borderColor: tokens.color.semantic.destructive,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    hint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
