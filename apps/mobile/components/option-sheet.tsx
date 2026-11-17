import { forwardRef, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import { CheckGlyph } from "@/components/control-glyphs";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetScrim,
  SHEET_STACK_BEHAVIOR,
  useSheetBackgroundStyle,
  useSheetClose,
} from "@/components/sheet-scaffold";
import { BottomSheetScrollView } from "@/lib/sheet-scrollables";

export interface SheetOption {
  /** What `onSelect` receives; `null` is the "any" choice. */
  value: string | null;
  label: string;
  /** A small glyph before the label (a pin, a star). */
  mark?: ReactNode;
  /**
   * A second line under the label, in the caption role (#5318): the study
   * zone picker's "You're here · 1 pt / hour". A row with one sets its label
   * in the label role, so the two lines read as a title and its detail.
   */
  detail?: ReactNode;
  /** What a screen reader hears for the row; the label when absent. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/**
 * Past this many rows the sheet stops growing and scrolls, at a fixed detent
 * with the sheet-aware list inside: one sheet cannot be both
 * (`spec/ui/mobile/patterns.md` § Bottom sheets). Six, so six two-line rows
 * still fit a small phone; the study zone picker's own copy of this switch
 * opened cut off on 2026-11-12 when it passed a fixed detent with dynamic
 * sizing left on. One threshold for every pick-one sheet (#5318).
 */
export const MAX_ROWS_SIZED_TO_CONTENT = 6;
const LONG_LIST_SNAP_POINTS = ["70%"];

/**
 * One pick from a short list, in a sheet sized to it (#5278): a titled list
 * of rows with a check on the current one, applied and closed on the tap.
 * Google Drive's Type, People and Modified chips and its sort control open
 * this same sheet on a phone, as Files' and Dropbox's sort menus do: the
 * choice is one tap from the screen and one more in the sheet, never a row
 * of chips to scroll.
 */
export const OptionSheet = forwardRef<
  BottomSheetModal,
  {
    title: string;
    options: readonly SheetOption[];
    selected: string | null;
    /** The pick. The sheet closes itself after it, so the host doesn't dismiss. */
    onSelect: (value: string | null) => void;
    /** The sheet closed, however it closed. */
    onDismiss?: () => void;
  }
>(function OptionSheet({ title, options, selected, onSelect, onDismiss }, ref) {
  const closeSheet = useSheetClose(ref);
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const insets = useSafeAreaInsets();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const fits = options.length <= MAX_ROWS_SIZED_TO_CONTENT;
  const bottomPad = { paddingBottom: insets.bottom + tokens.spacing.md };

  const rows = options.map((option, index) => {
    const on = option.value === selected;
    return (
      <Pressable
        key={option.value ?? "any"}
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        accessibilityLabel={option.accessibilityLabel ?? option.label}
        accessibilityHint={option.accessibilityHint}
        onPress={() => {
          onSelect(option.value);
          closeSheet();
        }}
        style={({ pressed }) => [
          styles.row,
          index === options.length - 1 ? styles.rowLast : null,
          pressed ? styles.rowPressed : null,
        ]}
      >
        {option.mark ? <View style={styles.mark}>{option.mark}</View> : null}
        {option.detail ? (
          <View style={styles.twoLine}>
            <Text numberOfLines={1} style={styles.title}>
              {option.label}
            </Text>
            <Text style={styles.detail}>{option.detail}</Text>
          </View>
        ) : (
          <Text
            numberOfLines={1}
            style={[styles.label, on ? styles.labelOn : null]}
          >
            {option.label}
          </Text>
        )}
        {on ? <CheckGlyph color={accent} size={20} /> : null}
      </Pressable>
    );
  });

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...(fits
        ? { enableDynamicSizing: true }
        : { enableDynamicSizing: false, snapPoints: LONG_LIST_SNAP_POINTS })}
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={onDismiss}
    >
      <SheetBackToClose onClose={closeSheet} />
      {fits ? (
        <BottomSheetView
          accessibilityRole="radiogroup"
          onAccessibilityEscape={closeSheet}
          style={[styles.body, bottomPad]}
        >
          <SheetHeader title={title} />
          {rows}
        </BottomSheetView>
      ) : (
        <BottomSheetScrollView
          accessibilityRole="radiogroup"
          onAccessibilityEscape={closeSheet}
          contentContainerStyle={[styles.body, bottomPad]}
        >
          <SheetHeader title={title} />
          {rows}
        </BottomSheetScrollView>
      )}
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      paddingVertical: tokens.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    rowLast: {
      borderBottomWidth: 0,
    },
    rowPressed: {
      opacity: 0.7,
    },
    mark: {
      width: 16,
      alignItems: "center",
    },
    label: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    labelOn: {
      ...typeRole(tokens.typography.role.label),
    },
    twoLine: {
      flex: 1,
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    detail: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      marginTop: 2,
    },
  });
}
