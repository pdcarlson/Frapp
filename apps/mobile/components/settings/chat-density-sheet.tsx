import { forwardRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import {
  CHAT_DENSITY_OPTIONS,
  type ChatDensity,
} from "@repo/chat-core/density";
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
import {
  useChapterBranding,
  type ChapterBranding,
} from "@/lib/chapter-branding";
import { setChatDensity, useChatDensity } from "@/lib/chat/chat-density";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Settings → Chat density, on the phone (`components.md` §11 § Density): three
 * cards, each a small drawing of the thread in that density, so the choice is
 * made by looking. A tap saves and closes; the thread redraws at once.
 */
export const ChatDensitySheet = forwardRef<BottomSheetModal>(
  function ChatDensitySheet(_props, ref) {
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
          <SheetHeader title="Chat density" />
          <ChatDensityOptions onPicked={closeSheet} />
          <Text style={styles.footnote}>Applies on this phone.</Text>
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);

/**
 * The three density cards, saved on the tap. Shared by the Settings sheet,
 * s03's display beat (#3787), where a new member picks their display while
 * setting up, and chapter setup's display step, where a founder does (#4056).
 */
export function ChatDensityOptions({ onPicked }: { onPicked?: () => void }) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  const density = useChatDensity();
  return (
    <View style={styles.options} accessibilityRole="radiogroup">
      {CHAT_DENSITY_OPTIONS.map((option) => {
        const checked = option.value === density;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked }}
            accessibilityLabel={option.label}
            accessibilityHint={option.description}
            onPress={() => {
              setChatDensity(option.value);
              onPicked?.();
            }}
            style={[styles.option, checked ? styles.optionChecked : null]}
          >
            <DensityPreview density={option.value} styles={styles} />
            <Text style={[styles.label, checked ? styles.labelChecked : null]}>
              {option.label}
            </Text>
            <Text style={styles.description}>{option.description}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Shapes, not words, so the drawing never shows a made-up member or message. */
const COZY_ROWS = [0.75, 0.5, 0.66];
const COMPACT_ROWS = [0.75, 0.5, 0.66, 0.6, 0.35, 0.5];
/** Bubbles: theirs on the left, yours on the right in the accent. */
const BUBBLE_ROWS = [
  { mine: false, width: 0.7 },
  { mine: false, width: 0.5 },
  { mine: true, width: 0.6 },
  { mine: true, width: 0.4 },
] as const;

function DensityPreview({
  density,
  styles,
}: {
  density: ChatDensity;
  styles: ReturnType<typeof createStyles>;
}) {
  if (density === "bubbles") {
    return (
      <View
        style={[styles.preview, styles.previewBubbles]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {BUBBLE_ROWS.map(({ mine, width }, index) => (
          <View
            key={index}
            style={[
              styles.bubbleBar,
              mine ? styles.bubbleBarMine : styles.bubbleBarTheirs,
              { width: `${width * 100}%` },
            ]}
          />
        ))}
      </View>
    );
  }
  const cozy = density === "cozy";
  return (
    <View
      style={[
        styles.preview,
        cozy ? styles.previewCozy : styles.previewCompact,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {(cozy ? COZY_ROWS : COMPACT_ROWS).map((width, index) =>
        cozy ? (
          <View key={index} style={styles.cozyRow}>
            <View style={styles.dot} />
            <View style={styles.cozyLines}>
              <View style={[styles.bar, styles.nameBar, { width: "40%" }]} />
              <View
                style={[
                  styles.bar,
                  styles.textBar,
                  { width: `${width * 100}%` },
                ]}
              />
            </View>
          </View>
        ) : (
          <View key={index} style={styles.compactRow}>
            <View style={[styles.bar, styles.timeBar]} />
            <View style={[styles.bar, styles.nameBar, styles.compactName]} />
            <View
              style={[styles.bar, styles.textBar, { width: `${width * 60}%` }]}
            />
          </View>
        ),
      )}
    </View>
  );
}

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    options: { flexDirection: "row", gap: tokens.spacing.md },
    option: {
      flex: 1,
      gap: tokens.spacing.xs,
      // Three cards share a 343pt row on the smallest phone.
      padding: tokens.spacing.sm,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    // The selected card takes the accent's quiet fill and border, the way a
    // selected chip does: it is a control the member switched on.
    optionChecked: {
      backgroundColor: brand.accentSubtle,
      borderColor: brand.accentBorder,
    },
    preview: {
      height: 88,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.sm,
      marginBottom: tokens.spacing.xs,
      borderRadius: tokens.radius.chipLarge,
      backgroundColor: tokens.color.surface.background,
      overflow: "hidden",
    },
    previewCozy: { gap: tokens.spacing.md },
    previewCompact: { gap: tokens.spacing.sm },
    previewBubbles: { gap: tokens.spacing.xs },
    bubbleBar: { height: 10, borderRadius: 5 },
    bubbleBarTheirs: {
      alignSelf: "flex-start",
      backgroundColor: tokens.color.surface.popover,
    },
    bubbleBarMine: {
      alignSelf: "flex-end",
      backgroundColor: brand.accentPrimary,
    },
    cozyRow: { flexDirection: "row", gap: tokens.spacing.sm },
    cozyLines: { flex: 1, gap: tokens.spacing.xs },
    compactRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    dot: {
      width: 14,
      height: 14,
      borderRadius: avatarRadius(14),
      backgroundColor: tokens.color.surface.popover,
    },
    bar: { height: tokens.spacing.xs, borderRadius: tokens.spacing.xs / 2 },
    timeBar: { width: 12, backgroundColor: tokens.color.border.hairline },
    nameBar: { backgroundColor: tokens.color.text.muted },
    compactName: { width: 24 },
    textBar: { backgroundColor: tokens.color.fill.neutral },
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
