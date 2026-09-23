import { Pressable, StyleSheet, Text } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The global ✦ Ask entry (s04, s06).
 *
 * `spec/ui/mobile/navigation.md:60` — "Ask is a global entry, not a tab, and it
 * MUST NOT become a fifth tab." It rides `ScreenShell`'s `headerAction` slot,
 * which S2 added ahead of the hotspot freeze for exactly this control, so
 * rendering it needs no change to any frozen file.
 *
 * **Signet gold, never the chapter accent.** `spec/ui/design-system/components.md:235`
 * scopes the ✦ mark and its surface to Signet's own gold — "the Ask/AI surface
 * speaks in Signet's voice, not the tenant's" — so this is the one control on
 * Chat home that does not retint per chapter.
 *
 * The ✦ is a **text glyph**, explicitly exempted from the duotone icon recipe
 * (`components.md:235`), so it is not a `tab-glyphs.tsx` SVG.
 *
 * Geometry is the drawn s04 pill (`canvas-screens.dc.html:113`): height 36,
 * `radius.chipLarge` (10) — a rounded rectangle, because `components.md:23`
 * bans capsules and calls this control out by name. The 36pt drawn height is
 * below the 44pt minimum touch target, so the hit area is expanded rather than
 * the box, keeping the drawing honest and the target legal.
 *
 * Destination: the s17 Ask sheet, which C7 built. The pill takes `onPress`
 * rather than navigating itself, because s17 is a **sheet hosted by its parent
 * screen**, not a route (`spec/ui/mobile/patterns.md` § Bottom sheets) — the
 * host owns the `BottomSheetModal` ref and presents it, exactly as `tasks.tsx`
 * hosts the s19 sheet behind its `+`.
 *
 * **Only in a build that has Ask.** Each host renders this behind
 * `isAskAvailable()` (`lib/ask/flag.ts`), so a build without Ask draws no pill
 * at all. It used to press through and open a sheet that said Ask was off;
 * that was reversed on 2026-09-22 (#2259), because a control whose only
 * function is to say its feature is missing reads as a placeholder under App
 * Review Guideline 2.1 (`spec/ui/mobile/navigation.md` § Global entries). The
 * gate sits at the host rather than in here because `ScreenShell` wraps any
 * non-null `headerAction` in its own view, so a pill that rendered `null`
 * would still leave that wrapper behind.
 */
export function AskPill({ onPress }: { onPress: () => void }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ask"
      accessibilityHint="Ask a question about your chapter."
      // 36pt drawn against a 44pt minimum: 4pt a side closes the gap without
      // moving the pill or disturbing the header row's alignment.
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, pressed ? styles.pressed : null]}
    >
      <Text style={styles.glyph}>✦</Text>
      <Text style={styles.label}>Ask</Text>
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs + 2,
      height: 36,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.chipLarge,
      borderWidth: 1,
      borderColor: tokens.color.gold.askBorder,
      backgroundColor: tokens.color.gold.askFill,
    },
    pressed: {
      opacity: 0.7,
    },
    glyph: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.askText,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.askText,
    },
  });
}
