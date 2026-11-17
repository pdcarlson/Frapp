import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useEvents,
  useMeetingRecorderAvailability,
  useMeetings,
  usePermissionList,
  useViewerUserId,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { can, MAX_MEETING_RECORDING_SECONDS } from "@repo/validation";
import { useAiConsentGate } from "@/components/ai/meet-frapp-ai";
import { MeetingPickField } from "@/components/minutes/meeting-pick-field";
import { RecordingNoticeSheet } from "@/components/minutes/recording-notice-sheet";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetPrimaryButton,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetClose,
} from "@/components/sheet-scaffold";
import { useAiSurfaces } from "@/lib/ai/availability";
import { useChapterBranding } from "@/lib/chapter-branding";
import { recorderMeetingId } from "@/lib/minutes/recorder/machine";
import { recordingBarView } from "@/lib/minutes/recorder/row-view";
import { useMeetingRecorder } from "@/lib/minutes/recorder/session";
import { useMeetingsOn } from "@/lib/minutes/meetings-on";
import {
  MEETING_START_COPY,
  choiceLabel,
  meetingChoices,
  recordRowDetail,
  useStartMinutesFor,
  type MeetingChoice,
  type MeetingChoices,
} from "@/lib/minutes/start-minutes";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { BottomSheetScrollView } from "@/lib/sheet-scrollables";

/** What the +'s Record meeting row shows, or nothing for this member. */
export type RecordMeetingEntry = {
  /** The second line: the meeting it will use, or what the recorder is doing. */
  detail: string;
  /** The phone holds a recording, so the row opens it instead of starting one. */
  held: boolean;
  onPress: () => void;
};

/**
 * The +'s meeting actions (#5287; `spec/ui/mobile/navigation.md` § Quick
 * actions): the Record meeting row above the grid, and New minutes in it.
 * Paul, 2026-11-17: "the huge one is there's no way for me to record ...
 * minutes on my phone."
 *
 * Both pick the meeting by themselves (the one on now, else a new one
 * today; `meetingChoices`) and carry it on their sheet with Change, so the
 * shortest way to record is +, Record meeting, the tick, Start recording:
 * the notice always comes first (`meetings.md` § Recording notice), and the
 * meeting rides on it rather than taking a step. Start recording starts the
 * minutes (or opens the member's own draft on that event), starts the
 * recorder and opens the minutes screen, where the controls are.
 *
 * Record meeting is offered where the minutes screen's own Record is: the
 * member holds `meetings:record`, the module is on, the chapter drafts from
 * notes, this server can write a recording out, and this build has a
 * microphone. Recording where it can't be written out is #5289. While the
 * phone holds a recording the row is always there, says what it is doing
 * and opens it, so a second recording is never started from here.
 */
