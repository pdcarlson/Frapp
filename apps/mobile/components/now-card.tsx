import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { formatClockShort } from "@repo/formatting";
import { eventNowPill, eventNowState, useEventsOnNow } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { EVENT_NOW_COPY } from "@repo/validation";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { ForwardGlyph } from "@/components/control-glyphs";
import { ListSection, PressableRow } from "@/components/list-section";

/**
 * The Now card (`spec/behavior/activity.md` § Now, #5777): the event on right
 * now, at the top of Chat home and Activity, the same on the web.
 *
 * Paul sat in a meeting on 2026-11-19 and no screen said it was on: Up next
 * had moved on to the next start and Activity had dropped the meeting once he
 * checked in. Now is the one answer to "what's on right now", read from its
 * own small route and drawn the same wherever it sits. It indicates rather
 * than narrates: "Now · until 10:25 PM", the name, where, and the member's
 * own state. Tapping opens the event, where check-in, the agenda and the
 * minutes are. With nothing on it draws nothing.
 *
 * Like Teams' bar over a meeting's chat and Slack's huddle bar: the live thing
 * sits above everything else on the screen you are already on, whether or
 * not you have joined it.
 */
export function NowCard({ testID = "now-card" }: { testID?: string }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { events } = useEventsOnNow();
  const lead = events[0];
  if (!lead) return null;
  const more = events.length - 1;
  const until = EVENT_NOW_COPY.until(formatClockShort(lead.end_time));
  const state = eventNowState(lead);

  return (
    <View style={styles.wrap} testID={testID}>
      <ListSection>
        <PressableRow
          onCard
          accessibilityRole="button"
          accessibilityLabel={[until, lead.name, lead.location, state]
            .filter(Boolean)
            .join(", ")}
          accessibilityHint="Opens the event."
          onPress={() =>
            router.push({
              pathname: "/event-details",
              params: { id: lead.id },
            })
          }
          style={styles.row}
        >
          <View style={styles.text}>
            <View style={styles.top}>
              <View style={styles.dot} />
              <Text style={styles.until} numberOfLines={1}>
                {until}
              </Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {lead.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[state, lead.location].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <ForwardGlyph color={tokens.color.text.mutedForeground} />
        </PressableRow>
      </ListSection>
      {more > 0 ? (
        <Text style={styles.more}>{EVENT_NOW_COPY.more(more)}</Text>
      ) : null}
    </View>
  );
}

/** The event's pill under its title, the same words as web's sheet. */
export function EventNowPill({
  event,
  now,
}: {
  event: Parameters<typeof eventNowPill>[0];
  now: Date;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const pill = eventNowPill(event, now);
  if (!pill) return null;
  return (
    <View
      style={[styles.pill, pill.live ? styles.pillLive : null]}
      testID="event-now-pill"
    >
      {pill.live ? <View style={styles.dot} /> : null}
      <Text style={[styles.pillText, pill.live ? styles.until : null]}>
        {pill.label}
      </Text>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    wrap: {
      gap: tokens.spacing.xs,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
    },
    text: {
      flex: 1,
      minWidth: 0,
      gap: tokens.spacing.xs,
    },
    top: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    // Live is the success green, the colour check-in's own "Checked in" dot
    // already uses, not the chapter accent (foundations.md § Where the
    // accent goes).
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: tokens.color.semantic.success,
    },
    until: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.success,
      fontWeight: tokens.typography.weight.semibold,
    },
    name: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      borderRadius: tokens.radius.chip,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.color.border.hairline,
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: 2,
    },
    pillLive: {
      borderColor: tokens.color.semantic.success,
    },
    pillText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    more: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      paddingHorizontal: tokens.spacing.md,
    },
  });
}
