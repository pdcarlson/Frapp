import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { BACK_CAPSULE_HEIGHT, BACK_ROW_HEIGHT } from "@/components/back-row";
import { CloseGlyph } from "@/components/control-glyphs";
import { GlassSurface } from "@/components/glass-surface";
import { useFrappTheme } from "@/lib/theme";

/**
 * The close on a full-screen flow with no back row: the check-in scanner
 * (s18) and the host QR (s22). The same glass the back capsule is drawn in
 * (`back-row.tsx`), as a circle the capsule's height, with the app-wide
 * `CloseGlyph` in the foreground ink. Both screens drew a bare "✕" text glyph
 * here, which read as a different app from every other way out (#3703).
 *
 * The target is the back row's 44pt, so the control meets the touch floor
 * (`foundations.md` § 9) while the circle stays 36pt. Held, the glass lifts to
 * the popover step, as the back capsule does.
 */
export function GlassCloseButton({
  accessibilityLabel,
  onPress,
}: {
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const [held, setHeld] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onPressIn={() => setHeld(true)}
      onPressOut={() => setHeld(false)}
      style={styles.target}
      testID="glass-close"
    >
      <GlassSurface style={[styles.circle, held ? styles.held : null]}>
        <View style={styles.center}>
          <CloseGlyph color={tokens.color.text.foreground} size={18} />
        </View>
      </GlassSurface>
    </Pressable>
  );
}

/**
 * The same width, empty, for the other end of a centred header row, so the
 * title stays centred on the screen.
 */
export function GlassCloseSpacer() {
  return <View style={{ width: BACK_ROW_HEIGHT, height: BACK_ROW_HEIGHT }} />;
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    target: {
      width: BACK_ROW_HEIGHT,
      height: BACK_ROW_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
    },
    circle: {
      width: BACK_CAPSULE_HEIGHT,
      height: BACK_CAPSULE_HEIGHT,
      borderRadius: BACK_CAPSULE_HEIGHT / 2,
    },
    held: {
      backgroundColor: tokens.color.surface.popover,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