export function useMeetingQuickActions({
  confirm,
}: {
  /** Says something above the bar for a few seconds (the host's notice). */
  confirm: (text: string) => void;
}): {
  record: RecordMeetingEntry | null;
  newMinutes: () => void;
  sheets: ReactNode;
} {
  const router = useRouter();
  const on = useMeetingsOn();
  const canRecord = can("meetings:record", usePermissionList());
  const ai = useAiSurfaces();
  const { state, recorder } = useMeetingRecorder();
  const mayStart = on && canRecord && ai.meetingNotes;
  const availability = useMeetingRecorderAvailability({
    enabled: mayStart && !!recorder,
  });
  const recordable =
    mayStart &&
    !!recorder &&
    availability.data?.available === true &&
    availability.data.blocked !== "chapter_off";

  // The choices are read once the member could use them: for the Record
  // row's second line, or when New minutes is asked for. Not with the tab
  // bar for everyone, so a member who never records never reads every event.
  const [asked, setAsked] = useState(false);
  const wanted = mayStart && (recordable || asked);
  const eventsQuery = useEvents({ enabled: wanted });
  const meetingsQuery = useMeetings({ enabled: wanted });
  const viewerId = useViewerUserId() ?? null;
  const ready = eventsQuery.isSuccess && meetingsQuery.isSuccess;
  const choices = useMemo<MeetingChoices | null>(
    () =>
      ready
        ? meetingChoices(
            eventsQuery.data,
            meetingsQuery.data ?? [],
            viewerId,
            new Date(),
          )
        : null,
    [ready, eventsQuery.data, meetingsQuery.data, viewerId],
  );

  const { start } = useStartMinutesFor();
  const { ensureConsent, consentSheet } = useAiConsentGate();
  const noticeRef = useRef<BottomSheetModal>(null);
  const minutesRef = useRef<BottomSheetModal>(null);
  // The officer's own pick from Change, or null to follow the +'s. Cleared
  // on each open, so a sheet opens on the meeting the + picks then, not one
  // left from the last open.
  const [changed, setChanged] = useState<MeetingChoice | null>(null);
  const choice = changed ?? choices?.picked ?? null;
  // Which sheet was asked for, counted so asking again opens it again.
  const [request, setRequest] = useState<{
    sheet: "record" | "minutes";
    n: number;
  } | null>(null);
  const presented = useRef(0);

  const heldId = recorderMeetingId(state);
  const held = heldId ? recordingBarView(state) : null;
  const maxSeconds =
    availability.data?.max_seconds ?? MAX_MEETING_RECORDING_SECONDS;

  // A sheet opens once the choices are in hand, after the commit that gives
  // it its meeting row.
  useEffect(() => {
    if (!request || !choices || request.n === presented.current) return;
    presented.current = request.n;
    const ref = request.sheet === "record" ? noticeRef : minutesRef;
    requestAnimationFrame(() => ref.current?.present());
  }, [request, choices]);

  const present = useCallback((sheet: "record" | "minutes") => {
    setAsked(true);
    setChanged(null);
    setRequest((prev) => ({ sheet, n: (prev?.n ?? 0) + 1 }));
  }, []);

  const newMinutes = useCallback(() => present("minutes"), [present]);

  const recordPress = useCallback(async () => {
    if (heldId) {
      router.push({ pathname: "/minutes-details", params: { id: heldId } });
      return;
    }
    // The AI question comes before the notice (§ Recording in the app).
    if (availability.data?.blocked === "consent_required") {
      try {
        if (!(await ensureConsent())) return;
      } catch {
        return;
      }
      void availability.refetch();
    }
    present("record");
  }, [heldId, router, availability, ensureConsent, present]);

  const record: RecordMeetingEntry | null = held
    ? { detail: held.label, held: true, onPress: () => void recordPress() }
    : recordable
      ? {
          detail: recordRowDetail(choices?.picked ?? { kind: "new" }),
          held: false,
          onPress: () => void recordPress(),
        }
      : null;

  async function startRecording(picked: MeetingChoice) {
    if (!recorder || !choices) return;
    try {
      const minutes = await start(picked, choices.ownDraftFor);
      router.push({ pathname: "/minutes-details", params: { id: minutes.id } });
      await recorder.start(
        { meetingId: minutes.id, eventName: minutes.eventName, maxSeconds },
        true,
      );
    } catch (error) {
      confirm(error instanceof Error ? error.message : String(error));
    }
  }

  async function startMinutes(picked: MeetingChoice) {
    if (!choices) return;
    try {
      const minutes = await start(picked, choices.ownDraftFor);
      router.push({ pathname: "/minutes-details", params: { id: minutes.id } });
    } catch (error) {
      confirm(error instanceof Error ? error.message : String(error));
    }
  }

  const inRoomId =
    choices?.picked.kind === "event" ? choices.picked.event.id : null;
  const pick =
    choices && choice ? (
      <MeetingPickField
        value={choice}
        label={choiceLabel(choice, new Date(), inRoomId)}
        options={choices.options}
        onChange={setChanged}
      />
    ) : null;

  const sheets = (
    <>
      {consentSheet}
      {recordable ? (
        <RecordingNoticeSheet
          ref={noticeRef}
          maxSeconds={maxSeconds}
          subject={pick}
          onStart={() => {
            if (choice) void startRecording(choice);
          }}
        />
      ) : null}
      {mayStart ? (
        <StartMinutesSheet
          ref={minutesRef}
          pick={pick}
          onStart={async () => {
            if (choice) await startMinutes(choice);
          }}
        />
      ) : null}
    </>
  );

  return { record, newMinutes, sheets };
}

/**
 * New minutes from the + (#5287): the meeting, already picked, and Start
 * minutes. No notice and no microphone; the minutes open ready for notes.
 */
const StartMinutesSheet = forwardRef<
  BottomSheetModal,
  {
    pick: ReactNode;
    onStart: () => Promise<void>;
  }
>(function StartMinutesSheet({ pick, onStart }, ref) {
  const { tokens } = useFrappTheme();
  const { accent, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const closeSheet = useSheetClose(ref);
  const [busy, setBusy] = useState(false);

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        contentContainerStyle={styles.body}
      >
        <Text accessibilityRole="header" style={styles.title}>
          {MEETING_START_COPY.newHeading}
        </Text>
        {pick}
        <SheetPrimaryButton
          label={MEETING_START_COPY.start}
          busy={busy}
          disabled={!pick || busy}
          accent={accent}
          onAccent={accentOnPrimary}
          onPress={async () => {
            setBusy(true);
            try {
              await onStart();
              closeSheet();
            } finally {
              setBusy(false);
            }
          }}
        />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing["2xl"],
      gap: tokens.spacing.md,
    },
    title: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
  });
}
