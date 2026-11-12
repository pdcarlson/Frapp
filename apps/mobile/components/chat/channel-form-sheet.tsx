import { forwardRef, useCallback, useRef, useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { DELETE_CHANNEL_LABEL } from "@repo/hooks";
import {
  describeChannelAccess,
  isEmptyChannelAccessChoice,
  matchesCategoryAccess,
  type ChannelAccessOption,
  type ChannelAccessQuestion,
} from "@repo/hooks/channel-access";
import { sameChannelAccessList } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  useChapterBranding,
  type ChapterBranding,
} from "@/lib/chapter-branding";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  SHEET_STACK_BEHAVIOR,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useSheetVisit,
} from "@/components/sheet-scaffold";
import { FilterChips } from "@/components/filter-chips";
import { DisclosureGlyph } from "@/components/control-glyphs";
import {
  CHANNEL_ACCESS_TITLE,
  ChannelAccessSheet,
} from "@/components/chat/channel-access-sheet";
import { Toggle } from "@/components/toggle";
import { successHaptic } from "@/lib/haptics";

/** The chip for "no category"; FilterChips keeps `null` for an "all" chip. */
const NO_CATEGORY = "__none__";

export interface ChannelFormCategory {
  id: string;
  name: string;
  /** The category's answers, which a new channel in it starts with. */
  who_can_see?: string[] | null;
  who_can_post?: string[] | null;
}

/** What the sheet is for: a new channel in a category, or one channel's edit. */
export type ChannelFormMode =
  | { kind: "create"; categoryId: string | null }
  | {
      kind: "edit";
      channel: {
        id: string;
        name: string;
        description?: string | null;
        category_id: string | null;
        /** `#chapter-audit`: the server refuses a rename (#3909). */
        is_audit_log?: boolean;
        type?: string;
        /** Absent when the list didn't say; then the sheet doesn't ask. */
        who_can_see?: string[] | null;
        who_can_post?: string[] | null;
      };
    };

export interface ChannelFormValues {
  name: string;
  /** Trimmed; empty means none. */
  description: string;
  categoryId: string | null;
  /** Create only: a private channel's members are added by hand. */
  isPrivate: boolean;
  /**
   * Who can see and who can post, as the request sends them: only a list
   * the officer changed (a save of the name must not write back lists the
   * category, or another officer, just moved), or `match_category_access`.
   * Empty when nothing about access changed.
   */
  access: {
    who_can_see?: string[] | null;
    who_can_post?: string[] | null;
    match_category_access?: true;
  };
}

/** The two answers a draft holds. */
interface AccessDraft {
  see: string[] | null;
  post: string[] | null;
}

const ACCESS_INCOMPLETE =
  "Add a tier or role to each chosen list, or pick Everyone.";

/**
 * New channel and Edit channel, on the phone (#3838; Shawn, 2026-11-11: "I
 * should be able to create new channels directly on the channel list"). One
 * sheet for both, as web's Create a channel panel and a channel's settings
 * page ask the same questions: the name, a description, and the category.
 * A new channel can be private; its type is fixed after that, so Edit doesn't
 * ask.
 *
 * Who can see and who can post (#3702): two rows, each opening a tall step
 * (`channel-access-sheet.tsx`) with web's two answers, Everyone or chosen
 * tiers and roles. A new channel starts with its category's answers and
 * follows a change of category until the officer changes one, as web's
 * Create a channel panel does. An existing channel says whether it matches
 * its category, and offers Match <category> when it doesn't, as Chat
 * settings does. A private channel, a DM's sort, carries no lists.
 *
 * Edit ends with Delete channel, which hands off to the typed-name sheet.
 * The host mounts a new sheet per channel or category (`key`), so a draft
 * never carries from one to another.
 */
export const ChannelFormSheet = forwardRef<
  BottomSheetModal,
  {
    mode: ChannelFormMode;
    categories: readonly ChannelFormCategory[];
    /** Saves; rejects with the line to show when the server refuses. */
    onSubmit: (values: ChannelFormValues) => Promise<void>;
    /** Edit only: opens the typed-name delete sheet. */
    onDelete?: () => void;
    /** What the lists can name: `GET /v1/channels/access-options`. */
    accessOptions: readonly ChannelAccessOption[];
    accessOptionsState: "ready" | "loading" | "error";
  }
