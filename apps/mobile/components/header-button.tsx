import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { useGuardedBySwipe } from "@/lib/swipe-claim";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { pageSurfaces } from "@/lib/surfaces";

/**
 * A screen header's icon action: the glyph inside a 36pt round on the card
 * fill, the round Chat home's Messages door and bell have drawn since the
 * 2026-11-06 glass direction (`spec/ui/mobile/patterns.md` § Screen headers).
 *
 * Every header action on a screen draws in it (#4610, step 3). Until then
 * Calendar's subscribe, Messages' new message and Notifications' mark all
 * read were a bare 20pt glyph beside the title, which nothing marked as a
 * control: the team's read of the phone on 2026-11-12 was "buttons are
 * unclear". Instagram, Slack and iOS Messages each draw the top-right action
 * inside a shape for the same reason. A bare `IconButton` stays right inside
 * a row or a bar, where the row already says it can be pressed.
 *
 * 36 plus 4 of slop on each side is the 44pt touch floor (foundations.md §2).
 * Inside a screen-wide swipe it drops a press that came from the swipe's own
 * touch (`lib/swipe-claim.ts`).
 */
export function HeaderButton({
  label,
  hint,
  value,
  onPress,
  disabled = false,
  badge,
  children,
}: {
  label: string;
  hint?: string;
  /** What a screen reader says after the label: "3 unread". */
  value?: string;
  onPress: () => void;
  disabled?: boolean;
  /** A count on the round's corner; nothing is drawn at zero. */
  badge?: HeaderBadge;
  /**
   * The glyph, at 20pt. `text.foreground` for an action that goes somewhere
   * (Messages, the bell, New message, Subscribe); the chapter accent for one
   * that acts on this screen (Edit, Mark all read), as iconography.md §6.1.5
   * gives a back-row slot.
   */
  children: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const guardedPress = useGuardedBySwipe(onPress);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityValue={value ? { text: value } : undefined}
      accessibilityState={disabled ? { disabled } : undefined}
      disabled={disabled}
      hitSlop={HEADER_BUTTON_HIT_SLOP}
      android_ripple={{
        color: tint(tokens.color.text.foreground, 0.12),
        borderless: true,
        radius: 22,
      }}
      onPress={guardedPress}
      style={({ pressed }) => [
        styles.round,
        pressed && Platform.OS !== "android" ? styles.pressed : null,
      ]}
    >
      {children}
      {badge && badge.count > 0 ? (
        <View
          testID={badge.testID}
          pointerEvents="none"
          style={[
            styles.badge,
            badge.tone === "mention" ? styles.badgeMention : styles.badgeInbox,
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              badge.tone === "mention"
                ? styles.badgeTextMention
                : styles.badgeTextInbox,
            ]}
          >
            {badge.count > 99 ? "99+" : badge.count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export type HeaderBadge = {
  count: number;
  /**
   * `mention` is the red that means the member was addressed (a direct
   * message); `inbox` is house gold, a count that is not direct address
   * (foundations.md §5).
   */
  tone: "mention" | "inbox";
  testID?: string;
};

/** The round's side: the header's control size. */
export const HEADER_BUTTON_SIZE = 36;

/** (44 - 36) / 2: what lifts the round to the 44pt touch floor. */
export const HEADER_BUTTON_HIT_SLOP = 4;

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    round: {
      width: HEADER_BUTTON_SIZE,
      height: HEADER_BUTTON_SIZE,
      borderRadius: HEADER_BUTTON_SIZE / 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: surfaces.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    pressed: { backgroundColor: surfaces.raised },
    badge: {
      position: "absolute",
      top: -4,
      right: -6,
      minWidth: 18,
      height: 18,
      paddingHorizontal: tokens.spacing.xs,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeMention: { backgroundColor: tokens.color.semantic.mention },
    badgeInbox: { backgroundColor: tokens.color.gold.house },
    badgeText: {
      ...typeRole({ size: 11, weight: tokens.typography.weight.bold }),
      lineHeight: 14,
    },
    badgeTextMention: { color: tokens.color.semantic.mentionForeground },
    badgeTextInbox: { color: tokens.color.gold.onHouse },
  });
}
