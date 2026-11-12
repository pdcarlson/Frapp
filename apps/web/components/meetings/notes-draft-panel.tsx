"use client";

import { useEffect, useId, useRef, useState } from "react";
import { codeOf } from "@repo/api-sdk";
import {
  useDiscardMeetingDraft,
  useRequestMeetingDraft,
  type MeetingDraftState,
} from "@repo/hooks";
import {
  MEETING_DRAFT_FAILURE_COPY,
  MEETING_NOTES_MAX_LENGTH,
  STANDARDS_MEETING_NOTE,
  type MeetingContent,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type {
  ConfirmRequest,
  ConfirmResult,
} from "@/components/shared/confirm-dialog";
import { getErrorMessage } from "@/lib/utils";

/** `2026-11-09` for the calendar day `value` falls on where the reader is. */
export function localDayOf(value: string): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function leftOutLine(count: number): string {
  return count === 1
    ? "One drafted line was left out because nothing in your notes backed it."
    : `${count} drafted lines were left out because nothing in your notes backed them.`;
}

/**
 * The notes box above a draft's sections (`spec/behavior/meetings.md`
 * § Drafting from notes). The secretary pastes what they typed during the
 * meeting, asks for a draft, and the sections below fill in for them to fix
 * and post, the way Granola turns rough notes into a write-up in the same
 * document. The minutes stay theirs: nothing here posts anything.
 *
 * One status line sits beside the buttons and keeps its height in every
 * state, so nothing below moves while a draft is written (principles P4).
 */
export function NotesDraftPanel({
  meetingId,
  eventStart,
  state,
  hasContent,
  disabled,
  prepare,
  onApplied,
  onUse,
  onStale,
  confirm,
}: {
  meetingId: string;
  eventStart: string;
  state: MeetingDraftState;
  /** The sections below already hold something a draft would replace. */
  hasContent: boolean;
  disabled: boolean;
  /**
   * Saves what is typed below and answers the version a draft should build
   * on, or null when the save didn't land.
   */
  prepare: () => Promise<string | null>;
  /** The draft went into the minutes: load them. */
  onApplied: () => void;
  /** Put a draft that waited (`ready`) into the editor. */
  onUse: (content: Partial<MeetingContent>) => void;
  onStale: () => void;
  confirm: (request: ConfirmRequest) => Promise<ConfirmResult | null>;
}) {
  const ids = useId();
  const request = useRequestMeetingDraft();
  const discard = useDiscardMeetingDraft();
  const [notes, setNotes] = useState(state.notes);
  const [problem, setProblem] = useState<string | null>(null);
  const [used, setUsed] = useState(false);

  const drafting = state.status === "drafting" || request.isPending;
  const needsConsent = state.blocked === "consent_required";
  const unsent = notes.trim() !== state.notes.trim() && notes.trim() !== "";

  // The draft landing is the server's doing, so the page learns of it here.
  const lastStatus = useRef(state.status);
  const applied = useRef(onApplied);
  useEffect(() => {
    applied.current = onApplied;
  });
  useEffect(() => {
    if (lastStatus.current === state.status) return;
    lastStatus.current = state.status;
    if (state.status === "applied") applied.current();
  }, [state.status]);

  // Notes are stored when a draft is asked for, so until then leaving asks.
  useEffect(() => {
    if (!unsent) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsent]);

  async function handleDraft() {
    const text = notes.trim();
    if (!text) {
      setProblem("Paste or type your notes first.");
      return;
    }
    if (text.length > MEETING_NOTES_MAX_LENGTH) {
      setProblem(
        `Notes can be up to ${MEETING_NOTES_MAX_LENGTH.toLocaleString("en-US")} characters, and these are ${text.length.toLocaleString("en-US")}. Shorten them, or draft the meeting in two parts.`,
      );
      return;
    }
    setProblem(null);
    if (hasContent) {
      const answer = await confirm({
        title: "Replace what's written?",
        description:
          "The draft replaces the sections below with what it finds in your notes. Who checked in stays as it is.",
        confirmLabel: "Draft minutes",
        tone: "default",
      });
      if (!answer) return;
    }
    const expected = await prepare();
    if (!expected) return;
    try {
      setUsed(false);
      await request.mutateAsync({
        id: meetingId,
        body: {
          notes: text,
          expected_updated_at: expected,
          meeting_date: localDayOf(eventStart),
        },
      });
    } catch (error) {
      const code = codeOf(error);
      if (code === "meeting.stale") onStale();
      else if (code === "meeting.standards_refused")
        setProblem(STANDARDS_MEETING_NOTE);
      else if (code === "ai.consent.required")
        setProblem(MEETING_DRAFT_FAILURE_COPY.consent_required);
      else if (code === "ai.chapter_off")
        setProblem(MEETING_DRAFT_FAILURE_COPY.chapter_off);
      else
        setProblem(
          getErrorMessage(
            error,
            "Couldn't start the draft. Your notes are still in the box, so try again.",
          ),
        );
    }
  }

  async function handleStop() {
    // The box keeps the notes, so stopping loses nothing typed.
    try {
      await discard.mutateAsync(meetingId);
    } catch (error) {
      setProblem(getErrorMessage(error, "Couldn't stop the draft. Try again."));
    }
  }

  async function handleClear() {
    const answer = await confirm({
      title: "Clear your notes?",
      description:
        "The notes are removed for good. What is written in the minutes below stays.",
      confirmLabel: "Clear notes",
      tone: "destructive",
    });
    if (!answer) return;
    try {
      if (state.status !== "none") await discard.mutateAsync(meetingId);
      setNotes("");
      setProblem(null);
    } catch (error) {
      setProblem(
        getErrorMessage(error, "Couldn't clear the notes. Try again."),
      );
    }
  }

  const waiting = state.status === "ready" && !used;
  const status = problem
    ? { tone: "problem" as const, text: problem }
    : drafting
      ? { tone: "quiet" as const, text: "Drafting minutes from your notes" }
      : needsConsent
        ? {
            tone: "quiet" as const,
            text: MEETING_DRAFT_FAILURE_COPY.consent_required,
          }
        : state.status === "failed"
          ? {
              tone: "problem" as const,
              text: state.failure_message ?? MEETING_DRAFT_FAILURE_COPY.failed,
            }
          : waiting
            ? {
                tone: "quiet" as const,
                text: "The minutes changed while the draft was being written, so it wasn't put in.",
              }
            : state.status === "applied" || used
              ? {
                  tone: "quiet" as const,
                  text: "Drafted from your notes. Read it through before you post.",
                }
              : {
                  tone: "quiet" as const,
                  text: "Your notes go to an AI provider to write the draft. Nothing is posted until you post it.",
                };

  const reviewed = state.status === "applied" || state.status === "ready";
  const { gaps, left_out: leftOut } = state.review;

  return (
    <section
      aria-labelledby={`${ids}-heading`}
      className="space-y-3 rounded-lg border border-border p-4"
    >
      <div className="space-y-1">
        <h3 id={`${ids}-heading`} className="text-base font-semibold">
          Your notes
        </h3>
        <p className="text-caption text-muted-foreground">
          Rough is fine. The draft keeps only what your notes say, and lists
          what they leave out.
        </p>
      </div>
      <Textarea
        aria-labelledby={`${ids}-heading`}
        aria-describedby={`${ids}-status`}
        aria-invalid={problem ? true : undefined}
        placeholder="Paste or type what you wrote down during the meeting."
        rows={8}
        value={notes}
        disabled={drafting || disabled}
        onChange={(event) => {
          setNotes(event.target.value);
          if (problem) setProblem(null);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        {drafting ? (
          <Button
            variant="secondary"
            disabled={discard.isPending || request.isPending}
            onClick={() => void handleStop()}
          >
            Stop
          </Button>
        ) : (
          <Button
            variant={hasContent ? "secondary" : "default"}
            disabled={disabled || needsConsent}
            onClick={() => void handleDraft()}
          >
            {reviewed ? "Draft again" : "Draft minutes"}
          </Button>
        )}
        {waiting && state.content ? (
          <Button
            disabled={disabled}
            onClick={() => {
              onUse(state.content as Partial<MeetingContent>);
              setUsed(true);
            }}
          >
            Use the draft
          </Button>
        ) : null}
        {!drafting && (notes !== "" || state.status !== "none") ? (
          <Button
            variant="ghost"
            disabled={disabled || discard.isPending}
            onClick={() => void handleClear()}
          >
            Clear notes
          </Button>
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
      {reviewed && !drafting && (gaps.length > 0 || leftOut > 0) ? (
        <div className="space-y-1 border-t border-border pt-3">
          <h4 className="text-sm font-semibold">To fill in</h4>
          {gaps.length > 0 ? (
            <ul role="list" className="list-disc space-y-1 pl-5 text-sm">
              {gaps.map((gap, index) => (
                <li key={index}>{gap}</li>
              ))}
            </ul>
          ) : null}
          {leftOut > 0 ? (
            <p className="text-sm text-muted-foreground">
              {leftOutLine(leftOut)}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
