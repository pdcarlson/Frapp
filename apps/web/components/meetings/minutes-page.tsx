"use client";

import {
  type ComponentProps,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  FileText,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  UserCheck,
  X,
} from "lucide-react";
import { codeOf, statusOf } from "@repo/api-sdk";
import {
  useChapterRoster,
  useCurrentUser,
  useDeleteMeeting,
  useEvent,
  useMeeting,
  useMeetingActionItemTasks,
  useMeetingDraft,
  useMeetingNotes,
  useMeetingRecording,
  useMemberDisplayNames,
  usePermissionList,
  usePostMeeting,
  useUpdateMeeting,
  type MeetingDraftState,
  type MeetingNotesState,
  type MeetingRecordingState,
  type MeetingMinutes,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import {
  MEETING_COPY,
  MEETING_DATES_MAX_ITEMS,
  MEETING_DECISION_HEADLINE_MAX_LENGTH,
  MEETING_ITEM_TEXT_MAX_LENGTH,
  MEETING_LIST_MAX_ITEMS,
  MEETING_TABLED_MAX_ITEMS,
  MEETING_TABLED_MAX_TIMES,
  MEETING_TEXT_MAX_LENGTH,
  MEETING_VOTE_MAX,
  MINUTES_PREVIEW,
  MINUTES_READ_COPY,
  can,
  isMeetingContentEmpty,
  meetingDraftQuoteFor,
  meetingDraftSourceFor,
  MEETING_NOTE_TAKERS_COPY,
  meetingTypeLabel,
  minutesJumps,
  minutesReadSections,
  readMeetingContent,
  shownMeetingSections,
  type MeetingActionItem,
  type MeetingContent,
  type MeetingDateItem,
  type MeetingDecision,
  type MeetingSectionKey,
  type MeetingTabledItem,
  type MeetingTextSection,
  type MeetingType,
  agendaMatterKey,
  meetingTabledFromLabel,
  readEventAgenda,
} from "@repo/validation";
import { ErrorState } from "@/components/shared/async-states";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  InlineNote,
  inlineNoteActionClassName,
} from "@/components/shared/inline-note";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { EYEBROW } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DueDateField } from "@/components/tasks/due-date-field";
import { useToast } from "@/lib/hooks/use-toast";
import { cn, getErrorMessage } from "@/lib/utils";
import { useGrowWithText } from "@/lib/hooks/use-grow-with-text";
import { LinkEventPanel } from "@/components/meetings/link-event";
import { NotesDraftPanel } from "@/components/meetings/notes-draft-panel";
import { AttendanceBackfill } from "@/components/meetings/attendance-backfill";
import { SuggestedTasks } from "@/components/ai/suggested-tasks";
import { MinutesPageSkeleton } from "@/components/meetings/meetings-skeleton";
import {
  meetingDayLabel,
  meetingWhenLabel,
  sectionLabel,
} from "@/components/meetings/meeting-copy";
import {
  ActionChecklist,
  Attendees,
  DatesView,
  DecisionsView,
  LinesView,
  MinutesJumpBar,
  MinutesRow,
  TabledView,
  TldrBlock,
  TopicsView,
  attendanceDetail,
  hasAttendees,
} from "@/components/meetings/minutes-read";
import {
  MinutesDetailsDialog,
  type MinutesTypeValue,
} from "@/components/meetings/minutes-details-dialog";

/** The Select value for an action item nobody was named for. */
const NO_OWNER = "none";

type Draft = {
  meeting_type: MeetingType;
  other_label: string;
  content: MeetingContent;
};

function draftOf(meeting: MeetingMinutes): Draft {
  return {
    meeting_type: meeting.meeting_type as MeetingType,
    other_label: meeting.other_label ?? "",
    content: readMeetingContent(meeting.content),
  };
}

/** What a save sends: blank rows dropped and text trimmed at the ends. */
function cleanContent(content: MeetingContent): MeetingContent {
  return {
    ...content,
    decisions: content.decisions
      .map((decision) => ({
        ...decision,
        text: decision.text.trim(),
        headline: decision.headline?.trim() || null,
      }))
      .filter((decision) => decision.text.length > 0),
    dates: content.dates
      .map((item) => ({ ...item, text: item.text.trim() }))
      .filter((item) => item.text.length > 0 && item.date.length > 0),
    action_items: content.action_items
      .map((item) => ({ ...item, text: item.text.trim() }))
      .filter((item) => item.text.length > 0),
    tabled: content.tabled
      .map((item) => ({ ...item, text: item.text.trim() }))
      .filter((item) => item.text.length > 0),
  };
}

/**
 * A draft as a save would store it: blank rows gone, ends trimmed. Two
 * drafts that only differ in a trailing space are the same, so a pause
 * after typing a space saves nothing and nothing typed is trimmed away.
 */
function storedForm(draft: Draft): string {
  const content = cleanContent(draft.content);
  const text = Object.fromEntries(
    Object.entries(content).map(([key, value]) => [
      key,
      typeof value === "string" ? value.trim() : value,
    ]),
  );
  return JSON.stringify({
    meeting_type: draft.meeting_type,
    other_label: draft.meeting_type === "other" ? draft.other_label.trim() : "",
    content: text,
  });
}

function sameDraft(a: Draft, b: Draft): boolean {
  return storedForm(a) === storedForm(b);
}

/**
 * How long a draft's typing rests before it saves on its own, the way Google
 * Docs and Notion save (Paul, 2026-11-16: no Save button to chase).
 */
const AUTOSAVE_MS = 1200;

