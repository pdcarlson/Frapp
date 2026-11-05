import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
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

/**
 * §5's Accent kind — `accent-3` fill, 1px `accent-7` border, `accent-11` text —
 * for the accent-worthy stats §5 names: on mobile, the `+N pts` chip on Events
 * (s06), Event detail (s07) and a task row (s08). Same geometry as
 * {@link StatusChip}, so the two sit side by side at one height.
 *
 * It lives beside StatusChip rather than as a `hue` value because the rule on
 * that prop is the point of it: a status is never the chapter accent. s06 and
 * s07 used to hand-roll this chip as a hairline-bordered muted one, which §5
 * reserves for "quiet metadata that must not read as a status", so the one
 * badge the spec gives the accent was the one not wearing it. The chat cards'
 * `PointsChip` (`components/chat/chat-card.tsx`) still draws that hairline
 * chip; moving it is tracked with the chat cards' own work.
 */
export function AccentChip({ label }: { label: string }) {
  const { tokens } = useFrappTheme();
  const { accent, accentSubtle, accentBorder } = useChapterBranding();
  const styles = createStyles(tokens);

  return (
    <View
      style={[
        styles.chip,
        styles.bordered,
        { backgroundColor: accentSubtle, borderColor: accentBorder },
      ]}
    >
      <Text style={[styles.text, { color: accent }]}>{label}</Text>
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
    bordered: {
      borderWidth: 1,
    },
    text: {
      // §5's 12.5px / 600, which is also what the board draws on every chip.
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
    },
  });
}
