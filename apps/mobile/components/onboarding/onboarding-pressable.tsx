import {
  Platform,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/**
 * How an onboarding control answers a press, in one place: the gold primary,
 * the outlined secondary, sign-in's light provider button and join's Account
 * menu rows. Each had grown its own copy of the same machinery, which would
 * have let one screen's press drift from the next.
 *
 * Android draws a ripple in `rippleColor`, kept inside the control's rounded
 * corners by `overflow: "hidden"`. iOS has no ripple, so the control takes
 * `heldStyle` while it is held: by default the fill dims to the sheet
 * primary's held 0.85 (`components/sheet-scaffold.tsx`), and a control on a
 * surface ladder lifts a rung instead. Disabled, it shows no press at all and
 * takes `disabledStyle`, by default a 0.55 dim, so a member waiting on a slow
 * request doesn't take it for a frozen screen.
 *
 * Only the press is owned here. The caller keeps its own fill, ink, layout and
 * accessibility props, which pass through to the `Pressable`.
 */
export function OnboardingPressable({
  rippleColor,
  heldStyle,
  disabledStyle,
  disabled = false,
  style,
  ...props
}: Omit<PressableProps, "style" | "android_ripple" | "disabled"> & {
  rippleColor: string;
  heldStyle?: StyleProp<ViewStyle>;
  disabledStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      {...props}
      disabled={disabled}
      android_ripple={disabled ? undefined : { color: rippleColor }}
      style={({ pressed }) => [
        styles.clip,
        style,
        disabled ? (disabledStyle ?? styles.disabled) : null,
        pressed && !disabled && Platform.OS !== "android"
          ? (heldStyle ?? styles.held)
          : null,
      ]}
    />
  );
}

// No token holds these: they are the values the onboarding buttons and the
// sheet primary already shared.
const styles = StyleSheet.create({
  clip: {
    overflow: "hidden",
  },
  disabled: {
    opacity: 0.55,
  },
  held: {
    opacity: 0.85,
  },
});
