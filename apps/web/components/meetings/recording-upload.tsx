"use client";

import { useEffect, useId, useRef, useState } from "react";
import { codeOf } from "@repo/api-sdk";
import { formatBytes } from "@repo/formatting";
import {
  useConfirmMeetingRecording,
  useRemoveMeetingRecording,
  useStartMeetingRecording,
  type MeetingRecordingState,
} from "@repo/hooks";
import {
  MEETING_RECORDING_ACCEPT,
  MEETING_RECORDING_FAILURE_COPY,
  MEETING_RECORDING_FORMATS_LABEL,
  MEETING_RECORDING_NOTICE,
  MIN_MEETING_RECORDING_SECONDS,
  STANDARDS_MEETING_NOTE,
  meetingRecordingLengthLabel,
  meetingRecordingMimeType,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import type {
  ConfirmRequest,
  ConfirmResult,
} from "@/components/shared/confirm-dialog";
import {
  ResumableUploadError,
  readAudioDuration,
  uploadResumable,
} from "@/lib/resumable-upload";
import { getErrorMessage } from "@/lib/utils";

/** "1 hour 12 minutes" inside a sentence. */
function lengthInWords(seconds: number): string {
  return meetingRecordingLengthLabel(seconds).toLowerCase();
}

function speakersLabel(count: number | null): string {
  if (!count) return "";
  return count === 1 ? ", one speaker" : `, ${count} speakers`;
}

type Chosen = { file: File; seconds: number };

/** What is wrong with a file, or what it is: checked the moment it is picked. */
async function inspect(
  file: File,
  limits: { maxBytes: number; maxSeconds: number },
): Promise<{ chosen: Chosen } | { problem: string }> {
  if (!meetingRecordingMimeType(file.name, file.type)) {
    return {
      problem: `That file isn't a recording Frapp can read. Choose ${MEETING_RECORDING_FORMATS_LABEL}.`,
    };
  }
  if (file.size === 0) return { problem: "That file is empty." };
  if (file.size > limits.maxBytes) {
    return {
      problem: `That file is ${formatBytes(file.size)}, and the most Frapp takes is ${formatBytes(limits.maxBytes)}. Export it at a lower quality, or split it in two and upload each part.`,
    };
  }
  const seconds = await readAudioDuration(file);
  if (seconds === null) {
    return {
      problem:
        "Your browser couldn't read how long that recording is. Export it from your phone as M4A or MP3 and choose that.",
    };
  }
  if (seconds < MIN_MEETING_RECORDING_SECONDS) {
    return {
      problem: `That recording is shorter than ${MIN_MEETING_RECORDING_SECONDS} seconds. Check that it is the right file.`,
    };
  }
  if (seconds > limits.maxSeconds) {
    return {
      problem: `That recording is ${lengthInWords(seconds)} long, and the most Frapp takes is ${lengthInWords(limits.maxSeconds)}. Split it and upload each part.`,
    };
  }
  return { chosen: { file, seconds } };
}

/**
 * Uploading a meeting's recording (`spec/behavior/meetings.md` § Uploading a
 * recording, #712), inside the notes box it feeds. The secretary picks the
 * file their phone recorded, confirms the room was told, and leaves: the
 * transcript arrives in a few minutes and goes into "Your notes", where
 * drafting takes over. Otter's "Import" and Rev's upload work the same way:
 * choose a file, watch one line of progress, come back to text.
 *
 * One row, one height, in every state (principles P4): what the recording is
 * doing, and the one thing to do about it. The row is tall enough for three
 * lines with the button beneath them, which is what the narrow panel beside
 * chat needs, so nothing below moves as the states change.
 */
export function RecordingUpload({
  meetingId,
  state,
  disabled,
  notes,
  onTranscript,
  ensureConsent,
  confirm,
}: {
  meetingId: string;
  state: MeetingRecordingState;
  disabled: boolean;
  /** What is in the notes box now. */
  notes: string;
  /** Put the transcript into the notes box. */
  onTranscript: (transcript: string) => void;
  ensureConsent: () => Promise<boolean>;
  confirm: (request: ConfirmRequest) => Promise<ConfirmResult | null>;
}) {
  const ids = useId();
  const start = useStartMeetingRecording();
  const confirmUploaded = useConfirmMeetingRecording();
  const remove = useRemoveMeetingRecording();

  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [reading, setReading] = useState(false);
  const [told, setTold] = useState(false);
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** The upload this tab is sending: null after a reload. */
  const [sending, setSending] = useState<{
    uploadId: string;
    sent: number;
    total: number;
  } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const limits = { maxBytes: state.max_bytes, maxSeconds: state.max_seconds };

  // A transcript that arrives while the notes box is empty goes straight in:
  // that is what the officer uploaded it for. Notes they already typed are
  // theirs, so then it waits behind a button.
  // The same on coming back to the page: the transcript is on the server,
  // the notes box starts empty, and the officer should find it filled. It is
  // put in once per upload, so emptying the box by hand stays emptied.
  const delivered = useRef<string | null>(null);
  const put = useRef(onTranscript);
  const notesNow = useRef(notes);
  useEffect(() => {
    put.current = onTranscript;
    notesNow.current = notes;
  });
  useEffect(() => {
    if (state.status !== "ready" || !state.transcript) return;
    if (delivered.current === state.upload_id) return;
    delivered.current = state.upload_id;
    if (notesNow.current.trim() === "") put.current(state.transcript);
  }, [state.status, state.transcript, state.upload_id]);

  // Leaving mid-upload loses it, so the browser asks first.
  useEffect(() => {
    if (!sending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [sending]);
  useEffect(() => () => abort.current?.abort(), []);

  async function handleOpen() {
    setProblem(null);
    if (state.blocked === "consent_required") {
      try {
        if (!(await ensureConsent())) return;
      } catch {
        setProblem("Couldn't check your AI choice. Try again in a moment.");
        return;
      }
    }
    setChosen(null);
    setTold(false);
    setFormProblem(null);
    setOpen(true);
  }

  async function handleFile(file: File | undefined) {
    setFormProblem(null);
    setChosen(null);
    if (!file) return;
    setReading(true);
    const result = await inspect(file, limits);
    setReading(false);
    if ("problem" in result) setFormProblem(result.problem);
    else setChosen(result.chosen);
  }

  async function handleUpload() {
    if (!chosen) {
      setFormProblem("Choose the recording first.");
      return;
    }
    if (!told) {
      setFormProblem(MEETING_RECORDING_NOTICE.unconfirmed);
      return;
    }
    if (state.status === "ready" || state.status === "transcribing") {
      const answer = await confirm({
        title: "Replace the recording?",
        description:
          state.status === "ready"
            ? "The earlier transcript is removed. What is already in your notes stays."
            : "The recording being transcribed now is stopped and removed.",
        confirmLabel: "Replace it",
        tone: "default",
      });
      if (!answer) return;
    }
    const { file, seconds } = chosen;
    let target;
    try {
      const started = await start.mutateAsync({
        id: meetingId,
        body: {
          file_name: file.name.slice(0, 200),
          mime_type: file.type || null,
          size_bytes: file.size,
          duration_seconds: Math.round(seconds),
          notice_confirmed: true,
        },
      });
      target = started.upload;
      if (!target) throw new Error("The upload could not be started.");
    } catch (error) {
      const code = codeOf(error);
      setFormProblem(
        code === "meeting.standards_refused"
          ? STANDARDS_MEETING_NOTE
          : code === "ai.consent.required"
            ? MEETING_RECORDING_FAILURE_COPY.consent_required
            : code === "ai.chapter_off"
              ? MEETING_RECORDING_FAILURE_COPY.chapter_off
              : getErrorMessage(
                  error,
                  "Couldn't start the upload. Try again in a moment.",
                ),
      );
      return;
    }

    setOpen(false);
    const controller = new AbortController();
    abort.current = controller;
    setSending({ uploadId: target.upload_id, sent: 0, total: file.size });
    try {
      await uploadResumable(
        file,
        {
          bucket: target.bucket,
          path: target.path,
          token: target.token,
          contentType: target.content_type,
        },
        {
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
          signal: controller.signal,
          onProgress: (sent, total) =>
            setSending({ uploadId: target.upload_id, sent, total }),
        },
      );
      await confirmUploaded.mutateAsync({
        id: meetingId,
        uploadId: target.upload_id,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      // Nothing half-sent is kept: the officer starts again with the file.
      void remove.mutateAsync({ id: meetingId }).catch(() => undefined);
      setProblem(
        error instanceof ResumableUploadError
          ? error.failure === "network"
            ? "The connection dropped and the upload couldn't finish. Check your connection and upload the recording again."
            : error.failure === "too_large"
              ? "That file is larger than Frapp takes. Export it at a lower quality, or split it in two."
              : "The upload was refused. Upload the recording again."
          : getErrorMessage(
              error,
              "The upload didn't finish. Upload the recording again.",
            ),
      );
    } finally {
      abort.current = null;
      setSending(null);
    }
  }

  async function handleRemove(ask: ConfirmRequest | null) {
    if (ask && !(await confirm(ask))) return;
    abort.current?.abort();
    setProblem(null);
    try {
      await remove.mutateAsync({ id: meetingId });
    } catch (error) {
      setProblem(
        getErrorMessage(error, "Couldn't remove the recording. Try again."),
      );
    }
  }

  function run(does: "upload" | "cancel" | "stop" | "insert") {
    if (does === "upload") return void handleOpen();
    if (does === "cancel") return void handleRemove(null);
    if (does === "insert") {
      if (state.transcript) onTranscript(state.transcript);
      return;
    }
    void handleRemove({
      title: "Stop transcribing?",
      description: "The recording is removed. You can upload it again later.",
      confirmLabel: "Stop",
      tone: "destructive",
    });
  }

  const inNotes =
    state.status === "ready" &&
    !!state.transcript &&
    notes.includes(state.transcript.slice(0, 200));
  // The server says an upload is under way, and this tab isn't sending it:
  // the page was reloaded or closed mid-upload.
  const interrupted = state.status === "uploading" && !sending;
  const busy = start.isPending || confirmUploaded.isPending || remove.isPending;

  let line: { tone: "quiet" | "problem"; text: string };
  // What a button does is named, not held as a function: the handlers read
  // refs, which render must not.
  type RowAction = {
    label: string;
    does: "upload" | "cancel" | "stop" | "insert";
  };
  let action: RowAction | null = null;
  let second: RowAction | null = null;
  const uploadAction: RowAction = { label: "Upload a recording", does: "upload" };
  if (sending) {
    const percent =
      sending.total > 0 ? Math.floor((sending.sent / sending.total) * 100) : 0;
    line = {
      tone: "quiet",
      text: `Uploading the recording: ${percent}% of ${formatBytes(sending.total)}. Keep this page open until it finishes.`,
    };
    action = { label: "Cancel", does: "cancel" };
  } else if (problem) {
    line = { tone: "problem", text: problem };
    action = uploadAction;
  } else if (interrupted) {
    line = {
      tone: "problem",
      text: "The upload was interrupted before it finished. Upload the recording again.",
    };
    action = uploadAction;
  } else if (state.status === "transcribing") {
    line = {
      tone: "quiet",
      text: `Transcribing ${lengthInWords(state.duration_seconds ?? 0)} of audio. This takes a few minutes, and you can leave this page.`,
    };
    action = { label: "Stop", does: "stop" };
  } else if (state.status === "ready") {
    line = {
      tone: "quiet",
      text: inNotes
        ? `The transcript is in your notes (${lengthInWords(state.duration_seconds ?? 0)}${speakersLabel(state.speaker_count)}). Speakers are numbered, not named, and the recording has been deleted.`
        : `The transcript is ready (${lengthInWords(state.duration_seconds ?? 0)}${speakersLabel(state.speaker_count)}), and the recording has been deleted.`,
    };
    if (!inNotes && state.transcript) {
      action = {
        label: notes.trim() === "" ? "Put it in your notes" : "Add to your notes",
        does: "insert",
      };
    }
    second = { label: "Upload another", does: "upload" };
  } else if (state.status === "failed") {
    line = {
      tone: "problem",
      text: state.failure_message ?? MEETING_RECORDING_FAILURE_COPY.failed,
    };
    action = uploadAction;
  } else {
    line = {
      tone: "quiet",
      text: "Recorded the meeting on your phone? Upload it and Frapp writes it out here.",
    };
    action = uploadAction;
  }

  const percent = sending
    ? sending.total > 0
      ? Math.floor((sending.sent / sending.total) * 100)
      : 0
    : null;

  return (
    <div className="space-y-2">
      <div className="flex min-h-[6.5rem] flex-wrap content-start items-start gap-x-3 gap-y-2">
        <p
          id={`${ids}-status`}
          role="status"
          className={
            line.tone === "problem"
              ? "min-w-0 flex-1 basis-64 text-sm text-destructive-text"
              : "min-w-0 flex-1 basis-64 text-sm text-muted-foreground"
          }
        >
          {line.text}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {second ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || busy}
              onClick={() => run(second.does)}
            >
              {second.label}
            </Button>
          ) : null}
          {action ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={(disabled && !sending) || busy}
              onClick={() => run(action.does)}
            >
              {action.label}
            </Button>
          ) : null}
        </div>
      </div>
      {/* Always in the layout, so the row below never moves when it fills. */}
      <div
        role={percent === null ? undefined : "progressbar"}
        aria-label={percent === null ? undefined : "Upload progress"}
        aria-valuemin={percent === null ? undefined : 0}
        aria-valuemax={percent === null ? undefined : 100}
        aria-valuenow={percent ?? undefined}
        aria-hidden={percent === null ? true : undefined}
        className="h-1 overflow-hidden rounded-full bg-border"
        style={{ visibility: percent === null ? "hidden" : "visible" }}
      >
        <div
          className="h-full bg-primary transition-[width] duration-300"
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>

      <Dialog open={open} onOpenChange={(next) => !start.isPending && setOpen(next)}>
        <DialogContent>
          <DialogHeader className="min-w-0">
            <DialogTitle>{MEETING_RECORDING_NOTICE.heading}</DialogTitle>
            <DialogDescription>
              {MEETING_RECORDING_NOTICE.rule}
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0 space-y-4 text-sm">
            <figure className="space-y-1">
              <figcaption className="text-caption text-muted-foreground">
                {MEETING_RECORDING_NOTICE.scriptLabel}
              </figcaption>
              <blockquote className="rounded-lg border border-border px-3 py-2">
                {MEETING_RECORDING_NOTICE.script}
              </blockquote>
            </figure>
            <p className="text-muted-foreground">
              {MEETING_RECORDING_NOTICE.whatHappens}{" "}
              {MEETING_RECORDING_NOTICE.standards}
            </p>
            <div className="space-y-2">
              <input
                ref={fileInput}
                id={`${ids}-file`}
                type="file"
                accept={MEETING_RECORDING_ACCEPT}
                className="sr-only"
                aria-describedby={`${ids}-file-line ${ids}-form-problem`}
                onChange={(event) => void handleFile(event.target.files?.[0])}
              />
              <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={reading || start.isPending}
                  onClick={() => fileInput.current?.click()}
                >
                  {chosen ? "Choose another file" : "Choose the recording"}
                </Button>
                <p
                  id={`${ids}-file-line`}
                  className="min-w-0 flex-1 basis-48 break-words text-muted-foreground"
                >
                  {reading
                    ? "Reading the file"
                    : chosen
                      ? `${chosen.file.name} · ${meetingRecordingLengthLabel(chosen.seconds)} · ${formatBytes(chosen.file.size)}`
                      : `${MEETING_RECORDING_FORMATS_LABEL}, up to ${lengthInWords(state.max_seconds)}`}
                </p>
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-2">
              <span className={dashboardCheckboxHitAreaClassName}>
                <input
                  type="checkbox"
                  className={dashboardTableCheckboxClassName}
                  checked={told}
                  onChange={(event) => {
                    setTold(event.target.checked);
                    setFormProblem(null);
                  }}
                />
              </span>
              <span>{MEETING_RECORDING_NOTICE.confirmLabel}</span>
            </label>
            <p
              id={`${ids}-form-problem`}
              role="alert"
              className="min-h-10 text-destructive-text"
            >
              {formProblem}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={start.isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={reading || start.isPending}
              onClick={() => void handleUpload()}
            >
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
