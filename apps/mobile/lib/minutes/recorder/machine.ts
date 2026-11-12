/**
 * The phone's meeting recorder as a state machine
 * (`spec/behavior/meetings.md` § Recording in the app). Pure: every
 * transition is here, and `controller.ts` only turns what the phone does (a
 * tap, a tick of the clock, a call taking the microphone, an upload ending)
 * into the events below. Nothing can be seen on a device from CI, so this
 * file's spec is what proves a recording is never silently lost.
 *
 * The phases, in the order a meeting goes through them:
 *
 * - `idle`: nothing on this phone. May carry the reason the last try ended.
 * - `starting`: the microphone is being asked for and prepared.
 * - `recording`: audio is being written, or is paused, by the officer or by
 *   something that took the microphone (a call).
 * - `saving`: Stop was tapped and the file is being closed.
 * - `kept`: a finished recording is on this phone and the server does not
 *   have it yet. Every way of leaving `recording` that isn't a deliberate
 *   delete lands here, so the audio survives a failed upload, a closed app
 *   and a full disk.
 * - `uploading`: the kept file is being sent.
 *
 * After the upload the phone holds nothing and the server's own state
 * (`useMeetingRecording`) says the rest: transcribing, ready, failed.
 */

/** What is being recorded, and the longest the server takes. */
export interface RecordingSubject {
  meetingId: string;
  eventName: string;
  maxSeconds: number;
}

export type PauseReason =
  /** The officer tapped Pause. */
  | "user"
  /** Something took the microphone: a call, another app. */
  | "interrupted";

/** Why a finished recording is sitting on the phone. */
export type KeptReason =
  /** Stopped by the officer; the upload starts by itself. */
  | "stopped"
  /** The app closed mid-recording and what was written was found again. */
  | "recovered"
  /** The server's longest length was reached. */
  | "max_reached"
  /** The phone ran out of space. */
  | "storage"
  /** Stopped from the Android notification, or by the system. */
  | "outside"
  /** The connection dropped past every retry. */
  | "upload_failed"
  /** Storage or the API refused the upload. */
  | "upload_refused"
  /** The officer cancelled the upload. */
  | "upload_cancelled";

/** Why a try at recording ended with nothing kept. */
export type RecorderProblem =
  | "microphone_denied"
  | "notifications_denied"
  | "low_storage"
  | "start_failed"
  | "too_short"
  | "lost";

export interface RecorderRefusal {
  kind: RecorderProblem;
  meetingId: string;
  /** For `low_storage`: the free space recording needs. */
  neededBytes?: number;
}

export type RecorderState =
  | { phase: "idle"; refusal: RecorderRefusal | null }
  | { phase: "starting"; subject: RecordingSubject }
  | {
      phase: "recording";
      subject: RecordingSubject;
      seconds: number;
      paused: PauseReason | null;
    }
  | { phase: "saving"; subject: RecordingSubject; seconds: number }
  | {
      phase: "kept";
      subject: RecordingSubject;
      seconds: number;
      bytes: number;
      reason: KeptReason;
      /** The server's own words for a refusal, when it gave any. */
      message: string | null;
    }
  | {
      phase: "uploading";
      subject: RecordingSubject;
      seconds: number;
      sent: number;
      total: number;
    };

export type RecorderEvent =
  | { type: "start_requested"; subject: RecordingSubject }
  | { type: "start_refused"; kind: RecorderProblem; neededBytes?: number }
  | { type: "started" }
  /** The clock: what the phone's recorder says right now. */
  | { type: "tick"; seconds: number; isRecording: boolean }
  | { type: "paused" }
  | { type: "resumed" }
  | { type: "stop_requested" }
  | { type: "saved"; seconds: number; bytes: number; reason: KeptReason }
  | { type: "too_short" }
  | {
      type: "recovered";
      subject: RecordingSubject;
      seconds: number;
      bytes: number;
      reason: KeptReason;
    }
  | { type: "upload_started"; total: number }
  | { type: "upload_progress"; sent: number; total: number }
  | {
      type: "upload_ended";
      reason: "upload_failed" | "upload_refused" | "upload_cancelled";
      message?: string | null;
    }
  | { type: "uploaded" }
  | { type: "discarded" }
  /** The file is gone from the phone: nothing can be uploaded. */
  | { type: "lost"; meetingId: string }
  | { type: "refusal_cleared" };

