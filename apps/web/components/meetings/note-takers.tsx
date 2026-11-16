"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { codeOf } from "@repo/api-sdk";
import {
  useAddMeetingNoteTaker,
  useChapterRoster,
  useCurrentUser,
  useMeetingNotes,
  useRemoveMeetingNoteTaker,
  useSaveMeetingNotes,
  type MeetingNotesState,
  type MeetingRecordingState,
} from "@repo/hooks";
import {
  MEETING_NOTES_COPY,
  MEETING_NOTES_MAX_LENGTH,
  MEETING_NOTE_TAKERS_COPY,
  meetingWhenLabel,
} from "@repo/validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ConfirmRequest,
  ConfirmResult,
} from "@/components/shared/confirm-dialog";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/async-states";
import { inlineNoteActionClassName } from "@/components/shared/inline-note";
import { memberLabel } from "@repo/hooks/display-names";
import { getErrorMessage } from "@/lib/utils";

/**
 * Several members taking notes on one meeting (`spec/behavior/meetings.md`
 * § Several note-takers, #4935). Each writes in their own notes, saved as
 * they type, the way Granola keeps each person's notes their own; the
 * minutes' author reads everyone's here, beside the recording's transcript,
 * and drafts from all of them at once.
 */

/** How long typing rests before it is saved. */
const SAVE_AFTER_MS = 800;

export type SaveStatus = "idle" | "saving" | "saved" | "failed";

/**
 * The caller's notes on one meeting, saved as they type. `flush` saves now
 * and answers whether the save landed, for a draft that must read them.
 */
export function useNotesAutosave(meetingId: string, initial: string) {
  const save = useSaveMeetingNotes();
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const savedText = useRef(initial);
  /** The same as `savedText`, for render: a ref can't be read there. */
  const [saved, setSaved] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** What a pending save will send, so leaving the page can send it now. */
  const pending = useRef<string | null>(null);
  const mutate = useRef(save.mutateAsync);
  useEffect(() => {
    mutate.current = save.mutateAsync;
  });

  async function persist(value: string): Promise<boolean> {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    if (value === savedText.current) return true;
    setStatus("saving");
    try {
      await mutate.current({ id: meetingId, notes: value });
      savedText.current = value;
      setSaved(value);
      setStatus("saved");
      return true;
    } catch {
      setStatus("failed");
      return false;
    }
  }

  function change(value: string) {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    if (value.length > MEETING_NOTES_MAX_LENGTH) return;
    pending.current = value;
    timer.current = setTimeout(() => void persist(value), SAVE_AFTER_MS);
  }

  /** Puts text in the box without saving it (a clear the server already did). */
  function reset(value: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    savedText.current = value;
    setSaved(value);
    setText(value);
    setStatus("idle");
  }

  // Leaving with typing not yet saved asks first.
  const unsaved = text !== saved;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  // Leaving the page within the pause before a save (a link, closing the
  // editor) sends what was typed rather than dropping it. The mutation runs
  // on after this component is gone.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const value = pending.current;
      if (value !== null && value !== savedText.current) {
        void mutate.current({ id: meetingId, notes: value }).catch(() => {});
      }
    },
    [meetingId],
  );

  return {
    text,
    change,
    reset,
    status,
    flush: () => persist(text),
  };
}

/** The one line under a notes box saying whether they are saved. */
export function saveStatusLine(status: SaveStatus): string | null {
  if (status === "saving") return MEETING_NOTE_TAKERS_COPY.saving;
  if (status === "saved") return MEETING_NOTE_TAKERS_COPY.saved;
  if (status === "failed") return MEETING_NOTE_TAKERS_COPY.saveFailed;
  return null;
}

