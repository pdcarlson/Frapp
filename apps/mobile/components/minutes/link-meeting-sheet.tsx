import { forwardRef, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { codeOf } from "@repo/api-sdk";
import { useEvents, useLinkMeetingEvent, useMeetings } from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  DEFAULT_MEETING_NAME,
  MEETING_ENTRY_COPY,
  MEETING_NOTE_TAKERS_COPY,
  meetingWhenLabel,
} from "@repo/validation";
import { ListRow, ListSection } from "@/components/list-section";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  TallSheetHeader,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
} from "@/components/sheet-scaffold";
import { selectAllEventRows } from "@/lib/events/select";
import { BottomSheetScrollView } from "@/lib/sheet-scrollables";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** How far back the list looks for the meeting, as on web. */
const RECENT_DAYS = 60;
/** The event Add it to the calendar makes runs an hour from the minutes' start. */
const HOUR_MS = 3_600_000;

/**
 * Link minutes that have no meeting to one (`spec/behavior/meetings.md`
 * § Linking a meeting later), from the minutes screen: the recent meetings
 * without minutes, newest first, and Add it to the calendar, which makes the
 * quiet after-the-fact event at the time the minutes were started. Web's
 * `link-event.tsx` is its twin, with the same words.
 */
export const LinkMeetingSheet = forwardRef<
  BottomSheetModal,
  {
    meetingId: string;
    /** When the minutes were started: Add it to the calendar's time. */
    startedAt: string;
    onLinked: () => void;
  }
>(function LinkMeetingSheet({ meetingId, startedAt, onLinked }, ref) {
  const backgroundStyle = useSheetBackgroundStyle();
  const tall = useTallSheetProps();
  const closeSheet = useSheetClose(ref);
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const eventsQuery = useEvents();
  const meetingsQuery = useMeetings();
  const link = useLinkMeetingEvent();
  const [problem, setProblem] = useState<string | null>(null);

  const [now] = useState(() => Date.now());
  const recent = useMemo(() => {
    const withMinutes = new Set(
      (meetingsQuery.data ?? []).flatMap((m) =>
        m.event_id ? [m.event_id] : [],
      ),
    );
    const from = now - RECENT_DAYS * 86_400_000;
    return selectAllEventRows(eventsQuery.data)
      .filter((event) => {
        const at = Date.parse(event.start_time);
        return at >= from && at <= now && !withMinutes.has(event.id);
      })
      .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  }, [eventsQuery.data, meetingsQuery.data, now]);

  async function submit(body: Parameters<typeof link.mutateAsync>[0]["body"]) {
    setProblem(null);
    try {
      await link.mutateAsync({ id: meetingId, body });
      onLinked();
      closeSheet();
    } catch (error) {
      setProblem(
        codeOf(error) === "meeting.already_started"
          ? MEETING_ENTRY_COPY.alreadyStartedBody
          : errorCopy(error, MEETING_NOTE_TAKERS_COPY.linkFailed),
      );
    }
  }

  function addToCalendar() {
    const start = Date.parse(startedAt);
    const at = Number.isNaN(start) ? now : start;
    void submit({
      new_event: {
        name: DEFAULT_MEETING_NAME,
        start_time: new Date(at).toISOString(),
        end_time: new Date(at + HOUR_MS).toISOString(),
        role_ids: [],
      },
    });
  }

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...tall}
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={() => setProblem(null)}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        stickyHeaderIndices={[0]}
        contentContainerStyle={styles.body}
      >
        <View style={styles.header}>
          <TallSheetHeader
            title={MEETING_NOTE_TAKERS_COPY.linkEvent}
            onClose={closeSheet}
          />
        </View>
        <Text accessibilityRole="header" style={styles.heading}>
          {MEETING_NOTE_TAKERS_COPY.linkPick}
        </Text>
        <ListSection>
          {recent.map((event) => (
            <ListRow
              key={event.id}
              label={event.name}
              description={meetingWhenLabel(event.start_time)}
              disabled={link.isPending}
              onPress={() => void submit({ event_id: event.id })}
            />
          ))}
          <ListRow
            label={MEETING_NOTE_TAKERS_COPY.linkMake}
            description={meetingWhenLabel(startedAt)}
            disabled={link.isPending}
            onPress={addToCalendar}
          />
        </ListSection>
        {problem ? (
          <Text accessibilityLiveRegion="polite" style={styles.problem}>
            {problem}
          </Text>
        ) : null}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing["2xl"],
    },
    header: {
      backgroundColor: tokens.color.surface.popover,
    },
    heading: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    problem: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
  });
}
