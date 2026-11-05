import { useMemo, useRef } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useActiveChapterId, useEvents, useNowDate } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import {
  EmptyState,
  ErrorState,
  NoChapterState,
  SkeletonLines,
} from "@/components/state-block";
import { AccentChip, StatusChip } from "@/components/status-chip";
import { AskSheet } from "@/components/ask/ask-sheet";
import { AskPill } from "@/components/chat/ask-pill";
import { isAskAvailable } from "@/lib/ask/flag";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  formatEventDateBlock,
  resolveCheckInWindow,
} from "@/lib/events/format";
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
 * `spec/ui/mobile/navigation.md` § Global entries puts it "in the top bar of
 * Chat home and Events", and only in a build that has Ask (#2259). The sheet
 * it opens is hosted here rather than routed to, per
 * `spec/ui/mobile/patterns.md` § Bottom sheets.
 *
 * The board's Going / Can't buttons and "Going ✓" marker are not drawn: RSVP
 * has no server model yet (`spec/behavior/events.md`), and they come back with
 * the endpoint (#1035), as on s07.
 */

export default function EventsScreen() {
  const chapterId = useActiveChapterId();
  const router = useRouter();
  const eventsQuery = useEvents();
  const askSheetRef = useRef<BottomSheetModal>(null);

  // One `now` per render so every row agrees on what "today" and "open" mean,
  // and it ticks so a check-in window opens and closes on a tab that never
  // unmounts rather than staying as it was when the screen first rendered.
  const now = useNowDate();
  const events = useMemo(
    () => selectEventRows(eventsQuery.data, now),
    [eventsQuery.data, now],
  );

  function openEvent(eventId: string) {
    // Object form, because s07 now takes a param. Covered by the `pathname:`
    // matcher in `lib/routes.spec.ts`.
    router.push({ pathname: "/event-details", params: { id: eventId } });
  }

  function renderList() {
    // `useEvents` is `enabled: !!chapterId`, so with no active chapter the
    // query never runs and `isPending` never clears. Without this gate the tab
    // showed its loading state forever.
    if (!chapterId) return <NoChapterState noun="events" />;

    // The tile stands in for the row's date block.
    if (eventsQuery.isPending) return <SkeletonLines lines={2} showTile />;

    if (eventsQuery.isError) {
      // Explicit retry for the same reason Chat home carries one: this is a
      // tab that stays mounted and the shell's ScrollView has no
      // RefreshControl. C8 (#998) wired `onlineManager`, so a connectivity
      // blip recovers on its own; a server error still needs this.
      return (
        <ErrorState
          title="Couldn't load events"
          body="The server couldn't be reached."
          onRetry={() => void eventsQuery.refetch()}
          isRetrying={eventsQuery.isFetching}
        />
      );
    }

    if (events.length === 0) {
      return (
        <EmptyState
          glyph="◷"
          title="Nothing scheduled"
          body="Your chapter has nothing coming up."
        />
      );
    }

    return events.map((event) => (
      <EventRowCard
        key={event.id}
        event={event}
        now={now}
        onPress={() => openEvent(event.id)}
      />
    ));
  }

  return (
    <ScreenShell
      title="Events"
      headerAction={
        // No pill in a build without Ask (#2259) — see `app/(tabs)/index.tsx`.
        isAskAvailable() ? (
          <AskPill onPress={() => askSheetRef.current?.present()} />
        ) : undefined
      }
    >
      {renderList()}

      <AskSheet ref={askSheetRef} />
    </ScreenShell>
  );
}

/**
 * One event, as the board draws it: a date block on the left, and on the
 * right the name (with Mandatory beside it), a muted "6:00 PM · Great Hall"
 * line, then the points chip and the check-in status. The name leads: it is
 * the largest, heaviest text on the card, and the place sits under it at
 * caption size. The card used to stack an accent time caption, a 14pt name and
 * a 16pt location, so the location was the biggest text on every card.
 */
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
  const date = formatEventDateBlock(event.start_time, now);
  const meta = [date?.clock, event.location].filter(Boolean).join(" · ");
  const isOpen = window.state === "open";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${event.name}`}
      accessibilityHint="View event details and check in."
      onPress={onPress}
      // Press feedback per platform, as `ListRow` does it: Android gets a
      // bounded ripple of the foreground at 12%, clipped to the card's corners
      // by `overflow: hidden`; iOS has no ripple, so the card lifts one rung
      // up the surface ladder while it is held.
      android_ripple={{ color: styles.ripple.color }}
      style={({ pressed }) => [
        styles.card,
        pressed && Platform.OS !== "android" ? styles.pressed : null,
      ]}
    >
      {date ? (
        <View style={styles.dateBlock}>
          <Text style={styles.dateLabel}>{date.label}</Text>
          <Text style={styles.dateDay}>{date.day}</Text>
        </View>
      ) : null}

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{event.name}</Text>
          {event.is_mandatory ? (
            <StatusChip
              label="Mandatory"
              hue={tokens.color.semantic.destructive}
            />
          ) : null}
        </View>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}

        {event.point_value || isOpen ? (
          <View style={styles.footer}>
            {event.point_value ? (
              <AccentChip label={`+${event.point_value} pts`} />
            ) : null}
            {isOpen ? (
              <Text style={styles.openNow}>Check-in is open</Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      gap: tokens.spacing.md,
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      // Bounds the Android ripple to the rounded card.
      overflow: "hidden",
    },
    pressed: {
      backgroundColor: tokens.color.surface.popover,
    },
    // Not a style a view takes: the ripple's color, kept in the factory so it
    // derives from a token, as in `list-section.tsx`.
    ripple: {
      color: tint(tokens.color.text.foreground, 0.12),
    },
    dateBlock: {
      // 52 as drawn. No spacing token sits near it, and the column has to
      // hold "TODAY" over a two-digit day without shifting the names beside it.
      width: 52,
      alignItems: "center",
    },
    dateLabel: {
      // The board draws 11px / 700. `caption` is the smallest role, so it
      // keeps the role's size and takes the drawn weight.
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.bold,
      }),
      color: accent,
      letterSpacing: 0.6,
      textTransform: "uppercase",
    },
    dateDay: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
    },
    body: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: tokens.spacing.sm,
    },
    title: {
      flexShrink: 1,
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      marginTop: tokens.spacing.xs,
    },
    openNow: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.semantic.success,
    },
  });
}
