import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The semantic status chip — `spec/ui/design-system/components.md` §5:
 * "status color @ 13% alpha / no border / status color / Paid / Overdue /
 * status only — never decorative."
 *
 * Extracted on its third copy. The More hub's "Past due Sep 15" chip and the
 * dues balance card's "Past due Sep 15" chip are the same claim about the same
 * invoice, and the copies had already drifted — one produced its height from a
 * fixed `height: 24`, the other from vertical padding, so they rendered at
 * different sizes at a large text setting. This is the duplication
 * `state-block.tsx`, `list-section.tsx` and `sheet-scaffold.tsx` each carry a
 * docblock about preventing.
 *
 * `filter-chips.tsx` is the *interactive* tab-style chip and is a different
 * component; this one is never pressable.
 */
export function StatusChip({
  label,
  hue,
}: {
  label: string;
  /** A semantic token value — never the chapter accent (§5: status only). */
  hue: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <View style={[styles.chip, { backgroundColor: tint(hue) }]}>
      <Text style={[styles.text, { color: hue }]}>{label}</Text>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    chip: {
      height: 24,
      borderRadius: tokens.radius.chip,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.sm,
    },
    text: {
      ...typeRole(tokens.typography.role.caption),
    },
  });
}
