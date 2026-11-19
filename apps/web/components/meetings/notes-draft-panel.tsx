"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { codeOf } from "@repo/api-sdk";
import {
  useChooseMeetingDraftVersion,
  useCurrentUser,
  useMemberDisplayNames,
  useDiscardMeetingDraft,
  useRequestMeetingDraft,
  useUseMeetingDraft,
  useRemoveMeetingRecording,
  type MeetingDraftState,
  type MeetingNotesState,
  type MeetingRecordingState,
} from "@repo/hooks";
import {
  MEETING_DRAFT_FAILURE_COPY,
  MEETING_NOTES_COPY,
  MEETING_NOTES_MAX_LENGTH,
  MEETING_NOTE_TAKERS_COPY,
  MINUTES_READ_COPY,
  STANDARDS_MEETING_NOTE,
  meetingLocalDay,
  notesLookLikeTranscript,
  notesWordCount,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  ConfirmRequest,
  ConfirmResult,
} from "@/components/shared/confirm-dialog";
import { useAiConsentGate } from "@/components/ai/meet-frapp-ai";
import { ReportAiButton } from "@/components/ai/report-ai";
import { RecordingUpload } from "@/components/meetings/recording-upload";
import {
  NoteTakersList,
  saveStatusLine,
  useNotesAutosave,
} from "@/components/meetings/note-takers";
import { getErrorMessage } from "@/lib/utils";

/**
 * The notes box above a draft's sections (`spec/behavior/meetings.md`
 * § Drafting from notes). The secretary pastes what they typed during the
 * meeting, asks for a draft, and the sections below fill in for them to fix
 * and post, the way Granola turns rough notes into a write-up in the same
 * document. The minutes stay theirs: nothing here posts anything.
 *
 * One status line sits beside the buttons and keeps its height in every
 * state, so nothing below moves while a draft is written (principles P4).
 *
 * Since #4935 the notes save as they are typed, other members can take notes
 * too, and the draft reads all of them and the recording's transcript
 * (`meetings.md` § Several note-takers), listed under the box.
 */
