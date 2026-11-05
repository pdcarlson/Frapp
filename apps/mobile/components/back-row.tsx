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

type BackRowProps = {
  label: string;
  /**
   * A control at the row's far end, where the board draws s15's Edit
   * (`‹ More` … `Edit`) and s12's upload glyph, and setup its progress ticks.
   * Optional; every other screen draws the row alone.
   */
  trailing?: ReactNode;
  /** House gold instead of the chapter accent, for a row in `(auth)`. */
  house?: boolean;
  /** Dims the row and ignores taps, as while a sign-in or a join is in flight. */
  disabled?: boolean;
  /** Defaults to `Back to <label>`; a step-back row names where it steps to. */
  accessibilityLabel?: string;
} & (
  | { href: Href; onPress?: never }
  | {
      /** A step back the screen owns, in place of navigating to `href`. */
      onPress: () => void;
      href?: never;
    }
);

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
 *
 * Sign-in, join, setup and the chapter picker draw the same row (`‹ Back`,
 * `‹ More`), as the board's s02 does. They pass `house`, because `(auth)` has
 * no chapter to take an accent from, and `onPress`, because their way back is
 * a step inside one route (the email form to the providers, the confirm step
 * to the field) or the picker's own `router.back()`, not a tab to open.
 */
export function BackRow(props: BackRowProps) {
  // Two components rather than a branch inside one: a house row never reads
  // the chapter, so sign-in doesn't ask for a current chapter it can't have.
  return props.house ? (
    <HouseBackRow {...props} />
  ) : (
    <ChapterBackRow {...props} />
  );
}

function ChapterBackRow(props: BackRowProps) {
  const { accent } = useChapterBranding();
  return <BackRowView {...props} color={accent} />;
}

function HouseBackRow(props: BackRowProps) {
  const { tokens } = useFrappTheme();
  // `askText` is the gold the board draws its `‹` rows in (s02's `‹ Back`).
  return <BackRowView {...props} color={tokens.color.gold.askText} />;
}

function BackRowView({
  label,
  href,
  onPress,
  trailing,
  disabled = false,
  accessibilityLabel,
  color,
}: BackRowProps & { color: string }) {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens, color);

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? `Back to ${label}`}
        accessibilityState={disabled ? { disabled } : undefined}
        disabled={disabled}
        // The drawn row is a 16pt line of text; the slop brings the target to
        // the 44pt minimum without moving the title down.
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        onPress={() => {
          if (onPress) onPress();
          else if (href) router.navigate(href);
        }}
        style={({ pressed }) =>
          disabled ? styles.disabled : pressed ? styles.pressed : null
        }
      >
        <Text style={styles.text}>{`‹ ${label}`}</Text>
      </Pressable>
      {trailing}
    </View>
  );
}

function createStyles(tokens: SignetTokens, color: string) {
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
    // The whole row dims while it holds: a control that can't respond looks it.
    disabled: {
      opacity: 0.5,
    },
    text: {
      // The board's 16pt regular line, which is the body role.
      ...typeRole(tokens.typography.role.body),
      color,
    },
  });
}
