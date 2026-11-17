import { forwardRef, useMemo } from "react";
import { StyleSheet, Text } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { useFrappTheme } from "@/lib/theme";
import { OptionSheet, type SheetOption } from "@/components/option-sheet";
import type { StudyZoneModel } from "@/lib/study/zones";
import { zoneRewardCopy } from "@/lib/study/zones";
import {
  proximityCopy,
  sortByProximity,
  type ProximityMap,
} from "@/lib/study/proximity";

/**
 * Zone picker for s10, on the shared pick-one sheet (`OptionSheet`, #5318),
 * which owns the sizing: content height for a chapter's handful of zones, a
 * fixed detent that scrolls past that. The zone sheet had its own copy of
 * that switch until then, from the day it opened cut off (2026-11-12,
 * `spec/ui/mobile/patterns.md` § Bottom sheets).
 *
 * **Nearest first, with how far.** With a location fix the rows sort by
 * distance and each says "You're here" or how far away it is, the way a store
 * picker lists the closest location first. Without one they stay alphabetical
 * and say only what the zone pays.
 */
export interface ZonePickerSheetProps {
  zones: StudyZoneModel[];
  selectedZoneId: string | null;
  /** Null until the screen has a fix (location not allowed, or still reading). */
  proximity?: ProximityMap | null;
  /** The pick. The sheet closes itself after it. */
  onSelect: (zoneId: string) => void;
  /** The sheet closed, however it closed. The screen holds its distances still while it's up. */
  onDismiss?: () => void;
}

export const ZonePickerSheet = forwardRef<
  BottomSheetModal,
  ZonePickerSheetProps
>(function ZonePickerSheet(
  { zones, selectedZoneId, proximity = null, onSelect, onDismiss },
  ref,
) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const options: SheetOption[] = sortByProximity(zones, proximity).map(
    (zone) => {
      const where = proximity?.get(zone.id) ?? null;
      const reward = zoneRewardCopy(zone);
      return {
        value: zone.id,
        label: zone.name,
        detail: (
          <>
            {where ? (
              <Text style={where.inside ? styles.here : styles.away}>
                {proximityCopy(where)}
                {" · "}
              </Text>
            ) : null}
            {reward}
          </>
        ),
        accessibilityLabel: where
          ? `${zone.name}, ${proximityCopy(where)}`
          : zone.name,
        accessibilityHint: reward,
      };
    },
  );
  return (
    <OptionSheet
      ref={ref}
      title="Study zone"
      options={options}
      selected={selectedZoneId}
      onSelect={(value) => {
        if (value) onSelect(value);
      }}
      onDismiss={onDismiss}
    />
  );
});

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    here: {
      color: tokens.color.semantic.success,
    },
    away: {
      color: tokens.color.text.foreground,
    },
  });
}
