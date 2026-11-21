import { describeLoadFailure } from "@repo/hooks/error-copy";
import { statusOf } from "@repo/api-sdk";
import {
  agendaCheckOffOpen,
  attendanceFromEvent,
  can,
  checkInZoneLine,
  describeAttendance,
  EVENT_FORM_ROW_LABELS,
  statusLabel,
} from "@repo/validation";
import type { EventFormGlyphName } from "@repo/theme/event-form-glyphs";
import { formatDayTime, formatPointsChip } from "@repo/formatting";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  Pressable,
  type ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  eventNowPill,
  eventSeriesKey,
  seriesCadenceOf,
  useEvent,
  useEvents,
  useMyAttendance,
  useNowDate,
  usePermissionList,
  useRequiredOfViewer,
  useRoles,
  useViewerUserId,
} from "@repo/hooks";
import { toRoleOptions } from "@repo/hooks/chapter-roles";
import {
  ExcuseReviewSection,
  MyExcuse,
} from "@/components/events/event-excuses";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { EventNowPill } from "@/components/now-card";
import { PencilGlyph } from "@/components/control-glyphs";
import { HeaderButton } from "@/components/header-button";
import {
  NewEventSheet,
  useEventEditGrants,
} from "@/components/events/new-event-sheet";
import { useEventEditTarget } from "@/lib/events/use-event-edit";
import { useOneTapCheckIn } from "@/lib/events/use-one-tap-check-in";
import { SelfCheckInLink } from "@/components/events/self-check-in-link";
import { BACK_TO_EVENTS, pinnedBackClearance } from "@/components/back-row";
import { goBackTo } from "@/lib/href";
import { useDropKeptSheetDraft } from "@/lib/kept-sheet-draft";
import { SheetPrimaryButton } from "@/components/sheet-scaffold";
import {
  ErrorState,
  SkeletonBlock,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import { AccentChip, HairlineChip } from "@/components/status-chip";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  formatCheckInOpens,
  formatEventClock,
  formatEventWindow,
  resolveCheckInWindow,
  sortEventsByStart,
  type CheckInWindow,
} from "@/lib/events/format";
import {
  selectAllEventRows,
  selectEventDetail,
  selectMyAttendance,
  selectSeriesOccurrences,
  type EventDetail,
} from "@/lib/events/select";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { eyebrowStyle } from "@/components/eyebrow";
import { pageSurfaces } from "@/lib/surfaces";
import { InlineNote } from "@/components/inline-note";
import { ListPanel } from "@/components/list-section";
import { EventMinutesRow } from "@/components/minutes/event-minutes-row";
import { EventMeetingLists } from "@/components/events/event-agenda";
import { EventFormGlyph } from "@/components/events/event-form-rows";
import { useMeetingsOn, useNotesLabel } from "@/lib/minutes/meetings-on";
import {
  ScrollRevealProvider,
  useScrollReveal,
} from "@/lib/keep-above-keyboard";