export function NotesDraftPanel({
  meetingId,
  eventStart,
  state,
  notesState,
  recording,
  hasContent,
  folded = false,
  fillInSlot = null,
  disabled,
  prepare,
  onSettled,
  onStale,
  confirm,
}: {
  meetingId: string;
  eventStart: string;
  state: MeetingDraftState;
  /** The caller's notes and the other note-takers', or null while unknown. */
  notesState: MeetingNotesState | null;
  /**
   * Where the meeting's uploaded recording stands, or null when this server
   * transcribes nothing: the notes box is then all there is.
   */
  recording: MeetingRecordingState | null;
  /** The sections below already hold something a draft would replace. */
  hasContent: boolean;
  /**
   * The minutes are written and lead the page, so the notes fold away under
   * them behind a Show button (Paul, 2026-11-16: a 4-hour transcript is not
   * what the officer edits).
   */
  folded?: boolean;
  /**
   * Where the draft's "To fill in" questions go, above the minutes, so
   * answering them is the first thing to do; in this panel when null.
   */
  fillInSlot?: HTMLElement | null;
  disabled: boolean;
  /**
   * Saves what is typed below and answers the version a draft should build
   * on, or null when the save didn't land.
   */
  prepare: () => Promise<string | null>;
  /**
   * A draft stopped being written, however it ended: load the minutes, which
   * it may have filled in.
   */
  onSettled: () => void;
  onStale: () => void;
  confirm: (request: ConfirmRequest) => Promise<ConfirmResult | null>;
}) {
  const ids = useId();
  const request = useRequestMeetingDraft();
  const discard = useDiscardMeetingDraft();
  const use = useUseMeetingDraft();
  const choose = useChooseMeetingDraftVersion();
  // A version is named by its writer; the viewer's own reads as "yours".
  const me = (useCurrentUser().data as { id?: string } | undefined)?.id;
  const myName = useMemberDisplayNames().nameFor(me ?? "");
  const isMine = (from: string) => !!myName && from === myName;
  const removeRecording = useRemoveMeetingRecording();
  // The AI sheet opens here, where the officer first reaches for the draft.
  const { ensureConsent, consentDialog } = useAiConsentGate();
  const autosave = useNotesAutosave(
    meetingId,
    notesState?.mine.notes ?? state.notes,
  );
  const notes = autosave.text;
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // One answer per open question, for the draft on screen.
  const [answers, setAnswers] = useState<string[]>([]);
  const [answersFor, setAnswersFor] = useState(state.requested_at);
  if (answersFor !== state.requested_at) {
    setAnswersFor(state.requested_at);
    setAnswers([]);
  }

  const drafting =
    state.status === "drafting" || request.isPending || use.isPending;
  const needsConsent = state.blocked === "consent_required";
  const transcriptReady =
    recording?.status === "ready" && !!recording.transcript;
  const othersWrote =
    (notesState?.takers ?? []).some(
      (taker) => taker.notes.trim() && taker.held === null,
    ) || transcriptReady;

  // The draft landing is the server's doing, so the page learns of it here.
  // Whenever one stops being written (put in, waiting, stopped, failed, or
  // cleared from another tab), the minutes on screen may be behind.
  const lastStatus = useRef(state.status);
  const settled = useRef(onSettled);
  useEffect(() => {
    settled.current = onSettled;
  });
  useEffect(() => {
    if (lastStatus.current === state.status) return;
    const was = lastStatus.current;
    lastStatus.current = state.status;
    if (was === "drafting" || state.status === "applied") settled.current();
  }, [state.status]);

  /**
   * Write the draft. With `answered`, the officer's answers to the open
   * questions join the end of their notes first, as their own lines, so the
   * redraft reads them like the rest of the notes and can quote them; the
   * author's notes outrank every other source, so an answer settles what the
   * transcript left open.
   */
  async function handleDraft(answered?: string) {
    const text = (
      answered ? `${notes.trimEnd()}\n\n${answered}` : notes
    ).trim();

    if (!text && !othersWrote) {
      setProblem(MEETING_NOTES_COPY.empty);
      return;
    }
    if (text.length > MEETING_NOTES_MAX_LENGTH) {
      setProblem(
        MEETING_NOTES_COPY.tooLong(MEETING_NOTES_MAX_LENGTH, text.length),
      );
      return;
    }
    setProblem(null);
    if (needsConsent) {
      try {
        // A No leaves everything as it was: the notes stay in the box.
        if (!(await ensureConsent())) return;
      } catch {
        setProblem(MEETING_NOTES_COPY.consentCheckFailed);
        return;
      }
    }
    // Answering the open questions says plainly that the draft is rewritten.
    if (hasContent && !answered) {
      const answer = await confirm({
        title: MEETING_NOTES_COPY.replaceTitle,
        description: MEETING_NOTES_COPY.replaceBodyDraft,
        confirmLabel: MEETING_NOTES_COPY.draft,
        tone: "default",
      });
      if (!answer) return;
    }
    // A save still waiting goes first: otherwise the draft would read the
    // notes as they were, and the late save of an emptied box would then
    // delete the draft just asked for.
    if (!(await autosave.flush())) return;
    const expected = await prepare();
    if (!expected) return;
    try {
      // The officer's notes go with the request too, so the draft reads
      // exactly what is in the box.
      await request.mutateAsync({
        id: meetingId,
        body: {
          ...(text ? { notes: text } : {}),
          expected_updated_at: expected,
          meeting_date: meetingLocalDay(eventStart),
        },
      });
      // The server stored the notes with the answers; the box shows them
      // only now, so a request that never went leaves the notes as they were.
      if (answered) autosave.reset(text);
    } catch (error) {
      const code = codeOf(error);
      if (code === "meeting.stale") onStale();
      else if (code === "meeting.standards_refused")
        setProblem(STANDARDS_MEETING_NOTE);
      else if (code === "ai.consent.required")
        setProblem(MEETING_DRAFT_FAILURE_COPY.consent_required);
      else if (code === "ai.chapter_off")
        setProblem(MEETING_DRAFT_FAILURE_COPY.chapter_off);
      else setProblem(getErrorMessage(error, MEETING_NOTES_COPY.startFailed));
    }
  }

  async function handleAnswers() {
    const lines = state.review.gaps
      .map((gap, index) => {
        const answer = (answers[index] ?? "").replace(/\s+/g, " ").trim();
        return answer ? `${gap.trim()} ${answer}` : null;
      })
      .filter((line): line is string => line !== null);
    if (lines.length === 0) return;
    await handleDraft([MEETING_NOTES_COPY.answersHeading, ...lines].join("\n"));
  }

  async function handleStop() {
    // Only the writing stops: the notes stay, stored and in the box.
    try {
      await discard.mutateAsync({ id: meetingId, keepNotes: true });
    } catch (error) {
      setProblem(getErrorMessage(error, MEETING_NOTES_COPY.stopFailed));
    }
  }

  async function handleClear() {
    const answer = await confirm({
      title: MEETING_NOTES_COPY.clearTitle,
      description:
        recording && recording.status !== "none"
          ? MEETING_NOTES_COPY.clearBodyRecording
          : MEETING_NOTES_COPY.clearBody,
      confirmLabel: MEETING_NOTES_COPY.clear,
      tone: "destructive",
    });
    if (!answer) return;
    try {
      // Clears the officer's own notes and the draft; other note-takers'
      // notes stay theirs.
      await discard.mutateAsync({ id: meetingId });
      // The recording is the officer's upload: Clear notes removes it too.
      if (recording && recording.status !== "none") {
        await removeRecording.mutateAsync({ id: meetingId });
      }
      autosave.reset("");
      setProblem(null);
    } catch (error) {
      setProblem(getErrorMessage(error, MEETING_NOTES_COPY.clearFailed));
    }
  }

  // A pasted transcript folds into a card (#5562; Paul, 2026-11-19: a Wispr
  // Flow paste made "the infinite scroll"), the phone's twin in
  // `notes-panel.tsx`: what it is and how long, with View and Remove.
  const [showText, setShowText] = useState(false);
  const [focused, setFocused] = useState(false);
  const pasted = notesLookLikeTranscript(notes);
  const pastedFolded = pasted && !showText && !focused;
  const pastedCopy = MINUTES_READ_COPY.pastedTranscript;

  async function handleRemovePasted() {
    // After a draft only Clear notes may empty the stored notes, so Remove
    // is Clear there; before one it empties the box, which saves.
    if (state.status !== "none") {
      await handleClear();
      return;
    }
    const answer = await confirm({
      title: pastedCopy.removeTitle,
      description: pastedCopy.removeBody,
      confirmLabel: pastedCopy.remove,
      tone: "destructive",
    });
    if (!answer) return;
    autosave.change("");
    setShowText(false);
  }

  async function handleChoose(conflict: number, version: number) {
    const expected = await prepare();
    if (!expected) return;
    try {
      await choose.mutateAsync({
        id: meetingId,
        body: { conflict, version, expected_updated_at: expected },
      });
      onSettled();
    } catch (error) {
      if (codeOf(error) === "meeting.stale") onStale();
      else
        setProblem(
          getErrorMessage(error, MEETING_NOTE_TAKERS_COPY.chooseFailed),
        );
    }
  }

  async function handleUse() {
    if (hasContent) {
      const answer = await confirm({
        title: MEETING_NOTES_COPY.replaceTitle,
        description: MEETING_NOTES_COPY.replaceBodyUse,
        confirmLabel: MEETING_NOTES_COPY.useDraft,
        tone: "default",
      });
      if (!answer) return;
    }
    // The minutes moved while the draft was written, so the version on
    // screen is read again before the draft goes onto it.
    const expected = await prepare();
    if (!expected) return;
    try {
      await use.mutateAsync({ id: meetingId, expectedUpdatedAt: expected });
    } catch (error) {
      if (codeOf(error) === "meeting.stale") onStale();
      else setProblem(getErrorMessage(error, MEETING_NOTES_COPY.useFailed));
    }
  }

  const waiting = state.status === "ready";
  const saving = saveStatusLine(autosave.status);
  const status = problem
    ? { tone: "problem" as const, text: problem }
    : autosave.status === "failed" && saving
      ? { tone: "problem" as const, text: saving }
      : drafting
        ? {
            tone: "quiet" as const,
            text: othersWrote
              ? MEETING_NOTE_TAKERS_COPY.draftingAll
              : MEETING_NOTES_COPY.drafting,
          }
        : needsConsent
          ? {
              tone: "quiet" as const,
              text: MEETING_DRAFT_FAILURE_COPY.consent_required,
            }
          : state.status === "failed"
            ? {
                tone:
                  state.failure === "stopped"
                    ? ("quiet" as const)
                    : ("problem" as const),
                text:
                  state.failure_message ?? MEETING_DRAFT_FAILURE_COPY.failed,
              }
            : waiting
              ? {
                  tone: "quiet" as const,
                  text: MEETING_NOTES_COPY.waiting,
                }
              : state.status === "applied"
                ? {
                    tone: "quiet" as const,
                    text: othersWrote
                      ? MEETING_NOTE_TAKERS_COPY.appliedAll
                      : MEETING_NOTES_COPY.applied,
                  }
                : {
                    tone: "quiet" as const,
                    text: MEETING_NOTES_COPY.idle,
                  };

  const reviewed = state.status === "applied" || state.status === "ready";
  const { gaps, left_out: leftOut } = state.review;
  // An API from before several note-takers sends no disagreements.
  const conflicts = state.review.conflicts ?? [];

  const answered = answers.some((answer) => answer.trim().length > 0);
  const fillIn =
    reviewed && !drafting && (gaps.length > 0 || leftOut > 0) ? (
      <section
        aria-labelledby={`${ids}-fill-in`}
        className={
          fillInSlot
            ? "space-y-3 rounded-lg border border-primary/40 bg-surface-1 p-4"
            : "space-y-3 border-t border-border pt-3"
        }
      >
        <div className="space-y-1">
          <h3 id={`${ids}-fill-in`} className="text-base font-semibold">
            {MEETING_NOTES_COPY.toFillIn}
            {gaps.length > 0 ? `, ${gaps.length}` : ""}
          </h3>
          {gaps.length > 0 ? (
            <p className="text-caption text-muted-foreground">
              {MEETING_NOTES_COPY.toFillInHint}
            </p>
          ) : null}
        </div>
        {gaps.length > 0 ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleAnswers();
            }}
          >
            <ol role="list" className="space-y-3">
              {gaps.map((gap, index) => (
                <li key={index} className="grid gap-1">
                  <label htmlFor={`${ids}-answer-${index}`} className="text-sm">
                    {gap}
                  </label>
                  <Input
                    id={`${ids}-answer-${index}`}
                    placeholder={MEETING_NOTES_COPY.answerPlaceholder}
                    value={answers[index] ?? ""}
                    disabled={disabled}
                    maxLength={500}
                    onChange={(event) => {
                      const value = event.target.value;
                      setAnswers((current) => {
                        const next = [...current];
                        next[index] = value;
                        return next;
                      });
                    }}
                  />
                </li>
              ))}
            </ol>
            <Button type="submit" disabled={disabled || !answered}>
              {MEETING_NOTES_COPY.updateDraft}
            </Button>
          </form>
        ) : null}
        {leftOut > 0 ? (
          <p className="text-sm text-muted-foreground">
            {MEETING_NOTES_COPY.leftOut(leftOut)}
          </p>
        ) : null}
      </section>
    ) : null;

  return (
    <section
      aria-labelledby={`${ids}-heading`}
      className="space-y-3 rounded-lg border border-border p-4"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 id={`${ids}-heading`} className="text-base font-semibold">
            {folded
              ? MEETING_NOTES_COPY.foldedHeading
              : MEETING_NOTES_COPY.heading}
          </h3>
          <p className="text-caption text-muted-foreground">
            {folded
              ? MEETING_NOTES_COPY.foldedSummary(notesWordCount(notes))
              : MEETING_NOTES_COPY.hint}
          </p>
        </div>
        {folded ? (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={`${ids}-notes`}
            onClick={() => setOpen((was) => !was)}
          >
            {open ? MEETING_NOTES_COPY.hide : MEETING_NOTES_COPY.show}
          </Button>
        ) : null}
      </div>
      <div id={`${ids}-notes`} hidden={folded && !open} className="space-y-3">
        {recording?.available && recording.blocked !== "chapter_off" ? (
          <RecordingUpload
            meetingId={meetingId}
            state={recording}
            disabled={drafting || disabled}
            ensureConsent={ensureConsent}
            confirm={confirm}
          />
        ) : null}
        {pastedFolded ? (
          <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{pastedCopy.title}</p>
              <p className="text-caption text-muted-foreground">
                {pastedCopy.words(notesWordCount(notes))}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowText(true)}>
              {pastedCopy.view}
            </Button>
            {!drafting ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || discard.isPending}
                onClick={() => void handleRemovePasted()}
              >
                {pastedCopy.remove}
              </Button>
            ) : null}
          </div>
        ) : (
          <Textarea
            aria-labelledby={`${ids}-heading`}
            aria-describedby={`${ids}-status`}
            aria-invalid={problem ? true : undefined}
            placeholder={MEETING_NOTES_COPY.placeholder}
            rows={8}
            value={notes}
            disabled={drafting || disabled}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => {
              autosave.change(event.target.value);
              if (problem) setProblem(null);
            }}
          />
        )}
        {pasted && showText && !focused ? (
          <Button variant="ghost" size="sm" onClick={() => setShowText(false)}>
            {pastedCopy.hide}
          </Button>
        ) : null}
        {saving && autosave.status !== "failed" ? (
          <p className="text-caption text-muted-foreground">{saving}</p>
        ) : null}
        {notesState &&
        (notesState.takers.length > 0 ||
          transcriptReady ||
          notesState.can_add) ? (
          <NoteTakersList
            meetingId={meetingId}
            state={notesState}
            recording={recording}
            disabled={drafting || disabled}
            confirm={confirm}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {drafting ? (
          <Button
            variant="secondary"
            disabled={discard.isPending || request.isPending}
            onClick={() => void handleStop()}
          >
            {MEETING_NOTES_COPY.stop}
          </Button>
        ) : (
          <Button
            variant={hasContent ? "secondary" : "default"}
            disabled={disabled}
            onClick={() => void handleDraft()}
          >
            {reviewed
              ? MEETING_NOTES_COPY.draftAgain
              : othersWrote
                ? MEETING_NOTE_TAKERS_COPY.draftAll
                : MEETING_NOTES_COPY.draft}
          </Button>
        )}
        {waiting ? (
          <Button
            disabled={disabled || use.isPending}
            onClick={() => void handleUse()}
          >
            {MEETING_NOTES_COPY.useDraft}
          </Button>
        ) : null}
        {!drafting &&
        (notes !== "" ||
          state.status !== "none" ||
          (!!recording && recording.status !== "none")) ? (
          <Button
            variant="ghost"
            disabled={disabled || discard.isPending}
            onClick={() => void handleClear()}
          >
            {MEETING_NOTES_COPY.clear}
          </Button>
        ) : null}
        {/* A draft the AI wrote can be reported, like an Ask answer. */}
        {reviewed && !drafting ? (
          <ReportAiButton
            // Each draft is its own thing to report.
            key={state.requested_at ?? "draft"}
            className="ml-auto"
            target={{ subject: "meeting_draft", subjectId: meetingId }}
          />
        ) : null}
      </div>
      <p
        id={`${ids}-status`}
        role="status"
        className={
          status.tone === "problem"
            ? "min-h-10 text-sm text-destructive-text"
            : "min-h-10 text-sm text-muted-foreground"
        }
      >
        {status.text}
      </p>
      {fillInSlot ? (fillIn ? createPortal(fillIn, fillInSlot) : null) : fillIn}
      {reviewed && !drafting && conflicts.length > 0 ? (
        <div className="space-y-2 border-t border-border pt-3">
          <h4 className="text-sm font-semibold">
            {MEETING_NOTE_TAKERS_COPY.disagreed}
          </h4>
          <ul role="list" className="space-y-3">
            {conflicts.map((conflict, index) => (
              <li
                key={index}
                className="space-y-2 rounded-lg border border-warning/30 p-3"
              >
                <p className="text-caption font-semibold text-warning-text">
                  {conflict.settled_by
                    ? MEETING_NOTE_TAKERS_COPY.settledBy[conflict.settled_by]
                    : MEETING_NOTE_TAKERS_COPY.youDecide}
                </p>
                <p className="text-sm font-semibold">{conflict.about}</p>
                {conflict.chosen === null ? (
                  <p className="text-sm text-muted-foreground">
                    {MEETING_NOTE_TAKERS_COPY.tieBody}
                  </p>
                ) : null}
                <ul role="list" className="space-y-2">
                  {conflict.versions.map((version, at) => (
                    <li
                      key={at}
                      className="flex flex-wrap items-start gap-2 text-sm"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="break-words">{version.text}</p>
                        <p className="break-words text-caption text-muted-foreground">
                          {MEETING_NOTE_TAKERS_COPY.from(
                            version.from,
                            isMine(version.from),
                          )}
                          : “{version.quote}”
                        </p>
                      </div>
                      {conflict.chosen === at ? (
                        <span className="text-caption text-muted-foreground">
                          {MEETING_NOTE_TAKERS_COPY.inMinutes}
                        </span>
                      ) : state.status === "applied" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={disabled || choose.isPending}
                          onClick={() => void handleChoose(index, at)}
                        >
                          {conflict.chosen === null
                            ? MEETING_NOTE_TAKERS_COPY.pickVersion(
                                version.from,
                                isMine(version.from),
                              )
                            : MEETING_NOTE_TAKERS_COPY.takeVersion(
                                version.from,
                                isMine(version.from),
                              )}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {consentDialog}
    </section>
  );
}
