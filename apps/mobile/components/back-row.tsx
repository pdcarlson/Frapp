import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** Where a back row leads: the name it shows, and the route it opens. */
export type BackTarget = {
  /** The destination's name, as its tab or screen title reads ("More"). */
  label: string;
  href: Href;
};

/** s10–s13, s15, s16 and Service hours, each opened from a More row. */
export const BACK_TO_MORE: BackTarget = { label: "More", href: "/more" };
/** s07, opened from an Events row (and from Chat home's Up next). */
export const BACK_TO_EVENTS: BackTarget = { label: "Events", href: "/events" };
/**
 * s14. The board draws `‹ More`, but the inbox's entry is the bell on Chat
 * home since #3362, so its way back is Chat.
 */
export const BACK_TO_CHAT: BackTarget = { label: "Chat", href: "/" };

/**
 * The `‹ More` / `‹ Events` row the Canvas board draws above the title on a
 * screen reached from another one (s07, s10–s16, `canvas-screens.dc.html`).
 * `spec/ui/mobile/navigation.md` § Back rows owns the rule.
 *
 * It goes to a fixed destination rather than `router.back()`, as s05's `‹`
 * does (`app/(tabs)/chat-thread.tsx`). These routes are hidden tabs, so a
 * notification tap or a `frapp://` link can open one with nothing behind it,
 * and the row must still land where its label says. A label that names the
 * place it goes is also one a member can trust: `back()` from a screen opened
 * off Chat home would land on Chat under a row that says More. Android's back
 * button keeps the history behavior, which is where a member expects it.
 *
 * Drawn in the chapter accent, as s05's `‹` and the active tab are. The board
 * bakes house gold here because its mock chapter is gold; the owner's rule
 * (2026-11-04, `spec/behavior/branding.md`) puts the accent on every back
 * arrow inside a chapter, and keeps house gold for places with no chapter.
 */
export function BackRow({
  label,
  href,
  trailing,
}: BackTarget & {
  /**
   * A control at the row's far end, where the board draws s15's Edit
   * (`‹ More` … `Edit`) and s12's upload glyph. Optional; every other screen
   * draws the row alone.
   */
  trailing?: ReactNode;
}) {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Back to ${label}`}
        // The drawn row is a 16pt line of text; the slop brings the target to
        // the 44pt minimum without moving the title down.
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        onPress={() => router.navigate(href)}
        style={({ pressed }) => (pressed ? styles.pressed : null)}
      >
        <Text style={styles.text}>{`‹ ${label}`}</Text>
      </Pressable>
      {trailing}
    </View>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: tokens.spacing.sm,
    },
    pressed: {
      opacity: 0.6,
    },
    text: {
      // The board's 16pt regular line, which is the body role.
      ...typeRole(tokens.typography.role.body),
      color: accent,
    },
  });
}