/**
 * s07 — Event detail (`canvas-screens.dc.html:246`).
 *
 * **This filename is a contract and must never be renamed**: `frapp://event-details`
 * is baked into `.ics` files members exported before the calendar export was
 * withdrawn (#3708), and those entries live on in their calendars, so a
 * rename orphans every one of them (`spec/ui/mobile/screens.md:29`).
 *
 * Reached with an `id` param from s06 and from the Chat home UP NEXT strip.
 * Without one there is no event to render — the screen says so rather than
 * inventing a placeholder, which is what it used to do: until C2 this file was
 * a hardcoded "Frapp Chapter Meeting" with a fabricated date.
 *
 * ## No RSVP control until RSVP exists
 *
 * The reference draws a "Going ✓ / Can't make it" row and a "GOING · 31" count.
 * Neither has a server behind it: `spec/behavior/events.md` records that
 * "pre-event RSVP intent (going / maybe / not-going, ahead of the window) is
 * not yet modelled". Both are omitted. The row used to render disabled in its
 * drawn position; a control that can never be enabled is the "coming soon"
 * shape App Review Guideline 2.1 rejects (#2300), so it comes back only with
 * the endpoint (#1035). A line that used to stand in for it ("Check in at the
 * event to be counted.") is gone too: the check-in card above already says it.
 * On an event that requires the viewer, "Can't make it" is an excuse, not an
 * RSVP, and has a server (#3735): `MyExcuse` under the check-in card, and
 * the receiver's `ExcuseReviewSection` below it.
 *
 * ## Editing
 *
 * A viewer who may edit events (`events:update`) gets a pencil in the back
 * row, the slot Profile's edit uses, for any event in the chapter, not only
 * their own: the officer fixing tonight's room minutes before chapter is
 * rarely the one who made the series in August. It opens the New event sheet
 * filled in as "Edit event", which also holds Delete for a viewer with
 * `events:delete`. A generated occurrence reads its series parent first, so
 * the form can show the series' Repeat and move the whole series' time.
 *
 * ## Where the chips sit
 *
 * The board draws Mandatory and `+N pts` above the title and the place in the
 * line under it ("Tonight · 6:00 – 7:00 PM · Great Hall"). The place is in that
 * line here too. The chips sit under it, because `ScreenShell` draws the title
 * first and is frozen; they used to share a row with the place, which wrapped
 * a long location beside them.
 *
 * ## The keyboard
 *
 * An editor types agenda items, a link or a Chapter Files search, and a
 * member their excuse, in fields on the page itself, the agenda's well down
 * it. The body rises with the keyboard (`avoidKeyboard`), and the screen
 * scrolls the focused field into view above it and keeps it there as items
 * are added (`lib/keep-above-keyboard.tsx`, #5463): on a 3-item agenda the
 * field used to open under the keyboard, and each item added went under it
 * too. A tap on a row's control while the keyboard is up works on the first
 * tap (`keyboardShouldPersistTaps`), so an officer can reorder or check off
 * between items without closing it.
 */

