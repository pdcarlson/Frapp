import { Redirect, useLocalSearchParams } from "expo-router";
import { statusOf } from "@repo/api-sdk";
import { useMeeting, useMeetingRecording } from "@repo/hooks";
import {
  MEETING_COPY,
  MEETING_RECORDER_COPY,
  isBetaOffModule,
} from "@repo/validation";
import { InlineNote } from "@/components/inline-note";
import { ScreenShell } from "@/components/screen-shell";
import {
  ErrorState,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import { TranscriptLines } from "@/components/minutes/transcript-lines";
import { useFrappTheme } from "@/lib/theme";

/**
 * A meeting's transcript on its own screen, pushed from the Transcript row on
 * its minutes (Paul, 2026-11-18: "Transcript that long should open in a new
 * tab not be the infinite scroll we have rn"). An hour's transcript opened
 * in place pushed everything under it a thousand lines down; on its own
 * screen it reads top to bottom and Back returns to the minutes where they
 * were, as Otter and Granola open theirs.
 */
export default function MinutesTranscriptScreen() {
  if (isBetaOffModule("meetings")) return <Redirect href="/you" />;
  return <MinutesTranscriptBody />;
}

function MinutesTranscriptBody() {
  const { tokens } = useFrappTheme();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");
  const meetingQuery = useMeeting(id || null);
  const recordingQuery = useMeetingRecording(id || null, { enabled: !!id });
  const back = {
    label: "Minutes",
    href: { pathname: "/minutes-details" as const, params: { id } },
  };

  const recording = recordingQuery.data ?? null;
  // A draft's transcript is the recording's; posted minutes keep their own.
  const transcript =
    (recording?.status === "ready" ? recording.transcript : null) ??
    meetingQuery.data?.transcript ??
    null;
  const seconds = recording?.duration_seconds ?? 0;
  const title = meetingQuery.data?.event_name ?? MEETING_COPY.transcript;
  const subtitle =
    seconds > 0
      ? MEETING_RECORDER_COPY.transcriptRow(seconds)
      : MEETING_COPY.transcript;

  if (!id) {
    return (
      <ScreenShell back={back} title={MEETING_COPY.transcript}>
        <InlineNote>{MEETING_COPY.missingBody}</InlineNote>
      </ScreenShell>
    );
  }
  if (meetingQuery.isPending || (recordingQuery.isPending && !transcript)) {
    return (
      <ScreenShell back={back} title={title}>
        <SkeletonRegion label={MEETING_COPY.transcript}>
          {(["92%", "84%", "88%", "70%", "90%", "60%"] as const).map(
            (width) => (
              <SkeletonText
                key={width}
                role={tokens.typography.role.body}
                width={width}
              />
            ),
          )}
        </SkeletonRegion>
      </ScreenShell>
    );
  }
  // A 404 is minutes deleted or not shared with this member. Any other
  // failure, of the minutes or of a draft's recording, may pass on a retry,
  // so it never reads as "no transcript".
  const failed = !meetingQuery.data
    ? meetingQuery
    : !transcript && recordingQuery.isError
      ? recordingQuery
      : null;
  if (failed) {
    const missing = statusOf(failed.error) === 404;
    return (
      <ScreenShell back={back} title={MEETING_COPY.transcript}>
        <ErrorState
          title={
            missing ? MEETING_COPY.missingTitle : MEETING_COPY.loadFailedTitle
          }
          body={
            missing ? MEETING_COPY.missingBody : MEETING_COPY.loadFailedBody
          }
          onRetry={missing ? undefined : () => void failed.refetch()}
          isRetrying={failed.isFetching}
        />
      </ScreenShell>
    );
  }
  return (
    <ScreenShell back={back} title={title} subtitle={subtitle}>
      {transcript ? (
        <TranscriptLines transcript={transcript} />
      ) : (
        <InlineNote>{MEETING_COPY.transcriptMissing}</InlineNote>
      )}
    </ScreenShell>
  );
}