function linesIn(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

/**
 * Every source the author's draft reads, under the notes box: the other
 * note-takers' notes and the recording's transcript, each readable in place,
 * and adding or removing a note-taker.
 */
export function NoteTakersList({
  meetingId,
  state,
  recording,
  disabled,
  confirm,
}: {
  meetingId: string;
  state: MeetingNotesState;
  recording: MeetingRecordingState | null;
  disabled: boolean;
  confirm: (request: ConfirmRequest) => Promise<ConfirmResult | null>;
}) {
  const ids = useId();
  const remove = useRemoveMeetingNoteTaker();
  const add = useAddMeetingNoteTaker();
  const rosterQuery = useChapterRoster();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState<string>("");
  const [problem, setProblem] = useState<string | null>(null);

  const taken = useMemo(
    () => new Set(state.takers.map((taker) => taker.user_id)),
    [state.takers],
  );
  const candidates = useMemo(
    () =>
      (rosterQuery.data ?? [])
        .filter((row) => !taken.has(row.user_id))
        .map((row) => ({
          id: row.user_id,
          name: memberLabel(row.display_name, row.user_id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [rosterQuery.data, taken],
  );

  const transcript =
    recording?.status === "ready" && recording.transcript
      ? recording.transcript
      : null;

  async function handleRemove(userId: string, name: string) {
    const answer = await confirm({
      title: MEETING_NOTE_TAKERS_COPY.removeTitle(name),
      description: MEETING_NOTE_TAKERS_COPY.removeBody,
      confirmLabel: MEETING_NOTE_TAKERS_COPY.remove,
      tone: "destructive",
    });
    if (!answer) return;
    try {
      await remove.mutateAsync({ id: meetingId, userId });
    } catch (error) {
      setProblem(getErrorMessage(error, MEETING_NOTE_TAKERS_COPY.addFailed));
    }
  }

  async function handleAdd() {
    if (!pick) return;
    setProblem(null);
    try {
      await add.mutateAsync({ id: meetingId, userId: pick });
      setPick("");
      setAdding(false);
    } catch (error) {
      setProblem(
        codeOf(error) === "meeting.not_in_audience"
          ? MEETING_NOTE_TAKERS_COPY.notInAudience
          : getErrorMessage(error, MEETING_NOTE_TAKERS_COPY.addFailed),
      );
    }
  }

  const rows: {
    key: string;
    name: string;
    chips: string[];
    detail: string;
    text: string | null;
    held: boolean;
    removable: boolean;
  }[] = [
    ...state.takers.map((taker) => ({
      key: taker.user_id,
      name: taker.display_name,
      chips: [
        ...(taker.is_author ? [MEETING_NOTE_TAKERS_COPY.author] : []),
        ...(taker.added ? [MEETING_NOTE_TAKERS_COPY.added] : []),
      ],
      detail: taker.notes.trim()
        ? MEETING_NOTE_TAKERS_COPY.lines(linesIn(taker.notes))
        : MEETING_NOTE_TAKERS_COPY.noNotesYet,
      text: taker.notes.trim() ? taker.notes : null,
      held: taker.held === "consent_required",
      removable: !taker.is_author,
    })),
    ...(transcript
      ? [
          {
            key: "recording",
            name: MEETING_NOTE_TAKERS_COPY.recording,
            chips: [],
            detail: `${MEETING_NOTE_TAKERS_COPY.recordingWhat(recording?.speaker_count ?? null)}, ${MEETING_NOTE_TAKERS_COPY.lines(linesIn(transcript))}`,
            text: transcript,
            held: false,
            removable: false,
          },
        ]
      : []),
  ];

  return (
    <section aria-labelledby={`${ids}-heading`} className="space-y-2">
      <h4 id={`${ids}-heading`} className="text-sm font-semibold">
        {MEETING_NOTE_TAKERS_COPY.heading}
      </h4>
      {rows.length > 0 ? (
        <ul role="list" className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.key} className="space-y-2 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span className="break-words">{row.name}</span>
                    {row.chips.map((chip) => (
                      <Badge key={chip} variant="outline">
                        {chip}
                      </Badge>
                    ))}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {row.held
                      ? MEETING_NOTE_TAKERS_COPY.heldConsent
                      : row.detail}
                  </p>
                </div>
                {row.text ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={open === row.key}
                    onClick={() =>
                      setOpen((current) =>
                        current === row.key ? null : row.key,
                      )
                    }
                  >
                    {open === row.key
                      ? MEETING_NOTE_TAKERS_COPY.hide
                      : MEETING_NOTE_TAKERS_COPY.read}
                  </Button>
                ) : null}
                {row.removable ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled || remove.isPending}
                    onClick={() => void handleRemove(row.key, row.name)}
                  >
                    {MEETING_NOTE_TAKERS_COPY.remove}
                  </Button>
                ) : null}
              </div>
              {open === row.key && row.text ? (
                <p className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">
                  {row.text}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {state.can_add ? (
        adding ? (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
            <div className="grid min-w-0 gap-1">
              <Label htmlFor={`${ids}-pick`}>
                {MEETING_NOTE_TAKERS_COPY.addLabel}
              </Label>
              <Select value={pick} onValueChange={setPick}>
                <SelectTrigger id={`${ids}-pick`}>
                  <SelectValue
                    placeholder={MEETING_NOTE_TAKERS_COPY.addPlaceholder}
                  />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={!pick || add.isPending || disabled}
              onClick={() => void handleAdd()}
            >
              {MEETING_NOTE_TAKERS_COPY.add}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setProblem(null);
              }}
            >
              Cancel
            </Button>
            <p className="text-caption text-muted-foreground sm:col-span-3">
              {MEETING_NOTE_TAKERS_COPY.addHint}
            </p>
          </div>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => setAdding(true)}
          >
            {MEETING_NOTE_TAKERS_COPY.add}
          </Button>
        )
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm text-destructive-text">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

/**
 * A note-taker's own page on someone else's minutes (`/meetings/:id/notes`):
 * their notes, saved as they type, and nothing of the minutes, which stay
 * their author's until posted.
 */
export function NoteTakerPage({ id }: { id: string }) {
  const query = useMeetingNotes(id);
  if (query.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-4" aria-busy="true">
        <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <ErrorState
          title={MEETING_NOTE_TAKERS_COPY.takeNotes}
          description={MEETING_NOTE_TAKERS_COPY.missing}
          onRetry={query.error ? () => void query.refetch() : undefined}
        />
        <p className="text-center text-sm">
          <Link href="/meetings" className={inlineNoteActionClassName}>
            Back to Meetings
          </Link>
        </p>
      </div>
    );
  }
  return <NoteTakerNotes key={id} state={query.data} />;
}

function NoteTakerNotes({ state }: { state: MeetingNotesState }) {
  const ids = useId();
  const remove = useRemoveMeetingNoteTaker();
  const user = useCurrentUser();
  const me = (user.data as { id?: string } | undefined)?.id ?? null;
  const { confirm, confirmDialog } = useConfirmDialog();
  const notes = useNotesAutosave(state.meeting.id, state.mine.notes);
  const [left, setLeft] = useState(false);
  const status = saveStatusLine(notes.status);

  async function handleLeave() {
    const answer = await confirm({
      title: MEETING_NOTE_TAKERS_COPY.leaveTitle,
      description: MEETING_NOTE_TAKERS_COPY.leaveBody,
      confirmLabel: MEETING_NOTE_TAKERS_COPY.leave,
      tone: "destructive",
    });
    if (!answer || !me) return;
    // Leaving removes the notes and the row with them, on the server.
    try {
      await remove.mutateAsync({ id: state.meeting.id, userId: me });
      notes.reset("");
      setLeft(true);
    } catch {
      // The notes stay as they are; the status line says nothing was lost.
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-bold leading-tight">
          {MEETING_NOTE_TAKERS_COPY.noteTakerTitle(state.meeting.event_name)}
        </h2>
        <p className="text-sm text-muted-foreground">
          {meetingWhenLabel(state.meeting.event_start_time)}
        </p>
        <p className="text-sm">
          {MEETING_NOTE_TAKERS_COPY.noteTakerHint(state.meeting.author_name)}
        </p>
      </header>
      {state.mine.held === "consent_required" ? (
        <p className="rounded-lg border border-border p-3 text-sm">
          {MEETING_NOTE_TAKERS_COPY.noteTakerConsent}
        </p>
      ) : null}
      <section className="space-y-2">
        <Label htmlFor={`${ids}-notes`} className="sr-only">
          {MEETING_NOTES_COPY.heading}
        </Label>
        <Textarea
          id={`${ids}-notes`}
          aria-describedby={`${ids}-status`}
          rows={16}
          placeholder={MEETING_NOTES_COPY.placeholder}
          value={notes.text}
          disabled={left}
          onChange={(event) => notes.change(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <p
            id={`${ids}-status`}
            role="status"
            className={
              notes.status === "failed"
                ? "min-h-5 flex-1 text-sm text-destructive-text"
                : "min-h-5 flex-1 text-sm text-muted-foreground"
            }
          >
            {left ? MEETING_NOTE_TAKERS_COPY.leaveBody : status}
          </p>
          {!left ? (
            <Button
              variant="ghost"
              disabled={remove.isPending || !me}
              onClick={() => void handleLeave()}
            >
              {MEETING_NOTE_TAKERS_COPY.leave}
            </Button>
          ) : null}
        </div>
        <p className="text-caption text-muted-foreground">
          {MEETING_NOTE_TAKERS_COPY.noteTakerOthers(state.others_count)}
        </p>
      </section>
      {confirmDialog}
    </div>
  );
}
