import { forwardRef, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import {
  type ChannelAccessOption,
  type ChannelAccessQuestion,
} from "@repo/hooks/channel-access";
import { normalizeWords } from "@repo/hooks/fuzzy-match";
import { normalizeChannelAccessList } from "@repo/validation";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  TallSheetHeader,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { Segmented } from "@/components/segmented";
import {
  channelAccessRows,
  channelAccessSummaryLine,
  peopleCount,
  type ChannelAccessRow as Row,
} from "@/lib/chat/channel-access-rows";
import { CheckGlyph } from "@/components/tasks/task-glyphs";

/** A search shows once the chapter has more tiers and roles than fit a screen. */
export const CHANNEL_ACCESS_SEARCH_FROM = 8;

export const CHANNEL_ACCESS_TITLE: Record<ChannelAccessQuestion, string> = {
  see: "Who can see",
  post: "Who can post",
};

type Mode = "everyone" | "chosen";

const MODE_OPTIONS: readonly { value: Mode; label: string }[] = [
  { value: "everyone", label: "Everyone" },
  { value: "chosen", label: "Chosen roles" },
];

export interface ChannelAccessSheetProps {
  question: ChannelAccessQuestion;
  /** `null` is everyone; a list names tiers and roles. */
  value: readonly string[] | null;
  onChange: (next: string[] | null) => void;
  options: readonly ChannelAccessOption[];
  optionsState: "ready" | "loading" | "error";
}

/**
 * Who can see a channel, or who can post in it (#3702), on the phone: a tall
 * step stacked over the Edit channel or New channel sheet, as Who's coming
 * stacks over New event. Same two answers as web's Chat settings
 * (`channel-access-field.tsx`): Everyone, or chosen tiers and roles.
 *
 * Chosen is a checklist rather than web's chips and Add menu: on a phone a
 * tick in a list is one tap and shows every answer in place, as iOS Settings'
 * pickers and Discord's mobile channel permissions (a role list to tick) do.
 * Built for real scale (an imported Discord server brings a hundred roles):
 * virtualized, searchable past {@link CHANNEL_ACCESS_SEARCH_FROM} entries,
 * and each row says how many people it reaches. The line under the switch
 * holds two lines whatever it says, so ticking never moves a row (P4).
 *
 * Controlled, and nothing is saved here: Done goes back to the form, which
 * saves with its own Save.
 */
export const ChannelAccessSheet = forwardRef<
  BottomSheetModal,
  ChannelAccessSheetProps
>(function ChannelAccessSheet(props, ref) {
  const backgroundStyle = useSheetBackgroundStyle();
  const tall = useTallSheetProps();
  const close = useSheetClose(ref);
  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...tall}
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
    >
      <SheetBackToClose onClose={close} />
      {/* gorhom mounts a modal's children only while it is presented, so the
          search and the row order start fresh each visit. */}
      <ChannelAccessBody {...props} onDone={close} />
    </BottomSheetModal>
  );
});

