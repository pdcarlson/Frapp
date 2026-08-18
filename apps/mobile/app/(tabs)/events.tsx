import { useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useEvents } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { AskSheet } from "@/components/ask/ask-sheet";
import { AskPill } from "@/components/chat/ask-pill";
import { useChapterBranding } from "@/lib/chapter-branding";
import { formatEventRowTime, resolveCheckInWindow } from "@/lib/events/format";
import { selectEventRows, type EventRow } from "@/lib/events/select";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s06 — Events list (`canvas-screens.dc.html:195`).
 *
 * Rows are the chapter's real events from `GET /v1/events`, filtered to what a
 * member can still act on: anything upcoming, plus anything whose check-in
 * window is still open. Finished events deliberately fall off — attendance
 * history is a reports surface, and a list that grows forever buries tonight's
 * meeting under last semester's.
 *
 * The ✦ Ask pill in the header is the s06 half of the global Ask entry.
 * `spec/ui/mobile/navigation.md:60` puts it "in the top bar of Chat home **and
 * Events**"; only the s04 half was built, so this screen carried no
 * `headerAction` at all until C7. The sheet it opens is hosted here rather than
 * routed to, per `spec/ui/mobile/patterns.md` § Bottom sheets.
 */

export default function EventsScreen() {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const router = useRouter();
  const eventsQuery = useEvents();
  const askSheetRef = useRef<BottomSheetModal>(null);

  // Read once per render so every row agrees on what "today" and "open" mean.
  const now = useMemo(() => new Date(), []);
  const events = useMemo(
    () => selectEventRows(eventsQuery.data, now),
    [eventsQuery.data, now],
  );

  function openEvent(eventId: string) {
    // Object form, because s07 now takes a param. Covered by the `pathname:`
    // matcher in `lib/routes.spec.ts`.
    router.push({ pathname: "/event-details", params: { id: eventId } });
  }

  return (
    <ScreenShell
      title="Events"
      subtitle="What's coming up, and what you can check in to right now."
      headerAction={<AskPill onPress={() => askSheetRef.current?.present()} />}
    >
      {eventsQuery.isPending ? (
        <View style={styles.stateBlock}>
          <ActivityIndicator color={tokens.color.text.muted} />
          <Text style={styles.stateBody}>Loading events…</Text>
        </View>
      ) : eventsQuery.isError ? (
        <View style={styles.stateBlock}>
          <Text style={styles.stateTitle}>Couldn&apos;t load events</Text>
          <Text style={styles.stateBody}>
            Events couldn&apos;t reach the server.
          </Text>
          {/*
            Explicit retry for the same reason Chat home carries one: this is a
            tab that stays mounted and the shell's ScrollView has no
            RefreshControl. C8 (#998) wired `onlineManager`, so a connectivity
            blip now recovers on its own; a server error still needs this.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try loading events again"
            disabled={eventsQuery.isFetching}
            onPress={() => void eventsQuery.refetch()}
            style={({ pressed }) => [
              styles.retryButton,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.retryText}>
              {eventsQuery.isFetching ? "Retrying…" : "Try again"}
            </Text>
          </Pressable>
        </View>
      ) : events.length === 0 ? (
        <View style={styles.stateBlock}>
          <Text style={styles.stateTitle}>Nothing scheduled</Text>
          <Text style={styles.stateBody}>
            Events your chapter schedules will appear here.
          </Text>
        </View>
      ) : (
        events.map((event) => (
          <EventRowCard
            key={event.id}
            event={event}
            now={now}
            onPress={() => openEvent(event.id)}
          />
        ))
      )}

      <AskSheet ref={askSheetRef} />
    </ScreenShell>
  );
}

function EventRowCard({
  event,
  now,
  onPress,
}: {
  event: EventRow;
  now: Date;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const window = resolveCheckInWindow(event.start_time, event.end_time, now);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${event.name}`}
      accessibilityHint="View event details and check in."
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardTime}>
          {formatEventRowTime(event.start_time, now)}
        </Text>
        <View style={styles.badgeRow}>
          {event.is_mandatory ? (
            <View style={styles.mandatoryBadge}>
              <Text style={styles.mandatoryText}>Mandatory</Text>
            </View>
          ) : null}
          {event.point_value ? (
            <View style={styles.pointsBadge}>
              <Text style={styles.pointsText}>+{event.point_value} pts</Text>
            </View>
          ) : null}
        </View>
      </View>

      <Text style={styles.cardTitle}>{event.name}</Text>
      {event.location ? (
        <Text style={styles.cardMeta}>{event.location}</Text>
      ) : null}

      {window.state === "open" ? (
        <Text style={styles.openNow}>Check-in is open</Text>
      ) : null}
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  return StyleSheet.create({
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.xs,
    },
    pressed: {
      opacity: 0.7,
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    cardTime: {
      flexShrink: 1,
      color: accent,
      ...typeRole(tokens.typography.role.caption),
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    badgeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      flexShrink: 0,
    },
    mandatoryBadge: {
      borderRadius: tokens.radius.chip,
      backgroundColor: tint(tokens.color.semantic.warning),
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
    },
    mandatoryText: {
      color: tokens.color.semantic.warning,
      ...typeRole(tokens.typography.role.caption),
    },
    pointsBadge: {
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
    },
    pointsText: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.caption),
    },
    cardTitle: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
    cardMeta: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
    },
    openNow: {
      marginTop: tokens.spacing.xs,
      color: tokens.color.semantic.success,
      ...typeRole(tokens.typography.role.caption),
    },
    stateBlock: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
      alignItems: "flex-start",
    },
    stateTitle: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
    stateBody: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
    },
    retryButton: {
      marginTop: tokens.spacing.xs,
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
    },
    retryText: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
  });
}
