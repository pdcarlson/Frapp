import { Switch } from "react-native";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useFrappTheme } from "@/lib/theme";

type ToggleProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
  /**
   * Paint in house gold rather than the chapter accent, for a toggle drawn
   * where there is no chapter yet (the `(auth)` group, `spec/behavior/branding.md`).
   */
  house?: boolean;
};

/**
 * The Signet toggle (`spec/ui/design-system/components.md` § Toggle): on, the
 * track is the solid accent (`accent-9`) under an `accent-contrast` thumb; off,
 * the track is the elevated surface under a muted thumb, edged in the input
 * border's 14% white. Inside a chapter the accent is the chapter's, so the
 * same switch reads the same on every screen.
 *
 * A native switch can't draw a separate 1px border, so the off state carries
 * the border's 14% white as its track colour: on iOS it tints the switch over
 * the elevated `ios_backgroundColor`, and on Android it is the track. Without
 * it the off track is #2A2621 on a #211E1A card, about 1.1:1, and only the
 * thumb shows.
 *
 * `activeThumbColor` is react-native-web's name for the on-state thumb, which
 * it otherwise paints a fixed teal; native platforms ignore it.
 */
export function Toggle({
  value,
  onValueChange,
  accessibilityLabel,
  house = false,
}: ToggleProps) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const onTrack = house ? tokens.color.gold.house : brand.accentPrimary;
  const onThumb = house ? tokens.color.gold.onHouse : brand.accentOnPrimary;
  const offTrack = tokens.color.border.input;
  const offFill = tokens.color.surface.popover;
  const offThumb = tokens.color.text.muted;
  const webOnly = { activeThumbColor: onThumb } as object;

  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      accessibilityLabel={accessibilityLabel}
      trackColor={{ false: offTrack, true: onTrack }}
      thumbColor={value ? onThumb : offThumb}
      ios_backgroundColor={offFill}
      {...webOnly}
    />
  );
}