export default function EventDetailsScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const requiredOf = useRequiredOfViewer();
  const viewerId = useViewerUserId();
  const canDecideExcuses = can("events:update", usePermissionList());
  const params = useLocalSearchParams<{
    id?: string | string[];
    excuse?: string | string[];
  }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");
  // `excuse=1`: the chat card's Can't make it, which opens the line (#4660).
  const startExcuse =
    (Array.isArray(params.excuse) ? params.excuse[0] : params.excuse) === "1";

  const eventQuery = useEvent(eventId);
  const event = useMemo(
    () => selectEventDetail(eventQuery.data),
    [eventQuery.data],
  );

  const router = useRouter();
  const { accent } = useChapterBranding();
  const grants = useEventEditGrants();
  const editSheetRef = useRef<BottomSheetModal>(null);
  // The series' rule, head and next meetings, read for an editor; the
  // sheet remounts on what the server holds after a save (`sheetKey`).
  const {
    target: editTarget,
    ready: parentSettled,
    sheetKey: editSheetKey,
  } = useEventEditTarget(event, eventQuery.data);

  // An edit kept past this screen (#4872) goes with its event: one deleted
  // since has no sheet to open it in.
  const editDraftName = eventId ? `event-edit:${eventId}` : null;
  // The event was deleted: its read now 404s, though a refetch keeps the
  // event it loaded before on screen.
  const eventGone =
    !eventQuery.isPending &&
    eventQuery.isError &&
    statusOf(eventQuery.error) === 404;
  useDropKeptSheetDraft(editDraftName, eventGone);

  /*
    A ticking clock, not one frozen at mount: this screen is often opened
    *before* check-in opens — a member arriving early taps through from UP
    NEXT — and a `new Date()` captured once would leave "Check-in opens at
    5:50 PM" on screen through 5:50, 6:15 and past the close, with no way to
    reach the scanner but to back out and re-enter.

    It is the shared `@repo/hooks` clock the Events list and web's event card
    read, so this screen and the row it was opened from agree on whether the
    window is open. Its 30s tick is well inside the 15-minute grace window. The
    server enforces the real window regardless — this is UX only.
  */
  const now = useNowDate();
  const meetingsOn = useMeetingsOn();
  const [dragging, setDragging] = useState(false);
  const notesLabel = useNotesLabel();
  // The body's scroll view, which keeps a focused field above the keyboard.
  const scrollRef = useRef<ScrollView>(null);
  const reveal = useScrollReveal(scrollRef, {
    // The pinned back row floats over the top of the scroll view.
    top: pinnedBackClearance(tokens),
    margin: tokens.spacing.md,
  });

  if (!eventId) {
    return (
      <ScreenShell back={BACK_TO_EVENTS} title="Event">
        <InlineNote>Open an event from the Calendar.</InlineNote>
      </ScreenShell>
    );
  }

  if (eventQuery.isPending) {
    return (
      <ScreenShell back={BACK_TO_EVENTS} title="Event">
        <EventDetailSkeleton />
      </ScreenShell>
    );
  }

  if (!event) {
    return (
      <ScreenShell back={BACK_TO_EVENTS} title="Event">
        <ErrorState
          title="Couldn't load this event"
          body={describeLoadFailure(eventQuery.error)}
          onRetry={() => void eventQuery.refetch()}
          isRetrying={eventQuery.isFetching}
        />
      </ScreenShell>
    );
  }

  const window = resolveCheckInWindow(
    event.start_time,
    event.end_time,
    now,
    event.check_in_opens_minutes,
  );
  const requiredOfViewer = requiredOf(event.attendance);

  return (
    // Around the shell, not inside it: a provider in the body would fold the
    // whole body into one child and lose the shell's gap between sections.
    <ScrollRevealProvider value={reveal}>
      <ScreenShell
        back={BACK_TO_EVENTS}
        scrollRef={scrollRef}
        avoidKeyboard
        keyboardShouldPersistTaps="handled"
        // A held agenda row: the drag, not the page, follows the finger.
        scrollEnabled={!dragging}
        backAction={
          grants.edit ? (
            // A pencil, as Profile's edit: the same back-row slot.
            <HeaderButton
              label="Edit event"
              hint="Opens a sheet to change this event."
              disabled={!parentSettled}
              onPress={() => editSheetRef.current?.present()}
            >
              <PencilGlyph color={accent} />
            </HeaderButton>
          ) : undefined
        }
        title={event.name}
        subtitle={[
          formatEventWindow(event.start_time, event.end_time, now),
          event.location,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        {requiredOfViewer || event.point_value || eventNowPill(event, now) ? (
          <View style={styles.badgeRow}>
            {/* Where it stands, first (#5777): on now, or ended today. */}
            <EventNowPill event={event} now={now} />
            {requiredOfViewer ? (
              // The hairline kind, as the list and the chat card draw it
              // (#4132): one look for Mandatory on every screen.
              <HairlineChip label="Mandatory" />
            ) : null}
            {event.point_value ? (
              <AccentChip label={formatPointsChip(event.point_value)} />
            ) : null}
          </View>
        ) : null}

        {/* Details first, then the agenda, then attendance (Paul
            2026-11-19: "details should come first, followed by the agenda
            and the attendance"), web's event page in the same order. */}
        <DetailsSection event={event} now={now} />

        {/* The member's own part, checking in or saying they can't
            come, reads right under the details, where web's sheet puts its
            check-in row and excuse. */}
        <CheckInCard event={event} window={window} now={now} />

        <MyExcuse
          eventId={event.id}
          required={requiredOfViewer}
          start={event.start_time}
          end={event.end_time}
          opensMinutes={event.check_in_opens_minutes}
          now={now}
          startWriting={startExcuse}
        />

        {/* Keyed by meeting: a half-typed item, or a change still waiting
            to save, must not carry over to another occurrence opened from
            the Repeat row's Next link (the old one's is sent as it goes). */}
        <EventMeetingLists
          key={`lists-${event.id}`}
          eventId={event.id}
          lists={{ agenda: event.agenda, attachments: event.attachments }}
          // A real events:update answer, and an event still there: every
          // write to one deleted since would 404.
          canEdit={canDecideExcuses && !eventGone}
          // Items are ticked off during the meeting, not before it.
          checkOffOpen={agendaCheckOffOpen(event.start_time, now)}
          // Suggested draws on minutes, so it waits for them to be on.
          upcoming={meetingsOn && Date.parse(event.end_time) > now.getTime()}
          onDragging={setDragging}
        />

        {/* The event's creator receives its excuses; an events:update
            holder may decide them too (§ Excuses). */}
        {canDecideExcuses ||
        (viewerId !== null && event.created_by === viewerId) ? (
          <ExcuseReviewSection
            eventId={event.id}
            viewerId={viewerId}
            canUpdateEvents={canDecideExcuses}
          />
        ) : null}

        <EventMinutesRow eventId={event.id} eventName={event.name} />

        {event.notes ? (
          // Every member the event invites reads these, so never "internal"
          // (#4934); labeled as web's sheet labels them.
          <DetailSection
            label={notesLabel.toUpperCase()}
            body={event.notes}
            styles={styles}
          />
        ) : null}
      </ScreenShell>
      {grants.edit && editTarget ? (
        <NewEventSheet
          key={editSheetKey}
          ref={editSheetRef}
          now={now}
          editing={editTarget}
          // Kept past this screen (#4872): going back and opening this
          // event's Edit again brings back what was typed.
          keptDraft={editDraftName ?? undefined}
          onSaved={({ leave }) => {
            // A series save can replace the occurrence on screen with a new
            // one; the Calendar shows where it went.
            if (leave) goBackTo(router, BACK_TO_EVENTS.href);
          }}
          onDeleted={() => goBackTo(router, BACK_TO_EVENTS.href)}
        />
      ) : null}
    </ScrollRevealProvider>
  );
}

/**
 * The drawn "● Check-in is open · closes 6:15" card. Open, it takes the
 * chapter's accent-tinted fill and border with the green status dot and the
 * card's one button. Before and after the window it is one neutral line with
 * a muted dot, since there is nothing to do yet or any more.
 *
 * What it says, top to bottom (#3703, from running a real chapter event):
 *
 * - **Checked in.** A member with a check-in on record sees "Checked in at
 *   7:52 PM" and the points, with the green dot, and no scanner: the scan is
 *   done, and offering it again only leads to "already checked in". Read from
 *   the member's own row (`GET …/attendance/me`), so it holds on another
 *   device and after the app restarts. The points are the event's
 *   `point_value`, as s18's success panel says them; an edit to it after the
 *   check-in isn't retroactive (`spec/behavior/events.md`), so in that rare
 *   case the two differ.
 * - **Marked by an officer.** A row that isn't a check-in (an officer marked
 *   them excused, absent, or present by hand) says so, "Marked excused", and
 *   offers no scanner:
 *   the server refuses any second row, so a scan could only answer "already
 *   checked in".
 * - **Not open yet.** Only "Check-in opens at 7:50 PM" (with the day when it
 *   isn't today). No explanation, not even the zone line: the time is the
 *   whole answer.
 * - **Open, for a host.** A viewer who can host the check-in (`events:update`,
 *   the permission that mints the rotating code) gets **Host check-in**, which
 *   opens s22's QR and count, as the card's button in place of the guest's:
 *   forty members walk in in the same five minutes and the host should not be
 *   digging through More to find it. It is offered from before the window
 *   opens too, so the QR can be up when the first member arrives. Events have
 *   no creator or hosts list (#3762), so "host" is the permission. A host who
 *   attends still earns the points, so while the window is open and they
 *   aren't in yet, a quieter "Check myself in" under the button checks them
 *   in right there (2026-11-17, `useHostSelfCheckIn`): the API needs no code
 *   from a host, whose own phone is showing it and can't scan it.
 * - **Open, for a guest.** One line saying to scan the code here or with the
 *   phone's camera (2026-11-13: the QR is a link the camera opens), and
 *   **Scan code** as the card's button (2026-11-17; it was a quiet link),
 *   which opens s18 with its viewport up, where the typed code is one tap
 *   further for a camera that won't read it.
 *   Held back while their own row is first being read, so a checked-in
 *   member never sees it flash. Not while that read is paused offline: s18
 *   says what offline means for a check-in. A failed read shows it too (the
 *   server refuses a second check-in anyway).
 *
 * A check-in zone is said here, on the card it constrains, as one muted line
 * while check-in is open. It used to be its own box painted in
 * info blue, a semantic hue the board never draws on this screen, and inside
 * a chapter the blue read as an alert rather than a condition.
 */
function CheckInCard({
  event,
  window,
  now,
}: {
  event: EventDetail;
  window: CheckInWindow;
  now: Date;
}) {
  const { tokens } = useFrappTheme();
  const { accent, accentSubtle, accentBorder } = useChapterBranding();
  const styles = createStyles(tokens);
  const router = useRouter();
  const canHost = can("events:update", usePermissionList());
  const mine = useMyAttendance(event.id);
  const own = selectMyAttendance(mine.data);
  const checkedInAt = own?.checkedInAt ?? null;
  // A row without a check-in (an officer's mark): one the server won't let a
  // scan replace.
  const marked = own && !checkedInAt ? own.status : null;
  const isOpen = window.state === "open";
  const hostable = canHost && (isOpen || window.state === "upcoming");

  const title = checkedInAt
    ? `Checked in at ${formatEventClock(checkedInAt)}`
    : marked
      ? `Marked ${statusLabel("attendance", marked).toLowerCase()}`
      : isOpen
        ? "Check-in is open"
        : window.state === "upcoming" && window.opensAt
          ? `Check-in opens ${formatCheckInOpens(window.opensAt, now)}`
          : window.state === "closed"
            ? "Check-in is closed"
            : "Check-in is unavailable";
  const trailing = checkedInAt
    ? event.point_value
      ? formatPointsChip(event.point_value)
      : null
    : isOpen && !own
      ? `closes ${formatEventClock(window.closesAt)}`
      : null;
  const zone =
    !own && event.hasCheckInZone && isOpen
      ? checkInZoneLine(event.check_in_zone_name)
      : null;
  // Whether the viewer may still check themselves in, once their own row has
  // been read (or the read is paused offline).
  const canScan = isOpen && !own && !(mine.isPending && !mine.isPaused);
  // The accent fill marks a card with something to do now.
  const active = (isOpen && !own) || hostable;
  const showScan = canScan && !canHost;
  // s18 with Scan code's viewport already up: the member tapped Scan code.
  const openScanner = useCallback(
    () =>
      router.push({
        pathname: "/check-in",
        params: { eventId: event.id, scan: "1" },
      }),
    [event.id, router],
  );
  // A drawn zone needs the member's location, which s18 gathers; anything
  // else checks in from here in one tap unless a code is needed now.
  const oneTap = !event.hasCheckInZone;
  const tap = useOneTapCheckIn(event.id, openScanner);

  return (
    <View
      style={[
        styles.checkInCard,
        active
          ? { backgroundColor: accentSubtle, borderColor: accentBorder }
          : null,
      ]}
    >
      <View style={styles.checkInHeader}>
        <View
          style={[
            styles.dot,
            {
              // Green while there is a check-in to make, or one made; an
              // officer's mark has nothing left to do, so it reads muted.
              backgroundColor:
                checkedInAt || (isOpen && !own)
                  ? tokens.color.semantic.success
                  : tokens.color.text.muted,
            },
          ]}
        />
        <Text
          style={[
            styles.checkInTitle,
            isOpen && !own ? { color: accent } : null,
          ]}
        >
          {title}
        </Text>
        {trailing ? <Text style={styles.checkInMeta}>{trailing}</Text> : null}
      </View>

      {zone ? <Text style={styles.zoneText}>{zone}</Text> : null}

      {hostable ? (
        <>
          <SheetPrimaryButton
            label="Host check-in"
            accent={accent}
            onAccent={tokens.color.gold.onHouse}
            onPress={() =>
              router.push({
                pathname: "/host-check-in",
                params: { eventId: event.id },
              })
            }
          />
          {canScan ? (
            <SelfCheckInLink
              accent={accent}
              pending={tap.pending}
              message={tap.message}
              onPress={
                oneTap
                  ? tap.checkIn
                  : () =>
                      router.push({
                        pathname: "/check-in",
                        params: { eventId: event.id },
                      })
              }
            />
          ) : null}
        </>
      ) : showScan && oneTap && !event.checkInNeedsCode ? (
        <>
          <SheetPrimaryButton
            label={tap.pending ? "Checking you in…" : "Check in"}
            accent={accent}
            onAccent={tokens.color.gold.onHouse}
            onPress={tap.checkIn}
          />
          {tap.message ? (
            <Text style={styles.zoneText}>{tap.message}</Text>
          ) : null}
        </>
      ) : showScan ? (
        <>
          <Text style={styles.cameraHint}>
            Scan the code on the officer&apos;s screen, here or with your
            phone&apos;s camera.
          </Text>
          <SheetPrimaryButton
            label="Scan code"
            accent={accent}
            onAccent={tokens.color.gold.onHouse}
            onPress={openScanner}
          />
        </>
      ) : null}
    </View>
  );
}

/**
 * The screen's loading state, on the loaded screen's own styles: the check-in
 * card's frame and header line (components.md §10). The badge row and the
 * DETAILS and NOTES sections are left out: each draws only when the
 * event carries one, and a placeholder for one would leave a gap when it
 * doesn't land.
 *
 * Exported so `components/screen-skeletons.spec.tsx` can pin its shape.
 */
export function EventDetailSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { caption, label } = tokens.typography.role;

  return (
    <SkeletonRegion label="Loading event" style={styles.skeletonStack}>
      <View style={styles.checkInCard}>
        <View style={styles.checkInHeader}>
          <SkeletonBlock
            width={tokens.spacing.sm}
            height={tokens.spacing.sm}
            radius={tokens.spacing.xs}
          />
          <View style={styles.checkInTitleSkeleton}>
            <SkeletonText role={label} width="55%" />
          </View>
          <SkeletonText
            role={caption}
            width={tokens.spacing["3xl"] + tokens.spacing.lg}
          />
        </View>
      </View>
    </SkeletonRegion>
  );
}

