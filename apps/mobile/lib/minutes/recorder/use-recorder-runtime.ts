import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { codeOf } from "@repo/api-sdk";
import {
  useConfirmMeetingRecording,
  useRemoveMeetingRecording,
  useStartMeetingRecording,
} from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import {
  MEETING_RECORDING_FAILURE_COPY,
  STANDARDS_MEETING_NOTE,
  isBetaOffModule,
} from "@repo/validation";
import { useAuthSession } from "@/lib/auth-session";
import type { RecorderApi } from "./controller";
import { meetingRecorderDevice } from "./device";
import { bindMeetingRecorder } from "./session";
import { recorderStore } from "./store";

/** A refusal from the recording routes, in the words the web's step uses. */
export function describeRecordingRefusal(error: unknown): string | null {
  const code = codeOf(error);
  if (code === "meeting.standards_refused") return STANDARDS_MEETING_NOTE;
  if (code === "ai.consent.required") {
    return MEETING_RECORDING_FAILURE_COPY.consent_required;
  }
  if (code === "ai.chapter_off") return MEETING_RECORDING_FAILURE_COPY.chapter_off;
  if (code === "ai.not_available" || code === "meeting.recording_unavailable") {
    return MEETING_RECORDING_FAILURE_COPY.unavailable;
  }
  return errorCopy(error, "") || null;
}

/**
 * Keeps the phone's meeting recorder bound to whoever is signed in
 * (`session.ts`), and hands it the server calls. Mounted once, in
 * `AppRuntime`, so a recording outlives every screen.
 *
 * Nothing is bound, and no audio module is loaded, while the `meetings`
 * module is off for the beta: the app then behaves exactly as it did before
 * the recorder existed.
 */
export function useMeetingRecorderRuntime(): void {
  const { userId, chapterId } = useAuthSession();
  const start = useStartMeetingRecording();
  const confirm = useConfirmMeetingRecording();
  const remove = useRemoveMeetingRecording();
  const startRecording = start.mutateAsync;
  const confirmRecording = confirm.mutateAsync;
  const removeRecording = remove.mutateAsync;

  const api = useMemo<RecorderApi>(
    () => ({
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
      async start(meetingId, file) {
        const started = await startRecording({ id: meetingId, body: file });
        const target = started.upload;
        if (!target) throw new Error("The upload could not be started.");
        return {
          uploadId: target.upload_id,
          bucket: target.bucket,
          path: target.path,
          token: target.token,
          contentType: target.content_type,
        };
      },
      async confirm(meetingId, uploadId) {
        await confirmRecording({ id: meetingId, uploadId });
      },
      async abandon(meetingId, uploadId) {
        await removeRecording({ id: meetingId, uploadId });
      },
      describe: describeRecordingRefusal,
    }),
    [startRecording, confirmRecording, removeRecording],
  );

  const off = isBetaOffModule("meetings");
  useEffect(() => {
    if (off) return;
    const recorder = bindMeetingRecorder(
      userId && chapterId ? { userId, chapterId } : null,
      userId && chapterId ? meetingRecorderDevice() : null,
      recorderStore,
    );
    recorder?.setApi(api);
    // Back from the background: read the recorder at once, so a call that
    // paused it shows as paused before the next second passes.
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") recorder?.tick();
    });
    return () => subscription.remove();
  }, [off, userId, chapterId, api]);
}
