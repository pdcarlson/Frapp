import {
  ResumableUploadError,
  isNetworkFailure,
  uploadResumable,
  type ResumableSource,
  type ResumableUploadTarget,
} from "@repo/hooks/resumable-upload";
import {
  MEETING_RECORDER_FILE_NAME,
  MEETING_RECORDER_FORMAT,
  MEETING_RECORDER_KEEP_DAYS,
  MEETING_RECORDER_STOP_FREE_BYTES,
  MIN_MEETING_RECORDING_SECONDS,
  meetingRecorderSeconds,
  meetingRecorderSpaceNeeded,
} from "@repo/validation";
import {
  IDLE,
  recorderReducer,
  type KeptReason,
  type RecorderEvent,
  type RecorderProblem,
  type RecorderState,
  type RecordingSubject,
} from "./machine";

/**
 * Runs the phone's meeting recorder (`spec/behavior/meetings.md` § Recording
 * in the app): it owns the one recording a phone can hold, from the tap on
 * Record to the moment the server has the file. `machine.ts` decides what
 * each state is; this class does the work between them and never decides
 * what the screen says.
 *
 * It lives above the screens (`session.ts`), because a two-hour recording
 * must outlast the officer leaving the minutes screen to read chat. Every
 * thing it touches is handed in (`RecorderDevice`, `RecorderStore`,
 * `RecorderApi`, the clock), so its spec walks a whole meeting, a call, a
 * full disk, a dead app and a bad connection without a phone.
 *
 * What makes a recording survive:
 * - The file's place on the phone is written down the moment recording
 *   starts, with the length so far every fifteen seconds. A relaunch finds
 *   it (`restore`) whatever state the app died in.
 * - Nothing but Delete, or the server confirming it has the file, removes
 *   the file. A failed upload goes back to `kept` and can be tried again,
 *   carrying on from what Storage already holds.
 * - The server's upload path is the web's (`POST /v1/meetings/:id/recording`,
 *   a signed resumable upload, then `/uploaded`). The officer confirmed the
 *   notice before recording could start, which is what `notice_confirmed`
 *   reports.
 */

export interface RecorderIdentity {
  userId: string;
  chapterId: string;
}

/** What the phone remembers about its one recording, across restarts. */
export interface StoredRecording {
  v: 1;
  userId: string;
  chapterId: string;
  subject: RecordingSubject;
  uri: string;
  /** When recording started, in milliseconds. */
  startedAt: number;
  /** The recorded length, as last written down. */
  seconds: number;
  /** `recording` on a relaunch means the app died with the microphone open. */
  stage: "recording" | "kept";
  reason: KeptReason;
}

export interface RecorderStore {
  /**
   * Every recording the phone remembers, whoever made it. Rejects when the
   * phone's storage can't be read, which is not the same as holding none.
   */
  all: () => Promise<StoredRecording[]>;
  save: (recording: StoredRecording) => Promise<void>;
  /** Forget the recording of this member in this chapter. */
  clear: (identity: RecorderIdentity) => Promise<void>;
}

/** The phone: its microphone, its recorder and its disk. */
export interface RecorderDevice {
  /** Asks for the microphone if it hasn't been answered yet. */
  microphone: () => Promise<"granted" | "denied">;
  /**
   * Whether a recording can keep going with the screen off. Android needs
   * its notification allowed for that and asks here; iOS always can.
   */
  backgroundAllowed: () => Promise<boolean>;
  /** Free space in bytes, or null when the phone won't say. */
  freeBytes: () => number | null;
  /** Opens the microphone and starts writing a new file. */
  begin: () => Promise<{ uri: string }>;
  pause: () => void;
  resume: () => void;
  /** What the recorder says now, or null when there is none. */
  status: () => { isRecording: boolean; seconds: number } | null;
  /** Closes the file and gives the microphone back. */
  finish: () => Promise<void>;
  /** Told when recording ended without `finish`: the notification's Stop, an error. */
  onEnded: (listener: () => void) => () => void;
  /** Where a remembered file is now, or null when it is gone. */
  locate: (uri: string) => string | null;
  /** A file's size, or null when it isn't there. */
  fileSize: (uri: string) => number | null;
  remove: (uri: string) => void;
  /** The file as something the uploader can read a piece at a time. */
  source: (uri: string, size: number) => ResumableSource;
  /** Deletes every recording file on the phone except these. */
  purge: (keepUris: readonly string[]) => void;
}

