"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { codeOf, statusOf } from "@repo/api-sdk";
import {
  useChapterRoster,
  useDeleteMeeting,
  useMeeting,
  useMeetingDraft,
  useMeetingRecording,
  useMemberDisplayNames,
  usePostMeeting,
  useUpdateMeeting,
  type MeetingDraftState,
  type MeetingRecordingState,
  type MeetingMinutes,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import {
  MEETING_ITEM_TEXT_MAX_LENGTH,
  MEETING_LIST_MAX_ITEMS,
  MEETING_OTHER_LABEL_MAX_LENGTH,
  MEETING_TEXT_MAX_LENGTH,
  MEETING_TYPES,
  MEETING_TYPE_LABELS,
  MEETING_VOTE_MAX,
  STANDARDS_MEETING_NOTE,
  isMeetingContentEmpty,
  meetingDraftQuoteFor,
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
} from "@repo/validation";
import { PageActions } from "@/components/layout/page-actions";
import { ErrorState } from "@/components/shared/async-states";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  InlineNote,
  inlineNoteActionClassName,
} from "@/components/shared/inline-note";
import { Badge } from "@/components/ui/badge";
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
import { DueDateField } from "@/components/tasks/due-date-field";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import { NotesDraftPanel } from "@/components/meetings/notes-draft-panel";
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

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

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
  // The same for the recording row inside that box.
  const recordingQuery = useMeetingRecording(id, { enabled: drafts });
  if (
    query.isPending ||
    (drafts && (draftQuery.isPending || recordingQuery.isPending))
  ) {
    return <MinutesPageSkeleton />;
  }
  if (!query.data) {
    const missing = statusOf(query.error) === 404;
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <ErrorState
          title={
            missing ? "These minutes aren't here" : "Couldn't load the minutes"
          }
          description={
            missing
              ? "They were deleted, or they aren't shared with you."
              : "Check your connection and try again."
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
      onReload={async () => (await query.refetch()).data}
    />
  );
}

