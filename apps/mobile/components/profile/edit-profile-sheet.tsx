import {
  forwardRef,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type TextInput,
} from "react-native";
import { BottomSheetModal, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import {
  useChapterMajors,
  useFieldReveal,
  usePermissionList,
  useUpdateUser,
} from "@repo/hooks";
import {
  BIRTHDAY_COPY,
  can,
  DISPLAY_NAME_MAX_LENGTH,
  MAJOR_MAX_LENGTH,
  majorSuggestions,
  parseBirthdayVisibility,
  PHONE_MAX_LENGTH,
  PROFILE_ALUMNI_SECTION,
  PROFILE_FIELD_COPY,
  showsAfterGraduation,
  USER_BIO_MAX_LENGTH,
  USER_CITY_MAX_LENGTH,
  USER_COMPANY_MAX_LENGTH,
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
import { Toggle } from "@/components/toggle";
import { ListRow, ListSection } from "@/components/list-section";
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
import { BottomSheetScrollView } from "@/lib/sheet-scrollables";

/**
 * s15's Edit sheet (#3387): the member's name, phone (#3711), major,
 * graduation year, birthday and whether the chapter sees it (#4959, #5282), bio,
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
 *
 * ## It opens at the field that was tapped (#5280)
 *
 * The You tab's name and Details rows each name a field (`openAt`), and the
 * sheet opens with that field in view and its input focused, the keyboard up:
 * tapping Bio lands in the bio, not on Name with the bio four fields down.
 * Slack's and LinkedIn's profile editors do the same from a tapped field. The
 * scroll waits for the sheet to settle open (`onChange`): until then the
 * library pins the scroll view in place (`lib/sheet-scrollables.tsx`), so an
 * earlier `scrollTo` would be undone.
 *
 * It scrolls only as far as it must, the way iOS Contacts brings a field into
 * view: a field already clear of where the keyboard will be stays put, with
 * the header and its Cancel above it, and the sheet never scrolls past the end
 * of its content. The keyboard the focus raises shrinks the sheet's body
 * (`keyboardBehavior="interactive"`), so the field is checked once more
 * against what is left, and nothing after that: the member's own scrolling
 * and a later keyboard are theirs.
 */
const SNAP_POINTS = ["88%"];

/** A field the sheet can open at: each one that has an input. */
export type EditProfileField = Exclude<ProfileDraftField, "birthdayVisibility">;

/**
 * The share of the sheet's body a keyboard leaves clear, for the check made
 * before it has opened.
 */
const KEYBOARD_FREE = 1 / 2;

const BIRTHDAY_FIELDS: EditProfileField[] = [
  "birthdayMonth",
  "birthdayDay",
  "birthdayYear",
];

const copy = PROFILE_FIELD_COPY;

/**
 * The graduation year's width beside Major: four digits at the body size plus
 * the field's padding, rounded up to the grid (foundations §9).
 */
const YEAR_FIELD_WIDTH = 96;

/** A typed graduation year as a number, or null while it isn't one. */
function draftYear(typed: string): number | null {
  const year = typed.trim();
  return /^\d+$/.test(year) ? Number(year) : null;
}

/** Matches the web profile form's bio field, which draws three lines. */
const BIO_LINES = 3;

export const EditProfileSheet = forwardRef<
  BottomSheetModal,
  {
    profile: ViewerProfile | null;
    /** The field to bring into view and focus once the sheet is open. */
    openAt?: EditProfileField;
  }
>(function EditProfileSheet({ profile, openAt }, ref) {
  const closeSheet = useSheetClose(ref);
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const backgroundStyle = useSheetBackgroundStyle();
  const updateUser = useUpdateUser();
  const canViewMembers = can("members:view", usePermissionList());

  const original = useMemo(() => draftFromProfile(profile), [profile]);
  const [edits, setEdits] = useState<ProfileEdits | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [focused, setFocused] = useState<ProfileDraftField | null>(null);
  // The chapter's majors, offered under Major while it has focus (#5778), so
  // a member picks the spelling the chapter already pings. Read only then:
  // the sheet stays mounted under the You tab, and the groups read (which
  // needs `members:view`, as on web) is the whole chapter's. Once read it
  // stays cached for the next focus.
  const chapterMajors = useChapterMajors({
    enabled: canViewMembers && focused === "major",
  });
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
  // the year as typed or as stored, and the stored City and Company, so
  // clearing one doesn't hide the field mid-edit. The stored year counts
  // because the You tab draws the City and Company rows from it (#5280): a
  // year typed ahead and kept from a failed save must not leave those rows
  // opening a sheet without their fields. A year typed back hides nothing
  // until it is saved.
  const afterGraduation = [shown, original].some((draft) =>
    showsAfterGraduation({
      graduationYear: draftYear(draft.graduationYear),
      city: original.city,
      company: original.company,
    }),
  );
  const canSave = dirty && !updateUser.isPending;
  const birthdayVisibility = parseBirthdayVisibility(shown.birthdayVisibility);
  const birthdayTyped =
    shown.birthdayMonth.trim() !== "" && shown.birthdayDay.trim() !== "";

  // At most four, so the list under Major stays above the keyboard.
  const majorOptions = majorSuggestions(chapterMajors, shown.major, 4);

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

  // Opening at a field (#5280): where each field's block sits in the scroll
  // content (its top and bottom), the input to focus, the sheet's body and
  // content heights, how far the sheet has scrolled it, and where this visit
  // stands: been there yet, and waiting for the keyboard's shrink.
  const scrollRef = useRef<ComponentRef<typeof BottomSheetScrollView>>(null);
  const inputs = useRef(new Map<EditProfileField, TextInput>());
  const blocks = useRef(
    new Map<EditProfileField, { top: number; bottom: number }>(),
  );
  const viewport = useRef({ height: 0, content: 0 });
  const scrolled = useRef(0);
  const reachedOpenAt = useRef(false);
  const awaitingKeyboard = useRef(false);

  /** Records a block's place; the birthday's runs from its heading (`top`) to its row (`bottom`). */
  const anchor =
    (names: EditProfileField[], part: "block" | "top" | "bottom" = "block") =>
    (event: LayoutChangeEvent) => {
      const { y, height } = event.nativeEvent.layout;
      for (const name of names) {
        const block = blocks.current.get(name) ?? {
          top: y,
          bottom: y + height,
        };
        if (part !== "bottom") block.top = y;
        if (part !== "top") block.bottom = y + height;
        blocks.current.set(name, block);
      }
    };

  /** Scrolls the opened-at field into the top `share` of the body, if it isn't there. */
  const bringIntoView = (share: number) => {
    const block = openAt === undefined ? undefined : blocks.current.get(openAt);
    const { height, content } = viewport.current;
    if (block === undefined || height === 0) return;
    const margin = tokens.spacing.lg;
    const from = scrolled.current;
    if (
      block.top - margin >= from &&
      block.bottom + margin <= from + height * share
    ) {
      return;
    }
    // Just under the top edge, and never past the end of the content.
    const target = Math.min(
      Math.max(0, block.top - margin),
      Math.max(0, content - height),
    );
    if (target === from) return;
    scrolled.current = target;
    scrollRef.current?.scrollTo({ y: target, animated: true });
  };

  const goToOpenAt = (index: number) => {
    if (index < 0 || reachedOpenAt.current || openAt === undefined) return;
    reachedOpenAt.current = true;
    // Every row's field is drawn (`afterGraduation` above), so this holds
    // unless a caller asks for one the sheet has no input for.
    const input = inputs.current.get(openAt);
    if (input === undefined) return;
    bringIntoView(KEYBOARD_FREE);
    // A field is read-only while a save runs, so it takes no keyboard.
    if (updateUser.isPending) return;
    awaitingKeyboard.current = true;
    input.focus();
  };

  // However the sheet closes mid-save (Cancel, a swipe, the scrim), the edits
  // stay until the save settles: the PATCH is already sent, and a failure has
  // to reopen on what was typed.
  const closed = () => {
    markClosed();
    reachedOpenAt.current = false;
    awaitingKeyboard.current = false;
    scrolled.current = 0;
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
    name: EditProfileField,
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
      // A field sharing a row is placed by its row's `anchor`.
      onLayout={options.grow === undefined ? anchor([name]) : undefined}
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
        ref={(input: TextInput | null | undefined) => {
          if (input) inputs.current.set(name, input);
          else inputs.current.delete(name);
        }}
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
      onChange={goToOpenAt}
      onDismiss={closed}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        ref={scrollRef}
        onLayout={(event) => {
          viewport.current.height = event.nativeEvent.layout.height;
          // The keyboard the focus raised has shrunk the body: the field must
          // still be in view of what is left.
          if (awaitingKeyboard.current) {
            awaitingKeyboard.current = false;
            bringIntoView(1);
          }
        }}
        onContentSizeChange={(_width, height) => {
          viewport.current.content = height;
        }}
        onAccessibilityEscape={closeSheet}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <SheetHeader title="Edit profile" onCancel={cancel} />

        {field("displayName", copy.displayName.label, {
          placeholder: copy.displayName.placeholder,
          autoCapitalize: "words",
          maxLength: DISPLAY_NAME_MAX_LENGTH,
        })}
        {field("phone", copy.phone.label, {
          placeholder: copy.phone.placeholder,
          keyboardType: "phone-pad",
          textContentType: "telephoneNumber",
          maxLength: PHONE_MAX_LENGTH,
          hint: copy.phone.hint,
        })}
        <View style={styles.row} onLayout={anchor(["major", "graduationYear"])}>
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
        {/* The chapter's majors matching what is typed (#5778), as Mail's
            and Contacts' fields suggest under themselves: a tap takes its
            exact spelling, and typing on keeps a new one. */}
        {focused === "major" && majorOptions.length > 0 ? (
          <View
            accessibilityRole="list"
            accessibilityLabel={copy.major.suggestionsLabel}
          >
            <ListSection>
              {majorOptions.map((major) => (
                <ListRow
                  key={major}
                  label={major}
                  action
                  onPress={() => edit("major")(major)}
                />
              ))}
            </ListSection>
          </View>
        ) : null}
        {/* The birthday (#4959): month, day and an optional year as digits,
            then the switch that shares it with the chapter (#5282). */}
        <View
          style={styles.sectionHead}
          onLayout={anchor(BIRTHDAY_FIELDS, "top")}
        >
          <Text style={styles.sectionTitle}>{BIRTHDAY_COPY.label}</Text>
        </View>
        <View style={styles.row} onLayout={anchor(BIRTHDAY_FIELDS, "bottom")}>
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
        {/* Who sees the birthday (#5282): a switch that names what it
            shares, drawn once a month and day are typed, since it governs
            nothing without them. iOS Settings and Slack's profile share a
            field the same way: one switch, one line of who sees what. */}
        {birthdayTyped ? (
          <View style={styles.shareRow}>
            <View style={styles.shareText}>
              <Text style={styles.shareLabel}>
                {BIRTHDAY_COPY.visibilityLabel}
              </Text>
              <Text style={styles.hint}>
                {BIRTHDAY_COPY.visibilityHint[birthdayVisibility]}
              </Text>
            </View>
            <Toggle
              value={birthdayVisibility === "chapter"}
              onValueChange={(on) =>
                edit("birthdayVisibility")(on ? "chapter" : "nobody")
              }
              accessibilityLabel={BIRTHDAY_COPY.visibilityLabel}
              disabled={updateUser.isPending}
            />
          </View>
        ) : null}
        {field("bio", copy.bio.label, {
          placeholder: copy.bio.placeholder,
          multiline: true,
          autoCapitalize: "sentences",
          maxLength: USER_BIO_MAX_LENGTH,
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
              maxLength: USER_CITY_MAX_LENGTH,
            })}
            {field("company", copy.company.label, {
              placeholder: copy.company.placeholder,
              autoCapitalize: "words",
              maxLength: USER_COMPANY_MAX_LENGTH,
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
    // A switch row: the label and its line of who sees what, then the switch.
    shareRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    shareText: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    shareLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
  });
}