export const IDLE: RecorderState = { phase: "idle", refusal: null };

/**
 * The next state. An event that makes no sense where the recorder stands
 * (a late tick after Stop, a second Start) changes nothing, so a slow
 * callback can never move a recording backwards or drop it.
 */
export function recorderReducer(
  state: RecorderState,
  event: RecorderEvent,
): RecorderState {
  switch (event.type) {
    case "start_requested":
      return state.phase === "idle"
        ? { phase: "starting", subject: event.subject }
        : state;

    case "start_refused":
      return state.phase === "starting"
        ? {
            phase: "idle",
            refusal: {
              kind: event.kind,
              meetingId: state.subject.meetingId,
              ...(event.neededBytes === undefined
                ? {}
                : { neededBytes: event.neededBytes }),
            },
          }
        : state;

    case "started":
      return state.phase === "starting"
        ? {
            phase: "recording",
            subject: state.subject,
            seconds: 0,
            paused: null,
          }
        : state;

    case "tick": {
      if (state.phase !== "recording") return state;
      // The clock never runs backwards: a recorder that reports zero for a
      // moment (iOS does, between a pause and a resume) keeps what it had.
      const seconds = Math.max(state.seconds, Math.floor(event.seconds));
      let paused = state.paused;
      // Recording stopped and nobody here asked for it: a call took the
      // microphone. Recording again by itself: the call ended and the
      // system handed it back.
      if (!event.isRecording && paused === null) paused = "interrupted";
      else if (event.isRecording && paused === "interrupted") paused = null;
      return seconds === state.seconds && paused === state.paused
        ? state
        : { ...state, seconds, paused };
    }

    case "paused":
      return state.phase === "recording" && state.paused === null
        ? { ...state, paused: "user" }
        : state;

    case "resumed":
      return state.phase === "recording" && state.paused !== null
        ? { ...state, paused: null }
        : state;

    case "stop_requested":
      return state.phase === "recording"
        ? { phase: "saving", subject: state.subject, seconds: state.seconds }
        : state;

    case "saved":
      return state.phase === "saving"
        ? {
            phase: "kept",
            subject: state.subject,
            seconds: Math.floor(event.seconds),
            bytes: event.bytes,
            reason: event.reason,
            message: null,
          }
        : state;

    case "too_short":
      return state.phase === "saving"
        ? {
            phase: "idle",
            refusal: { kind: "too_short", meetingId: state.subject.meetingId },
          }
        : state;

    case "recovered":
      return state.phase === "idle"
        ? {
            phase: "kept",
            subject: event.subject,
            seconds: Math.floor(event.seconds),
            bytes: event.bytes,
            reason: event.reason,
            message: null,
          }
        : state;

    case "upload_started":
      return state.phase === "kept"
        ? {
            phase: "uploading",
            subject: state.subject,
            seconds: state.seconds,
            sent: 0,
            total: event.total,
          }
        : state;

    case "upload_progress":
      return state.phase === "uploading"
        ? {
            ...state,
            // Storage's count can only grow; a resync never shows less.
            sent: Math.max(state.sent, Math.min(event.sent, event.total)),
            total: event.total,
          }
        : state;

    case "upload_ended":
      return state.phase === "uploading"
        ? {
            phase: "kept",
            subject: state.subject,
            seconds: state.seconds,
            bytes: state.total,
            reason: event.reason,
            message: event.message ?? null,
          }
        : state;

    case "uploaded":
      return state.phase === "uploading" ? IDLE : state;

    case "discarded":
      return state.phase === "kept" ? IDLE : state;

    case "lost":
      // From `idle` too: a recording the phone remembered across a restart
      // whose file is no longer there. Never while the microphone is open.
      return state.phase === "starting" || state.phase === "recording"
        ? state
        : { phase: "idle", refusal: { kind: "lost", meetingId: event.meetingId } };

    case "refusal_cleared":
      return state.phase === "idle" && state.refusal ? IDLE : state;
  }
}

/** The meeting the phone is busy with, or null when it holds nothing. */
export function recorderMeetingId(state: RecorderState): string | null {
  return state.phase === "idle" ? null : state.subject.meetingId;
}