/**
 * DETAILS: the event form's rows read back (`EVENT_FORM_ROWS`, the same
 * marks and words), as web's event page lists them, so the page reads as
 * the form that made it. When and the place are the subtitle and the points
 * a chip, so the rows here are how it repeats, who's coming and what it's
 * about.
 *
 * A series is one row with a link to its next meeting, not a list of every
 * date (Paul 2026-11-19: "don't need to see all the upcoming series events
 * when I click on one"): the calendar holds the rest. Read from the cached
 * chapter events (`useEvents`), which already hold every occurrence.
 */
function DetailsSection({ event, now }: { event: EventDetail; now: Date }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const key = eventSeriesKey(event);
  const eventsQuery = useEvents({ enabled: !!key });
  const rolesQuery = useRoles();
  // Parsed once per payload; only the upcoming filter follows the clock.
  const rows = useMemo(
    () => selectAllEventRows(eventsQuery.data),
    [eventsQuery.data],
  );
  const cadence = useMemo(() => {
    if (!key) return null;
    const all = rows.some((row) => row.id === event.id)
      ? rows
      : sortEventsByStart([event, ...rows]);
    return seriesCadenceOf(all, event);
  }, [rows, event, key]);
  // The series' next meeting after this one.
  const next = useMemo(() => {
    const start = Date.parse(event.start_time);
    return (
      selectSeriesOccurrences(rows, event, now).find(
        (row) => Date.parse(row.start_time) > start,
      ) ?? null
    );
  }, [rows, event, now]);
  const roleName = useMemo(() => {
    const byId = new Map(
      toRoleOptions(rolesQuery.data, "keep").map((role) => [
        role.id,
        role.name,
      ]),
    );
    return (id: string) =>
      byId.get(id) ?? (rolesQuery.isSuccess ? "Removed role" : undefined);
  }, [rolesQuery.data, rolesQuery.isSuccess]);

  return (
    <View style={styles.section} accessibilityLabel="Details">
      <Text style={styles.sectionLabel}>DETAILS</Text>
      <ListPanel>
        {key ? (
          <DetailRow glyph="repeat" label={EVENT_FORM_ROW_LABELS.repeat}>
            <View style={styles.detailInline}>
              <Text style={styles.detailValue}>
                {cadence ?? "Part of a series"}
              </Text>
              {next ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`Next meeting, ${formatDayTime(next.start_time, now) ?? ""}`}
                  hitSlop={8}
                  onPress={() =>
                    router.push({
                      pathname: "/event-details",
                      params: { id: next.id },
                    })
                  }
                  style={({ pressed }) => (pressed ? styles.pressed : null)}
                >
                  <Text style={styles.detailLink}>
                    Next {formatDayTime(next.start_time, now) ?? ""}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </DetailRow>
        ) : null}
        <DetailRow glyph="attendance" label={EVENT_FORM_ROW_LABELS.attendance}>
          <Text style={styles.detailValue}>
            {describeAttendance(
              attendanceFromEvent(event.attendance),
              roleName,
            )}
          </Text>
        </DetailRow>
        {event.description ? (
          <DetailRow
            glyph="description"
            label={EVENT_FORM_ROW_LABELS.description}
          >
            <Text style={styles.detailValue}>{event.description}</Text>
          </DetailRow>
        ) : null}
      </ListPanel>
    </View>
  );
}

