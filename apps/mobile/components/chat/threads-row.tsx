import { StyleSheet, Text, View } from "react-native";
import { unreadThreadCount, useMemberThreads } from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import { ThreadsGlyph } from "@/components/control-glyphs";
import { gutterBleed, PressableRow } from "@/components/list-section";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * All threads (#4960) as the first row of Chat home's list (#5139, Paul's
 * pick of option A, 2026-11-16): Slack's Home leads its list with Threads the
 * same way. It opens the All threads sheet (`AllThreadsSheet`), as the round
 * in the title row did before Search took its place.
 *
 * It is drawn as a channel row is (`channel-row.tsx`): the glyph in the
 * sigil's slot, the name, and a count at the end. The count is threads with
 * new replies, in house gold like the bell's, never mention red, since a reply
 * in a followed thread is not direct address (foundations.md §5). With none,
 * the row reads as a read channel does: a grey name and no count.
 */
export function ThreadsRow({ onPress }: { onPress: () => void }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const unread = unreadThreadCount(useMemberThreads().data);
  const lit = unread > 0;

  return (
    <PressableRow
      accessibilityRole="button"
      accessibilityLabel="Threads"
      accessibilityHint="Opens the threads you're part of."
      accessibilityValue={
        lit ? { text: `${unread} with new replies` } : undefined
      }
      onPress={onPress}
      style={styles.row}
    >
      <View
        style={styles.slot}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <ThreadsGlyph
          color={lit ? tokens.color.text.foreground : tokens.color.text.muted}
          size={tokens.typography.role.title.size}
        />
      </View>
      <Text
        numberOfLines={1}
        style={[styles.title, lit ? styles.titleLit : styles.titleRead]}
      >
        Threads
      </Text>
      {lit ? (
        <View testID="threads-badge" style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
        </View>
      ) : null}
    </PressableRow>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // A channel row's one-line geometry (`channel-row.tsx` `row`, `rowOneLine`).
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      ...gutterBleed(tokens),
    },
    slot: {
      minWidth: tokens.typography.role.title.size,
    },
    title: {
      flex: 1,
    },
    titleLit: {
      ...typeRole({
        ...tokens.typography.role.body,
        weight: tokens.typography.weight.bold,
      }),
      color: tokens.color.text.foreground,
    },
    titleRead: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    // The channel row's badge geometry, in the bell's house gold.
    badge: {
      minWidth: 24,
      height: 24,
      borderRadius: tokens.radius.chip,
      paddingHorizontal: tokens.spacing.sm,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: tokens.color.gold.house,
    },
    badgeText: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.gold.onHouse,
    },
  });
}
