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
import { Check, Link2, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { codeOf, statusOf } from "@repo/api-sdk";
import {
  useChapterRoster,
  useCurrentUser,
  useDeleteMeeting,
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
  type MeetingActionItemTask,
  type MeetingMinutes,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import {
  MEETING_COPY,
  MEETING_LIST_COPY,
  MEETING_ITEM_TEXT_MAX_LENGTH,
  MEETING_LIST_MAX_ITEMS,
  MEETING_OTHER_LABEL_MAX_LENGTH,
  MEETING_TEXT_MAX_LENGTH,
  MEETING_TYPES,
  MEETING_TYPE_LABELS,
  MEETING_VOTE_MAX,
  STANDARDS_MEETING_NOTE,
  can,
  isMeetingContentEmpty,
  meetingDraftQuoteFor,
  meetingDraftSourceFor,
  MEETING_NOTE_TAKERS_COPY,
  meetingSectionHasContent,
  meetingTypeLabel,
  readMeetingContent,
  shownMeetingSections,
  type MeetingActionItem,
  type MeetingContent,
  type MeetingDecision,
  type MeetingSectionKey,
  type MeetingTextSection,
  type MeetingType,
  parseMinutesNotes,
} from "@repo/validation";
import { ErrorState } from "@/components/shared/async-states";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  InlineNote,
  inlineNoteActionClassName,
} from "@/components/shared/inline-note";
import { Badge } from "@/components/ui/badge";
import { EYEBROW } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedChoice } from "@/components/ui/segmented";
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
  meetingDueLabel,
  meetingWhenLabel,
  sectionLabel,
  voteLine,
} from "@/components/meetings/meeting-copy";

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
      .map((decision) => ({ ...decision, text: decision.text.trim() }))
      .filter((decision) => decision.text.length > 0),
    action_items: content.action_items
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
  const canMarkAttendance = can("events:update", usePermissionList());
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

  const shown = useMemo(() => {
    const content = editing || posting ? draft.content : base.content;
    const keys = shownMeetingSections(
      meeting.sections as MeetingSectionKey[],
      content,
    );
    if (editing) return keys;
    return keys.filter((key) =>
      key === "attendees"
        ? hasAttendees(meeting)
        : meetingSectionHasContent(content, key),
    );
  }, [editing, posting, draft.content, base.content, meeting]);

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
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Couldn't copy the link", variant: "destructive" });
    }
  }

  const when = meetingWhenLabel(meeting.event_start_time);
  const typeLabel = meetingTypeLabel(
    (editing ? draft.meeting_type : base.meeting_type) as MeetingType,
    editing ? draft.other_label : base.other_label,
  );
  // What the read view shows: while a post lands, the words just posted.
  const view = posting ? draft : base;
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
              {typeLabel} meeting, {when}
              {posting
                ? ", posting"
                : isDraft
                  ? `, ${MEETING_COPY.draftBadge.toLowerCase()}`
                  : meeting.posted_at
                    ? `. ${MEETING_COPY.posted(meetingDayLabel(meeting.posted_at))}`
                    : ""}
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
              // small icon, Edit and Delete sit behind the dots.
              <IconButton label="Copy link" onClick={() => void copyLink()}>
                <Link2 className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            ) : null}
            {(meeting.can_edit && !editing && !posting) ||
            meeting.can_delete ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label="More" disabled={busy}>
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {meeting.can_edit && !editing && !posting ? (
                    <DropdownMenuItem onSelect={() => setEditing(true)}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      Edit minutes
                    </DropdownMenuItem>
                  ) : null}
                  {meeting.can_delete ? (
                    <>
                      {meeting.can_edit && !editing && !posting ? (
                        <DropdownMenuSeparator />
                      ) : null}
                      <DropdownMenuItem
                        disabled={remove.isPending}
                        onSelect={() => void handleDelete()}
                        className="text-destructive-text focus:bg-destructive-tint focus:text-destructive-text"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Delete minutes
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
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
        {!editing && shown.length === 0 ? (
          <InlineNote>{MEETING_COPY.nothingWritten}</InlineNote>
        ) : null}

        {!editing && !isDraft ? (
          <AtAGlance
            content={view.content}
            attended={
              hasAttendees(meeting)
                ? (meeting.attendees?.present.length ?? 0) +
                  (meeting.attendees?.late.length ?? 0)
                : null
            }
            doneCount={
              [...actionItemTasks.values()].filter((entry) => entry.done).length
            }
          />
        ) : null}

        {shown.map((key, at) => (
          <section
            key={key}
            aria-labelledby={`${ids}-${key}`}
            className={cn(
              "space-y-3",
              // Read as a document: each section opens under a rule, its
              // name a quiet label over what it holds, so the eye lands on
              // the content and the sections still part clearly.
              !editing && at > 0 && "border-t border-border pt-6",
            )}
          >
            <h3
              id={`${ids}-${key}`}
              className={
                editing
                  ? "text-base font-semibold"
                  : `${EYEBROW} text-muted-foreground`
              }
            >
              {sectionLabel(key)}
            </h3>
            {key === "attendees" ? (
              <>
                <Attendees meeting={meeting} nameFor={names.nameFor} />
                {editing &&
                meeting.event_id &&
                canMarkAttendance &&
                meetingHasEnded(meeting) ? (
                  <AttendanceBackfill
                    eventId={meeting.event_id}
                    attendees={meeting.attendees}
                    onMarked={() => void onReload()}
                  />
                ) : null}
              </>
            ) : key === "decisions" ? (
              editing ? (
                <DecisionsEditor
                  decisions={draft.content.decisions}
                  onChange={(decisions) => editContent({ decisions })}
                  quoteFor={(text) => quoteOf(review, "decision", text, myName)}
                />
              ) : (
                <DecisionsView decisions={view.content.decisions} />
              )
            ) : key === "action_items" ? (
              editing ? (
                <ActionItemsEditor
                  disabled={drafting}
                  items={draft.content.action_items}
                  onChange={(action_items) => editContent({ action_items })}
                  quoteFor={(text) =>
                    quoteOf(review, "action_item", text, myName)
                  }
                />
              ) : (
                <ActionItemsView
                  items={view.content.action_items}
                  nameFor={names.nameFor}
                  viewerId={viewer?.id ?? null}
                  tasks={actionItemTasks}
                />
              )
            ) : editing ? (
              <GrowingTextarea
                aria-labelledby={`${ids}-${key}`}
                value={draft.content[key as MeetingTextSection]}
                maxLength={MEETING_TEXT_MAX_LENGTH}
                // Grows with the text, so a long summary reads whole.
                className="min-h-28"
                rows={key === "summary" ? 6 : 4}
                onChange={(event) =>
                  editContent({
                    [key]: event.target.value,
                  } as Partial<MeetingContent>)
                }
              />
            ) : key === "summary" ? (
              // The lead: what a member reads if they read nothing else.
              <p className="whitespace-pre-wrap break-words text-base leading-relaxed">
                {view.content.summary}
              </p>
            ) : (
              <LinesView
                text={view.content[key as MeetingTextSection]}
                outline={key === "discussion_log"}
              />
            )}
          </section>
        ))}

        {!editing && meeting.transcript?.trim() ? (
          // The whole recording, kept with posted minutes (#5410): the
          // record of what was said, for reading through or asking Frapp AI.
          <section className="space-y-1 border-t border-border pt-4">
            <h3 className="text-sm font-semibold">{MEETING_COPY.transcript}</h3>
            {/* Its own tab: an hour of lines under the minutes buries them
                (Paul, 2026-11-18). */}
            <Link
              href={`/meetings/${meeting.id}/transcript`}
              target="_blank"
              rel="noopener"
              className={inlineNoteActionClassName}
            >
              {MEETING_COPY.openTranscript}
            </Link>
          </section>
        ) : null}

        {editing ? (
          <section aria-labelledby={`${ids}-type`} className="space-y-2">
            <h3 id={`${ids}-type`} className="text-sm font-semibold">
              Meeting type
            </h3>
            <SegmentedChoice
              label="Meeting type"
              value={draft.meeting_type}
              onChange={(meeting_type) =>
                setDraft((current) => ({ ...current, meeting_type }))
              }
              options={MEETING_TYPES.map((value) => ({
                value,
                label: MEETING_TYPE_LABELS[value],
              }))}
            />
            {draft.meeting_type === "other" ? (
              <div className="grid max-w-sm gap-1">
                <Label htmlFor={`${ids}-other`}>
                  What kind of meeting (optional)
                </Label>
                <Input
                  id={`${ids}-other`}
                  value={draft.other_label}
                  maxLength={MEETING_OTHER_LABEL_MAX_LENGTH}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      other_label: event.target.value,
                    }))
                  }
                />
              </div>
            ) : null}
            <p className="text-caption text-muted-foreground">
              {STANDARDS_MEETING_NOTE}
            </p>
          </section>
        ) : null}
      </fieldset>

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

