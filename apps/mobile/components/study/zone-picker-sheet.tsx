import { forwardRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetFlatList, BottomSheetModal } from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  SheetGrabber,
  SheetHeader,
  useSheetBackgroundStyle,
} from "@/components/sheet-scaffold";
import type { StudyZoneModel } from "@/lib/study/zones";
import { zoneRewardCopy } from "@/lib/study/zones";

/**
 * Zone picker for s10 — the same shape as the s19 assignee picker.
 *
 * A list, so it snaps rather than sizing to content: `spec/ui/mobile/patterns.md`
 * § Bottom sheets requires the sheet-aware scrollable as a direct child with
 * fixed snap points, because a `BottomSheetFlatList` under `enableDynamicSizing`
 * gives two writers to the same content height.
 */
const SNAP_POINTS = ["55%"];

export interface ZonePickerSheetProps {
  zones: StudyZoneModel[];
  selectedZoneId: string | null;
  onSelect: (zoneId: string) => void;
}

export const ZonePickerSheet = forwardRef<BottomSheetModal, ZonePickerSheetProps>(
  function ZonePickerSheet({ zones, selectedZoneId, onSelect }, ref) {
    const { tokens } = useFrappTheme();
    const { accent } = useChapterBranding();
    const styles = createStyles(tokens);
    const backgroundStyle = useSheetBackgroundStyle();

    return (
      <BottomSheetModal
        ref={ref}
        snapPoints={SNAP_POINTS}
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
      >
        <View style={styles.header}>
          <SheetHeader
            title="Study zone"
            onCancel={() => {
              // `ref` is the caller's; dismissing is theirs to own too, so the
              // cancel path goes through the same `onSelect`-free close the
              // backdrop uses.
              (ref as React.RefObject<BottomSheetModal>)?.current?.dismiss();
            }}
          />
        </View>

        <BottomSheetFlatList
          data={zones}
          keyExtractor={(zone: StudyZoneModel) => zone.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }: { item: StudyZoneModel }) => {
            const selected = item.id === selectedZoneId;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={item.name}
                accessibilityHint={zoneRewardCopy(item)}
                onPress={() => onSelect(item.id)}
                style={({ pressed }) => [
                  styles.row,
                  pressed ? styles.rowPressed : null,
                ]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.meta}>{zoneRewardCopy(item)}</Text>
                </View>
                {selected ? (
                  <Text style={[styles.check, { color: accent }]}>✓</Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      </BottomSheetModal>
    );
  },
);

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    header: {
      paddingHorizontal: tokens.spacing.lg + 2,
    },
    list: {
      paddingHorizontal: tokens.spacing.lg + 2,
      paddingBottom: tokens.spacing.xl,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      paddingVertical: tokens.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: tokens.color.border.hairline,
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
    check: {
      ...typeRole(tokens.typography.role.title),
    },
  });
}
