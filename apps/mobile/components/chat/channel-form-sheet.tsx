import { forwardRef, useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { DELETE_CHANNEL_LABEL } from "@repo/hooks";
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
import { Toggle } from "@/components/toggle";
import { successHaptic } from "@/lib/haptics";

/** The chip for "no category"; FilterChips keeps `null` for an "all" chip. */
const NO_CATEGORY = "__none__";

export interface ChannelFormCategory {
  id: string;
  name: string;
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
      };
    };

export interface ChannelFormValues {
  name: string;
  /** Trimmed; empty means none. */
  description: string;
  categoryId: string | null;
  /** Create only: a private channel's members are added by hand. */
  isPrivate: boolean;
}

/**
 * New channel and Edit channel, on the phone (#3838; Shawn, 2026-11-11: "I
 * should be able to create new channels directly on the channel list"). One
 * sheet for both, as web's Create a channel panel and a channel's settings
 * page ask the same questions: the name, a description, and the category.
 * A new channel can be private; its type is fixed after that, so Edit doesn't
 * ask.
 *
 * Who can see and who can post are not asked here. A new channel takes its
 * category's answers (the server copies them when the lists are left out), as
 * web's panel does until an officer changes them, and an existing channel's
 * lists are changed in Chat settings on the web, which says who each tier and
 * role is. The sheet says so in a line.
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
  }
>(function ChannelFormSheet({ mode, categories, onSubmit, onDelete }, ref) {
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
  const [focused, setFocused] = useState<"name" | "description" | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Set the moment Save is pressed, so a second tap in the same batch can't
  // create the channel twice.
  const sending = useRef(false);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !saving;
  const nameLocked = editing?.is_audit_log === true;

  const closed = useCallback(() => {
    markClosed();
    setFocused(null);
    setFailure(null);
  }, [markClosed]);

  const save = useCallback(() => {
    if (!canSave || sending.current) return;
    sending.current = true;
    setSaving(true);
    setFailure(null);
    const sentFrom = visit();
    void onSubmit({
      name: trimmed,
      description: description.trim(),
      categoryId: categoryId === NO_CATEGORY ? null : categoryId,
      isPrivate,
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
  }, [
    canSave,
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

        <Text style={styles.caption}>
          {editing
            ? "Who can see and post in it is changed in Chat settings on the web."
            : isPrivate
              ? "You can add people once it's created."
              : "Who can see and post follows its category. Change it in Chat settings on the web."}
        </Text>

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
