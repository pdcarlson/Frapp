"use client";

import Link from "next/link";
import { useMeeting, useMeetingRecording } from "@repo/hooks";
import {
  MEETING_COPY,
  MEETING_RECORDER_COPY,
  meetingWhenLabel,
  transcriptTurns,
} from "@repo/validation";
import { ErrorState, Skeleton } from "@/components/shared/async-states";
import { inlineNoteActionClassName } from "@/components/shared/inline-note";

/**
 * A meeting's transcript on its own page, opened in a new tab from its
 * minutes (Paul, 2026-11-18: "Transcript that long should open in a new tab
 * not be the infinite scroll we have rn"). The minutes stay where they were
 * in theirs, so an officer can read the transcript beside the draft. Each
 * turn leads with its speaker (`transcriptTurns`), as the phone's screen
 * does.
 */
export function TranscriptPage({ id }: { id: string }) {
  const meetingQuery = useMeeting(id);
  const recordingQuery = useMeetingRecording(id);
  const recording = recordingQuery.data ?? null;
  // A draft's transcript is the recording's; posted minutes keep their own.
  const transcript =
    (recording?.status === "ready" ? recording.transcript : null) ??
    meetingQuery.data?.transcript ??
    null;

  if (meetingQuery.isPending || (recordingQuery.isPending && !transcript)) {
    return (
      <div className="mx-auto max-w-3xl space-y-3" aria-busy="true">
        <Skeleton className="h-8 w-2/3" />
        {["w-11/12", "w-5/6", "w-full", "w-3/4", "w-10/12"].map((width) => (
          <Skeleton key={width} className={`h-4 ${width}`} />
        ))}
      </div>
    );
  }
  const meeting = meetingQuery.data;
  if (!meeting || !transcript) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <ErrorState
          title={MEETING_COPY.transcript}
          description={
            meeting ? MEETING_COPY.transcriptMissing : MEETING_COPY.missingBody
          }
          onRetry={
            meetingQuery.error ? () => void meetingQuery.refetch() : undefined
          }
        />
        <p className="text-center text-sm">
          <Link href={`/meetings/${id}`} className={inlineNoteActionClassName}>
            Back to the minutes
          </Link>
        </p>
      </div>
    );
  }
  const seconds = recording?.duration_seconds ?? 0;
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h2 className="text-2xl font-bold leading-tight">
          {meeting.event_name}
        </h2>
        <p className="text-sm text-muted-foreground">
          {seconds > 0
            ? MEETING_RECORDER_COPY.transcriptRow(seconds)
            : MEETING_COPY.transcript}
          {", "}
          {meetingWhenLabel(meeting.event_start_time)}
        </p>
      </header>
      <ol className="space-y-3 text-sm leading-relaxed">
        {transcriptTurns(transcript).map((turn, index) => (
          <li key={index} className="break-words">
            {turn.speaker ? (
              <span className="mr-2 font-medium text-muted-foreground">
                {turn.speaker}
              </span>
            ) : null}
            {turn.text}
          </li>
        ))}
      </ol>
    </article>
  );
}
