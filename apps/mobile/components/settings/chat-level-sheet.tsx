import { forwardRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import {
  CHAT_CHAPTER_LEVEL_OPTIONS,
  type ChatChapterLevel,
} from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetClose,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import {
  useChapterBranding,
  type ChapterBranding,
} from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Settings → Chat messages, on the phone (#3840): the member's chapter-wide
 * chat level, "All messages" or "Mentions and DMs only". Slack's "Mentions &
 * DMs only" and Discord's "Only @mentions" are the same choice. A tap saves
 * and closes; the row behind shows the new level once the server has it.
 */
export const ChatLevelSheet = forwardRef<
  BottomSheetModal,
  {
    level: ChatChapterLevel | undefined;
    onPick: (level: ChatChapterLevel) => void;
  }
>(function ChatLevelSheet({ level, onPick }, ref) {
  const closeSheet = useSheetClose(ref);
  const backgroundStyle = useSheetBackgroundStyle();
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetView style={styles.body} onAccessibilityEscape={closeSheet}>
        <SheetHeader title="Chat messages" />
        <View accessibilityRole="radiogroup">
          {CHAT_CHAPTER_LEVEL_OPTIONS.map((option) => {
            const checked = option.level === level;
            return (
              <Pressable
                key={option.level}
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                accessibilityLabel={option.label}
                accessibilityHint={option.description}
                onPress={() => {
                  if (!checked) onPick(option.level);
                  closeSheet();
                }}
                style={styles.option}
              >
                <View style={styles.text}>
                  <Text
                    style={[styles.label, checked ? styles.labelChecked : null]}
                  >
                    {option.label}
                  </Text>
                  <Text style={styles.description}>{option.description}</Text>
                </View>
                {checked ? <CheckGlyph color={brand.accent} /> : null}
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.footnote}>
          A channel or DM you set yourself keeps its own setting.
        </Text>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: 44,
      paddingVertical: tokens.spacing.sm,
    },
    text: { flex: 1, gap: tokens.spacing.xs },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    labelChecked: { color: brand.accent },
    description: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    footnote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
