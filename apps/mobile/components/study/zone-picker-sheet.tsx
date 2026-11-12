import { forwardRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  SheetGrabber,
  SheetHeader,
  SheetScrim,
  useSheetBackgroundStyle,
  SheetBackToClose,
  useSheetClose,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import type { StudyZoneModel } from "@/lib/study/zones";
import { zoneRewardCopy } from "@/lib/study/zones";
import {
  proximityCopy,
  sortByProximity,
  type ProximityMap,
} from "@/lib/study/proximity";

/**
 * Zone picker for s10.
 *
 * **Sized to its rows.** A chapter has a handful of zones, so the sheet snaps to
 * content height (`enableDynamicSizing` over a plain `BottomSheetView`). It
 * used to pass a fixed `["55%"]` with gorhom v5's dynamic sizing left on by
 * default, which adds a content-height detent measured before the list lays
 * out: the sheet opened at the height of its title and cut the zones off below
 * the screen edge (Paul's screenshot, 2026-11-12).
 *
 * A chapter with more zones than fit comfortably gets a fixed detent with the
 * sheet-aware list as a direct child instead, because one sheet cannot be
 * both (`spec/ui/mobile/patterns.md` § Bottom sheets).
 *
 * **Nearest first, with how far.** With a location fix the rows sort by
 * distance and each says "You're here" or how far away it is, the way a store
 * picker lists the closest location first. Without one they stay alphabetical
 * and say only what the zone pays.
 */
const MAX_ROWS_SIZED_TO_CONTENT = 6;
const LONG_LIST_SNAP_POINTS = ["70%"];

export interface ZonePickerSheetProps {
  zones: StudyZoneModel[];
  selectedZoneId: string | null;
  /** Null until the screen has a fix (location not allowed, or still reading). */
  proximity?: ProximityMap | null;
  onSelect: (zoneId: string) => void;
  /** The sheet closed, however it closed. The screen holds its distances still while it's up. */
  onDismiss?: () => void;
}

export const ZonePickerSheet = forwardRef<BottomSheetModal, ZonePickerSheetProps>(
  function ZonePickerSheet(
    { zones, selectedZoneId, proximity = null, onSelect, onDismiss },
    ref,
  ) {
    const closeSheet = useSheetClose(ref);
    const { tokens } = useFrappTheme();
    const { accent } = useChapterBranding();
    const insets = useSafeAreaInsets();
    const styles = createStyles(tokens);
    const backgroundStyle = useSheetBackgroundStyle();
    const ordered = sortByProximity(zones, proximity);
    const fitsContent = ordered.length <= MAX_ROWS_SIZED_TO_CONTENT;
    const bottomPad = { paddingBottom: insets.bottom + tokens.spacing.md };

    const renderRow = (item: StudyZoneModel, isLast: boolean) => {
      const selected = item.id === selectedZoneId;
      const where = proximity?.get(item.id) ?? null;
      const reward = zoneRewardCopy(item);
      return (
        <Pressable
          key={item.id}
          accessibilityRole="radio"
          accessibilityState={{ selected }}
          accessibilityLabel={
            where ? `${item.name}, ${proximityCopy(where)}` : item.name
          }
          accessibilityHint={reward}
          onPress={() => onSelect(item.id)}
          style={({ pressed }) => [
            styles.row,
            isLast ? styles.rowLast : null,
            pressed ? styles.rowPressed : null,
          ]}
        >
          <View style={styles.rowText}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>
              {where ? (
                <Text style={where.inside ? styles.here : styles.away}>
                  {proximityCopy(where)}
                  {" · "}
                </Text>
              ) : null}
              {reward}
            </Text>
          </View>
          {selected ? (
            <Text style={[styles.check, { color: accent }]}>✓</Text>
          ) : null}
        </Pressable>
      );
    };

    return (
      <BottomSheetModal
        ref={ref}
        stackBehavior={SHEET_STACK_BEHAVIOR}
        {...(fitsContent
          ? { enableDynamicSizing: true }
          : { enableDynamicSizing: false, snapPoints: LONG_LIST_SNAP_POINTS })}
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onDismiss={onDismiss}
      >
        <SheetBackToClose onClose={closeSheet} />
        {fitsContent ? (
          <BottomSheetView
            onAccessibilityEscape={closeSheet}
            style={[styles.body, bottomPad]}
          >
            <SheetHeader title="Study zone" />
            {ordered.map((zone, index) =>
              renderRow(zone, index === ordered.length - 1),
            )}
          </BottomSheetView>
        ) : (
          <BottomSheetFlatList
            onAccessibilityEscape={closeSheet}
            data={ordered}
            keyExtractor={(zone: StudyZoneModel) => zone.id}
            ListHeaderComponent={<SheetHeader title="Study zone" />}
            contentContainerStyle={[styles.body, bottomPad]}
            renderItem={({
              item,
              index,
            }: {
              item: StudyZoneModel;
              index: number;
            }) => renderRow(item, index === ordered.length - 1)}
          />
        )}
      </BottomSheetModal>
    );
  },
);

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
      borderBottomWidth: 1,
      borderBottomColor: tokens.color.border.hairline,
    },
    rowLast: {
      borderBottomWidth: 0,
    },
    rowPressed: {
      opacity: 0.7,
    },
    rowText: {
      flex: 1,
    },
    name: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      marginTop: 2,
    },
    here: {
      color: tokens.color.semantic.success,
    },
    away: {
      color: tokens.color.text.foreground,
    },
    check: {
      ...typeRole(tokens.typography.role.title),
    },
  });
}
