import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  activityRecapCard,
  recapDismissalKey,
  recapDismissed,
  useActiveChapterId,
  withRecapDismissal,
  type ActivityRecap,
} from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import { CloseGlyph } from "@/components/control-glyphs";
import { SectionHeader } from "@/components/list-section";
import { createStoredPreference } from "@/lib/stored-preference";
import { pageSurfaces } from "@/lib/surfaces";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The recaps this phone dismissed, by chapter and week
 * (`recapDismissalKey`), space-separated; "" for none. A few keys, so next
 * week's recap, and another chapter's, still show. The Activity screen
 * hydrates it when it mounts, so a dismissed card isn't drawn for a frame
 * while the stored read is still on its way.
 */
export const recapDismissal = createStoredPreference<string>({
  key: "frapp.activity-recap-dismissed",
  parse: (raw) => (typeof raw === "string" ? raw : ""),
  fallback: "",
});

/**
 * Last week, under the week card on Activity on Sunday to Tuesday (#4983): what the
 * member did in their last finished week, as Slack's and Linear's weekly
 * digests sum one up, from `GET /v1/activity/recap`. The web page's card
 * (`apps/web/components/activity/recap-card.tsx`) on the phone, from the
 * same model (`activityRecapCard`). The week card says this week in
 * progress; this says the week that just closed, once: dismissed, it stays
 * gone until next week's.
 *
 * Only what the member did is drawn: a module that is off, a part that
 * couldn't be read and a zero are left out, a week with nothing to show
 * draws no card at all, and neither does a day after Tuesday, whatever the
 * cache still holds.
 */
export function RecapCard({ recap, now }: { recap: ActivityRecap; now: Date }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const dismissed = recapDismissal.use();
  const chapterId = useActiveChapterId();
  const card = activityRecapCard(recap, now);
  if (!card || !chapterId) return null;
  const key = recapDismissalKey(chapterId, card);
  if (recapDismissed(dismissed, key)) return null;
  return (
    <View style={styles.block} testID="activity-recap">
      <View style={styles.head}>
        <SectionHeader count={card.range}>Last week</SectionHeader>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss last week's recap"
          onPress={() => recapDismissal.set(withRecapDismissal(dismissed, key))}
          hitSlop={12}
          testID="activity-recap-dismiss"
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          <CloseGlyph color={tokens.color.text.muted} size={16} />
        </Pressable>
      </View>
      <View style={styles.card}>
        {card.figures.map((figure) => (
          <View
            key={figure.id}
            accessible
            accessibilityLabel={figure.spokenLabel}
            testID={`activity-recap-${figure.id}`}
            style={styles.figureRow}
          >
            <Text style={styles.figure}>{figure.figure}</Text>
            <Text style={styles.label}>{figure.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    block: {
      gap: tokens.spacing.sm,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    card: {
      flexDirection: "row",
      flexWrap: "wrap",
      columnGap: tokens.spacing.lg,
      rowGap: tokens.spacing.sm,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
    },
    figureRow: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: tokens.spacing.xs,
    },
    figure: {
      ...typeRole(tokens.typography.role.label),
      fontVariant: ["tabular-nums"],
      color: tokens.color.text.foreground,
    },
    label: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