/**
 * `/meetings/:id`: one meeting's minutes (`spec/behavior/meetings.md`). Read
 * as a document for everyone who may see them; written in place by their
 * author, or by someone who can edit any minutes, the way a Notion page or a
 * Google Doc turns into its own editor rather than opening a form over it.
 */
export function MinutesPage({ id }: { id: string }) {
  const query = useMeeting(id);
  // Whether drafting from notes is here is known before the editor shows, so
  // the notes box never arrives late and pushes the sections down.
  const drafts =
    !!query.data && query.data.status === "draft" && query.data.can_edit;
  const draftQuery = useMeetingDraft(id, { enabled: drafts });
  // The same for the recording row inside that box, and the note-takers
  // listed under it (#4935).
  const recordingQuery = useMeetingRecording(id, { enabled: drafts });
  const notesQuery = useMeetingNotes(id, { enabled: drafts });
  if (
    query.isPending ||
    (drafts &&
      (draftQuery.isPending ||
        recordingQuery.isPending ||
        notesQuery.isPending))
  ) {
    return <MinutesPageSkeleton />;
  }
  if (!query.data) {
    const missing = statusOf(query.error) === 404;
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <ErrorState
          title={
            missing ? MEETING_COPY.missingTitle : MEETING_COPY.loadFailedTitle
          }
          description={
            missing ? MEETING_COPY.missingBody : MEETING_COPY.loadFailedBody
          }
          onRetry={missing ? undefined : () => void query.refetch()}
        />
        <p className="text-center text-sm">
          <Link href="/meetings" className={inlineNoteActionClassName}>
            Back to Meetings
          </Link>
        </p>
      </div>
    );
  }
  return (
    <Minutes
      key={query.data.id}
      meeting={query.data}
      draftState={drafts ? (draftQuery.data ?? null) : null}
      recordingState={drafts ? (recordingQuery.data ?? null) : null}
      notesState={drafts ? (notesQuery.data ?? null) : null}
      onReload={async () => (await query.refetch()).data}
    />
  );
}

