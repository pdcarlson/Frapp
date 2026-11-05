import {
  Platform,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { tint, useFrappTheme } from "@/lib/theme";

/**
 * How a house-gold control answers a press, in one place: the gold primary
 * (which the update-required gate's Update button renders too: it shows over
 * the whole app but, like `(auth)`, never takes a chapter's accent), the
 * outlined secondary, sign-in's light provider button and its Password and
 * Magic link mode buttons, join's Account menu rows, the quiet text lines
 * beside them (`quiet`, the Terms checkbox row and its document links among
 * them), and the chapter picker's Tinted buttons. Each had grown its own copy
 * of the same machinery, which would have let one screen's press drift from
 * the next.
 *
 * Android draws a ripple in `rippleColor` (by default the neutral ripple
 * `ListRow` draws), kept inside the control's rounded corners by `overflow:
 * "hidden"`. iOS has no ripple, so the control takes `heldStyle` while it is
 * held: by default the fill dims to the sheet primary's held 0.85
 * (`components/sheet-scaffold.tsx`), and a control on a surface ladder lifts a
 * rung instead. Disabled, it shows no press at all and takes `disabledStyle`,
 * by default a 0.55 dim, so a member waiting on a slow request doesn't take it
 * for a frozen screen.
 *
 * `quiet` is a line of text with no fill (Sign out, Skip for now, Retry): held,
 * the text dims to 0.6, since there is no fill to dim, and disabled it takes no
 * dim of its own. A quiet line that waits sits beside a control that already
 * shows the wait, or greys its own text.
 *
 * Only the press is owned here. The caller keeps its own fill, ink, layout and
 * accessibility props, which pass through to the `Pressable`.
 */
export function OnboardingPressable({
  rippleColor,
  heldStyle,
  disabledStyle,
  quiet = false,
  disabled = false,
  style,
  ...props
}: Omit<PressableProps, "style" | "android_ripple" | "disabled"> & {
  rippleColor?: string;
  heldStyle?: StyleProp<ViewStyle>;
  disabledStyle?: StyleProp<ViewStyle>;
  quiet?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { tokens } = useFrappTheme();
  const ripple = rippleColor ?? tint(tokens.color.text.foreground, 0.12);
  return (
    <Pressable
      {...props}
      disabled={disabled}
      android_ripple={disabled ? undefined : { color: ripple }}
      style={({ pressed }) => [
        styles.clip,
        style,
        disabled ? (disabledStyle ?? (quiet ? null : styles.disabled)) : null,
        pressed && !disabled && Platform.OS !== "android"
          ? (heldStyle ?? (quiet ? styles.quietHeld : styles.held))
          : null,
      ]}
    />
  );
}

// No token holds these: they are the values the onboarding buttons, the
// sheet primary and the quiet text lines already shared.
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
  quietHeld: {
    opacity: 0.6,
  },
});
