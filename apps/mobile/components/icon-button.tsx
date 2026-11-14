import type { ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useGuardedBySwipe } from "@/lib/swipe-claim";

/**
 * An icon-only control (`spec/ui/design-system/components.md` § Icon-only
 * actions): a secondary or row action whose glyph already says what it does
 * draws the glyph alone, and the word moves to `accessibilityLabel`.
 *
 * `label` is required, so there is no icon-only control with nothing to
 * announce. `hint` is for what the label can't say ("It returns if the
 * connection has not recovered.").
 *
 * The box is the glyph's own 20pt and the slop adds 12 on each side, which
 * reaches the 44pt touch floor (§2) without taking layout height: a 28pt box
 * made the one-line network banner about 12pt taller. Slop isn't layout, so
 * the floor holds only where 12pt around the box is free; a control placed
 * flush against another one shares that margin.
 *
 * Inside a screen-wide swipe it drops a press that came from the swipe's own
 * touch (`lib/swipe-claim.ts`).
 */
export function IconButton({
  label,
  hint,
  onPress,
  disabled = false,
  selected,
  children,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  /**
   * For a control that stays chosen (a thumbs under an Ask answer): said to
   * a screen reader as "selected". Left out, nothing is said either way.
   */
  selected?: boolean;
  /** The glyph, from `components/control-glyphs.tsx` where one exists. */
  children: ReactNode;
}) {
  const guardedPress = useGuardedBySwipe(onPress);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={
        selected === undefined ? { disabled } : { disabled, selected }
      }
      disabled={disabled}
      hitSlop={ICON_BUTTON_HIT_SLOP}
      onPress={guardedPress}
      style={({ pressed }) => [styles.box, pressed ? styles.pressed : null]}
    >
      {children}
    </Pressable>
  );
}

/** The glyph size this control is drawn for, §2's icon-button size. */
export const ICON_BUTTON_SIZE = 20;

/** (44 - 20) / 2: what lifts the 20pt box to the 44pt touch floor. */
export const ICON_BUTTON_HIT_SLOP = 12;

const styles = StyleSheet.create({
  box: {
    width: ICON_BUTTON_SIZE,
    height: ICON_BUTTON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.6,
  },
});
