import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { DisclosureGlyph } from "@/components/control-glyphs";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The row that opens and closes a sheet form's further options: s19's New
 * event and s05's New poll. Closed, it says what they are set to, so nothing
 * hidden is a surprise on Create.
 */
export function MoreOptionsRow({
  open,
  summary,
  onToggle,
}: {
  open: boolean;
  summary: string;
  onToggle: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={open ? "Fewer options" : `More options: ${summary}`}
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={styles.moreRow}
    >
      <View style={styles.moreText}>
        <Text style={styles.moreLabel}>
          {open ? "Fewer options" : "More options"}
        </Text>
        {open ? null : (
          <Text style={styles.caption} numberOfLines={1}>
            {summary}
          </Text>
        )}
      </View>
      <DisclosureGlyph
        color={tokens.color.text.mutedForeground}
        size={18}
        direction={open ? "up" : "down"}
      />
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    moreRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      paddingVertical: tokens.spacing.xs,
    },
    moreText: {
      flex: 1,
      gap: 2,
    },
    moreLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
  });
}