function Minutes({
  meeting,
  draftState,
  recordingState,
  notesState,
  onReload,
}: {
  meeting: MeetingMinutes;
  /** Where drafting from notes stands; null when it isn't offered here. */
  draftState: MeetingDraftState | null;
  recordingState: MeetingRecordingState | null;
  notesState: MeetingNotesState | null;
  onReload: () => Promise<MeetingMinutes | undefined>;
}) {
  const ids = useId();
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const update = useUpdateMeeting();
  const post = usePostMeeting();
  const remove = useDeleteMeeting();
  const names = useMemberDisplayNames();
  const viewer = useCurrentUser().data as { id?: string } | undefined;
  // Marking attendance is the events rule, the same as on the event's own
  // attendance list: it counts toward points.
  // The same rule names the event and moves its time in Edit details.
  const canEditEvents = can("events:update", usePermissionList());
  const canMarkAttendance = canEditEvents;
  const myName = viewer?.id ? names.nameFor(viewer.id) : null;

  const isDraft = meeting.status === "draft";
  const actionItemTasksQuery = useMeetingActionItemTasks(meeting.id, {
    enabled: !isDraft && meeting.content.action_items.length > 0,
  });
  const actionItemTasks = useMemo(
    () =>
      new Map(
        (actionItemTasksQuery.data ?? []).map((entry) => [entry.index, entry]),
      ),
    [actionItemTasksQuery.data],
  );
  const [editing, setEditing] = useState(meeting.can_edit && isDraft);
  const [base, setBase] = useState(() => draftOf(meeting));
  const [draft, setDraft] = useState(base);
  // The version `base` was read from. Every save and post names it, so a save
  // made on an older version is refused rather than overwriting a newer one.
  const [loadedAt, setLoadedAt] = useState(meeting.updated_at);
  const [stale, setStale] = useState(false);
  // Posting switches to the read view at once (Paul, 2026-11-16); the post
  // itself lands a moment later, and a failure puts the editor back.
  const [posting, setPosting] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const dirty = !sameDraft(draft, base);
  // The latest of each, for saves that finish after more typing.
  const draftRef = useRef(draft);
  const loadedAtRef = useRef(loadedAt);
  const baseRef = useRef(base);
  useLayoutEffect(() => {
    draftRef.current = draft;
    baseRef.current = base;
    loadedAtRef.current = loadedAt;
  });
  // One save at a time: a second waits for the first, so two never race on
  // the same version and refuse each other as stale.
  const inFlight = useRef<Promise<MeetingMinutes | null> | null>(null);
  // While a draft is being written the sections are about to be replaced, so
  // they wait: typing into them now would be lost or would strand the draft.
  const drafting = draftState?.status === "drafting";
  const busy = post.isPending || posting || drafting;
  const showNotes =
    !!draftState && isDraft && editing && draftState.blocked !== "chapter_off";
  const review =
    draftState &&
    (draftState.status === "applied" || draftState.status === "ready")
      ? draftState.review
      : null;

  function adopt(next: MeetingMinutes) {
    const fresh = draftOf(next);
    setBase(fresh);
    setDraft(fresh);
    setLoadedAt(next.updated_at);
  }

  // A newer version arrived (a refetch on focus, someone else's save). With
  // nothing typed, show it; with typing on screen, keep the typing and let
  // the next save be refused as stale, so nothing is lost either way.
  if (
    Date.parse(meeting.updated_at) > Date.parse(loadedAt) &&
    !dirty &&
    !busy &&
    !update.isPending
  ) {
    adopt(meeting);
  }

  // Leaving with unsaved words asks first, as Google Docs does offline.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // The editor's sections: the template's, and any with words in it.
  const shown = useMemo(
    () =>
      shownMeetingSections(
        meeting.sections as MeetingSectionKey[],
        draft.content,
      ),
    [draft.content, meeting.sections],
  );

  function editContent(patch: Partial<MeetingContent>) {
    setDraft((current) => ({
      ...current,
      content: { ...current.content, ...patch },
    }));
  }

  /**
   * Save what is on screen, and answer the stored minutes, or null when the
   * save didn't land. Typing that arrives while it saves stays on screen and
   * goes with the next save.
   */
  async function save(): Promise<MeetingMinutes | null> {
    // Every save waiting on this one checks again when it ends, so two never
    // go out on the same version.
    while (inFlight.current) await inFlight.current;
    const sent = draftRef.current;
    // Nothing new to store: the version on screen is the one to build on.
    if (sameDraft(sent, baseRef.current)) {
      return { ...meeting, updated_at: loadedAtRef.current };
    }
    const run = (async () => {
      const content = cleanContent(sent.content);
      const otherLabel = sent.other_label.trim();
      try {
        const saved = await update.mutateAsync({
          id: meeting.id,
          body: {
            expected_updated_at: loadedAtRef.current,
            meeting_type: sent.meeting_type,
            other_label:
              sent.meeting_type === "other" && otherLabel ? otherLabel : null,
            content,
          },
        });
        setSaveFailed(false);
        loadedAtRef.current = saved.updated_at;
        baseRef.current = draftOf(saved);
        setLoadedAt(saved.updated_at);
        // The screen keeps what is typed, untrimmed and with rows still being
        // filled in; it counts as saved because it stores the same.
        setBase(draftOf(saved));
        return saved;
      } catch (error) {
        if (codeOf(error) === "meeting.stale") {
          setStale(true);
          return null;
        }
        setSaveFailed(true);
        toast({
          title: "Couldn't save the minutes",
          description: getErrorMessage(error, "Try again in a moment."),
          variant: "destructive",
        });
        return null;
      }
    })();
    inFlight.current = run;
    try {
      return await run;
    } finally {
      if (inFlight.current === run) inFlight.current = null;
    }
  }

  // A draft saves itself once typing rests. Posted minutes keep Save and
  // Cancel: an edit there changes what members already read.
  const autosaves = editing && isDraft && !posting;
  const pendingAutosave = autosaves && dirty && !stale && !drafting;
  useEffect(() => {
    if (!pendingAutosave || saveFailed) return;
    const timer = window.setTimeout(() => void save(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
    // `save` reads the latest draft through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutosave, saveFailed, draft]);

  // Leaving the page inside the app (a nav link) sends what is still
  // waiting to save, as the notes box does.
  const flushOnLeave = useRef(() => {});
  useEffect(() => {
    flushOnLeave.current = () => {
      if (autosaves && !stale && !sameDraft(draftRef.current, baseRef.current))
        void save();
    };
  });
  useEffect(() => () => flushOnLeave.current(), []);

  async function handleSave() {
    const saved = await save();
    if (saved && saved.status === "posted") setEditing(false);
    if (saved) toast({ title: "Minutes saved" });
  }

  /**
   * Post with no question first (Paul, 2026-11-16): the read view shows at
   * once, and a failure brings the editor back with every word kept.
   */
  async function handlePost() {
    setPosting(true);
    setEditing(false);
    const restore = () => {
      setPosting(false);
      setEditing(true);
    };
    const expectedUpdatedAt = dirty
      ? (await save())?.updated_at
      : loadedAtRef.current;
    if (!expectedUpdatedAt) {
      restore();
      return;
    }
    try {
      const posted = await post.mutateAsync({
        id: meeting.id,
        expectedUpdatedAt,
      });
      adopt(posted);
      setPosting(false);
      toast({ title: MEETING_COPY.posted_toast });
    } catch (error) {
      restore();
      if (codeOf(error) === "meeting.stale") {
        setStale(true);
        return;
      }
      toast({
        title: MEETING_COPY.postFailed,
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  async function handleDelete() {
    const answer = await confirm({
      title: "Delete these minutes?",
      description: isDraft
        ? "The draft is gone for good. The event stays on the calendar."
        : "Nobody can read them after this. The event stays on the calendar.",
      confirmLabel: "Delete minutes",
      tone: "destructive",
    });
    if (!answer) return;
    try {
      await remove.mutateAsync(meeting.id);
      toast({ title: "Minutes deleted" });
      router.push("/meetings");
    } catch (error) {
      toast({
        title: "Couldn't delete the minutes",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  async function loadTheirs() {
    const fresh = await onReload();
    if (!fresh) {
      toast({
        title: "Couldn't load their version",
        description: "Check your connection and try again.",
        variant: "destructive",
      });
      return;
    }
    adopt(fresh);
    setStale(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ title: MINUTES_READ_COPY.linkCopied });
    } catch {
      toast({ title: "Couldn't copy the link", variant: "destructive" });
    }
  }

  /**
   * Edit details' type, saved on its own: the minutes' words being typed
   * stay on screen and go with their own save (#5562).
   */
  async function saveType(next: MinutesTypeValue): Promise<boolean> {
    // Held as a save is, so an autosave that starts meanwhile waits for it
    // and goes out on the version it lands on, not the one it replaced.
    while (inFlight.current) await inFlight.current;
    const otherLabel = next.other_label.trim();
    const typeOnly = {
      meeting_type: next.meeting_type,
      other_label: next.meeting_type === "other" ? next.other_label : "",
    };
    const run = (async (): Promise<MeetingMinutes | null> => {
      try {
        const saved = await update.mutateAsync({
          id: meeting.id,
          body: {
            expected_updated_at: loadedAtRef.current,
            meeting_type: next.meeting_type,
            other_label:
              next.meeting_type === "other" && otherLabel ? otherLabel : null,
          },
        });
        loadedAtRef.current = saved.updated_at;
        baseRef.current = { ...baseRef.current, ...typeOnly };
        setLoadedAt(saved.updated_at);
        setBase((current) => ({ ...current, ...typeOnly }));
        setDraft((current) => ({ ...current, ...typeOnly }));
        return saved;
      } catch (error) {
        if (codeOf(error) === "meeting.stale") {
          setStale(true);
          return null;
        }
        toast({
          title: MINUTES_READ_COPY.details.saveFailed,
          description: getErrorMessage(error, "Try again in a moment."),
          variant: "destructive",
        });
        return null;
      }
    })();
    inFlight.current = run;
    try {
      return (await run) !== null;
    } finally {
      if (inFlight.current === run) inFlight.current = null;
    }
  }

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const canBackfill =
    !!meeting.event_id && canMarkAttendance && meetingHasEnded(meeting);

  const when = meetingWhenLabel(meeting.event_start_time);
  const typeLabel = meetingTypeLabel(
    (editing ? draft.meeting_type : base.meeting_type) as MeetingType,
    editing ? draft.other_label : base.other_label,
  );
  // What the read view shows: while a post lands, the words just posted.
  const view = posting ? draft : base;
  // The read view's blocks and its jump bar (#5562), the same as the phone's.
  const readKeys = minutesReadSections(
    meeting.sections as MeetingSectionKey[],
    view.content,
  );
  const jumps = editing ? [] : minutesJumps(readKeys, view.content);
  const showsAttendance =
    !editing &&
    (hasAttendees(meeting) ||
      (meeting.sections as MeetingSectionKey[]).includes("attendees"));
  const hasContent = !isMeetingContentEmpty(cleanContent(draft.content));
  // Once a draft has filled the minutes, they lead and the notes the draft
  // read fold away underneath; before that, the notes are the first step.
  // A redraft keeps them where they are while it is written.
  const notesFirst = !hasContent || (!review && !drafting);
  // Where the notes panel puts its "To fill in" questions: above the
  // minutes, the first thing to do after a draft (Paul, 2026-11-16).
  const [fillInSlot, setFillInSlot] = useState<HTMLDivElement | null>(null);
  const saveLine = !autosaves
    ? null
    : stale
      ? null
      : saveFailed
        ? "Not saved"
        : update.isPending || dirty
          ? "Saving…"
          : "Saved";

  const notesPanel =
    showNotes && draftState ? (
      <NotesDraftPanel
        meetingId={meeting.id}
        eventStart={meeting.event_start_time}
        state={draftState}
        notesState={notesState}
        recording={recordingState}
        hasContent={hasContent}
        folded={!notesFirst}
        fillInSlot={fillInSlot}
        disabled={posting || stale}
        prepare={async () => {
          if (dirty) return (await save())?.updated_at ?? null;
          // Nothing typed: build on the newest version, not the one this
          // page happened to load.
          const fresh = await onReload();
          if (!fresh) return loadedAtRef.current;
          adopt(fresh);
          return fresh.updated_at;
        }}
        onSettled={() => void onReload()}
        onStale={() => setStale(true)}
        confirm={confirm}
      />
    ) : null;

  const menu = MINUTES_READ_COPY.menu;
  const hasTranscript = !!meeting.transcript?.trim();

  return (
    // A flex column, so the notes panel moves between the top and the foot
    // by `order` alone: moving it in the tree would remount it mid-draft and
    // lose the draft landing.
    <div className="mx-auto flex max-w-3xl flex-col gap-8 pb-16">
      {/*
        The meeting's name and the page's actions stay in view the whole way
        down a long set of minutes (Paul, 2026-11-16). `-top-4` and the
        negative sides undo the page column's own padding so nothing scrolls
        past above or beside the bar.
      */}
      <header className="sticky -top-4 z-20 -mx-4 border-b border-border bg-background px-4 py-3 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-bold leading-tight">
              {meeting.event_name}
            </h2>
            <p className="break-words text-caption text-muted-foreground">
              {/* The phone's line, word for word (#5562). */}
              {[
                `${typeLabel} meeting, ${when}`,
                posting
                  ? "Posting"
                  : isDraft
                    ? MEETING_COPY.draftBadge
                    : meeting.posted_at
                      ? MEETING_COPY.posted(meetingDayLabel(meeting.posted_at))
                      : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {saveLine ? (
              <span
                role="status"
                className={
                  saveFailed
                    ? "text-caption text-destructive-text"
                    : "text-caption text-muted-foreground"
                }
              >
                {saveLine}
              </span>
            ) : null}
            {editing ? (
              <>
                {!isDraft ? (
                  <>
                    <Button
                      variant="ghost"
                      disabled={busy || update.isPending}
                      onClick={() => {
                        setDraft(base);
                        setEditing(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      disabled={busy || update.isPending || !dirty}
                      onClick={() => void handleSave()}
                    >
                      {dirty || update.isPending ? "Save" : "Saved"}
                    </Button>
                  </>
                ) : saveFailed ? (
                  <Button
                    variant="secondary"
                    disabled={busy || update.isPending}
                    onClick={() => void handleSave()}
                  >
                    Save
                  </Button>
                ) : null}
                {isDraft ? (
                  <Button disabled={busy} onClick={() => void handlePost()}>
                    {MEETING_COPY.post}
                  </Button>
                ) : null}
              </>
            ) : !isDraft && !posting ? (
              // Reading posted minutes is the job here, so nothing about
              // changing them is a big button (Paul, 2026-11-18: "Why would I
              // want to go edit the minutes all the time"): Copy link is a
              // small icon, the rest sit behind the dots.
              <IconButton label={menu.copyLink} onClick={() => void copyLink()}>
                <Link2 className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            ) : null}
            {/*
              The ⋯ menu (#5562): the same items in the same order as the
              phone's, so the two never feel like two systems (Paul,
              2026-11-19).
            */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={menu.label} disabled={busy}>
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {meeting.can_edit && !posting ? (
                  <DropdownMenuItem onSelect={() => setDetailsOpen(true)}>
                    <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                    {menu.editDetails}
                  </DropdownMenuItem>
                ) : null}
                {meeting.can_edit && !editing && !posting ? (
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    {menu.editMinutes}
                  </DropdownMenuItem>
                ) : null}
                {canBackfill ? (
                  <DropdownMenuItem onSelect={() => setAttendanceOpen(true)}>
                    <UserCheck className="h-4 w-4" aria-hidden="true" />
                    {menu.attendance}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => void copyLink()}>
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                  {menu.copyLink}
                </DropdownMenuItem>
                {meeting.event_id ? (
                  <DropdownMenuItem asChild>
                    <Link href={`/events?event=${meeting.event_id}`}>
                      <CalendarDays className="h-4 w-4" aria-hidden="true" />
                      {menu.openEvent}
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                {hasTranscript && !editing ? (
                  <DropdownMenuItem asChild>
                    {/* Its own tab: an hour of lines under the minutes
                        buries them (Paul, 2026-11-18). */}
                    <Link
                      href={`/meetings/${meeting.id}/transcript`}
                      target="_blank"
                      rel="noopener"
                    >
                      <FileText className="h-4 w-4" aria-hidden="true" />
                      {menu.transcript}
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                {meeting.can_delete ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={remove.isPending}
                      onSelect={() => void handleDelete()}
                      className="text-destructive-text focus:bg-destructive-tint focus:text-destructive-text"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      {menu.delete}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <MinutesJumpBar
          jumps={jumps}
          onJump={(jump) =>
            document
              .getElementById(`${ids}-${jump.key}`)
              ?.closest("section")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        />
      </header>

      {stale ? (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-warning/30 bg-warning-tint p-3 text-sm"
        >
          <p>{MEETING_COPY.stale}</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void loadTheirs()}
          >
            {MEETING_COPY.loadTheirs}
          </Button>
        </div>
      ) : null}

      {!meeting.event_id && meeting.can_edit ? (
        <LinkEventPanel
          meetingId={meeting.id}
          meetingName={meeting.event_name}
          onLinked={() => void onReload()}
        />
      ) : null}

      {/*
        At the top of posted minutes, one suggestion at a time (Paul,
        2026-11-18: "Maybe they could appear at the top"): a single card
        doesn't push the minutes far down. Never beside the editor: a
        suggestion follows the saved action items, not ones being typed.
      */}
      {!isDraft && !editing ? (
        <SuggestedTasks
          source={{ type: "meeting", id: meeting.id }}
          sourceStart={meeting.event_start_time}
          headingId={`${ids}-suggested`}
        />
      ) : null}

      {notesPanel ? (
        <div className={notesFirst ? undefined : "order-1"}>{notesPanel}</div>
      ) : null}
      {/* The draft's open questions land here, above the minutes. */}
      {showNotes ? <div ref={setFillInSlot} className="empty:hidden" /> : null}

      <fieldset
        disabled={drafting}
        aria-busy={drafting || undefined}
        className="m-0 min-w-0 space-y-8 border-0 p-0"
      >
        {editing ? (
          shown.map((key) => (
            <section
              key={key}
              aria-labelledby={`${ids}-${key}`}
              className="space-y-3"
            >
              <h3 id={`${ids}-${key}`} className="text-base font-semibold">
                {sectionLabel(key)}
              </h3>
              {key === "attendees" ? (
                <Attendees meeting={meeting} nameFor={names.nameFor} />
              ) : key === "decisions" ? (
                <DecisionsEditor
                  decisions={draft.content.decisions}
                  onChange={(decisions) => editContent({ decisions })}
                  quoteFor={(text) => quoteOf(review, "decision", text, myName)}
                />
              ) : key === "action_items" ? (
                <ActionItemsEditor
                  disabled={drafting}
                  items={draft.content.action_items}
                  onChange={(action_items) => editContent({ action_items })}
                  quoteFor={(text) =>
                    quoteOf(review, "action_item", text, myName)
                  }
                />
              ) : key === "tabled" ? (
                <TabledEditor
                  items={draft.content.tabled}
                  eventId={meeting.event_id}
                  onChange={(tabled) => editContent({ tabled })}
                />
              ) : key === "dates" ? (
                <DatesEditor
                  items={draft.content.dates}
                  onChange={(dates) => editContent({ dates })}
                />
              ) : (
                <GrowingTextarea
                  aria-labelledby={`${ids}-${key}`}
                  value={draft.content[key as MeetingTextSection]}
                  maxLength={MEETING_TEXT_MAX_LENGTH}
                  // Grows with the text, so a long summary reads whole.
                  className="min-h-28"
                  rows={key === "summary" ? 6 : 4}
                  placeholder={
                    key === "tldr" ? MEETING_COPY.tldrPlaceholder : undefined
                  }
                  onChange={(event) =>
                    editContent({
                      [key]: event.target.value,
                    } as Partial<MeetingContent>)
                  }
                />
              )}
            </section>
          ))
        ) : (
          <>
            {readKeys.length === 0 ? (
              <InlineNote>{MEETING_COPY.nothingWritten}</InlineNote>
            ) : null}
            {readKeys.map((key, at) => (
              <section
                key={key}
                aria-labelledby={`${ids}-${key}`}
                className={cn(
                  // Clears the sticky header and its jump bar on a jump.
                  "scroll-mt-36 space-y-3",
                  // Each section opens under a rule, its name a quiet label
                  // over what it holds, so the eye lands on the content.
                  at > 0 && "border-t border-border pt-6",
                )}
              >
                <h3
                  id={`${ids}-${key}`}
                  className={`${EYEBROW} text-muted-foreground`}
                >
                  {sectionLabel(key)}
                </h3>
                {key === "tldr" ? (
                  <TldrBlock
                    tldr={view.content.tldr}
                    summary={view.content.summary}
                  />
                ) : key === "summary" ? (
                  <p className="whitespace-pre-wrap break-words text-base leading-relaxed">
                    {view.content.summary}
                  </p>
                ) : key === "dates" ? (
                  <DatesView dates={view.content.dates} />
                ) : key === "decisions" ? (
                  <DecisionsView decisions={view.content.decisions} />
                ) : key === "action_items" ? (
                  <ActionChecklist
                    items={view.content.action_items}
                    nameFor={names.nameFor}
                    viewerId={viewer?.id ?? null}
                    tasks={actionItemTasks}
                  />
                ) : key === "tabled" ? (
                  <TabledView items={view.content.tabled} />
                ) : key === "discussion_log" ? (
                  <TopicsView text={view.content.discussion_log} />
                ) : (
                  <LinesView
                    text={view.content[key as MeetingTextSection]}
                    outline={false}
                    preview={
                      key === "announcements"
                        ? MINUTES_PREVIEW.announcements
                        : undefined
                    }
                  />
                )}
              </section>
            ))}
            {showsAttendance || hasTranscript ? (
              // Attendance and the transcript are rows under the minutes:
              // a long list of names or an hour of lines never sits
              // between a member and what was decided.
              <div className="space-y-2 border-t border-border pt-6">
                {showsAttendance ? (
                  <MinutesRow
                    label={MINUTES_READ_COPY.attendance}
                    detail={attendanceDetail(meeting)}
                  >
                    <Attendees meeting={meeting} nameFor={names.nameFor} />
                  </MinutesRow>
                ) : null}
                {hasTranscript ? (
                  // The whole recording, kept with posted minutes (#5410),
                  // in its own tab (Paul, 2026-11-18).
                  <Link
                    href={`/meetings/${meeting.id}/transcript`}
                    target="_blank"
                    rel="noopener"
                    className={cn(
                      "flex items-center gap-2 rounded-lg border p-3 text-sm hover:bg-card-hover",
                      FOCUS_RING_OFFSET,
                    )}
                  >
                    <FileText
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="flex-1 font-semibold">
                      {MEETING_COPY.transcript}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {MEETING_COPY.openTranscript}
                    </span>
                  </Link>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </fieldset>

      {meeting.can_edit ? (
        <MinutesDetailsDialog
          meeting={meeting}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          type={{
            meeting_type: draft.meeting_type,
            other_label: draft.other_label,
          }}
          canEditEvent={canEditEvents}
          onSaveType={saveType}
          onEventSaved={() => void onReload()}
        />
      ) : null}
      {canBackfill && meeting.event_id ? (
        <AttendanceBackfill
          eventId={meeting.event_id}
          attendees={meeting.attendees}
          open={attendanceOpen}
          onOpenChange={setAttendanceOpen}
          onMarked={() => void onReload()}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}

/** A section's box, as tall as what is written in it. */
function GrowingTextarea({
  className,
  ...props
}: ComponentProps<typeof Textarea>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useGrowWithText(ref, String(props.value ?? ""));
  return (
    <Textarea
      ref={ref}
      className={cn("resize-none [field-sizing:content]", className)}
      {...props}
    />
  );
}

/**
 * Marking by hand waits for the meeting to end: a member marked while
 * check-in is open could no longer check in themselves.
 */
function meetingHasEnded(meeting: MeetingMinutes): boolean {
  const end = Date.parse(meeting.event_end_time ?? meeting.event_start_time);
  return Number.isFinite(end) && end <= Date.now();
}

/**
 * The line of the officer's notes a drafted item came from, shown while the
 * item still reads as drafted, so each one can be checked at a glance.
 */
function NotesQuote({ quote }: { quote: DraftQuote | null }) {
  if (!quote) return null;
  return (
    <p className="break-words text-caption text-muted-foreground">
      {quote.from
        ? MEETING_NOTE_TAKERS_COPY.from(quote.from, quote.mine)
        : "From your notes"}
      : “{quote.quote}”
    </p>
  );
}

/** The line a drafted item came from, and whose it is (#4935). */
type DraftQuote = { quote: string; from: string | null; mine: boolean };

function quoteOf(
  review: MeetingDraftState["review"] | null,
  kind: "decision" | "action_item",
  text: string,
  myName: string | null,
): DraftQuote | null {
  const quote = meetingDraftQuoteFor(review, kind, text);
  if (!quote) return null;
  const from = meetingDraftSourceFor(review, kind, text);
  return { quote, from, mine: !!from && from === myName };
}

function clampVote(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, MEETING_VOTE_MAX);
}

function DecisionsEditor({
  decisions,
  onChange,
  quoteFor,
}: {
  decisions: MeetingDecision[];
  onChange: (next: MeetingDecision[]) => void;
  quoteFor: (text: string) => DraftQuote | null;
}) {
  const ids = useId();
  const set = (index: number, patch: Partial<MeetingDecision>) =>
    onChange(
      decisions.map((decision, at) =>
        at === index ? { ...decision, ...patch } : decision,
      ),
    );
  return (
    <div className="space-y-3">
      {decisions.map((decision, index) => (
        <div
          key={index}
          className="space-y-2 border-b border-border pb-3 last:border-b-0"
        >
          <div className="flex items-start gap-2">
            <GrowingTextarea
              aria-label={`Decision ${index + 1}`}
              placeholder="What was decided"
              rows={1}
              className="min-h-10"
              value={decision.text}
              maxLength={MEETING_ITEM_TEXT_MAX_LENGTH}
              onChange={(event) => set(index, { text: event.target.value })}
            />
            <IconButton
              label={`Remove decision ${index + 1}`}
              onClick={() =>
                onChange(decisions.filter((_, at) => at !== index))
              }
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
          <NotesQuote quote={quoteFor(decision.text)} />
          <div className="grid gap-1">
            <Label htmlFor={`${ids}-${index}-headline`}>
              {MEETING_COPY.decisionHeadline}
            </Label>
            <Input
              id={`${ids}-${index}-headline`}
              value={decision.headline ?? ""}
              maxLength={MEETING_DECISION_HEADLINE_MAX_LENGTH}
              placeholder={MEETING_COPY.decisionHeadlinePlaceholder}
              onChange={(event) => set(index, { headline: event.target.value })}
            />
          </div>
          {decision.vote ? (
            <div className="flex flex-wrap items-end gap-3">
              {(["for", "against", "abstain"] as const).map((side) => (
                <div key={side} className="grid w-24 gap-1">
                  <Label htmlFor={`${ids}-${index}-${side}`}>
                    {side === "for"
                      ? "For"
                      : side === "against"
                        ? "Against"
                        : "Abstaining"}
                  </Label>
                  <Input
                    id={`${ids}-${index}-${side}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MEETING_VOTE_MAX}
                    value={String(decision.vote![side])}
                    onChange={(event) =>
                      set(index, {
                        vote: {
                          ...decision.vote!,
                          [side]: clampVote(event.target.value),
                        },
                      })
                    }
                  />
                </div>
              ))}
              <Button
                variant="link"
                size="sm"
                onClick={() => set(index, { vote: null })}
              >
                Remove the count
              </Button>
            </div>
          ) : (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() =>
                set(index, { vote: { for: 0, against: 0, abstain: 0 } })
              }
            >
              Add a vote count
            </Button>
          )}
        </div>
      ))}
      {decisions.length < MEETING_LIST_MAX_ITEMS ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange([...decisions, { text: "", vote: null }])}
        >
          Add a decision
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Coming up by hand (#5562): a day and what happens then, for a date the
 * draft missed or one an officer adds.
 */
function DatesEditor({
  items,
  onChange,
}: {
  items: MeetingDateItem[];
  onChange: (next: MeetingDateItem[]) => void;
}) {
  const ids = useId();
  const set = (index: number, patch: Partial<MeetingDateItem>) =>
    onChange(
      items.map((item, at) => (at === index ? { ...item, ...patch } : item)),
    );
  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        // A row with words and no day isn't kept on save (Coming up is days),
        // so it says so instead of vanishing.
        const needsDay = item.text.trim() !== "" && item.date === "";
        return (
          <div key={index} className="space-y-1">
            <div className="flex items-start gap-2">
              <Input
                type="date"
                aria-label={`${MEETING_COPY.dateDay} ${index + 1}`}
                aria-invalid={needsDay || undefined}
                aria-describedby={needsDay ? `${ids}-${index}-day` : undefined}
                className="w-40 shrink-0"
                value={item.date}
                onChange={(event) => set(index, { date: event.target.value })}
              />
              <Input
                id={`${ids}-${index}`}
                aria-label={`${MEETING_COPY.dateWhat} ${index + 1}`}
                placeholder={MEETING_COPY.dateWhatPlaceholder}
                value={item.text}
                maxLength={MEETING_ITEM_TEXT_MAX_LENGTH}
                onChange={(event) => set(index, { text: event.target.value })}
              />
              <IconButton
                label={`${MEETING_COPY.removeDate} ${index + 1}`}
                onClick={() => onChange(items.filter((_, at) => at !== index))}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            </div>
            {needsDay ? (
              <p
                id={`${ids}-${index}-day`}
                className="text-caption text-destructive"
              >
                {MEETING_COPY.dateNeedsDay}
              </p>
            ) : null}
          </div>
        );
      })}
      {items.length < MEETING_DATES_MAX_ITEMS ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange([...items, { date: "", text: "" }])}
        >
          {MEETING_COPY.addDate}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The Table action by hand (#5522): add a matter the meeting put off, or
 * take out one the draft listed that wasn't. A matter carried in from an
 * earlier meeting keeps its date and count.
 */
function TabledEditor({
  items,
  eventId,
  onChange,
}: {
  items: MeetingTabledItem[];
  /** The meeting's event, whose agenda offers a quick Table per item. */
  eventId: string | null;
  onChange: (next: MeetingTabledItem[]) => void;
}) {
  const event = useEvent(eventId ?? "");
  const tabledWords = new Set(items.map((item) => agendaMatterKey(item.text)));
  // Each agenda item not tabled yet, as a chip (#5534): one tap tables it,
  // and one carried from an earlier Tabled list keeps its first date and
  // counts once more.
  const offered = readEventAgenda(event.data?.agenda).filter(
    (item) =>
      item.text.trim().length > 0 &&
      !tabledWords.has(agendaMatterKey(item.text)),
  );
  const full = items.length >= MEETING_TABLED_MAX_ITEMS;
  return (
    <div className="space-y-3">
      {offered.length > 0 && !full ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-caption text-muted-foreground">
            From the agenda:
          </span>
          {offered.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={`Table "${item.text}"`}
              onClick={() =>
                onChange([
                  ...items,
                  {
                    text: item.text,
                    first_meeting_id: item.tabled_from?.meeting_id ?? null,
                    first_start_time: item.tabled_from?.start_time ?? null,
                    times: item.tabled_from
                      ? Math.min(
                          item.tabled_from.times + 1,
                          MEETING_TABLED_MAX_TIMES,
                        )
                      : 1,
                  },
                ])
              }
              className={cn(
                "inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border border-border px-2.5 text-caption hover:bg-card-hover pointer-coarse:min-h-11",
                FOCUS_RING_OFFSET,
              )}
            >
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Table {item.text}</span>
            </button>
          ))}
        </div>
      ) : null}
      {items.map((item, index) => {
        const from = meetingTabledFromLabel(item);
        return (
          <div key={index} className="space-y-1">
            <div className="flex items-start gap-2">
              <GrowingTextarea
                aria-label={`Tabled item ${index + 1}`}
                placeholder="What was put off"
                rows={1}
                className="min-h-10"
                value={item.text}
                maxLength={MEETING_ITEM_TEXT_MAX_LENGTH}
                onChange={(event) =>
                  onChange(
                    items.map((entry, at) =>
                      at === index
                        ? { ...entry, text: event.target.value }
                        : entry,
                    ),
                  )
                }
              />
              <IconButton
                label={`Remove tabled item ${index + 1}`}
                onClick={() => onChange(items.filter((_, at) => at !== index))}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            </div>
            {from ? (
              <p className="text-caption text-muted-foreground">{from}</p>
            ) : null}
          </div>
        );
      })}
      {items.length < MEETING_TABLED_MAX_ITEMS ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            onChange([
              ...items,
              {
                text: "",
                first_meeting_id: null,
                first_start_time: null,
                times: 1,
              },
            ])
          }
        >
          Table an item
        </Button>
      ) : null}
    </div>
  );
}

function ActionItemsEditor({
  items,
  onChange,
  quoteFor,
  disabled,
}: {
  /** The owner menu isn't a form control, so a disabled fieldset misses it. */
  disabled: boolean;
  items: MeetingActionItem[];
  onChange: (next: MeetingActionItem[]) => void;
  quoteFor: (text: string) => DraftQuote | null;
}) {
  const ids = useId();
  const rosterQuery = useChapterRoster();
  const members = useMemo(
    () =>
      (rosterQuery.data ?? [])
        .map((row) => ({
          id: row.user_id,
          name: memberLabel(row.display_name, row.user_id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [rosterQuery.data],
  );
  const set = (index: number, patch: Partial<MeetingActionItem>) =>
    onChange(
      items.map((item, at) => (at === index ? { ...item, ...patch } : item)),
    );
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div
          key={index}
          className="space-y-2 border-b border-border pb-3 last:border-b-0"
        >
          <div className="flex items-start gap-2">
            <GrowingTextarea
              aria-label={`Action item ${index + 1}`}
              placeholder="What needs doing"
              rows={1}
              className="min-h-10"
              value={item.text}
              maxLength={MEETING_ITEM_TEXT_MAX_LENGTH}
              onChange={(event) => set(index, { text: event.target.value })}
            />
            <IconButton
              label={`Remove action item ${index + 1}`}
              onClick={() => onChange(items.filter((_, at) => at !== index))}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
          <NotesQuote quote={quoteFor(item.text)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid min-w-0 gap-1">
              <Label htmlFor={`${ids}-${index}-owner`}>Who</Label>
              <Select
                disabled={disabled}
                value={item.owner_user_id ?? NO_OWNER}
                onValueChange={(value) =>
                  set(index, {
                    owner_user_id: value === NO_OWNER ? null : value,
                  })
                }
              >
                <SelectTrigger id={`${ids}-${index}-owner`}>
                  <SelectValue placeholder="Nobody named" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OWNER}>Nobody named</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 gap-1">
              <Label htmlFor={`${ids}-${index}-due`}>Due</Label>
              <DueDateField
                id={`${ids}-${index}-due`}
                placeholder="No date"
                // An action item is due by a day: it stores no time.
                withoutTime
                value={item.due_date ?? ""}
                onChange={(value) =>
                  set(index, { due_date: value ? value.slice(0, 10) : null })
                }
              />
            </div>
          </div>
        </div>
      ))}
      {items.length < MEETING_LIST_MAX_ITEMS ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            onChange([
              ...items,
              { text: "", owner_user_id: null, due_date: null },
            ])
          }
        >
          Add an action item
        </Button>
      ) : null}
    </div>
  );
}