/** One detail: the form row's mark and word, then its value. */
function DetailRow({
  glyph,
  label,
  children,
}: {
  glyph: EventFormGlyphName;
  label: string;
  children: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.detailRow} accessible={false}>
      <View style={styles.detailMark}>
        <EventFormGlyph
          name={glyph}
          color={tokens.color.text.mutedForeground}
          size={16}
        />
      </View>
      <Text style={styles.detailLabel}>{label}</Text>
      <View style={styles.detailBody}>{children}</View>
    </View>
  );
}

/** DETAILS and NOTES share this shape; only the label and body differ. */
function DetailSection({
  label,
  body,
  styles,
}: {
  label: string;
  body: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <ListPanel>
        <Text style={styles.sectionBody}>{body}</Text>
      </ListPanel>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    // `ScreenShell`'s gap, which spaces the loaded screen's blocks.
    skeletonStack: {
      gap: tokens.spacing.md,
    },
    badgeRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: tokens.spacing.sm,
    },
    checkInCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    checkInHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    dot: {
      // The board draws 9; the 8pt spacing step is the nearest token, and
      // half of it rounds the square into a dot.
      width: tokens.spacing.sm,
      height: tokens.spacing.sm,
      borderRadius: tokens.spacing.xs,
    },
    checkInTitle: {
      flex: 1,
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
    // The title's flex, so the trailing caption sits where it lands.
    checkInTitleSkeleton: {
      flex: 1,
    },
    checkInMeta: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.caption),
    },
    zoneText: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.caption),
    },
    cameraHint: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.body),
    },
    section: {
      gap: tokens.spacing.xs,
    },
    sectionLabel: {
      ...eyebrowStyle(tokens),
      color: tokens.color.text.muted,
    },
    sectionBody: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
    },
    detailRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
    },
    // The mark centred on the first line of text beside it.
    detailMark: {
      height: tokens.typography.role.body.lineHeight,
      justifyContent: "center",
    },
    detailLabel: {
      width: 104,
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
    },
    detailBody: {
      flex: 1,
    },
    detailInline: {
      flexDirection: "row",
      flexWrap: "wrap",
      columnGap: tokens.spacing.sm,
    },
    detailValue: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.body),
    },
    detailLink: {
      color: tokens.color.text.mutedForeground,
      textDecorationLine: "underline",
      ...typeRole(tokens.typography.role.body),
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