function ChannelAccessBody({
  question,
  value,
  onChange,
  options,
  optionsState,
  onDone,
}: ChannelAccessSheetProps & { onDone: () => void }) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand.accent);
  const [search, setSearch] = useState("");
  // What was on the list as the sheet opened leads it for this visit; taken
  // once, so a tick never moves a row out from under a finger.
  const [pinned] = useState(() => new Set(value ?? []));
  const chosen = useMemo(() => new Set(value ?? []), [value]);
  const mode: Mode = value === null ? "everyone" : "chosen";
  const title = CHANNEL_ACCESS_TITLE[question];
  const rows = useMemo(
    () => (mode === "chosen" ? channelAccessRows(options, pinned, search) : []),
    [mode, options, pinned, search],
  );
  const searchable =
    mode === "chosen" &&
    options.filter((option) => !option.hidden).length >
      CHANNEL_ACCESS_SEARCH_FROM;

  function toggle(entry: string) {
    const current = value ?? [];
    onChange(
      current.includes(entry)
        ? current.filter((held) => held !== entry)
        : (normalizeChannelAccessList([...current, entry]) ?? []),
    );
  }

  const header = (
    <View style={styles.header}>
      <TallSheetHeader
        title={title}
        onClose={onDone}
        doneAccent={brand.accent}
      />
      <Segmented
        options={MODE_OPTIONS}
        value={mode}
        onChange={(next: Mode) => onChange(next === "everyone" ? null : [])}
        accessibilityLabel={title}
      />
      <Text
        style={styles.summary}
        numberOfLines={2}
        accessibilityLiveRegion="polite"
      >
        {channelAccessSummaryLine(
          question,
          value,
          options,
          optionsState === "ready",
        )}
      </Text>
      {searchable ? (
        // `BottomSheetTextInput`, not `SearchField`: a plain input breaks the
        // sheet's keyboard handling (`patterns.md`).
        <BottomSheetTextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Find a tier or role"
          placeholderTextColor={tokens.color.text.muted}
          accessibilityLabel="Find a tier or role"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.field}
        />
      ) : null}
    </View>
  );

  return (
    <BottomSheetFlatList
      onAccessibilityEscape={onDone}
      data={rows}
      keyExtractor={(row: Row) => row.key}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      ListHeaderComponent={header}
      stickyHeaderIndices={[0]}
      ListEmptyComponent={
        mode === "everyone" ? null : (
          <Text style={styles.empty}>
            {optionsState === "loading"
              ? "Loading tiers and roles…"
              : optionsState === "error"
                ? "Couldn't load your chapter's tiers and roles."
                : normalizeWords(search).length > 0
                  ? `Nothing matches “${search.trim()}”.`
                  : "Your chapter has no tiers or roles yet."}
          </Text>
        )
      }
      renderItem={({ item }: { item: Row }) => {
        if (item.kind === "heading") {
          return (
            <Text accessibilityRole="header" style={styles.heading}>
              {item.label}
            </Text>
          );
        }
        const { option } = item;
        const on = chosen.has(option.entry);
        const reach = peopleCount(option.user_ids.length);
        return (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={`${option.name}, ${reach}`}
            accessibilityState={{ checked: on }}
            onPress={() => toggle(option.entry)}
            style={({ pressed }) => [
              styles.row,
              pressed ? styles.rowPressed : null,
            ]}
          >
            {option.kind === "tier" ? (
              <View style={styles.tierMark} />
            ) : (
              <View
                style={[
                  styles.dot,
                  option.color ? { backgroundColor: option.color } : null,
                ]}
              />
            )}
            <Text style={styles.name} numberOfLines={1}>
              {option.name}
            </Text>
            <Text style={styles.reach} numberOfLines={1}>
              {reach}
            </Text>
            {/* A fixed slot, so names and counts line up whichever rows are on. */}
            <View
              style={styles.check}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {on ? <CheckGlyph color={brand.accent} size={16} /> : null}
            </View>
          </Pressable>
        );
      }}
    />
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
  const markSize = 10;
  const bodyLine =
    tokens.typography.role.body.lineHeight ??
    tokens.typography.role.body.size * 1.5;
  return StyleSheet.create({
    content: {
      paddingBottom: tokens.spacing.xl,
    },
    header: {
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.sm,
      // Sticky: rows scroll under it, so it is painted.
      backgroundColor: tokens.color.surface.popover,
    },
    summary: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      // Two lines held, so a longer line never pushes the rows down (P4).
      minHeight: 2 * bodyLine,
    },
    field: fieldStyles.field,
    empty: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm,
    },
    heading: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.md,
      paddingBottom: tokens.spacing.xs,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    rowPressed: {
      opacity: 0.6,
    },
    // A tier holds roles, so it draws as a ring; a role as its color dot.
    tierMark: {
      width: markSize,
      height: markSize,
      borderRadius: 3,
      borderWidth: 1.5,
      borderColor: tokens.color.text.mutedForeground,
    },
    dot: {
      width: markSize,
      height: markSize,
      borderRadius: markSize / 2,
      backgroundColor: tokens.color.border.hairline,
    },
    name: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    reach: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    check: {
      width: 16,
      alignItems: "center",
    },
  });
}