>(function ChannelFormSheet(
  { mode, categories, onSubmit, onDelete, accessOptions, accessOptionsState },
  ref,
) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  const backgroundStyle = useSheetBackgroundStyle();
  const closeSheet = useSheetClose(ref);
  const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
    useSheetVisit(ref);

  const editing = mode.kind === "edit" ? mode.channel : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [categoryId, setCategoryId] = useState<string>(
    (mode.kind === "edit" ? mode.channel.category_id : mode.categoryId) ??
      NO_CATEGORY,
  );
  const [isPrivate, setIsPrivate] = useState(false);

  // Who can see and post. Edit starts from the channel's lists; create from
  // its category's, and follows the category until the officer changes one.
  const categoryOf = (id: string) =>
    id === NO_CATEGORY
      ? null
      : (categories.find((category) => category.id === id) ?? null);
  const [seed] = useState<AccessDraft>(() => {
    if (editing) {
      return {
        see: editing.who_can_see ?? null,
        post: editing.who_can_post ?? null,
      };
    }
    const category =
      mode.kind === "create" && mode.categoryId
        ? (categories.find((c) => c.id === mode.categoryId) ?? null)
        : null;
    return {
      see: category?.who_can_see ?? null,
      post: category?.who_can_post ?? null,
    };
  });
  const [access, setAccess] = useState<AccessDraft>(seed);
  const [accessTouched, setAccessTouched] = useState(false);
  // Match <category> pressed: the save asks the server to copy the lists.
  const [matchAsked, setMatchAsked] = useState(false);
  const [question, setQuestion] = useState<ChannelAccessQuestion>("see");
  const accessSheetRef = useRef<BottomSheetModal>(null);
  const [focused, setFocused] = useState<"name" | "description" | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Set the moment Save is pressed, so a second tap in the same batch can't
  // create the channel twice.
  const sending = useRef(false);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !saving;
  const nameLocked = editing?.is_audit_log === true;

  /** Whether the sheet asks who can see and post at all. */
  const takesLists = editing
    ? editing.is_audit_log !== true &&
      (editing.type === "PUBLIC" || editing.type === "ROLE_GATED") &&
      editing.who_can_see !== undefined
    : !isPrivate;
  const draftCategory = categoryOf(categoryId);
  const seeChanged = !sameChannelAccessList(access.see, seed.see);
  const postChanged = !sameChannelAccessList(access.post, seed.post);
  const matches =
    matchAsked || matchesCategoryAccess(access.see, access.post, draftCategory);
  // Only a list the officer changed must name someone: an empty list the
  // channel already had doesn't block saving its name (as on web).
  const accessIncomplete =
    takesLists &&
    (((editing ? seeChanged : true) &&
      isEmptyChannelAccessChoice(access.see)) ||
      ((editing ? postChanged : true) &&
        isEmptyChannelAccessChoice(access.post)));

  function accessBody(): ChannelFormValues["access"] {
    if (!takesLists) return {};
    if (editing) {
      if (matchAsked && draftCategory) return { match_category_access: true };
      return {
        ...(seeChanged ? { who_can_see: access.see } : {}),
        ...(postChanged ? { who_can_post: access.post } : {}),
      };
    }
    // Left out, a new channel copies its category's lists on the server.
    return accessTouched
      ? { who_can_see: access.see, who_can_post: access.post }
      : {};
  }

  function changeAccess(next: string[] | null) {
    setAccess((current) =>
      question === "see"
        ? { ...current, see: next }
        : { ...current, post: next },
    );
    setAccessTouched(true);
    setMatchAsked(false);
    setFailure(null);
  }

  function openAccess(which: ChannelAccessQuestion) {
    Keyboard.dismiss();
    setQuestion(which);
    accessSheetRef.current?.present?.();
  }

  const closed = useCallback(() => {
    markClosed();
    setFocused(null);
    setFailure(null);
  }, [markClosed]);

  const save = useCallback(() => {
    if (!canSave || sending.current) return;
    if (accessIncomplete) {
      setFailure(ACCESS_INCOMPLETE);
      return;
    }
    sending.current = true;
    setSaving(true);
    setFailure(null);
    const sentFrom = visit();
    void onSubmit({
      name: trimmed,
      description: description.trim(),
      categoryId: categoryId === NO_CATEGORY ? null : categoryId,
      isPrivate,
      access: accessBody(),
    })
      .then(() => {
        successHaptic();
        if (isSameVisit(sentFrom)) dismiss();
      })
      .catch((error: unknown) => {
        if (!isSameVisit(sentFrom)) return;
        setFailure(
          error instanceof Error && error.message
            ? error.message
            : editing
              ? "Couldn't save the channel. Try again."
              : "Couldn't create the channel. Try again.",
        );
      })
      .finally(() => {
        sending.current = false;
        setSaving(false);
      });
    // `accessBody` reads this render's draft, which the deps below cover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canSave,
    accessIncomplete,
    access,
    accessTouched,
    matchAsked,
    visit,
    onSubmit,
    trimmed,
    description,
    categoryId,
    isPrivate,
    isSameVisit,
    dismiss,
    editing,
  ]);

  const chips = [
    { value: NO_CATEGORY, label: "No category" },
    ...categories.map((category) => ({
      value: category.id,
      label: category.name,
    })),
  ];

  return (
    <>
      <BottomSheetModal
        ref={ref}
        stackBehavior={SHEET_STACK_BEHAVIOR}
        enableDynamicSizing
        keyboardBehavior="interactive"
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onAnimate={onAnimate}
        onDismiss={closed}
      >
        <SheetBackToClose onClose={closeSheet} />
        <BottomSheetScrollView
          onAccessibilityEscape={closeSheet}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          <SheetHeader
            title={editing ? "Edit channel" : "New channel"}
            onCancel={closeSheet}
            cancelDisabled={saving}
          />

          <Text style={styles.groupLabel}>Name</Text>
          <View
            style={[styles.ring, focused === "name" ? styles.ringActive : null]}
          >
            <BottomSheetTextInput
              value={name}
              onChangeText={(next) => {
                setName(next);
                setFailure(null);
              }}
              onFocus={() => setFocused("name")}
              onBlur={() => setFocused(null)}
              editable={!saving && !nameLocked}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="announcements"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Channel name"
              maxLength={80}
              style={[
                styles.field,
                focused === "name" ? styles.fieldFocused : null,
              ]}
            />
          </View>
          {nameLocked ? (
            <Text style={styles.caption}>
              Frapp names the audit log, so it can&apos;t be renamed.
            </Text>
          ) : null}

          <Text style={styles.groupLabel}>Description</Text>
          <View
            style={[
              styles.ring,
              focused === "description" ? styles.ringActive : null,
            ]}
          >
            <BottomSheetTextInput
              value={description}
              onChangeText={(next) => {
                setDescription(next);
                setFailure(null);
              }}
              onFocus={() => setFocused("description")}
              onBlur={() => setFocused(null)}
              editable={!saving}
              placeholder="What it's for"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Channel description"
              multiline
              maxLength={500}
              style={[
                styles.field,
                styles.fieldMultiline,
                focused === "description" ? styles.fieldFocused : null,
              ]}
            />
          </View>

          <Text style={styles.groupLabel}>Category</Text>
          <FilterChips
            accessibilityLabel="Category"
            chips={chips}
            selected={categoryId}
            onSelect={(value) => {
              if (saving || value === null) return;
              setCategoryId(value);
              // A new channel follows its category until a list is changed,
              // and Match follows the category the channel ends up in (the
              // server copies from that one).
              const category = categoryOf(value);
              if (matchAsked && !category) {
                // Nothing to match without a category: back to its own lists.
                setMatchAsked(false);
                setAccess(seed);
              } else if ((!editing && !accessTouched) || matchAsked) {
                setAccess({
                  see: category?.who_can_see ?? null,
                  post: category?.who_can_post ?? null,
                });
              }
            }}
          />

          {editing ? null : (
            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>Private channel</Text>
                <Text style={styles.caption}>
                  Only people you add can see it, starting with you. This
                  can&apos;t be changed later.
                </Text>
              </View>
              <Toggle
                value={isPrivate}
                onValueChange={setIsPrivate}
                accessibilityLabel="Private channel"
              />
            </View>
          )}

          {takesLists ? (
            <>
              <Text style={styles.groupLabel}>Who can see and post</Text>
              <View style={styles.group}>
                {(["see", "post"] as const).map((which, index) => {
                  const list = which === "see" ? access.see : access.post;
                  const valueText = describeChannelAccess(
                    list,
                    which,
                    accessOptions,
                  );
                  return (
                    <View key={which}>
                      {index > 0 ? <View style={styles.groupDivider} /> : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${CHANNEL_ACCESS_TITLE[which]}: ${valueText}`}
                        accessibilityState={{ disabled: saving }}
                        disabled={saving}
                        onPress={() => openAccess(which)}
                        style={styles.optionRow}
                      >
                        <Text style={styles.optionLabel}>
                          {CHANNEL_ACCESS_TITLE[which]}
                        </Text>
                        <Text style={styles.optionValue} numberOfLines={1}>
                          {valueText}
                        </Text>
                        <DisclosureGlyph
                          color={tokens.color.text.muted}
                          size={16}
                          direction="right"
                        />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
              {draftCategory ? (
                matches ? (
                  <Text style={styles.caption}>
                    {editing
                      ? `Matches ${draftCategory.name}. Changes to it reach this channel too.`
                      : `Same as ${draftCategory.name}.`}
                  </Text>
                ) : editing ? (
                  <View style={styles.matchRow}>
                    <Text style={[styles.caption, styles.matchText]}>
                      Custom. {draftCategory.name} is set differently.
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      disabled={saving}
                      hitSlop={8}
                      onPress={() => {
                        setAccess({
                          see: draftCategory.who_can_see ?? null,
                          post: draftCategory.who_can_post ?? null,
                        });
                        setMatchAsked(true);
                        setFailure(null);
                      }}
                    >
                      <Text style={styles.matchLabel}>
                        Match {draftCategory.name}
                      </Text>
                    </Pressable>
                  </View>
                ) : null
              ) : null}
            </>
          ) : (
            <Text style={styles.caption}>
              {editing
                ? editing.is_audit_log
                  ? "Frapp writes the audit log, and officers read it."
                  : "Private. Only the people added to it can see it and post."
                : "You can add people once it's created."}
            </Text>
          )}

          {failure ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {failure}
            </Text>
          ) : null}

          <SheetPrimaryButton
            label={editing ? "Save" : "Create channel"}
            onPress={save}
            disabled={!canSave}
            busy={saving}
            accessibilityHint={trimmed ? undefined : "Give the channel a name."}
            accent={brand.accent}
            onAccent={tokens.color.gold.onHouse}
          />

          {editing && onDelete && !editing.is_audit_log ? (
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={onDelete}
              hitSlop={8}
              style={styles.deleteRow}
            >
              <Text style={styles.deleteLabel}>{DELETE_CHANNEL_LABEL}</Text>
            </Pressable>
          ) : null}
        </BottomSheetScrollView>
      </BottomSheetModal>
      {/* A sibling, as Who's coming is to New event: it stacks over this
        sheet (`SHEET_STACK_BEHAVIOR`), which stays presented under it. */}
      {takesLists ? (
        <ChannelAccessSheet
          ref={accessSheetRef}
          question={question}
          value={question === "see" ? access.see : access.post}
          onChange={changeAccess}
          options={accessOptions}
          optionsState={accessOptionsState}
        />
      ) : null}
    </>
  );
});

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  const fieldStyles = sheetFieldStyles(tokens, brand.accent);
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.sm,
    },
    ring: fieldStyles.ring,
    ringActive: fieldStyles.ringActive,
    field: fieldStyles.field,
    fieldMultiline: { ...fieldStyles.fieldMultilineText, minHeight: 72 },
    fieldFocused: fieldStyles.fieldFocused,
    groupLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.xs,
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      marginTop: tokens.spacing.xs,
    },
    toggleText: { flexShrink: 1, gap: tokens.spacing.xs },
    toggleLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    group: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
    },
    groupDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tokens.color.border.hairline,
    },
    optionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum + tokens.spacing.xs,
    },
    optionLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    optionValue: {
      flex: 1,
      textAlign: "right",
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    matchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    matchText: { flex: 1 },
    matchLabel: {
      ...typeRole(tokens.typography.role.label),
      color: brand.accent,
    },
    deleteRow: {
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    deleteLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.semantic.destructiveText,
    },
  });
}