function Minutes({
  meeting,
  draftState,
  recordingState,
  onReload,
}: {
  meeting: MeetingMinutes;
  /** Where drafting from notes stands; null when it isn't offered here. */
  draftState: MeetingDraftState | null;
  recordingState: MeetingRecordingState | null;
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

  const isDraft = meeting.status === "draft";
  const [editing, setEditing] = useState(meeting.can_edit && isDraft);
  const [base, setBase] = useState(() => draftOf(meeting));
  const [draft, setDraft] = useState(base);
  // The version `base` was read from. Every save and post names it, so a save
  // made on an older version is refused rather than overwriting a newer one.
  const [loadedAt, setLoadedAt] = useState(meeting.updated_at);
  const [stale, setStale] = useState(false);
  const dirty = !sameDraft(draft, base);
  // While a draft is being written the sections are about to be replaced, so
  // they wait: typing into them now would be lost or would strand the draft.
  const drafting = draftState?.status === "drafting";
  const busy = update.isPending || post.isPending || drafting;
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
    !busy
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
    const content = editing ? draft.content : base.content;
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
  }, [editing, draft.content, base.content, meeting]);

  function editContent(patch: Partial<MeetingContent>) {
    setDraft((current) => ({
      ...current,
      content: { ...current.content, ...patch },
    }));
  }

  /** Save, and answer the stored minutes, or null when the save didn't land. */
  async function save(): Promise<MeetingMinutes | null> {
    const content = cleanContent(draft.content);
    const otherLabel = draft.other_label.trim();
    try {
      const saved = await update.mutateAsync({
        id: meeting.id,
        body: {
          expected_updated_at: loadedAt,
          meeting_type: draft.meeting_type,
          other_label:
            draft.meeting_type === "other" && otherLabel ? otherLabel : null,
          content,
        },
      });
      adopt(saved);
      return saved;
    } catch (error) {
      if (codeOf(error) === "meeting.stale") {
        setStale(true);
        return null;
      }
      toast({
        title: "Couldn't save the minutes",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
      return null;
    }
  }

  async function handleSave() {
    const saved = await save();
    if (saved && saved.status === "posted") setEditing(false);
    if (saved) toast({ title: "Minutes saved" });
  }

  async function handlePost() {
    const answer = await confirm({
      title: "Post these minutes?",
      description:
        "Everyone the meeting's event invites can read them, and each of them is told once. You can still edit them after.",
      confirmLabel: "Post minutes",
    });
    if (!answer) return;
    const expectedUpdatedAt = dirty ? (await save())?.updated_at : loadedAt;
    if (!expectedUpdatedAt) return;
    try {
      await post.mutateAsync({ id: meeting.id, expectedUpdatedAt });
      setEditing(false);
      toast({ title: "Minutes posted" });
    } catch (error) {
      if (codeOf(error) === "meeting.stale") {
        setStale(true);
        return;
      }
      toast({
        title: "Couldn't post the minutes",
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

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-16">
      <PageActions>
        {editing ? (
          <>
            {!isDraft ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDraft(base);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            ) : null}
            <Button
              variant={isDraft ? "secondary" : "default"}
              disabled={busy || !dirty}
              onClick={() => void handleSave()}
            >
              {dirty || update.isPending ? "Save" : "Saved"}
            </Button>
            {isDraft ? (
              <Button disabled={busy} onClick={() => void handlePost()}>
                Post minutes
              </Button>
            ) : null}
          </>
        ) : (
          <>
            {!isDraft ? (
              <Button variant="secondary" onClick={() => void copyLink()}>
                Copy link
              </Button>
            ) : null}
            {meeting.can_edit ? (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
          </>
        )}
        {meeting.can_delete ? (
          <Button
            variant="ghost"
            disabled={busy || remove.isPending}
            onClick={() => void handleDelete()}
          >
            Delete
          </Button>
        ) : null}
      </PageActions>

      <header className="space-y-2">
        <h2 className="text-2xl font-bold leading-tight">
          {meeting.event_name}
        </h2>
        <p className="text-sm text-muted-foreground">
          {typeLabel} meeting, {when}
        </p>
        {isDraft ? (
          <Badge variant="outline">Draft</Badge>
        ) : meeting.posted_at ? (
          <p className="text-caption text-muted-foreground">
            Posted {meetingDayLabel(meeting.posted_at)}
          </p>
        ) : null}
      </header>

      {stale ? (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-warning/30 bg-warning-tint p-3 text-sm"
        >
          <p>
            Someone else saved these minutes since you opened them. Copy
            anything you want to keep, then load their version.
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void loadTheirs()}
          >
            Load their version
          </Button>
        </div>
      ) : null}

      {showNotes && draftState ? (
        <NotesDraftPanel
          meetingId={meeting.id}
          eventStart={meeting.event_start_time}
          state={draftState}
          recording={recordingState}
          hasContent={!isMeetingContentEmpty(cleanContent(draft.content))}
          disabled={update.isPending || post.isPending || stale}
          prepare={async () => {
            if (dirty) return (await save())?.updated_at ?? null;
            // Nothing typed: build on the newest version, not the one this
            // page happened to load.
            const fresh = await onReload();
            if (!fresh) return loadedAt;
            adopt(fresh);
            return fresh.updated_at;
          }}
          onSettled={() => void onReload()}
          onStale={() => setStale(true)}
          confirm={confirm}
        />
      ) : null}

      <fieldset
        disabled={drafting}
        aria-busy={drafting || undefined}
        className="m-0 min-w-0 space-y-8 border-0 p-0"
      >
        {editing ? (
          <section aria-labelledby={`${ids}-type`} className="space-y-2">
            <h3 id={`${ids}-type`} className="text-sm font-semibold">
              Type
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

        {!editing && shown.length === 0 ? (
          <InlineNote>
            Nothing has been written in these minutes yet.
          </InlineNote>
        ) : null}

        {shown.map((key) => (
          <section
            key={key}
            aria-labelledby={`${ids}-${key}`}
            className="space-y-2"
          >
            <h3 id={`${ids}-${key}`} className="text-base font-semibold">
              {sectionLabel(key)}
            </h3>
            {key === "attendees" ? (
              <Attendees meeting={meeting} nameFor={names.nameFor} />
            ) : key === "decisions" ? (
              editing ? (
                <DecisionsEditor
                  decisions={draft.content.decisions}
                  onChange={(decisions) => editContent({ decisions })}
                  quoteFor={(text) =>
                    meetingDraftQuoteFor(review, "decision", text)
                  }
                />
              ) : (
                <DecisionsView decisions={base.content.decisions} />
              )
            ) : key === "action_items" ? (
              editing ? (
                <ActionItemsEditor
                  disabled={drafting}
                  items={draft.content.action_items}
                  onChange={(action_items) => editContent({ action_items })}
                  quoteFor={(text) =>
                    meetingDraftQuoteFor(review, "action_item", text)
                  }
                />
              ) : (
                <ActionItemsView
                  items={base.content.action_items}
                  nameFor={names.nameFor}
                />
              )
            ) : editing ? (
              <Textarea
                aria-labelledby={`${ids}-${key}`}
                value={draft.content[key as MeetingTextSection]}
                maxLength={MEETING_TEXT_MAX_LENGTH}
                rows={key === "summary" ? 6 : 4}
                onChange={(event) =>
                  editContent({
                    [key]: event.target.value,
                  } as Partial<MeetingContent>)
                }
              />
            ) : (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {base.content[key as MeetingTextSection]}
              </p>
            )}
          </section>
        ))}
      </fieldset>

      {confirmDialog}
    </div>
  );
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
    return (
      <InlineNote>The event is gone, so its check-ins are too.</InlineNote>
    );
  }
  if (!hasAttendees(meeting)) {
    return (
      <InlineNote>
        Nobody has checked in yet. Who checked in to the event shows here.
      </InlineNote>
    );
  }
  const groups = [
    { label: "Present", ids: attendees.present },
    { label: "Late", ids: attendees.late },
    { label: "Excused", ids: attendees.excused },
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
    <ul role="list" className="list-disc space-y-2 pl-5 text-sm">
      {decisions.map((decision, index) => (
        <li key={index}>
          <p className="whitespace-pre-wrap break-words">{decision.text}</p>
          {decision.vote ? (
            <p className="text-caption text-muted-foreground">
              {voteLine(decision.vote)}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ActionItemsView({
  items,
  nameFor,
}: {
  items: MeetingActionItem[];
  nameFor: (userId: string) => string | null;
}) {
  return (
    <ul role="list" className="list-disc space-y-2 pl-5 text-sm">
      {items.map((item, index) => {
        const meta = [
          item.owner_user_id
            ? memberLabel(nameFor(item.owner_user_id), item.owner_user_id)
            : null,
          item.due_date ? `Due ${meetingDueLabel(item.due_date)}` : null,
        ].filter(Boolean);
        return (
          <li key={index}>
            <p className="whitespace-pre-wrap break-words">{item.text}</p>
            {meta.length > 0 ? (
              <p className="text-caption text-muted-foreground">
                {meta.join(" · ")}
              </p>
            ) : null}
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
function NotesQuote({ quote }: { quote: string | null }) {
  if (!quote) return null;
  return (
    <p className="break-words text-caption text-muted-foreground">
      From your notes: “{quote}”
    </p>
  );
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
  quoteFor: (text: string) => string | null;
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
          className="space-y-2 rounded-lg border border-border p-3"
        >
          <div className="flex items-start gap-2">
            <Input
              aria-label={`Decision ${index + 1}`}
              placeholder="What was decided"
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
  quoteFor: (text: string) => string | null;
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
          className="space-y-2 rounded-lg border border-border p-3"
        >
          <div className="flex items-start gap-2">
            <Input
              aria-label={`Action item ${index + 1}`}
              placeholder="What needs doing"
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
                placeholder="Friday"
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
