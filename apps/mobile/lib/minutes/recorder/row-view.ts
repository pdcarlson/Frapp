import {
  MEETING_RECORDER_COPY,
  MEETING_RECORDING_FAILURE_COPY,
  meetingRecorderClock,
} from "@repo/validation";
import type { RecorderState } from "./machine";

/**
 * What the recording row on a meeting's minutes says and offers
 * (`components/minutes/recorder-controls.tsx`), worked out from the phone's
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
  | "stop_transcribing";

export interface RowButton {
  label: string;
  does: RowAction;
}

/**
 * The row, redrawn after Paul's 2026-11-17 pass ("You don't need like four
 * humongous buttons everywhere"): at most one full-width button, the
 * recorder's own controls as two round icons that never trade places, a
 * moving sign while work goes on, and the rare steps in quiet words.
 */
export interface RecordingRowView {
  /** The bold word on the status line, or null when it has none. */
  title: string | null;
  /** The dot: red while audio is being written, amber while it isn't. */
  dot: "live" | "paused" | null;
  /** The recorder's clock, shown beside the title. */
  clock: string | null;
  /** While recording or paused: the round pause / carry-on and stop. */
  live: "recording" | "paused" | null;
  /** Something is being worked on (saving, uploading, transcribing). */
  working: boolean;
  text: string;
  tone: "quiet" | "problem";
  /** 0 to 1 while uploading. */
  progress: number | null;
  /** The one full-width button, or null. */
  primary: RowButton | null;
  /** The quieter steps, in words. */
  actions: RowButton[];
}

const base: RecordingRowView = {
  title: null,
  dot: null,
  clock: null,
  live: null,
  working: false,
  text: "",
  tone: "quiet",
  progress: null,
  primary: null,
  actions: [],
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
      actions: [
        { label: MEETING_RECORDER_COPY.openElsewhere, does: "open_other" },
      ],
    };
  }

  switch (local.phase) {
    case "starting":
      return { ...base, working: true, text: MEETING_RECORDER_COPY.checking };

    case "recording": {
      const clock = meetingRecorderClock(local.seconds);
      if (local.paused === null) {
        return {
          ...base,
          title: MEETING_RECORDER_COPY.recording,
          dot: "live",
          clock,
          live: "recording",
          text: MEETING_RECORDER_COPY.recordingHint,
        };
      }
      return {
        ...base,
        title: MEETING_RECORDER_COPY.paused,
        dot: "paused",
        clock,
        live: "paused",
        text:
          local.paused === "interrupted"
            ? MEETING_RECORDER_COPY.interruptedHint
            : MEETING_RECORDER_COPY.pausedHint,
        tone: local.paused === "interrupted" ? "problem" : "quiet",
      };
    }

    case "saving":
      return {
        ...base,
        title: MEETING_RECORDER_COPY.savingTitle,
        working: true,
        text: MEETING_RECORDER_COPY.saving,
      };

    case "uploading":
      return {
        ...base,
        title: MEETING_RECORDER_COPY.uploadingTitle,
        working: true,
        text: MEETING_RECORDER_COPY.uploading(local.sent, local.total),
        progress: local.total > 0 ? local.sent / local.total : 0,
        actions: [
          { label: MEETING_RECORDER_COPY.cancel, does: "cancel_upload" },
        ],
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
        actions: [{ label: MEETING_RECORDER_COPY.delete, does: "delete" }],
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
          actions: [RECORD],
        };
      case "notifications_denied":
        return {
          ...base,
          tone: "problem",
          text: MEETING_RECORDER_COPY.notificationsDenied,
          primary: settings,
          actions: [RECORD],
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
      return {
        ...base,
        title: MEETING_RECORDER_COPY.uploadingTitle,
        working: true,
        text: MEETING_RECORDER_COPY.otherDevice,
      };
    case "transcribing":
      return {
        ...base,
        title: MEETING_RECORDER_COPY.transcribingTitle,
        working: true,
        text: MEETING_RECORDER_COPY.transcribing(server.duration_seconds ?? 0),
        actions: [
          {
            label: MEETING_RECORDER_COPY.stopTranscribing,
            does: "stop_transcribing",
          },
        ],
      };
    case "ready":
      // No Record again (Paul, 2026-11-17: "I can't re-record a meeting that
      // I already had"). The transcript is read on the screen itself.
      return {
        ...base,
        title: server.transcript ? MEETING_RECORDER_COPY.readyTitle : null,
        text: MEETING_RECORDER_COPY.ready(server.duration_seconds ?? 0),
        primary: server.transcript ? null : RECORD,
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

/**
 * Whether the recorder is busy with this meeting: recording, paused, saving,
 * uploading, holding an unsent file, or the server transcribing. The minutes
 * screen holds Draft minutes and Post back meanwhile, so the recorder is the
 * one thing on it.
 */
export function recorderBusy(
  meetingId: string,
  local: RecorderState,
  server: Pick<ServerRecording, "status"> | null,
): boolean {
  if (local.phase !== "idle" && local.subject.meetingId === meetingId) {
    return true;
  }
  return server?.status === "uploading" || server?.status === "transcribing";
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

/** One step from the end of a recording to its draft, as the screen draws it. */
export interface PipelineStep {
  key: "recorded" | "uploaded" | "transcribed" | "drafted";
  label: string;
  state: "done" | "active" | "waiting";
  /** 0 to 1 for an active step that knows how far it is (the upload). */
  progress: number | null;
}

/**
 * What happens after Stop, drawn as four steps that tick off (Paul,
 * 2026-11-17: "I thought that it lost my minutes because there's no clear
 * indicator that the whole thing worked ... Show me, not tell me"): recorded,
 * uploaded, transcribed, drafted. Null when nothing is on its way: before a
 * recording, while one is live, and once the draft is in (the screen then
 * shows the minutes themselves).
 */
export function recordingPipeline(
  meetingId: string,
  local: RecorderState,
  server: Pick<ServerRecording, "status"> | null,
  draft: { drafting: boolean },
): PipelineStep[] | null {
  const mine = local.phase !== "idle" && local.subject.meetingId === meetingId;
  const status = server?.status ?? "none";
  let at: number;
  let uploadProgress: number | null = null;
  if (mine && local.phase === "saving") at = 0;
  else if (mine && local.phase === "uploading") {
    at = 1;
    uploadProgress = local.total > 0 ? local.sent / local.total : 0;
  } else if (mine) return null;
  else if (status === "uploading") at = 1;
  else if (status === "transcribing") at = 2;
  else if (status === "ready" && draft.drafting) at = 3;
  else return null;

  const keys = ["recorded", "uploaded", "transcribed", "drafted"] as const;
  return keys.map((key, index) => ({
    key,
    label: MEETING_RECORDER_COPY.steps[key],
    state: index < at ? "done" : index === at ? "active" : "waiting",
    progress: index === at && key === "uploaded" ? uploadProgress : null,
  }));
}
