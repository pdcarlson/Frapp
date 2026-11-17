import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useEvents,
  useFrappClient,
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
  MinutesStartError,
  choiceLabel,
  meetingChoices,
  recordRowDetail,
  useStartMinutesFor,
  type MeetingChoice,
  type MeetingChoices,
  type StartedMinutes,
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

type SheetKey = "record" | "minutes";

/**
 * How long a sheet asked for before the calendar was read may still open
 * once it is. Later than this, the officer has moved on, and a sheet
 * appearing by itself would be a surprise.
 */
const REQUEST_LIVES_MS = 8000;

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
 * minutes, opens them and starts the recorder.
 *
 * When the meeting on now already has someone else's minutes, the row says
 * so and opens the event, where Take notes is (#4935), rather than start a
 * second meeting beside it. When it is the member's own draft and that
 * draft already has a recording, the minutes open and the officer records
 * again from their row, which asks first, as it always has.
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
  const client = useFrappClient();
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

  // The calendar and the minutes are read once the member could use them:
  // for the Record row's second line, or when New minutes is asked for. Not
  // with the tab bar for everyone, so a member who never records never reads
  // every event.
  const [asked, setAsked] = useState(false);
  const wanted = mayStart && (recordable || asked);
  const eventsQuery = useEvents({ enabled: wanted });
  const meetingsQuery = useMeetings({ enabled: wanted });
  const viewerId = useViewerUserId();
  const readFailed = eventsQuery.isError || meetingsQuery.isError;
  // Events the server said already have minutes this member can't read.
  const [refused, setRefused] = useState<ReadonlySet<string>>(new Set());
  // Read on every render, not memoised on the data: which meeting is on
  // depends on the clock, and a list that hasn't changed since 6 PM must
  // still find the 7 PM meeting at 7:05.
  const choices: MeetingChoices | null =
    eventsQuery.isSuccess && meetingsQuery.isSuccess && viewerId
      ? meetingChoices(
          eventsQuery.data,
          meetingsQuery.data ?? [],
          viewerId,
          new Date(),
          refused,
        )
      : null;

  const { start } = useStartMinutesFor();
  const { ensureConsent, consentSheet } = useAiConsentGate();
  const noticeRef = useRef<BottomSheetModal>(null);
  const minutesRef = useRef<BottomSheetModal>(null);
  // The officer's own pick from Change, or null to follow the +'s. Cleared
  // on each open, so a sheet opens on the meeting the + picks then.
  const [changed, setChanged] = useState<MeetingChoice | null>(null);
  const choice = changed ?? choices?.picked ?? null;
  // Which sheet was asked for, and when, counted so asking again opens it
  // again.
  const [request, setRequest] = useState<{
    sheet: SheetKey;
    n: number;
    at: number;
  } | null>(null);
  const handled = useRef(0);

  const heldId = recorderMeetingId(state);
  const held = heldId ? recordingBarView(state) : null;
  const maxSeconds =
    availability.data?.max_seconds ?? MAX_MEETING_RECORDING_SECONDS;
  const ready = choices !== null;

  // A sheet opens once the calendar is read, after the commit that gives it
  // its meeting row; a read that fails says so instead, and a sheet asked
  // for long ago doesn't open by itself.
  useEffect(() => {
    if (!request || request.n === handled.current) return;
    if (readFailed) {
      handled.current = request.n;
      confirm(MEETING_START_COPY.readFailed);
      return;
    }
    if (!ready) return;
    handled.current = request.n;
    if (Date.now() - request.at > REQUEST_LIVES_MS) return;
    const ref = request.sheet === "record" ? noticeRef : minutesRef;
    requestAnimationFrame(() => ref.current?.present());
  }, [request, ready, readFailed, confirm]);

  const refetchEvents = eventsQuery.refetch;
  const refetchMeetings = meetingsQuery.refetch;
  const present = useCallback(
    (sheet: SheetKey) => {
      setAsked(true);
      setChanged(null);
      if (readFailed) {
        void refetchEvents();
        void refetchMeetings();
      }
      setRequest((prev) => ({ sheet, n: (prev?.n ?? 0) + 1, at: Date.now() }));
    },
    [readFailed, refetchEvents, refetchMeetings],
  );

  const newMinutes = useCallback(() => present("minutes"), [present]);
  const takenId = choices?.taken?.id ?? null;
  const consentNeeded = availability.data?.blocked === "consent_required";
  const refetchAvailability = availability.refetch;

  async function recordPress() {
    if (heldId) {
      router.push({ pathname: "/minutes-details", params: { id: heldId } });
      return;
    }
    // The meeting on now has someone else's minutes: its event screen has
    // Open minutes and Take notes, so the officer joins them.
    if (takenId) {
      router.push({ pathname: "/event-details", params: { id: takenId } });
      return;
    }
    // The AI question comes before the notice (§ Recording in the app).
    if (consentNeeded) {
      try {
        if (!(await ensureConsent())) return;
      } catch {
        return;
      }
      void refetchAvailability();
    }
    present("record");
  }

  const record: RecordMeetingEntry | null = held
    ? { detail: held.label, held: true, onPress: () => void recordPress() }
    : recordable
      ? {
          detail: choices
            ? recordRowDetail(choices)
            : readFailed
              ? MEETING_START_COPY.readFailed
              : MEETING_START_COPY.rowFinding,
          held: false,
          onPress: () => void recordPress(),
        }
      : null;

  /** Starts or opens the minutes, or the line to show when it can't. */
  async function startFor(
    picked: MeetingChoice,
  ): Promise<StartedMinutes | string> {
    try {
      return await start(picked, choices?.ownDraftFor);
    } catch (error) {
      if (error instanceof MinutesStartError && error.alreadyStarted) {
        if (picked.kind === "event") {
          const id = picked.event.id;
          setRefused((before) => new Set(before).add(id));
        }
        void refetchMeetings();
      }
      return error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Whether the member's own draft can be recorded straight away: it has no
   * recording, or only a failed one. Anything else (one uploading from
   * another device, transcribing, or ready) is the minutes screen's to
   * handle, where Record asks before replacing it.
   */
  async function freeToRecord(meetingId: string): Promise<boolean> {
    const { data } = await client.GET("/v1/meetings/{id}/recording", {
      params: { path: { id: meetingId } },
    });
    return !data || data.status === "none" || data.status === "failed";
  }

  async function startRecording(picked: MeetingChoice) {
    if (!recorder) return;
    const minutes = await startFor(picked);
    if (typeof minutes === "string") {
      confirm(minutes);
      return;
    }
    const open = () =>
      router.push({ pathname: "/minutes-details", params: { id: minutes.id } });
    if (minutes.existing && !(await freeToRecord(minutes.id))) {
      open();
      confirm(MEETING_START_COPY.hasRecording(minutes.eventName));
      return;
    }
    recorder.clearRefusal();
    open();
    await recorder.start(
      { meetingId: minutes.id, eventName: minutes.eventName, maxSeconds },
      true,
    );
  }

  /** Starts the minutes and opens them; the line to show when it can't. */
  async function startMinutes(picked: MeetingChoice): Promise<string | null> {
    const minutes = await startFor(picked);
    if (typeof minutes === "string") return minutes;
    router.push({ pathname: "/minutes-details", params: { id: minutes.id } });
    return null;
  }

  const inRoomId =
    choices?.picked?.kind === "event" ? choices.picked.event.id : null;
  const pick = choices ? (
    <MeetingPickField
      value={choice}
      label={choice ? choiceLabel(choice, new Date(), inRoomId) : null}
      options={choices.options}
      note={
        choices.taken ? MEETING_START_COPY.takenNote(choices.taken.name) : null
      }
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
          canStart={choice !== null}
          onStart={async () => (choice ? startMinutes(choice) : null)}
        />
      ) : null}
    </>
  );

  return { record, newMinutes, sheets };
}

/**
 * New minutes from the + (#5287): the meeting, already picked, and Start
 * minutes. No notice and no microphone; the minutes open ready for notes. A
 * start that fails says why in the sheet, which stays open to try again.
 */
const StartMinutesSheet = forwardRef<
  BottomSheetModal,
  {
    pick: ReactNode;
    canStart: boolean;
    /** Resolves to the line to show when the start failed, else null. */
    onStart: () => Promise<string | null>;
  }
>(function StartMinutesSheet({ pick, canStart, onStart }, ref) {
  const { tokens } = useFrappTheme();
  const { accent, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const closeSheet = useSheetClose(ref);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={() => setProblem(null)}
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
        {problem ? (
          <Text accessibilityLiveRegion="polite" style={styles.problem}>
            {problem}
          </Text>
        ) : null}
        <SheetPrimaryButton
          label={MEETING_START_COPY.start}
          busy={busy}
          disabled={!pick || !canStart || busy}
          accent={accent}
          onAccent={accentOnPrimary}
          onPress={async () => {
            setBusy(true);
            setProblem(null);
            try {
              const failed = await onStart();
              if (failed) setProblem(failed);
              else closeSheet();
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
    problem: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
  });
}
