import { Pressable, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import { GlassSurface } from "@/components/glass-surface";
import { usePressFeedback } from "@/components/list-section";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  FLOATING_TAB_BAR,
  floatingTabBarTop,
  useFloatingChrome,
} from "@/lib/floating-chrome";
import { useFrappTheme } from "@/lib/theme";

/** The button as drawn: a 56pt glass circle. */
export const CREATE_BUTTON_SIZE = 56;

export type CreateAction = {
  /** What a screen reader says, since the glyph alone says nothing. */
  label: string;
  hint?: string;
  onPress: () => void;
};

/**
 * The screen's one create action, a glass "+" floating bottom right just above
 * the tab bar, where the thumb already is (owner ask 2026-11-05;
 * `spec/ui/mobile/patterns.md` § Create actions). Service hours' Log service
 * hours, Documents' upload and the task board's New task (#4610) sit here, in
 * the same spot, so a member learns it once. It is for pushed screens only: on
 * the four tabs that spot holds the tab bar's quick-actions + (`GlassTabBar`).
 * It
 * replaced the accent "+" tile in the title row (`HeaderAddButton`), which sat
 * at the far top corner.
 *
 * Glass like the bar under it, with the "+" in the chapter accent. Not a solid
 * accent disc: the accent marks the action, and a filled disc floating over
 * every row would be the loudest thing on the screen.
 */
export function FloatingCreateButton({ label, hint, onPress }: CreateAction) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const { tabBar } = useFloatingChrome();
  const { bottom } = useSafeAreaInsets();
  const feedback = usePressFeedback({ onCard: true });
  const styles = createStyles(tokens);

  // Above the floating bar where there is one, else clear of the inset.
  const offset = tabBar
    ? floatingTabBarTop(bottom) + FLOATING_TAB_BAR.gap
    : bottom + tokens.spacing.lg;

  return (
    <GlassSurface style={[styles.button, { bottom: offset }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        android_ripple={feedback.ripple}
        onPress={onPress}
        style={({ pressed }) => [styles.press, feedback.lift(pressed)]}
      >
        <Svg
          width={24}
          height={24}
          viewBox="0 0 24 24"
          fill="none"
          stroke={accent}
          strokeWidth={2.2}
          strokeLinecap="round"
        >
          <Path d="M12 5v14M5 12h14" />
        </Svg>
      </Pressable>
    </GlassSurface>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    button: {
      position: "absolute",
      // Rendered before the screen's content for reading order, so it needs
      // the lift to draw over it.
      zIndex: 2,
      right: tokens.spacing.lg,
      width: CREATE_BUTTON_SIZE,
      height: CREATE_BUTTON_SIZE,
      borderRadius: CREATE_BUTTON_SIZE / 2,
    },
    press: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
