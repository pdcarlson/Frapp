import {
  MEETING_RECORDER_COPY,
  MEETING_RECORDING_FAILURE_COPY,
  meetingRecorderClock,
} from "@repo/validation";
import type { RecorderState } from "./machine";

/**
 * What the recording row on a meeting's minutes says and offers
 * (`components/minutes/recording-row.tsx`), worked out from the phone's
 * recorder and the server's record of the meeting's recording. Pure, so
 * every state the row can be in is covered by a spec.
 *
 * The phone's own state wins while it holds anything: the server only knows
 * a recording once it is uploaded.
 */

/** The server's record, as `useMeetingRecording` reads it. */
export interface ServerRecording {
  status: "none" | "uploading" | "transcribing" | "ready" | "failed";
  duration_seconds: number | null;
  failure_message: string | null;
  transcript: string | null;
}

export type RowAction =
  | "record"
  | "pause"
  | "resume"
  | "stop"
  | "upload"
  | "cancel_upload"
  | "delete"
  | "open_settings"
  | "open_other"
  | "stop_transcribing"
  | "open_notes";

export interface RowButton {
  label: string;
  does: RowAction;
}

export interface RecordingRowView {
  /** The bold word beside the dot, or null when the row has no live state. */
  title: string | null;
  /** The dot: red while audio is being written, amber while it isn't. */
  dot: "live" | "paused" | null;
  /** The recorder's clock, shown beside the title. */
  clock: string | null;
  text: string;
  tone: "quiet" | "problem";
  /** 0 to 1 while uploading. */
  progress: number | null;
  primary: RowButton | null;
  secondary: RowButton | null;
}

const base: RecordingRowView = {
  title: null,
  dot: null,
  clock: null,
  text: "",
  tone: "quiet",
  progress: null,
  primary: null,
  secondary: null,
};

const RECORD: RowButton = { label: MEETING_RECORDER_COPY.record, does: "record" };