export interface RecorderUploadTarget extends ResumableUploadTarget {
  uploadId: string;
}

/** The server, as the web's upload step uses it. */
export interface RecorderApi {
  supabaseUrl: string;
  start: (
    meetingId: string,
    file: {
      file_name: string;
      mime_type: string;
      size_bytes: number;
      duration_seconds: number;
      notice_confirmed: true;
    },
  ) => Promise<RecorderUploadTarget>;
  /** The file is in storage: transcribe it. */
  confirm: (meetingId: string, uploadId: string) => Promise<void>;
  /** Drop an upload this phone gave up on. */
  abandon: (meetingId: string, uploadId: string) => Promise<void>;
  /** A refusal in plain words, or null for a generic line. */
  describe: (error: unknown) => string | null;
}

export interface RecorderClock {
  now: () => number;
  /** Calls `tick` every `ms` until the returned function is called. */
  every: (ms: number, tick: () => void) => () => void;
}

const systemClock: RecorderClock = {
  now: () => Date.now(),
  every: (ms, tick) => {
    const timer = setInterval(tick, ms);
    return () => clearInterval(timer);
  },
};

const TICK_MS = 1000;
/** How often the length so far is written down. */
const REMEMBER_EVERY_TICKS = 15;
/** How often free space is checked while recording. */
const SPACE_EVERY_TICKS = 30;
/** How often a recorder a call paused is asked to carry on. */
const RETRY_RESUME_EVERY_TICKS = 5;
/** A signed upload is good for two hours; one older than this starts over. */
const UPLOAD_TARGET_LIFE_MS = 90 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ignore = () => undefined;

export class MeetingRecorderController {
  private state: RecorderState = IDLE;
  private readonly listeners = new Set<() => void>();
  private recording: StoredRecording | null = null;
  private api: RecorderApi | null = null;
  private stopWatching: (() => void) | null = null;
  private ticks = 0;
  private uploadAbort: AbortController | null = null;
  private disposed = false;
  /** The upload begun for the kept file, so a retry carries on from it. */
  private target: {
    meetingId: string;
    size: number;
    at: number;
    upload: RecorderUploadTarget;
    url: string | null;
    /** Storage has every byte; only the server's confirmation is owed. */
    complete: boolean;
  } | null = null;

  constructor(
    private readonly identity: RecorderIdentity,
    private readonly device: RecorderDevice,
    private readonly store: RecorderStore,
    private readonly clock: RecorderClock = systemClock,
    private readonly send: typeof uploadResumable = uploadResumable,
  ) {}

  getState = (): RecorderState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The server calls, which come from hooks and so arrive after construction. */
  setApi(api: RecorderApi | null): void {
    this.api = api;
  }

