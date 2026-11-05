import { Pressable, StyleSheet, Text } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The accent "+" tile in a screen header that opens the screen's creation
 * sheet: s08's New task, drawn at `canvas-screens.dc.html` s08, and Service
 * hours' Log service hours.
 *
 * Shared because Service hours drew the same action as a bare accent "Log"
 * word with no pressed state, which read as a link rather than the screen's
 * main action, beside Tasks' tile. `label` is what a screen reader says, since
 * the glyph alone says nothing.
 *
 * A solid accent fill, so it paints `useChapterBranding()`'s solid pair:
 * `accentPrimary` under `accentOnPrimary`, the ink the accent engine
 * contrast-corrects for exactly that fill (`accent-engine.md` §8). Both fall
 * back to the drawn house gold and its ink together.
 */
export function HeaderAddButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accentPrimary, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={tokens.spacing.sm}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: accentPrimary },
        pressed ? styles.tilePressed : null,
      ]}
    >
      <Text style={[styles.glyph, { color: accentOnPrimary }]}>+</Text>
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    tile: {
      width: 38,
      height: 38,
      // TODO-DESIGN: Canvas draws radius 11; `navItem` is 10 and is the nearest
      // role in the locked radius map (foundations.md § Radius).
      borderRadius: tokens.radius.navItem,
      alignItems: "center",
      justifyContent: "center",
    },
    tilePressed: {
      opacity: 0.85,
    },
    glyph: {
      ...typeRole(tokens.typography.role.title),
    },
  });
}