function hasAttendees(meeting: MeetingMinutes): boolean {
  const a = meeting.attendees;
  return !!a && a.present.length + a.late.length + a.excused.length > 0;
}

function Attendees({
  meeting,
  nameFor,
}: {
  meeting: MeetingMinutes;
  nameFor: (userId: string) => string | null;
}) {
  const attendees = meeting.attendees;
  if (!attendees) {
    return <InlineNote>{MEETING_COPY.attendeesGone}</InlineNote>;
  }
  if (!hasAttendees(meeting)) {
    return <InlineNote>{MEETING_COPY.attendeesNone}</InlineNote>;
  }
  const groups = [
    { label: MEETING_LIST_COPY.present, ids: attendees.present },
    { label: MEETING_LIST_COPY.late, ids: attendees.late },
    { label: MEETING_LIST_COPY.excused, ids: attendees.excused },
  ].filter((group) => group.ids.length > 0);
  return (
    <dl className="space-y-2 text-sm">
      {groups.map((group) => (
        <div key={group.label}>
          <dt className="text-caption text-muted-foreground">
            {group.label}, {group.ids.length}
          </dt>
          <dd>
            {group.ids
              .map((userId) => memberLabel(nameFor(userId), userId))
              .sort((a, b) => a.localeCompare(b))
              .join(", ")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DecisionsView({ decisions }: { decisions: MeetingDecision[] }) {
  return (
    // Each outcome on its own, marked by an accent rule, so the decisions
    // read apart from the discussion around them.
    <ul role="list" className="space-y-2 text-sm">
      {decisions.map((decision, index) => (
        <li key={index} className="border-l-2 border-primary py-0.5 pl-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="min-w-0 whitespace-pre-wrap break-words">
              {decision.text}
            </p>
            {decision.vote ? (
              <Badge
                variant="outline"
                title={voteLine(decision.vote)}
                aria-label={voteLine(decision.vote)}
                className="tabular-nums"
              >
                {voteTally(decision.vote)}
              </Badge>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The minutes at a glance, under the title: how many decisions, how many
 * action items and how many of those are done, and who came. A member sees
 * what the meeting produced before reading a word of it.
 */
function AtAGlance({
  content,
  attended,
  doneCount,
}: {
  content: MeetingContent;
  attended: number | null;
  doneCount: number;
}) {
  const decisions = content.decisions.length;
  const actions = content.action_items.length;
  const facts = [
    decisions > 0
      ? `${decisions} ${decisions === 1 ? "decision" : "decisions"}`
      : null,
    actions > 0
      ? `${actions} ${actions === 1 ? "action item" : "action items"}${
          doneCount > 0 ? `, ${doneCount} done` : ""
        }`
      : null,
    attended !== null && attended > 0 ? `${attended} attended` : null,
  ].filter((fact): fact is string => fact !== null);
  if (facts.length === 0) return null;
  return (
    <ul role="list" className="-mt-2 flex flex-wrap gap-2">
      {facts.map((fact) => (
        <li
          key={fact}
          className="rounded-full border border-border px-3 py-1 text-caption tabular-nums text-muted-foreground"
        >
          {fact}
        </li>
      ))}
    </ul>
  );
}

/** "22–5", with abstentions only when there were some: "22–5–1". */
function voteTally(vote: NonNullable<MeetingDecision["vote"]>): string {
  const counts = [vote.for, vote.against];
  if (vote.abstain > 0) counts.push(vote.abstain);
  return counts.join("–");
}

function ActionItemsView({
  items,
  nameFor,
  viewerId,
  tasks,
}: {
  items: MeetingActionItem[];
  nameFor: (userId: string) => string | null;
  /** The reader, whose own items say so (a chair finds theirs at a glance). */
  viewerId: string | null;
  /** The tasks the items became, by their place in the list. */
  tasks: ReadonlyMap<number, MeetingActionItemTask>;
}) {
  // A checklist, ticked as each item's task is marked done (Paul,
  // 2026-11-18: "action items should be like checkboxes that show updates
  // as the tasks are actually checked off"). The boxes only show: an item is
  // checked off by doing its task, where its points and sign-off live.
  return (
    <ul role="list" className="space-y-3 text-sm">
      {items.map((item, index) => {
        const task = tasks.get(index);
        const done = task?.done ?? false;
        const meta = [
          item.owner_user_id
            ? memberLabel(nameFor(item.owner_user_id), item.owner_user_id)
            : "Nobody named yet",
          item.due_date ? `Due ${meetingDueLabel(item.due_date)}` : null,
          task?.group && !done
            ? `${task.group.done} of ${task.group.total} done`
            : null,
        ].filter(Boolean);
        const yours = !!viewerId && item.owner_user_id === viewerId;
        return (
          <li key={index} className="flex gap-3">
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
                done
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border",
              )}
            >
              {done ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p
                  className={cn(
                    "min-w-0 whitespace-pre-wrap break-words",
                    done && "text-muted-foreground",
                  )}
                >
                  <span className="sr-only">
                    {done ? "Done: " : task ? "Not done yet: " : ""}
                  </span>
                  {item.text}
                </p>
                {yours ? <Badge>Yours</Badge> : null}
              </div>
              <p className="text-caption text-muted-foreground">
                {meta.join(" · ")}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A section written one item per line (the notes, reports, announcements,
 * business). The notes come as an outline, a topic over its "- " points,
 * and draw as one: the topic in bold, its points as a list under it, the
 * way Granola lays out meeting notes. A plain line that opens with its
 * topic ("Treasurer: ...") shows the topic in bold, so it can be skimmed.
 */
function LinesView({ text, outline }: { text: string; outline: boolean }) {
  const lines = parseMinutesNotes(text, { outline });
  return (
    <ul role="list" className="space-y-1.5 text-sm leading-relaxed">
      {lines.map((line, index) => {
        if (line.kind === "topic") {
          return (
            // A topic reads as a heading over its points, as in Paul's
            // Granola notes (2026-11-17), not as one more bold line.
            <li
              key={index}
              className="break-words pt-4 text-base font-semibold first:pt-0"
            >
              {line.text}
            </li>
          );
        }
        if (line.kind === "point") {
          return (
            <li
              key={index}
              className={`flex gap-2 break-words ${line.depth ? "pl-5" : ""}`}
            >
              <span aria-hidden className="select-none text-muted-foreground">
                {line.depth ? "◦" : "•"}
              </span>
              <span className="min-w-0">{line.text}</span>
            </li>
          );
        }
        return (
          <li key={index} className="break-words">
            {line.head ? (
              <>
                <span className="font-semibold">{line.head}</span>
                {": "}
                {line.text}
              </>
            ) : (
              line.text
            )}
          </li>
        );
      })}
    </ul>
  );
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