export function recordingRowView(
  meetingId: string,
  local: RecorderState,
  server: ServerRecording,
): RecordingRowView {
  if (local.phase !== "idle" && local.subject.meetingId !== meetingId) {
    return {
      ...base,
      text: MEETING_RECORDER_COPY.elsewhere(local.subject.eventName),
      primary: { label: MEETING_RECORDER_COPY.openElsewhere, does: "open_other" },
    };
  }

  switch (local.phase) {
    case "starting":
      return { ...base, text: MEETING_RECORDER_COPY.checking };

    case "recording": {
      const stop: RowButton = { label: MEETING_RECORDER_COPY.stop, does: "stop" };
      const clock = meetingRecorderClock(local.seconds);
      if (local.paused === null) {
        return {
          ...base,
          title: MEETING_RECORDER_COPY.recording,
          dot: "live",
          clock,
          text: MEETING_RECORDER_COPY.recordingHint,
          primary: stop,
          secondary: { label: MEETING_RECORDER_COPY.pause, does: "pause" },
        };
      }
      return {
        ...base,
        title: MEETING_RECORDER_COPY.paused,
        dot: "paused",
        clock,
        text:
          local.paused === "interrupted"
            ? MEETING_RECORDER_COPY.interruptedHint
            : MEETING_RECORDER_COPY.pausedHint,
        tone: local.paused === "interrupted" ? "problem" : "quiet",
        primary: { label: MEETING_RECORDER_COPY.resume, does: "resume" },
        secondary: stop,
      };
    }

    case "saving":
      return { ...base, text: MEETING_RECORDER_COPY.saving };

    case "uploading":
      return {
        ...base,
        text: MEETING_RECORDER_COPY.uploading(local.sent, local.total),
        progress: local.total > 0 ? local.sent / local.total : 0,
        primary: { label: MEETING_RECORDER_COPY.cancel, does: "cancel_upload" },
      };

    case "kept": {
      const failed =
        local.reason === "upload_failed" || local.reason === "upload_refused";
      const text =
        local.reason === "recovered"
          ? MEETING_RECORDER_COPY.recovered(local.seconds)
          : local.reason === "max_reached"
            ? MEETING_RECORDER_COPY.maxReached(local.subject.maxSeconds)
            : local.reason === "storage"
              ? MEETING_RECORDER_COPY.storageStopped
              : local.reason === "outside"
                ? MEETING_RECORDER_COPY.stoppedOutside
                : local.reason === "upload_failed"
                  ? MEETING_RECORDER_COPY.uploadFailed
                  : local.reason === "upload_refused"
                    ? (local.message ?? MEETING_RECORDER_COPY.uploadRefused)
                    : MEETING_RECORDER_COPY.kept(local.seconds);
      return {
        ...base,
        text,
        tone: failed || local.reason === "storage" ? "problem" : "quiet",
        primary: {
          label: failed
            ? MEETING_RECORDER_COPY.tryAgain
            : MEETING_RECORDER_COPY.upload,
          does: "upload",
        },
        secondary: { label: MEETING_RECORDER_COPY.delete, does: "delete" },
      };
    }

    case "idle":
      break;
  }

  const refusal =
    local.refusal && local.refusal.meetingId === meetingId
      ? local.refusal
      : null;
  if (refusal) {
    const settings: RowButton = {
      label: MEETING_RECORDER_COPY.openSettings,
      does: "open_settings",
    };
    switch (refusal.kind) {
      case "microphone_denied":
        return {
          ...base,
          tone: "problem",
          text: MEETING_RECORDER_COPY.microphoneDenied,
          primary: settings,
          secondary: RECORD,
        };
      case "notifications_denied":
        return {
          ...base,
          tone: "problem",
          text: MEETING_RECORDER_COPY.notificationsDenied,
          primary: settings,
          secondary: RECORD,
        };
      case "low_storage":
        return {
          ...base,
          tone: "problem",
          text: MEETING_RECORDER_COPY.lowStorage(refusal.neededBytes ?? 0),
          primary: RECORD,
        };
      case "too_short":
        return {
          ...base,
          text: MEETING_RECORDER_COPY.tooShort,
          primary: RECORD,
        };
      case "lost":
        return {
          ...base,
          tone: "problem",
          text: MEETING_RECORDER_COPY.lost,
          primary: RECORD,
        };
      case "start_failed":
        return {
          ...base,
          tone: "problem",
          text: MEETING_RECORDER_COPY.startFailed,
          primary: RECORD,
        };
    }
  }

  switch (server.status) {
    case "uploading":
      // Not from this phone: the web's upload step, or another device.
      return { ...base, text: MEETING_RECORDER_COPY.otherDevice };
    case "transcribing":
      return {
        ...base,
        text: MEETING_RECORDER_COPY.transcribing(server.duration_seconds ?? 0),
        primary: {
          label: MEETING_RECORDER_COPY.stopTranscribing,
          does: "stop_transcribing",
        },
      };
    case "ready":
      return {
        ...base,
        text: MEETING_RECORDER_COPY.ready(server.duration_seconds ?? 0),
        primary: server.transcript
          ? { label: MEETING_RECORDER_COPY.openNotes, does: "open_notes" }
          : RECORD,
        secondary: server.transcript
          ? { label: MEETING_RECORDER_COPY.recordAgain, does: "record" }
          : null,
      };
    case "failed":
      return {
        ...base,
        tone: "problem",
        text: server.failure_message ?? MEETING_RECORDING_FAILURE_COPY.failed,
        primary: RECORD,
      };
    case "none":
      return { ...base, text: MEETING_RECORDER_COPY.offer, primary: RECORD };
  }
}

/** What the bar over every other screen says, or null when it has nothing to. */
export function recordingBarView(
  local: RecorderState,
): { label: string; description: string; dot: "live" | "paused" | "kept" } | null {
  switch (local.phase) {
    case "idle":
      return null;
    case "starting":
    case "saving":
      return {
        label: MEETING_RECORDER_COPY.recording,
        description: MEETING_RECORDER_COPY.bar(local.subject.eventName),
        dot: "live",
      };
    case "recording":
      return local.paused === null
        ? {
            label: `${MEETING_RECORDER_COPY.recording} ${meetingRecorderClock(local.seconds)}`,
            description: MEETING_RECORDER_COPY.bar(local.subject.eventName),
            dot: "live",
          }
        : {
            label: `${MEETING_RECORDER_COPY.paused} ${meetingRecorderClock(local.seconds)}`,
            description: MEETING_RECORDER_COPY.barPaused(
              local.subject.eventName,
            ),
            dot: "paused",
          };
    case "uploading":
      return {
        label: MEETING_RECORDER_COPY.barUploading(local.sent, local.total),
        description: MEETING_RECORDER_COPY.barUploadingFull(
          local.subject.eventName,
        ),
        dot: "kept",
      };
    case "kept":
      return {
        label: MEETING_RECORDER_COPY.barKept,
        description: MEETING_RECORDER_COPY.barKeptFull(local.subject.eventName),
        dot: "kept",
      };
  }
}
