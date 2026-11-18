import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StyleSheet, Text, View } from "react-native";
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
import { MicGlyph } from "@/components/control-glyphs";
import { TextAction } from "@/components/minutes/recorder-controls";
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
import { useMeetingRecorder } from "@/lib/minutes/recorder/session";
import { useMeetingsOn } from "@/lib/minutes/meetings-on";
import {
  MEETING_START_COPY,
  MinutesStartError,
  choiceLabel,
  meetingChoices,
  useStartMinutesFor,
  type MeetingChoice,
  type MeetingChoices,
  type StartedMinutes,
} from "@/lib/minutes/start-minutes";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { BottomSheetScrollView } from "@/lib/sheet-scrollables";

type SheetKey = "record" | "minutes";

/**
 * How long a sheet asked for before the calendar was read may still open
 * once it is. Later than this, the officer has moved on, and a sheet
 * appearing by itself would be a surprise.
 */
const REQUEST_LIVES_MS = 8000;

/**
 * The +'s meeting action (#5287; `spec/ui/mobile/navigation.md` § Quick
 * actions): New minutes, one entry for taking notes and for recording.
 * Paul, 2026-11-17: "I don't need a full red record meeting minutes option
 * in the plus menu. Just let it be the normal new minutes option. Why have
 * 2 options?" (it replaced a red Record meeting row above the grid that he
 * had picked that morning).
 *
 * New minutes picks the meeting by itself (the one on now, else a new one
 * today; `meetingChoices`) and carries it on its sheet with Change. The
 * sheet starts the minutes, or, where this phone can record, starts them
 * recording: the notice always comes first (`meetings.md` § Recording
 * notice) with the same meeting on it, and Start recording there starts
 * the minutes, opens them and starts the recorder. So the shortest way to
 * record is +, New minutes, Record, Start recording.
 *
 * When the member's own draft on that meeting already has a recording, the
 * minutes open and the officer records again from their row, which asks
 * first, as it always has.
 *
 * New minutes is offered to every member who holds `meetings:record` with
 * the module on (#5288). Record is offered where the minutes screen's own
 * Record is: the
 * chapter drafts from notes, this server can write a recording out, and this build has a microphone.
 * Recording where it can't be written out is #5289. While the phone holds a
 * recording, Record isn't offered, so a second recording is never started
 * from here; the recording's own pill opens it.
 */
export function useMeetingQuickActions({
  confirm,
}: {
  /** Says something above the bar for a few seconds (the host's notice). */
  confirm: (text: string) => void;
}): {
  newMinutes: () => void;
  sheets: ReactNode;
} {
  const router = useRouter();
  const client = useFrappClient();
  const on = useMeetingsOn();
  const canRecord = can("meetings:record", usePermissionList());
  const ai = useAiSurfaces();
  const { state, recorder } = useMeetingRecorder();
  // Minutes start for every officer who records them (#5288); recording
  // still needs drafting, which is what a transcript is for (#5289 records
  // without it).
  const mayStart = on && canRecord;
  const availability = useMeetingRecorderAvailability({
    enabled: mayStart && ai.meetingNotes && !!recorder,
  });
  const recordable =
    mayStart &&
    ai.meetingNotes &&
    !!recorder &&
    availability.data?.available === true &&
    availability.data.blocked !== "chapter_off";

  // The calendar and the minutes are read once New minutes is asked for,
  // not with the tab bar, so a member who never takes minutes never reads
  // every event.
  const [asked, setAsked] = useState(false);
  const wanted = mayStart && asked;
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
    (sheet: SheetKey, keepPick = false) => {
      setAsked(true);
      if (!keepPick) setChanged(null);
      if (readFailed) {
        void refetchEvents();
        void refetchMeetings();
      }
      setRequest((prev) => ({ sheet, n: (prev?.n ?? 0) + 1, at: Date.now() }));
    },
    [readFailed, refetchEvents, refetchMeetings],
  );

  const newMinutes = useCallback(() => present("minutes"), [present]);
  const consentNeeded = availability.data?.blocked === "consent_required";
  const refetchAvailability = availability.refetch;

  /**
   * Record, from New minutes: the AI question first when it is owed
   * (§ Recording in the app), over the sheet, then the notice on the meeting
   * the sheet had. Whether to go on, so a No leaves New minutes open with
   * the meeting the officer picked.
   */
  async function recordFromSheet(): Promise<boolean> {
    if (consentNeeded) {
      try {
        if (!(await ensureConsent())) return false;
      } catch {
        return false;
      }
      void refetchAvailability();
    }
    present("record", true);
    return true;
  }

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
   * handle, where the minutes open as they are.
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
          onRecord={recordable && !heldId ? recordFromSheet : null}
        />
      ) : null}
    </>
  );

  return { newMinutes, sheets };
}

/**
 * New minutes from the + (#5287): the meeting, already picked, then, where
 * this phone can record, Record, which closes this sheet for the recording
 * notice, with "Type notes instead" under it; elsewhere Start minutes, which
 * opens them ready for notes. A start
 * that fails says why in the sheet, which stays open to try again.
 */
const StartMinutesSheet = forwardRef<
  BottomSheetModal,
  {
    pick: ReactNode;
    canStart: boolean;
    /** Resolves to the line to show when the start failed, else null. */
    onStart: () => Promise<string | null>;
    /**
     * Starts them recording instead, resolving to whether the notice is
     * coming, or null where this phone can't record.
     */
    onRecord: (() => Promise<boolean>) | null;
  }
>(function StartMinutesSheet({ pick, canStart, onStart, onRecord }, ref) {
  const { tokens } = useFrappTheme();
  const { accent, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const closeSheet = useSheetClose(ref);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function startTyped() {
    setBusy(true);
    setProblem(null);
    try {
      const failed = await onStart();
      if (failed) setProblem(failed);
      else closeSheet();
    } finally {
      setBusy(false);
    }
  }

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
        {/* The meeting comes first, so it is plain what a recording or
            notes attach to (Paul, 2026-11-17). */}
        {pick ? (
          <Text style={styles.label}>{MEETING_START_COPY.forMeeting}</Text>
        ) : null}
        {pick}
        {problem ? (
          <Text accessibilityLiveRegion="polite" style={styles.problem}>
            {problem}
          </Text>
        ) : null}
        {onRecord ? (
          // Recording leads where this phone can record (Paul, 2026-11-17:
          // "replace it for just the record button"); typed notes stay a
          // quiet word under it.
          <>
            <SheetPrimaryButton
              label={MEETING_START_COPY.record}
              icon={(color) => <MicGlyph color={color} />}
              disabled={!pick || !canStart || busy}
              accent={accent}
              onAccent={accentOnPrimary}
              onPress={async () => {
                if (await onRecord()) closeSheet();
              }}
            />
            <View style={styles.quiet}>
              <TextAction
                label={MEETING_START_COPY.typeInstead}
                color={accent}
                disabled={!pick || !canStart || busy}
                onPress={() => void startTyped()}
              />
            </View>
          </>
        ) : (
          <SheetPrimaryButton
            label={MEETING_START_COPY.start}
            busy={busy}
            disabled={!pick || !canStart || busy}
            accent={accent}
            onAccent={accentOnPrimary}
            onPress={() => void startTyped()}
          />
        )}
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
    label: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      marginBottom: -tokens.spacing.xs,
    },
    quiet: {
      alignItems: "center",
    },
    problem: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
  });
}
