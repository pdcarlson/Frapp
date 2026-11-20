import {
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Keyboard,
  StyleSheet,
  Text,
  View,
  type ScrollView,
} from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import * as Clipboard from "expo-clipboard";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import {
  NavigationContext,
  usePreventRemove,
} from "expo-router/react-navigation";
import { statusOf } from "@repo/api-sdk";
import {
  useAiSuggestions,
  useCachedMeetingRow,
  useCurrentUser,
  useDeleteMeeting,
  useMeeting,
  useMeetingActionItemTasks,
  useMeetingDraft,
  useMeetingRecording,
  useMemberDisplayNames,
  usePermissionList,
  usePostMeeting,
  type MeetingMinutes,
  type MeetingSummary,
} from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  MEETING_COPY,
  MEETING_LIST_COPY,
  MEETING_NOTES_COPY,
  MEETING_RECORDER_COPY,
  MINUTES_EDITOR_COPY,
  MINUTES_FLOW_COPY,
  MINUTES_READ_COPY,
  can,
  cleanMeetingContent,
  isMeetingContentEmpty,
  meetingDraftQuote,
  minutesDatesMissingDay,
  meetingDayLabel,
  meetingTypeLabel,
  meetingWhenLabel,
  minutesMetaHead,
  minutesDraftSource,
  minutesJumps,
  minutesReadSections,
  readMeetingContent,
  type MeetingSectionKey,
  type MeetingType,
  isBetaOffModule,
} from "@repo/validation";
import type { BackTarget } from "@/components/back-row";
import { InlineNote } from "@/components/inline-note";
import { ListRow, ListSection } from "@/components/list-section";
import {
  CalendarPlusGlyph,
  CheckGlyph,
  LinkGlyph,
  ListGlyph,
  MoreGlyph,
  PencilGlyph,
  PersonGlyph,
  SlidersGlyph,
  TrashGlyph,
} from "@/components/control-glyphs";
import { HeaderButton } from "@/components/header-button";
import {
  useItemMenu,
  type ItemMenuAction,
} from "@/components/item-actions-menu";
import {
  DraftingClockLine,
  DraftingSteps,
} from "@/components/minutes/drafting-steps";
import { MarkAttendanceSheet } from "@/components/minutes/mark-attendance-sheet";
import { MinutesBody, MinutesJumpBar } from "@/components/minutes/minutes-body";
import { ComingUpDates } from "@/components/minutes/coming-up-dates";
import { ComingUpPostReview } from "@/components/minutes/coming-up-post-review";
import { MinutesDetailsSheet } from "@/components/minutes/minutes-details-sheet";
import { MinutesEditor } from "@/components/minutes/minutes-editor";
import {
  NotesPanel,
  type NotesPanelHandle,
  useOtherSources,
} from "@/components/minutes/notes-panel";
import { TextAction } from "@/components/minutes/recorder-controls";
import {
  RecorderControls,
  RecorderStage,
  useMeetingRecorderRow,
} from "@/components/minutes/recorder";
import { RecordingPlayer } from "@/components/minutes/recording-player";
import {
  SummaryNote,
  type SummaryNoteHandle,
} from "@/components/minutes/summary-note";
import { useAiConsentGate } from "@/components/ai/meet-frapp-ai";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { ScreenShell, StickyHeader } from "@/components/screen-shell";
import { SheetPrimaryButton } from "@/components/sheet-scaffold";
import {
  ErrorState,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import { useAiSurfaces } from "@/lib/ai/availability";
import { useChapterBranding } from "@/lib/chapter-branding";
import { webAppOrigin } from "@/lib/onboarding/chapter-wizard/invite-link";
import { confirmAlert } from "@/lib/minutes/meetings-on";
import { recorderMeetingId } from "@/lib/minutes/recorder/machine";
import {
  recorderBusy,
  recordingPipeline,
} from "@/lib/minutes/recorder/row-view";
import { useMeetingRecorder } from "@/lib/minutes/recorder/session";
import { useMinutesEditor } from "@/lib/minutes/use-minutes-editor";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * One meeting's minutes (`spec/behavior/meetings.md`; #4312): what a member
 * opens from the "minutes posted" notification, an event, an Ask source, or
 * the Minutes list.
 *
 * **Everyone reads.** The page is the minutes as a document: the event's
 * name, one line saying what kind of meeting and when, a jump bar to each
 * section, then the read view both apps share (#5562, `MinutesBody`). The
 * ⋯ beside the back row holds the same items, in the same order, as web's
 * (Edit details, Mark who was there, Copy link, Open event, Transcript,
 * Delete minutes; Paul, 2026-11-19: "make sure we keep the MOBILE AND WEB
 * UIs in sync").
 *
 * **An officer who may edit a draft takes and finishes it here, as a note**
 * (Paul, 2026-11-17: "I don't want a pop-up sheet for everything"; #5288,
 * Granola's note is the model). From the top: the event's name, its line
 * (type, when, draft), then the officer's notes typed on
 * the page and saved as they type, with the keyboard able to stay up while
 * it records. Where the chapter drafts from notes they are the officer's
 * notes and the draft fills the minutes in; where it doesn't they are the
 * minutes' Summary, posted from here. The one action of the moment is pinned
 * at the bottom: the recorder's bar (pause, the live level, the clock, stop)
 * while recording, Post once there is something to post, Draft minutes for
 * typed notes, Record the meeting to begin. After Stop a card ticks off the
 * upload and the transcript, and a finished transcript drafts by itself.
 * Edit minutes in the ⋯ menu turns the screen into the web's section editor
 * in place (#4412): every section, decisions with their vote count, action
 * items with who and a due day.
 *
 * Posting asks nothing first, as on the web (Paul, 2026-11-16), though it
 * tells every invited member once.
 */
const BACK_TO_MINUTES: BackTarget = { label: "Minutes", href: "/minutes" };

export default function MinutesDetailsScreen() {
  // More, the event row and the push all hide while `meetings` is off for the
  // beta; this catches a way in that skips them (a typed link), where the
  // server would only refuse. A chapter's own switch doesn't close the
  // screen, so minutes already posted stay readable from a notification.
  if (isBetaOffModule("meetings")) return <Redirect href="/you" />;
  return <MinutesDetailsScreenBody />;
}

function MinutesDetailsScreenBody() {
  const params = useLocalSearchParams<{
    id?: string | string[];
    record?: string | string[];
  }>();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");
  const record =
    (Array.isArray(params.record) ? params.record[0] : params.record) === "1";
  const meetingQuery = useMeeting(id || null);
  // Named from the Minutes list while the minutes load, so a tap from the
  // list never opens on a blank screen (Paul, 2026-11-19).
  const cached = useCachedMeetingRow(id || null);

  if (!id) {
    return (
      <ScreenShell back={BACK_TO_MINUTES} title={MEETING_LIST_COPY.title}>
        <InlineNote>{MEETING_COPY.missingBody}</InlineNote>
      </ScreenShell>
    );
  }
  if (meetingQuery.isPending) {
    return (
      <ScreenShell
        back={BACK_TO_MINUTES}
        title={cached?.event_name ?? MEETING_LIST_COPY.title}
        subtitle={
          cached ? meetingWhenLabel(cached.event_start_time) : undefined
        }
      >
        <MinutesSkeleton row={cached} />
      </ScreenShell>
    );
  }
  if (!meetingQuery.data) {
    // A 404 is minutes that were deleted or aren't shared with this member;
    // anything else may pass on a retry.
    const missing = statusOf(meetingQuery.error) === 404;
    return (
      <ScreenShell back={BACK_TO_MINUTES} title={MEETING_LIST_COPY.title}>
        <ErrorState
          title={
            missing ? MEETING_COPY.missingTitle : MEETING_COPY.loadFailedTitle
          }
          body={
            missing ? MEETING_COPY.missingBody : MEETING_COPY.loadFailedBody
          }
          onRetry={missing ? undefined : () => void meetingQuery.refetch()}
          isRetrying={meetingQuery.isFetching}
        />
      </ScreenShell>
    );
  }
  return (
    <LoadedMinutes
      meeting={meetingQuery.data}
      autoRecord={record}
      // A read that fails answers null, not the copy already held: a version
      // read for a save, a post or Load their version must be the server's.
      refetch={async () => {
        const read = await meetingQuery.refetch();
        return read.isError ? null : (read.data ?? null);
      }}
    />
  );
}

function LoadedMinutes({
  meeting,
  autoRecord,
  refetch,
}: {
  meeting: MeetingMinutes;
  /** Opened by the event's or the +'s Record: ask to record straight away. */
  autoRecord: boolean;
  refetch: () => Promise<MeetingMinutes | null>;
}) {
  const { tokens } = useFrappTheme();
  const { accent, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const router = useRouter();
  const names = useMemberDisplayNames();
  const notesRef = useRef<NotesPanelHandle>(null);
  const summaryRef = useRef<SummaryNoteHandle>(null);
  const [summaryWritten, setSummaryWritten] = useState(false);
  const post = usePostMeeting();
  const [problem, setProblem] = useState<string | null>(null);
  const [draftable, setDraftable] = useState(false);
  // A transcript runs to an hour of lines, so it opens on its own screen
  // rather than under the minutes (Paul, 2026-11-18).
  const openTranscript = () =>
    router.push({
      pathname: "/minutes-transcript",
      params: { id: meeting.id },
    });

  const isDraft = meeting.status === "draft";
  const finishing = isDraft && meeting.can_edit;
  const viewerId =
    (useCurrentUser().data as { id?: string } | undefined)?.id ?? null;
  // Naming the event, moving it and marking who came are the events rule,
  // as on web.
  const canEditEvents = can("events:update", usePermissionList());
  const remove = useDeleteMeeting();
  const detailsSheetRef = useRef<BottomSheetModal>(null);
  const attendanceSheetRef = useRef<BottomSheetModal>(null);
  const scrollRef = useRef<ScrollView>(null);
  // Where the body and each of its sections sit, for the jump bar.
  const bodyY = useRef(0);
  const sectionY = useRef(new Map<MeetingSectionKey, number>());
  const jumpBarHeight = useRef(0);
  const [notice, setNotice] = useState<string | null>(null);
  // The review of the Coming up dates, once the minutes post (#5672).
  const [reviewingDates, setReviewingDates] = useState(false);
  const endDatesReview = useCallback(() => setReviewingDates(false), []);
  const [stopping, setStopping] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menu = useItemMenu();
  const [openedAt] = useState(() => Date.now());
  // Offered where the server has AI and the president has drafting on, which
  // is what the draft routes check; with either off the button would only
  // meet a refusal.
  const ai = useAiSurfaces();
  const notesOffered = ai.meetingNotes;
  const draftQuery = useMeetingDraft(meeting.id, {
    enabled: finishing && notesOffered,
  });
  const draftState = (notesOffered ? draftQuery.data : null) ?? null;
  const drafting = draftState?.status === "drafting";

  // The recorder is offered with drafting, which is what a transcript is for,
  // and only where the server can transcribe.
  const recordingQuery = useMeetingRecording(meeting.id, {
    enabled: finishing && notesOffered,
  });
  const recordingState =
    (finishing && notesOffered ? recordingQuery.data : null) ?? null;
  const recorderOffered = recordingState?.available === true;
  const { ensureConsent, consentSheet } = useAiConsentGate();
  const recorder = useMeetingRecorderRow({
    meetingId: meeting.id,
    eventName: meeting.event_name,
    server: recorderOffered ? recordingState : null,
    ensureConsent,
    autoRecord,
  });
  // A recording this phone holds for this meeting always has its controls
  // here, whatever the server says or hasn't said yet: the pill steps aside
  // on this screen, so without them an open microphone would have no Stop.
  const recorderState = useMeetingRecorder().state;
  const heldHere = recorderMeetingId(recorderState) === meeting.id;
  const recorderShown = (recorderOffered || heldHere) && recorder.shown;
  const busy = recorderBusy(meeting.id, recorderState, recordingState);
  const transcript =
    recordingState?.status === "ready" ? recordingState.transcript : null;
  const steps = recordingPipeline(meeting.id, recorderState, recordingState, {
    drafting,
  });
  const { takersWrote, transcriptReady } = useOtherSources(
    meeting.id,
    recordingState,
  );
  // What the draft reads, for its first step and the review banner, in
  // web's words (`MINUTES_FLOW_COPY`).
  const source = minutesDraftSource({
    notes: draftState?.notes ?? "",
    othersWrote: takersWrote,
    recordingReady: transcriptReady,
  });
  const notesY = useRef(0);

  // The tasks suggested from these minutes, for someone who could accept
  // them. Read only once the minutes are posted, which is what makes them.
  const suggestions = useAiSuggestions({
    source: { type: "meeting", id: meeting.id },
    enabled: !isDraft && ai.available === true,
  });
  const suggested = (suggestions.data?.items ?? []).filter(
    (item) => item.kind === "task" && item.task !== null,
  ).length;

  const content = useMemo(
    () => readMeetingContent(meeting.content),
    [meeting.content],
  );
  const empty = isMeetingContentEmpty(content);
  const actionTasksQuery = useMeetingActionItemTasks(meeting.id, {
    enabled: !isDraft && content.action_items.length > 0,
  });
  const actionTasks = useMemo(
    () =>
      new Map(
        (actionTasksQuery.data ?? []).map((entry) => [entry.index, entry]),
      ),
    [actionTasksQuery.data],
  );
  // Without drafting the note is the minutes' Summary, typed and posted here
  // (#5288); Edit minutes writes the other sections. Only once the AI
  // reads have answered that drafting is off: while they load, or when one
  // failed, an officer's notes must not land in the Summary members read.
  const summaryShown =
    finishing &&
    (ai.available === false || (ai.available === true && ai.ready)) &&
    !notesOffered;
  const rest = useMemo(() => ({ ...content, summary: "" }), [content]);
  const writtenHere = summaryShown && summaryWritten;

  // Edit minutes (#4412): the screen turns into the section editor in place,
  // as the task screen does and the web's page does. A draft saves itself
  // as typing rests; posted minutes keep Save and Cancel.
  const [editing, setEditing] = useState(false);
  const [byHand, setByHand] = useState(false);
  const editor = useMinutesEditor({
    meeting,
    active: editing,
    autosave: isDraft,
    // As on the web: nothing saves while a draft is written over these
    // sections or the minutes are posting.
    paused: drafting || post.isPending,
    reload: refetch,
  });
  // Done or Post found a Coming up row with words and no day.
  const [showProblems, setShowProblems] = useState(false);
  /**
   * A row a save would drop stops Done, Save and Post, and every such row
   * says so, rather than the words vanishing as the editor closes.
   */
  const keepsEveryRow = () => {
    if (!minutesDatesMissingDay(editor.draft.content)) return true;
    setShowProblems(true);
    return false;
  };
  const editingPosted = editing && !isDraft;
  // The note is set aside while the section editor has the Summary.
  const summaryOnPage = summaryShown && !editing;
  // Where drafting is offered the editor shows what the draft filled, with
  // Add a section for the rest; written by hand it lays out the template,
  // as on the web.
  const notesShown = finishing && !!draftState;
  const editorByHand = byHand || !notesShown;
  // A new draft starts the kept sections afresh, as on the web.
  const [keptFor, setKeptFor] = useState(draftState?.requested_at ?? null);
  if ((draftState?.requested_at ?? null) !== keptFor) {
    setKeptFor(draftState?.requested_at ?? null);
    editor.clearKept();
  }
  const myName = viewerId ? names.nameFor(viewerId) : null;
  const review =
    draftState &&
    (draftState.status === "applied" || draftState.status === "ready")
      ? draftState.review
      : null;
  const quoteFor = (kind: "decision" | "action_item", text: string) =>
    meetingDraftQuote(review, kind, text, myName);

  /**
   * Opens the editor on the newest version: the Summary typed on the note
   * is saved first, so the editor starts from it rather than over it.
   */
  async function startEdit(options: { byHand?: boolean } = {}) {
    setProblem(null);
    if (summaryOnPage && summaryRef.current) {
      const saved = await summaryRef.current.flush();
      if (!saved) {
        // Stale, the note already offers their version; otherwise the save
        // failed and the note keeps every word.
        if (!summaryRef.current.isStale()) setProblem(MEETING_COPY.saveFailed);
        return;
      }
    }
    const fresh = (await refetch()) ?? meeting;
    editor.begin(fresh);
    setShowProblems(false);
    setByHand(!!options.byHand);
    setEditing(true);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  /** A draft's Done: what is still waiting saves, then the read view. */
  const [finishingEdit, setFinishingEdit] = useState(false);
  async function finishEdit() {
    if (finishingEdit) return;
    Keyboard.dismiss();
    if (!keepsEveryRow()) return;
    setFinishingEdit(true);
    const saved = editor.isStale() ? null : await editor.save();
    setFinishingEdit(false);
    // A save that didn't land keeps the editor, with every word, and says why.
    if (saved) {
      setEditing(false);
      setByHand(false);
    }
  }

  /** Posted minutes' Save: the read view once it lands. */
  async function saveEdit() {
    Keyboard.dismiss();
    setProblem(null);
    if (!keepsEveryRow()) return;
    const saved = await editor.save();
    if (!saved) {
      if (!editor.isStale()) setProblem(MINUTES_EDITOR_COPY.saveFailedTitle);
      return;
    }
    setEditing(false);
    say(MINUTES_EDITOR_COPY.savedToast);
  }

  function cancelEdit() {
    Keyboard.dismiss();
    editor.discard();
    setProblem(null);
    setEditing(false);
  }

  // Leaving posted minutes with changes not saved asks first, by the back
  // row, the edge swipe or Android's back, as Apple Notes' shared notes
  // and Google Docs do. A draft saves as it goes and asks only when its
  // words can't be sent on the way out: refused as stale, a save that
  // failed, or a draft being written over it.
  const navigation = useContext(NavigationContext);
  const leaveLoses =
    editing &&
    editor.dirty &&
    (editingPosted || editor.stale || editor.failed || drafting);
  usePreventRemove(leaveLoses, ({ data }) => {
    void confirmAlert({
      title: MINUTES_EDITOR_COPY.discardTitle,
      body: MINUTES_EDITOR_COPY.discardBody,
      confirmLabel: MINUTES_EDITOR_COPY.discard,
      cancelLabel: MINUTES_EDITOR_COPY.keepEditing,
      destructive: true,
    }).then((yes) => {
      if (yes) navigation?.dispatch(data.action);
    });
  });

  const meetingRefresh = useCallback(() => refetch(), [refetch]);
  const refresh = useRefetchAll([
    { refetch: meetingRefresh },
    draftQuery,
    recordingQuery,
    suggestions,
  ]);

  async function handlePost() {
    setProblem(null);
    // No "are you sure" (Paul, 2026-11-16): posting is the officer's plain
    // intent, and posted minutes can still be edited.
    // The Summary typed here is saved first; a save refused as stale stops
    // the post, and the note offers their version. Then the version to post
    // is whatever the server holds now, read fresh.
    if (summaryOnPage && !(await summaryRef.current?.flush())) {
      setProblem(MEETING_COPY.postFailed);
      return;
    }
    // From the editor: what is still waiting saves first, and the read view
    // shows while the post lands, as on the web. A save refused as stale
    // keeps the editor and offers their version.
    if (editing) {
      Keyboard.dismiss();
      if (!keepsEveryRow()) return;
      const saved = await editor.save();
      if (!saved) {
        if (!editor.isStale()) setProblem(MEETING_COPY.postFailed);
        return;
      }
      setEditing(false);
      setByHand(false);
    }
    const expectedUpdatedAt = (await refetch())?.updated_at ?? null;
    if (!expectedUpdatedAt) {
      setProblem(MEETING_COPY.postFailed);
      return;
    }
    try {
      await post.mutateAsync({
        id: meeting.id,
        expectedUpdatedAt,
      });
    } catch (error) {
      setProblem(errorCopy(error, MEETING_COPY.postFailed));
      return;
    }
    setReviewingDates(true);
  }

  const type = meetingTypeLabel(
    meeting.meeting_type as MeetingType,
    meeting.other_label,
  );

  function say(line: string) {
    setNotice(line);
    AccessibilityInfo.announceForAccessibility(line);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
  }

  async function copyLink() {
    try {
      await Clipboard.setStringAsync(
        `${webAppOrigin()}/meetings/${meeting.id}`,
      );
      say(MINUTES_READ_COPY.linkCopied);
    } catch {
      say("Couldn't copy the link");
    }
  }

  async function handleDelete() {
    const yes = await confirmAlert({
      title: "Delete these minutes?",
      body: isDraft
        ? "The draft is gone for good. The event stays on the calendar."
        : "Nobody can read them after this. The event stays on the calendar.",
      confirmLabel: MINUTES_READ_COPY.menu.delete,
      destructive: true,
    });
    if (!yes) return;
    try {
      await remove.mutateAsync(meeting.id);
      router.back();
    } catch (error) {
      setProblem(errorCopy(error, "Couldn't delete the minutes."));
    }
  }

  const openEvent = () => {
    if (!meeting.event_id) return;
    router.push({
      pathname: "/event-details",
      params: { id: meeting.event_id },
    });
  };
  // Marking by hand waits for the meeting to end, as on web: a member
  // marked while check-in is open could no longer check in themselves.
  const ended =
    Date.parse(meeting.event_end_time ?? meeting.event_start_time) <= openedAt;
  const canBackfill = !!meeting.event_id && canEditEvents && ended;
  const hasTranscript = !!meeting.transcript?.trim() || !!transcript;

  // The ⋯ menu (#5562): web's items, in web's order.
  const words = MINUTES_READ_COPY.menu;
  const menuActions = (): ItemMenuAction[] => [
    ...(meeting.can_edit
      ? [
          {
            key: "details",
            label: words.editDetails,
            glyph: (color: string) => <SlidersGlyph color={color} />,
            run: () => detailsSheetRef.current?.present(),
          },
        ]
      : []),
    // Not while a draft is being written into the sections.
    ...(meeting.can_edit && !drafting
      ? [
          {
            key: "edit",
            label: words.editMinutes,
            glyph: (color: string) => <PencilGlyph color={color} />,
            run: () => void startEdit(),
          },
        ]
      : []),
    ...(finishing && !empty && !drafting && !!draftState
      ? [
          {
            key: "notes",
            label: MINUTES_FLOW_COPY.review.notes,
            glyph: (color: string) => <ListGlyph color={color} />,
            run: scrollToNotes,
          },
        ]
      : []),
    ...(canBackfill
      ? [
          {
            key: "attendance",
            label: words.attendance,
            glyph: (color: string) => <PersonGlyph color={color} />,
            run: () => attendanceSheetRef.current?.present(),
          },
        ]
      : []),
    {
      key: "copy",
      label: words.copyLink,
      glyph: (color: string) => <LinkGlyph color={color} />,
      run: () => void copyLink(),
    },
    ...(meeting.event_id
      ? [
          {
            key: "event",
            label: words.openEvent,
            glyph: (color: string) => <CalendarPlusGlyph color={color} />,
            run: openEvent,
          },
        ]
      : []),
    ...(hasTranscript
      ? [
          {
            key: "transcript",
            label: words.transcript,
            glyph: (color: string) => <ListGlyph color={color} />,
            run: openTranscript,
          },
        ]
      : []),
    ...(meeting.can_delete
      ? [
          {
            key: "delete",
            label: words.delete,
            destructive: true,
            glyph: (color: string) => <TrashGlyph color={color} />,
            run: () => void handleDelete(),
          },
        ]
      : []),
  ];
  // Built on the press, so the sheets' refs are read then, not while drawing.
  const openMenu = () =>
    menu
      .handleFor({ title: meeting.event_name, actions: menuActions() })
      ?.open();

  // The one thing at the bottom (Paul, 2026-11-17): the recorder's controls
  // while it records or needs the officer, else Post once the minutes have
  // words, else Draft minutes once there is something to draft from, else
  // the recorder's quieter steps (Record, Open Settings after a refusal),
  // which never stand in the way of posting.
  const recorderFooter =
    recorderShown && (recorder.view.live || recorder.primary) ? (
      <RecorderControls row={recorder} />
    ) : null;
  const recordLeads = recorder.primary?.does === "record";
  const recorderLeads =
    !!recorder.view.live ||
    (!!recorder.primary &&
      recorder.primary.does !== "record" &&
      recorder.primary.does !== "open_settings");
  // Words in the editor count as something to post, saved or not yet.
  const postable = editing
    ? !isMeetingContentEmpty(cleanMeetingContent(editor.draft.content))
    : !empty || writtenHere;
  let footer: ReactNode = null;
  // An open microphone always keeps its Stop, even over an edit.
  const recorderHolds = heldHere && !!recorderFooter && recorderLeads;
  if (editingPosted && !recorderHolds) {
    // Posted minutes keep Save and Cancel: members already read them.
    footer = (
      <View style={styles.editBar}>
        <TextAction
          label={MINUTES_EDITOR_COPY.cancel}
          color={tokens.color.text.foreground}
          disabled={editor.saving}
          onPress={cancelEdit}
        />
        <View style={styles.editBarMain}>
          <SheetPrimaryButton
            label={
              editor.dirty || editor.saving
                ? MINUTES_EDITOR_COPY.save
                : MINUTES_EDITOR_COPY.saved
            }
            busy={editor.saving}
            disabled={editor.saving || !editor.dirty || editor.stale}
            onPress={() => void saveEdit()}
            accent={accent}
            onAccent={accentOnPrimary}
          />
        </View>
      </View>
    );
  } else if (finishing || heldHere) {
    if (recorderFooter && recorderLeads) footer = recorderFooter;
    else if (finishing && drafting) {
      // While the minutes are written, what is happening and Stop are the
      // one thing at the bottom (#5562; Paul, 2026-11-19: they were buried
      // under a long paste, with Record still pinned).
      footer = (
        <View style={styles.draftingBar}>
          <ActivityIndicator color={tokens.color.text.mutedForeground} />
          <DraftingClockLine
            requestedAt={
              draftState?.status === "drafting" ? draftState.requested_at : null
            }
            style={styles.draftingText}
          />
          <TextAction
            label={MINUTES_FLOW_COPY.drafting.stop}
            color={tokens.color.text.foreground}
            disabled={stopping}
            onPress={() => {
              setStopping(true);
              void notesRef.current?.stop().finally(() => setStopping(false));
            }}
          />
        </View>
      );
    } else if (finishing && !busy && !drafting && postable) {
      footer = (
        <SheetPrimaryButton
          label={MEETING_COPY.post}
          busy={post.isPending}
          disabled={post.isPending || (editing && editor.stale)}
          onPress={() => void handlePost()}
          accent={accent}
          onAccent={accentOnPrimary}
        />
      );
    } else if (finishing && draftState && draftable && !busy && !drafting) {
      footer = (
        <SheetPrimaryButton
          label={MEETING_NOTES_COPY.draft}
          onPress={() => void notesRef.current?.draft()}
          accent={accent}
          onAccent={accentOnPrimary}
        />
      );
    } else if (recorderFooter) footer = recorderFooter;
  }

  // A draft in the minutes: one line above them says so, with the notes a
  // tap away, as web's banner (Paul, 2026-11-19).
  const reviewing =
    finishing &&
    !editing &&
    !empty &&
    !drafting &&
    draftState?.status === "applied";
  const scrollToNotes = () =>
    scrollRef.current?.scrollTo({
      y: Math.max(0, notesY.current - tokens.spacing.md),
      animated: true,
    });
  const notes =
    finishing && draftState ? (
      <NotesPanel
        ref={notesRef}
        meetingId={meeting.id}
        eventStart={meeting.event_start_time}
        state={draftState}
        hasContent={!empty}
        recording={recorderOffered ? recordingState : null}
        // Asking for a draft from under the editor sends what is typed
        // first, so the draft builds on it rather than strand it; a save
        // that doesn't land stops the ask, with every word kept.
        getVersion={async () => {
          if (editing && !(await editor.save())) return null;
          return (await refetch())?.updated_at ?? null;
        }}
        onSettled={() => void refetch()}
        autoDraft={!!transcript && empty}
        onDraftable={setDraftable}
        stopInFooter
        bannerAbove={reviewing}
      />
    ) : null;
  // The minutes to review. While the recorder works and nothing is written
  // there is nothing to show, so the note has the screen.
  const bodyHidden =
    (empty && finishing && (busy || recordLeads || drafting)) ||
    // Typed on the note, or nothing written yet: the note is the page.
    (summaryShown && isMeetingContentEmpty(rest)) ||
    (finishing && empty && !!notes);
  const shownContent = summaryShown ? rest : content;
  const body = bodyHidden ? null : (
    <View
      onLayout={(event) => {
        bodyY.current = event.nativeEvent.layout.y;
      }}
    >
      <MinutesBody
        meeting={meeting}
        content={shownContent}
        nameFor={names.nameFor}
        viewerId={viewerId}
        tasks={actionTasks}
        onSectionLayout={(key, y) => sectionY.current.set(key, y)}
        renderDates={(dates) => (
          <ComingUpDates
            meetingId={meeting.id}
            dates={dates}
            viewerId={viewerId}
          />
        )}
      />
    </View>
  );
  // The jump bar, pinned over the minutes as they scroll (#5562). Only on
  // minutes being read: an officer finishing a draft has the note instead.
  const jumps =
    bodyHidden || finishing || editing
      ? []
      : minutesJumps(
          minutesReadSections(meeting.sections, shownContent),
          shownContent,
        );
  const meta = [
    minutesMetaHead(meeting, type),
    isDraft
      ? MEETING_COPY.draftBadge
      : MEETING_COPY.posted(meetingDayLabel(meeting.posted_at)),
  ].join(" · ");

  return (
    <>
      <ScreenShell
        back={BACK_TO_MINUTES}
        backAction={
          editingPosted ? null : editing ? (
            // A draft's editor: its save state where the web's bar has it,
            // and Done, which saves what is waiting and goes back to reading.
            <View style={styles.editHeader}>
              {editor.saveLine && !drafting ? (
                <Text
                  accessibilityLiveRegion="polite"
                  style={[styles.meta, editor.failed ? styles.problem : null]}
                >
                  {editor.saveLine}
                </Text>
              ) : null}
              <HeaderButton
                label={MINUTES_EDITOR_COPY.done}
                hint="Saves what you're typing and goes back to reading."
                disabled={finishingEdit}
                onPress={() => void finishEdit()}
              >
                <CheckGlyph color={accent} />
              </HeaderButton>
            </View>
          ) : (
            <HeaderButton
              label={words.label}
              hint="Opens what you can do with these minutes."
              onPress={openMenu}
            >
              <MoreGlyph color={tokens.color.text.foreground} />
            </HeaderButton>
          )
        }
        title={meeting.event_name}
        // One line instead of a row of chips (#5562): what kind, when, and
        // whether it is posted.
        subtitle={meta}
        scrollRef={scrollRef}
        refresh={refresh}
        keyboardShouldPersistTaps="handled"
        avoidKeyboard={finishing || editing}
        footer={
          footer || problem || notice ? (
            <>
              {notice ? (
                <Text accessibilityLiveRegion="polite" style={styles.meta}>
                  {notice}
                </Text>
              ) : null}
              {problem ? (
                <Text
                  accessibilityLiveRegion="polite"
                  style={[styles.meta, styles.problem]}
                >
                  {problem}
                </Text>
              ) : null}
              {footer}
            </>
          ) : undefined
        }
      >
        {jumps.length > 0 ? (
          <StickyHeader>
            <View
              onLayout={(event) => {
                jumpBarHeight.current = event.nativeEvent.layout.height;
              }}
            >
              <MinutesJumpBar
                jumps={jumps}
                onJump={(jump) => {
                  const y = sectionY.current.get(jump.key);
                  if (y === undefined) return;
                  scrollRef.current?.scrollTo({
                    y: Math.max(
                      0,
                      bodyY.current +
                        y -
                        jumpBarHeight.current -
                        tokens.spacing.sm,
                    ),
                    animated: true,
                  });
                }}
              />
            </View>
          </StickyHeader>
        ) : null}

        {recorderShown ? <RecorderStage row={recorder} steps={steps} /> : null}

        {/* A draft from notes or a paste: its steps and clock. A recording's
            draft shows the recorder's four steps above instead. */}
        {finishing && drafting && !steps ? (
          <DraftingSteps
            source={source}
            requestedAt={draftState?.requested_at ?? null}
          />
        ) : null}

        {/* The start box's question, as on web: nothing is written yet. */}
        {finishing &&
        empty &&
        !editing &&
        !drafting &&
        !steps &&
        notes &&
        !busy ? (
          <View style={styles.start}>
            <Text accessibilityRole="header" style={styles.startTitle}>
              {MINUTES_FLOW_COPY.start.heading}
            </Text>
            <Text style={styles.meta}>{MINUTES_FLOW_COPY.start.hint}</Text>
            {/* Beside Draft minutes on the web; quiet here, under the
                question, since Record holds the bottom. */}
            <TextAction
              label={MINUTES_FLOW_COPY.start.byHand}
              color={accent}
              onPress={() => void startEdit({ byHand: true })}
            />
          </View>
        ) : null}

        {reviewing ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              {MINUTES_FLOW_COPY.review.banner(source)}
            </Text>
            <TextAction
              label={MINUTES_FLOW_COPY.review.notes}
              color={accent}
              onPress={scrollToNotes}
            />
          </View>
        ) : null}

        {summaryOnPage ? (
          <SummaryNote
            ref={summaryRef}
            meeting={meeting}
            reload={refetch}
            onWritten={setSummaryWritten}
            onEditAll={() => void startEdit({ byHand: true })}
          />
        ) : null}

        {/* Before anything is drafted the notes are the page; once the
            minutes are in they lead and the notes sit under them. The notes
            keep one slot, so the minutes arriving never remounts the box
            being typed in. */}
        {editing ? (
          <MinutesEditor
            meeting={meeting}
            editing={editor}
            byHand={editorByHand}
            disabled={drafting}
            showProblems={showProblems}
            quoteFor={quoteFor}
            menuFor={menu.handleFor}
            onMarkAttendance={
              canBackfill
                ? () => attendanceSheetRef.current?.present()
                : undefined
            }
          />
        ) : empty ? null : (
          body
        )}
        {notes ? (
          <View
            onLayout={(event) => {
              notesY.current = event.nativeEvent.layout.y;
            }}
          >
            {notes}
          </View>
        ) : null}
        {!editing && empty ? body : null}

        {!editing && transcript && recordingState ? (
          <View style={styles.transcript}>
            {recordingState.audio_url ? (
              <RecordingPlayer
                url={recordingState.audio_url}
                durationSeconds={recordingState.duration_seconds ?? 0}
              />
            ) : null}
            <ListSection>
              <ListRow
                label={MEETING_RECORDER_COPY.transcriptRow(
                  recordingState.duration_seconds ?? 0,
                )}
                accessibilityHint={MEETING_COPY.transcriptHint}
                onPress={openTranscript}
              />
            </ListSection>
          </View>
        ) : null}

        {/* Posted minutes keep their recording's transcript (#5410). */}
        {!editing && !transcript && meeting.transcript ? (
          <View style={styles.transcript}>
            <ListSection>
              <ListRow
                label={MEETING_COPY.transcript}
                accessibilityHint={MEETING_COPY.transcriptHint}
                onPress={openTranscript}
              />
            </ListSection>
          </View>
        ) : null}

        {/* Under the minutes, so its arrival after the read moves nothing
            the member is reading. */}
        {!editing && suggested > 0 ? (
          <ListSection>
            <ListRow
              label={MEETING_COPY.suggestedTasks}
              value={String(suggested)}
              accessibilityHint="Opens the tasks suggested from these minutes."
              onPress={() =>
                router.push({
                  pathname: "/suggested-tasks",
                  params: { meetingId: meeting.id },
                })
              }
            />
          </ListSection>
        ) : null}
      </ScreenShell>
      {recorder.sheets}
      {consentSheet}
      {menu.element}
      {meeting.can_edit ? (
        <MinutesDetailsSheet
          ref={detailsSheetRef}
          meeting={meeting}
          canEditEvent={canEditEvents}
          getVersion={async () => (await refetch())?.updated_at ?? null}
          onSaved={() => {
            void refetch();
            say(MINUTES_READ_COPY.details.saved);
          }}
          onOpenEvent={openEvent}
        />
      ) : null}
      {reviewingDates ? (
        <ComingUpPostReview
          meetingId={meeting.id}
          content={content}
          viewerId={viewerId}
          onDone={endDatesReview}
          onTracked={say}
        />
      ) : null}
      {canBackfill && meeting.event_id ? (
        <MarkAttendanceSheet
          ref={attendanceSheetRef}
          eventId={meeting.event_id}
          attendees={meeting.attendees}
          onMarked={(line) => {
            void refetch();
            say(line);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The minutes while they load: shaped like the sections they will fill. The
 * screen's title already names the meeting when the list had it (`row`).
 */
function MinutesSkeleton({
  row = null,
}: {
  row?: Pick<MeetingSummary, "event_name"> | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { body, caption } = tokens.typography.role;
  return (
    <SkeletonRegion
      label={row ? `Loading ${row.event_name}` : "Loading minutes"}
      style={styles.skeleton}
    >
      <SkeletonText role={caption} width="30%" />
      <SkeletonText role={body} width="92%" />
      <SkeletonText role={body} width="84%" />
      <SkeletonText role={body} width="60%" />
      <SkeletonText role={caption} width="34%" />
      <SkeletonText role={body} width="88%" />
      <SkeletonText role={body} width="70%" />
    </SkeletonRegion>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    problem: {
      color: tokens.color.semantic.destructiveText,
    },
    draftingBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: 52,
    },
    draftingText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    transcript: {
      gap: tokens.spacing.sm,
    },
    skeleton: {
      gap: tokens.spacing.md,
    },
    start: {
      gap: tokens.spacing.xs,
    },
    startTitle: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    editHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    editBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.lg,
    },
    editBarMain: {
      flex: 1,
    },
    banner: {
      gap: tokens.spacing.sm,
      padding: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      backgroundColor: tokens.color.surface.card,
    },
    bannerText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
  });
}
