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
 */
export function HeaderAddButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={tokens.spacing.sm}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: accent },
        pressed ? styles.tilePressed : null,
      ]}
    >
      <Text style={styles.glyph}>+</Text>
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
      // Drawn on house gold. The chapter accent is free to differ, and a dark
      // ink on an arbitrary accent is the contrast hazard every accent-filled
      // CTA here carries (`SheetPrimaryButton`, #1060's note on an on-accent
      // token) — matched rather than diverged from.
      color: tokens.color.gold.onHouse,
    },
  });
}
