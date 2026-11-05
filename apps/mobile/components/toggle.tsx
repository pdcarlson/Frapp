import { Switch } from "react-native";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useFrappTheme } from "@/lib/theme";

type ToggleProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  /**
   * Paint in house gold rather than the chapter accent, for a toggle drawn
   * where there is no chapter yet (the `(auth)` group, `spec/behavior/branding.md`).
   */
  house?: boolean;
};

/**
 * The Signet toggle (`spec/ui/design-system/components.md` § Toggle): on, the
 * track is the solid accent (`accent-9`) under an `accent-contrast` thumb; off,
 * the track is the elevated surface under a muted thumb. Inside a chapter the
 * accent is the chapter's, so the same switch reads the same on every screen.
 *
 * `activeThumbColor` is react-native-web's name for the on-state thumb, which
 * it otherwise paints a fixed teal; native platforms ignore it.
 */
export function Toggle({
  value,
  onValueChange,
  accessibilityLabel,
  disabled,
  house = false,
}: ToggleProps) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const onTrack = house ? tokens.color.gold.house : brand.accentPrimary;
  const onThumb = house ? tokens.color.gold.onHouse : brand.accentOnPrimary;
  const offTrack = tokens.color.surface.popover;
  const offThumb = tokens.color.text.muted;
  const webOnly = { activeThumbColor: onThumb } as object;

  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      trackColor={{ false: offTrack, true: onTrack }}
      thumbColor={value ? onThumb : offThumb}
      ios_backgroundColor={offTrack}
      {...webOnly}
    />
  );
}