  private dispatch(event: RecorderEvent): void {
    const next = recorderReducer(this.state, event);
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  /**
   * On launch: find the recording this phone was holding, if any. One the
   * app died in the middle of is kept as far as it got.
   */
  async restore(): Promise<void> {
    if (this.state.phase !== "idle") return;
    let remembered: StoredRecording[];
    try {
      remembered = await this.store.all();
    } catch {
      // The phone's storage couldn't be read. That is not "nothing is
      // remembered": no file is cleared on a guess.
      return;
    }
    if (this.disposed || this.state.phase !== "idle") return;
    const now = this.clock.now();
    const keep: string[] = [];
    let mine: { stored: StoredRecording; uri: string | null } | null = null;
    for (const stored of remembered) {
      const uri = this.device.locate(stored.uri);
      if (now - stored.startedAt > MEETING_RECORDER_KEEP_DAYS * DAY_MS) {
        // A recording of a room is not left on a phone indefinitely,
        // whoever made it.
        if (uri) this.device.remove(uri);
        await this.store.clear(stored).catch(ignore);
      } else if (
        stored.userId === this.identity.userId &&
        stored.chapterId === this.identity.chapterId
      ) {
        mine = { stored, uri };
      } else if (uri) {
        // Another member's, or another chapter's: not this session's to
        // show, upload or delete. It waits for its owner.
        keep.push(uri);
      }
    }
    if (!mine) {
      this.device.purge(keep);
      return;
    }
    const { stored, uri } = mine;
    const bytes = uri ? this.device.fileSize(uri) : null;
    if (!uri || !bytes) {
      await this.store.clear(this.identity).catch(ignore);
      this.dispatch({ type: "lost", meetingId: stored.subject.meetingId });
      this.device.purge(keep);
      return;
    }
    const died = stored.stage === "recording";
    // An ADTS file states no length, so a recording cut short is measured
    // by its size, and never taken as shorter than what was written down.
    const seconds = died ? this.measured(stored.seconds, bytes) : stored.seconds;
    if (seconds < MIN_MEETING_RECORDING_SECONDS) {
      this.device.remove(uri);
      await this.store.clear(this.identity).catch(ignore);
      this.device.purge(keep);
      return;
    }
    const reason: KeptReason = died ? "recovered" : stored.reason;
    this.recording = { ...stored, uri, seconds, stage: "kept", reason };
    await this.store.save(this.recording).catch(ignore);
    this.dispatch({
      type: "recovered",
      subject: stored.subject,
      seconds,
      bytes,
      reason,
    });
    this.device.purge([...keep, uri]);
  }

  /**
   * A recording's length when the clock can't be trusted: what the file's
   * size says, and never less than the clock's last word. Android holds the
   * app's clock while the screen is off, so a recording stopped from its
   * notification an hour in may have a clock that reads six seconds.
   */
  private measured(clockSeconds: number, bytes: number): number {
    return Math.max(clockSeconds, meetingRecorderSeconds(bytes));
  }

  /**
   * Starts recording. `noticeConfirmed` is the officer's tick on the
   * recording notice: without it nothing happens, here as on the server.
   */
  async start(subject: RecordingSubject, noticeConfirmed: boolean): Promise<void> {
    if (noticeConfirmed !== true || this.state.phase !== "idle") return;
    this.dispatch({ type: "start_requested", subject });
    const refuse = (kind: RecorderProblem, neededBytes?: number) =>
      this.dispatch({
        type: "start_refused",
        kind,
        ...(neededBytes === undefined ? {} : { neededBytes }),
      });
    let uri: string | null = null;
    try {
      if ((await this.device.microphone()) !== "granted") {
        return refuse("microphone_denied");
      }
      if (!(await this.device.backgroundAllowed())) {
        return refuse("notifications_denied");
      }
      const needed = meetingRecorderSpaceNeeded(subject.maxSeconds);
      const free = this.device.freeBytes();
      if (free !== null && free < needed) return refuse("low_storage", needed);

      // The session ended (sign-out, another chapter) while the phone was
      // being asked: don't open a microphone nobody can see or stop.
      if (this.disposed) return;
      uri = (await this.device.begin()).uri;
      this.recording = {
        v: 1,
        userId: this.identity.userId,
        chapterId: this.identity.chapterId,
        subject,
        uri,
        startedAt: this.clock.now(),
        seconds: 0,
        stage: "recording",
        reason: "stopped",
      };
      // Written down before the clock starts: a recording the phone can't
      // find again after a crash is one it must not make.
      await this.store.save(this.recording);
      this.dispatch({ type: "started" });
      if (this.disposed) {
        // Ended in the moment the microphone opened: close it and keep
        // whatever there is, as `dispose` does for a recording under way.
        await this.finish("outside");
        return;
      }
      this.watch();
    } catch {
      await this.device.finish().catch(ignore);
      if (uri) this.device.remove(uri);
      this.recording = null;
      await this.store.clear(this.identity).catch(ignore);
      refuse("start_failed");
    }
  }

  private watch(): void {
    this.ticks = 0;
    const stopEnded = this.device.onEnded(() => void this.endedOutside());
    const stopClock = this.clock.every(TICK_MS, () => this.tick());
    this.stopWatching = () => {
      stopEnded();
      stopClock();
    };
  }

  private unwatch(): void {
    this.stopWatching?.();
    this.stopWatching = null;
  }

  /** One second of a recording: read the recorder, and check its limits. */
  tick(): void {
    if (this.state.phase !== "recording") return;
    const status = this.device.status();
    if (!status) return;
    this.dispatch({ type: "tick", ...status });
    if (this.state.phase !== "recording") return;
    this.ticks += 1;
    if (this.state.paused === "user" && status.isRecording) {
      // iOS restarts every recorder when a call ends, one the officer
      // paused included. Their pause stands: what they stopped the
      // recording for must not be recorded.
      try {
        this.device.pause();
      } catch {
        // The next tick tries again.
      }
    } else if (
      this.state.paused === "interrupted" &&
      this.ticks % RETRY_RESUME_EVERY_TICKS === 0
    ) {
      // iOS doesn't always hand the microphone back after a call, and a
      // phone lying on a table has nobody to tap Resume. Asking is
      // harmless while the call is still on; the next tick reads whether
      // it took.
      try {
        this.device.resume();
      } catch {
        // Still taken.
      }
    }
    if (this.state.seconds >= this.state.subject.maxSeconds) {
      void this.finish("max_reached");
      return;
    }
    if (this.ticks % REMEMBER_EVERY_TICKS === 0 && this.recording) {
      this.recording = { ...this.recording, seconds: this.state.seconds };
      void this.store.save(this.recording).catch(ignore);
    }
    if (this.ticks % SPACE_EVERY_TICKS === 0) {
      const free = this.device.freeBytes();
      if (free !== null && free < MEETING_RECORDER_STOP_FREE_BYTES) {
        void this.finish("storage");
      }
    }
  }

  pause(): void {
    if (this.state.phase !== "recording" || this.state.paused !== null) return;
    try {
      this.device.pause();
      this.dispatch({ type: "paused" });
    } catch {
      // Still recording; the next tick says so.
    }
  }

  resume(): void {
    if (this.state.phase !== "recording" || this.state.paused === null) return;
    try {
      this.device.resume();
      this.dispatch({ type: "resumed" });
    } catch {
      // The microphone is still taken (the call hasn't ended): stay paused.
    }
  }

  /** The officer's Stop: close the file, then send it. */
  async stop(): Promise<void> {
    await this.finish("stopped");
    if (this.state.phase === "kept" && this.state.reason === "stopped") {
      await this.upload();
    }
  }

  private async finish(reason: KeptReason): Promise<void> {
    if (this.state.phase !== "recording") return;
    // Read before stopping: a stopped recorder reports no length.
    const seconds = Math.max(
      this.state.seconds,
      Math.floor(this.device.status()?.seconds ?? 0),
    );
    this.dispatch({ type: "stop_requested" });
    this.unwatch();
    await this.device.finish().catch(ignore);
    await this.keep(seconds, reason);
  }

  /** Recording ended and nobody here stopped it. */
  private async endedOutside(): Promise<void> {
    if (this.state.phase !== "recording") return;
    const { seconds, subject } = this.state;
    this.dispatch({ type: "stop_requested" });
    this.unwatch();
    await this.device.finish().catch(ignore);
    // The recorder is already stopped and reports no length, and the clock
    // may be an hour stale (Android, screen off): measure the file.
    const bytes = this.recording
      ? this.device.fileSize(this.recording.uri)
      : null;
    const length = bytes ? this.measured(seconds, bytes) : seconds;
    await this.keep(
      length,
      length >= subject.maxSeconds ? "max_reached" : "outside",
    );
  }

  private async keep(seconds: number, reason: KeptReason): Promise<void> {
    const recording = this.recording;
    const bytes = recording ? this.device.fileSize(recording.uri) : null;
    if (!recording || !bytes) {
      const meetingId =
        this.state.phase === "idle" ? "" : this.state.subject.meetingId;
      this.recording = null;
      await this.store.clear(this.identity).catch(ignore);
      this.dispatch({ type: "lost", meetingId });
      return;
    }
    if (seconds < MIN_MEETING_RECORDING_SECONDS) {
      this.device.remove(recording.uri);
      this.recording = null;
      await this.store.clear(this.identity).catch(ignore);
      this.dispatch({ type: "too_short" });
      return;
    }
    this.recording = { ...recording, seconds, stage: "kept", reason };
    await this.store.save(this.recording).catch(ignore);
    this.dispatch({ type: "saved", seconds, bytes, reason });
  }

  /** Sends the kept file, carrying on an earlier try where there was one. */
  async upload(): Promise<void> {
    if (this.state.phase !== "kept") return;
    const recording = this.recording;
    const api = this.api;
    const { subject, seconds } = this.state;
    const size = recording ? this.device.fileSize(recording.uri) : null;
    if (!recording || !size) {
      this.recording = null;
      this.target = null;
      await this.store.clear(this.identity).catch(ignore);
      this.dispatch({ type: "lost", meetingId: subject.meetingId });
      return;
    }
    if (!api) return;

    this.dispatch({ type: "upload_started", total: size });
    const abort = new AbortController();
    this.uploadAbort = abort;
    try {
      let target = this.target;
      if (
        !target ||
        target.meetingId !== subject.meetingId ||
        target.size !== size ||
        this.clock.now() - target.at > UPLOAD_TARGET_LIFE_MS
      ) {
        const upload = await api.start(subject.meetingId, {
          file_name: MEETING_RECORDER_FILE_NAME,
          mime_type: MEETING_RECORDER_FORMAT.mimeType,
          size_bytes: size,
          // The server refuses a length past its longest. The phone stops
          // there itself, but only when its clock runs: Android may hold
          // the clock while the screen is off, so a meeting that ran over is
          // sent as the longest the server takes rather than refused for
          // good. The transcript still covers all of it.
          duration_seconds: Math.min(seconds, subject.maxSeconds),
          notice_confirmed: true,
        });
        target = {
          meetingId: subject.meetingId,
          size,
          at: this.clock.now(),
          upload,
          url: null,
          complete: false,
        };
        this.target = target;
      }
      const held = target;
      if (!held.complete) {
        try {
          await this.send(
            this.device.source(recording.uri, size),
            held.upload,
            {
              supabaseUrl: api.supabaseUrl,
              signal: abort.signal,
              resumeUrl: held.url,
              onUploadUrl: (url) => {
                held.url = url;
              },
              onProgress: (sent, total) =>
                this.dispatch({ type: "upload_progress", sent, total }),
            },
          );
          held.complete = true;
        } catch (error) {
          if (abort.signal.aborted) {
            this.dispatch({ type: "upload_ended", reason: "upload_cancelled" });
            return;
          }
          if (
            isNetworkFailure(error) ||
            (error instanceof ResumableUploadError &&
              error.failure === "network")
          ) {
            // What Storage holds stays; Try again carries on from it.
            this.dispatch({ type: "upload_ended", reason: "upload_failed" });
            return;
          }
          // Refused: this signature is spent, so the next try starts over.
          this.target = null;
          void api
            .abandon(subject.meetingId, held.upload.uploadId)
            .catch(ignore);
          this.dispatch({ type: "upload_ended", reason: "upload_refused" });
          return;
        }
      }
      this.dispatch({ type: "upload_progress", sent: size, total: size });
      await api.confirm(subject.meetingId, held.upload.uploadId);
      // The server has it: the phone's copy goes now.
      this.device.remove(recording.uri);
      this.recording = null;
      this.target = null;
      await this.store.clear(this.identity).catch(ignore);
      this.dispatch({ type: "uploaded" });
    } catch (error) {
      if (abort.signal.aborted) {
        this.dispatch({ type: "upload_ended", reason: "upload_cancelled" });
      } else if (isNetworkFailure(error)) {
        // No answer from the API (starting, or confirming a file Storage
        // already holds): what was sent stays sent.
        this.dispatch({ type: "upload_ended", reason: "upload_failed" });
      } else {
        // The API said no, to starting the upload or to taking it.
        this.target = null;
        this.dispatch({
          type: "upload_ended",
          reason: "upload_refused",
          message: api.describe(error),
        });
      }
    } finally {
      if (this.uploadAbort === abort) this.uploadAbort = null;
    }
  }

  /** Stops an upload under way. The file stays on the phone. */
  cancelUpload(): void {
    this.uploadAbort?.abort();
  }

  /** Deletes the kept recording from the phone. Nothing is transcribed. */
  async discard(): Promise<void> {
    if (this.state.phase !== "kept") return;
    const { meetingId } = this.state.subject;
    if (this.recording) this.device.remove(this.recording.uri);
    if (this.target && this.api) {
      void this.api.abandon(meetingId, this.target.upload.uploadId).catch(ignore);
    }
    this.recording = null;
    this.target = null;
    await this.store.clear(this.identity).catch(ignore);
    this.dispatch({ type: "discarded" });
  }

  clearRefusal(): void {
    this.dispatch({ type: "refusal_cleared" });
  }

  /**
   * The session this recorder belongs to is ending (sign-out, another
   * chapter). A recording under way is closed and kept, so signing back in
   * finds it.
   */
  dispose(): void {
    this.disposed = true;
    this.uploadAbort?.abort();
    if (this.state.phase === "recording") void this.finish("outside");
    else this.unwatch();
    this.listeners.clear();
  }
}
