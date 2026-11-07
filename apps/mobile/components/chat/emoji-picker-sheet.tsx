import { forwardRef, useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { SectionHeader } from "@/components/list-section";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  EMOJI_COLUMNS,
  emojiKey,
  emojiPickerRows,
  type EmojiPickerRow,
} from "@/lib/chat/emoji-search";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Every emoji, for a reaction the quick row doesn't have: the long-press
 * menu's last reaction cell opens it, as Discord's and Slack's do. A search
 * field over the emoji grouped the way the system keyboard groups them. The
 * names are emojibase's, as on web's picker (`frimousse`); this one stops at
 * Emoji 14 (`scripts/generate-emoji-data.mjs`), which web does not.
 *
 * It replaces the menu (`stackBehavior="replace"`), so closing it returns to
 * the thread. Picking closes it; the chip under the message confirms.
 *
 * An emoji the viewer has already reacted with is drawn selected and takes
 * the reaction back off, the same toggle the quick row and the chips have.
 */
export interface EmojiPickerSheetProps {
  /** The viewer's reactions on the message, drawn selected. */
  selected: readonly string[];
  onPick: (emoji: string, mine: boolean) => void;
  /** Cleared on close so the next open starts on the full list. */
  onDismiss?: () => void;
}

export const EmojiPickerSheet = forwardRef<
  BottomSheetModal,
  EmojiPickerSheetProps
>(function EmojiPickerSheet({ selected, onPick, onDismiss }, ref) {
  const { tokens } = useFrappTheme();
  const { accent, accentSubtle } = useChapterBranding();
  const styles = useMemo(() => createStyles(tokens, accent), [tokens, accent]);
  const backgroundStyle = useSheetBackgroundStyle();
  const tallSheet = useTallSheetProps();
  const close = useSheetClose(ref);
  const [search, setSearch] = useState("");
  const rows = useMemo(() => emojiPickerRows(search), [search]);
  const mine = useMemo(() => new Set(selected.map(emojiKey)), [selected]);

  const renderItem = useCallback(
    ({ item }: { item: EmojiPickerRow }) => {
      if (item.kind === "heading") {
        return <SectionHeader>{item.name}</SectionHeader>;
      }
      return (
        <View style={styles.line}>
          {item.emojis.map((emoji) => {
            const isMine = mine.has(emojiKey(emoji));
            return (
              <Pressable
                key={emoji}
                accessibilityRole="button"
                accessibilityLabel={
                  isMine ? `Remove ${emoji} reaction` : `React with ${emoji}`
                }
                accessibilityState={{ selected: isMine }}
                onPress={() => onPick(emoji, isMine)}
                style={({ pressed }) => [
                  styles.cell,
                  isMine ? { backgroundColor: accentSubtle } : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={styles.emoji}>{emoji}</Text>
              </Pressable>
            );
          })}
          {/* Pad a short last line so its cells keep the grid's width. */}
          {Array.from(
            { length: EMOJI_COLUMNS - item.emojis.length },
            (_, i) => (
              <View key={`pad-${i}`} style={styles.cell} />
            ),
          )}
        </View>
      );
    },
    [accentSubtle, mine, onPick, styles],
  );

  return (
    <BottomSheetModal
      ref={ref}
      {...tallSheet}
      stackBehavior="replace"
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={() => {
        setSearch("");
        onDismiss?.();
      }}
    >
      <SheetBackToClose onClose={close} />
      <BottomSheetFlatList
        onAccessibilityEscape={close}
        data={rows}
        keyExtractor={(row: EmojiPickerRow) => row.key}
        renderItem={renderItem}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        stickyHeaderIndices={[0]}
        initialNumToRender={12}
        windowSize={7}
        ListHeaderComponent={
          <View style={styles.header}>
            {/* `BottomSheetTextInput`, not `SearchField`: a plain input breaks
                the sheet's keyboard handling (`patterns.md`). */}
            <BottomSheetTextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search emoji"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Search emoji"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.field}
            />
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>No emoji match that search.</Text>
        }
      />
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    content: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
    },
    header: {
      paddingBottom: tokens.spacing.sm,
      // Sticky, so it paints the sheet's own fill over the rows passing under.
      backgroundColor: tokens.color.surface.popover,
    },
    field: fieldStyles.field,
    line: {
      flexDirection: "row",
    },
    cell: {
      flex: 1,
      height: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radius.control,
    },
    emoji: {
      ...typeRole(tokens.typography.role.title),
    },
    pressed: {
      opacity: 0.6,
    },
    empty: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      paddingVertical: tokens.spacing.md,
    },
  });
}
