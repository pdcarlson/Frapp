import type { ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";

/**
 * An icon-only control (`spec/ui/design-system/components.md` § Icon-only
 * actions): a secondary or row action whose glyph already says what it does
 * draws the glyph alone, and the word moves to `accessibilityLabel`.
 *
 * `label` is required, so there is no icon-only control with nothing to
 * announce. `hint` is for what the label can't say ("It returns if the
 * connection has not recovered.").
 *
 * The glyph is 20px and the hit area is the 44pt touch floor (§2): the
 * box is 28pt and the slop adds 8 on each side, so the control sits on a
 * caption-height banner without making it taller.
 */
export function IconButton({
  label,
  hint,
  onPress,
  disabled = false,
  children,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  /** The glyph, from `components/control-glyphs.tsx` where one exists. */
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.box, pressed ? styles.pressed : null]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.6,
  },
});
