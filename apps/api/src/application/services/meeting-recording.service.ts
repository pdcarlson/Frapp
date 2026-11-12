import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  MAX_MEETING_RECORDING_BYTES,
  MAX_MEETING_RECORDING_LABEL,
  MAX_MEETING_RECORDING_SECONDS,
  MEETING_NOTES_MAX_LENGTH,
  MEETING_RECORDING_FAILURE_COPY,
  MEETING_RECORDING_FORMATS_LABEL,
  MEETING_RECORDING_NOTICE,
  MEETING_RECORDING_NOTIFICATION,
  MIN_MEETING_RECORDING_SECONDS,
  formatMeetingTranscript,
  isMeetingRecordingFailure,
  meetingRecordingExtension,
  meetingRecordingLengthLabel,
  meetingRecordingMimeType,
  type MeetingRecordingFailure,
  type MeetingRecordingStatus,
} from '@repo/validation';
import {
  MEETING_RECORDING_REPOSITORY,
  type IMeetingRecordingRepository,
} from '#domain/repositories/meeting-recording.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '#domain/adapters/storage.interface';
import { LanguageModelError } from '#domain/adapters/language-model.interface';
import type {
  Meeting,
  MeetingRecording,
} from '#domain/entities/meeting.entity';
import type { AiRunFailureReason } from '#domain/entities/ai-run.entity';
import { SystemPermissions } from '#domain/constants/permissions';
import { aiCatalogEntry } from '#domain/constants/ai-model-catalog';
import { MeetingService } from './meeting.service';
import { assertMeetingDraftable } from './meeting-draft.service';
import { AiRunService } from './ai-run.service';
import {
  AiRunFailure,
  AiRunRegistry,
  type AiRunContext,
  type AiRunHandler,
} from './ai-run-registry';
import { AiTranscriptionService } from './ai/ai-transcription.service';
import { AiConsentService } from './ai/ai-consent.service';
import { aiConsentRefusal } from './ai/ai-consent-refusal';

/** The catalog task, and the AI run kind, for a recording's transcript. */
export const MEETING_TRANSCRIPTION_TASK = 'meetings.transcribe';
export const MEETING_TRANSCRIPTION_RUN_KIND = 'meeting_transcription';
/** Stamped on the usage ledger where a prompt's version goes. */
export const MEETING_TRANSCRIPTION_VERSION = 'meetings.transcribe@v1';

/** The private bucket a recording waits in (`20261112190000_meeting_recordings.sql`). */
export const MEETING_AUDIO_BUCKET = 'meeting-audio';

/** A recording and its transcript older than this are deleted, like notes. */
export const MEETING_RECORDING_RETENTION_DAYS = 30;

/**
 * How long an upload may stay unfinished before it reads as failed. Two
 * hundred megabytes on a slow connection is well inside it.
 */
export const ABANDONED_UPLOAD_MS = 6 * 60 * 60 * 1000;

/** How long the provider has to fetch the file: longer than one try. */
const AUDIO_LINK_SECONDS = 2 * 60 * 60;

/** The most names sent as spelling hints. */
const VOCABULARY_LIMIT = 200;

/** Rows and folders one sweep reads. */
const SWEEP_BATCH = 200;

/** What the upload step needs to send the file straight to storage. */
export interface MeetingRecordingUploadTarget {
  upload_id: string;
  bucket: string;
  path: string;
  /** Signs this one upload. A secret until the upload is confirmed. */
  token: string;
  content_type: string;
}

/** What the editor reads about a meeting's recording. */
export interface MeetingRecordingState {
  status: MeetingRecordingStatus;
  /** The upload this state is about; null when there is none. */
  upload_id: string | null;
  file_name: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  failure: MeetingRecordingFailure | null;
  /** The failure in plain words. */
  failure_message: string | null;
  /** One line per speaker turn, only while `ready`. */
  transcript: string | null;
  speaker_count: number | null;
  uploaded_at: string | null;
  /**
   * False when this server has no transcription provider set up: the upload
   * step is not offered.
   */
  available: boolean;
  /** Why this viewer can't upload right now; null when they can. */
  blocked: 'chapter_off' | 'consent_required' | null;
  /** The largest and longest recording this server takes. */
  max_bytes: number;
  max_seconds: number;
  /** Only in the answer to starting an upload. */
  upload: MeetingRecordingUploadTarget | null;
}

export interface StartMeetingRecordingInput {
  file_name: string;
  /** The browser's name for the file's type; may be empty. */
  mime_type?: string | null;
  size_bytes: number;
  /** As the browser read it off the file. */
  duration_seconds: number;
  /** The officer ticked "everyone in the room was told". */
  notice_confirmed: boolean;
}

/** How a run that ended without the handler saying why reads to the officer. */
const RUN_FAILURES: Partial<
  Record<AiRunFailureReason, MeetingRecordingFailure>
> = {
  ai_unavailable: 'unavailable',
  not_permitted: 'not_permitted',
  source_gone: 'not_permitted',
  spend_limit: 'spend_limit',
};

/**
 * A meeting's uploaded recording, written out as text
 * (`spec/behavior/meetings.md` § Uploading a recording, #712, ADR-28
 * decisions 1 and 7).
 *
 * The officer's browser sends the file straight to a private bucket; this
 * service signs that upload, then has the recording transcribed by an AI run
 * (`meeting_transcription`) through `AiTranscriptionService`, which makes
 * the consent check, the spend hold and the usage record. The transcript
 * waits on the row for the officer to put into their notes, where drafting
 * from notes takes over. Nothing here drafts or posts.
 *
 * Refused before a byte is stored: a Standards meeting, minutes the caller
 * can't edit, posted minutes, an officer who has not confirmed the room was
 * told, a chapter with meeting notes off, an officer who has not said yes on
 * the AI sheet, and a file that is not audio Frapp takes or is too large or
 * too long.
 *
 * The audio is deleted as soon as the transcript is written or the
 * transcription has failed for good. Neither the audio, its link, the file's
 * name nor the transcript is ever in a log, an error or an event.
 */
@Injectable()
export class MeetingRecordingService implements AiRunHandler, OnModuleInit {
  private readonly logger = new Logger(MeetingRecordingService.name);

  readonly kind = MEETING_TRANSCRIPTION_RUN_KIND;
  readonly label = 'Transcribing the recording';
  readonly actsForMember = true;
  /** Still an officer who may write minutes when the run runs. */
  readonly runPermissions = [SystemPermissions.MEETINGS_RECORD];
  /**
   * Three tries of up to half an hour: a two-hour recording takes a provider
   * a few minutes, and a try that died resumes the provider's job, so a
   * second try does not pay for the recording again.
   */
  readonly maxAttempts = 3;
  readonly timeoutMs = 30 * 60 * 1000;

  constructor(
    @Inject(MEETING_RECORDING_REPOSITORY)
    private readonly recordings: IMeetingRecordingRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
    private readonly meetings: MeetingService,
    private readonly runs: AiRunService,
    private readonly registry: AiRunRegistry,
    private readonly transcription: AiTranscriptionService,
    private readonly consent: AiConsentService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Where the meeting's recording stands, for whoever may edit its minutes. */
  async state(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<MeetingRecordingState> {
    await this.meetings.editableBy(chapterId, meetingId, userId);
    const recording = await this.recordings.find(chapterId, meetingId);
    return this.stateFor(
      chapterId,
      userId,
      recording ? await this.settled(recording) : null,
    );
  }

  /**
   * Checks the file against what Frapp and the provider take, records the
   * upload and signs it. Uploading again replaces the earlier recording, its
   * transcript and its failure, and stops a transcription still running.
   */
  async start(
    chapterId: string,
    meetingId: string,
    userId: string,
    input: StartMeetingRecordingInput,
  ): Promise<MeetingRecordingState> {
    const meeting = await this.meetings.editableBy(
      chapterId,
      meetingId,
      userId,
    );
    assertMeetingDraftable(meeting);

    if (input.notice_confirmed !== true) {
      throw new BadRequestException({
        code: 'meeting.recording_notice_required',
        message: MEETING_RECORDING_NOTICE.unconfirmed,
      });
    }

    const limits = this.limits();
    if (!limits.available) throw this.unavailable();

    const fileName = input.file_name.trim().slice(0, 200) || 'recording';
    const mimeType = meetingRecordingMimeType(fileName, input.mime_type);
    if (!mimeType) {
      throw new BadRequestException({
        code: 'meeting.recording_format',
        message: `That file isn't a recording Frapp can read. Upload ${MEETING_RECORDING_FORMATS_LABEL}.`,
      });
    }
    if (!Number.isInteger(input.size_bytes) || input.size_bytes < 1) {
      throw new BadRequestException('That file is empty.');
    }
    if (input.size_bytes > limits.max_bytes) {
      throw new BadRequestException({
        code: 'meeting.recording_too_large',
        message: `That file is larger than ${limits.max_bytes === MAX_MEETING_RECORDING_BYTES ? MAX_MEETING_RECORDING_LABEL : `${Math.floor(limits.max_bytes / (1024 * 1024))} MB`}. Export it at a lower quality, or split it in two and upload each part.`,
      });
    }
    const seconds = Math.round(input.duration_seconds);
    if (!Number.isFinite(seconds) || seconds < MIN_MEETING_RECORDING_SECONDS) {
      throw new BadRequestException({
        code: 'meeting.recording_too_short',
        message: `That recording is shorter than ${MIN_MEETING_RECORDING_SECONDS} seconds. Check that it is the right file.`,
      });
    }
    if (seconds > limits.max_seconds) {
      throw new BadRequestException({
        code: 'meeting.recording_too_long',
        message: `That recording is longer than ${meetingRecordingLengthLabel(limits.max_seconds).toLowerCase()}. Split it and upload each part.`,
      });
    }

    // The same check the run makes, made now so the officer is told at once
    // and no audio is stored for a call that can't be made.
    const consent = await this.consentFor(chapterId, userId);
    if (!consent.allowed) throw aiConsentRefusal(consent.reason);

    const earlier = await this.recordings.find(chapterId, meetingId);
    if (earlier?.status === 'transcribing' && earlier.run_id) {
      await this.runs.cancel(chapterId, earlier.run_id);
    }

    const uploadId = randomUUID();
    const path = `${chapterId}/${meetingId}/${uploadId}.${meetingRecordingExtension(mimeType)}`;
    const token = uploadTokenOf(
      await this.storage.getSignedUploadUrl(
        MEETING_AUDIO_BUCKET,
        path,
        mimeType,
      ),
    );
    const recording = await this.recordings.start({
      meeting_id: meetingId,
      chapter_id: chapterId,
      upload_id: uploadId,
      uploaded_by: userId,
      storage_path: path,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: input.size_bytes,
      duration_seconds: seconds,
      notice_confirmed_at: new Date().toISOString(),
    });
    // The row no longer names the earlier file, so it goes now; the sweep
    // takes it if this fails.
    if (earlier?.storage_path) await this.deleteAudio(earlier.storage_path);

    return {
      ...(await this.stateFor(chapterId, userId, recording)),
      upload: {
        upload_id: uploadId,
        bucket: MEETING_AUDIO_BUCKET,
        path,
        token,
        content_type: mimeType,
      },
    };
  }

  /**
   * The browser says the file is in storage: checks that it is, queues the
   * transcription and tells the members who were at the meeting. Safe to
   * call twice.
   */
  async uploaded(
    chapterId: string,
    meetingId: string,
    userId: string,
    uploadId: string,
  ): Promise<MeetingRecordingState> {
    const meeting = await this.meetings.editableBy(
      chapterId,
      meetingId,
      userId,
    );
    assertMeetingDraftable(meeting);

    const recording = await this.recordings.find(chapterId, meetingId);
    if (!recording || recording.upload_id !== uploadId) {
      throw new ConflictException({
        code: 'meeting.recording_replaced',
        message:
          'That upload was replaced or removed. Upload the recording again.',
      });
    }
    if (recording.status !== 'uploading') {
      return this.stateFor(chapterId, userId, await this.settled(recording));
    }
    const path = recording.storage_path;
    const stored = path
      ? await this.storage.listFiles(
          MEETING_AUDIO_BUCKET,
          `${chapterId}/${meetingId}`,
        )
      : [];
    if (!path || !stored.includes(path)) {
      throw new ConflictException({
        code: 'meeting.recording_incomplete',
        message: MEETING_RECORDING_FAILURE_COPY.upload_incomplete,
      });
    }

    const end = async (failure: MeetingRecordingFailure) => {
      await this.fail(recording, ['uploading', 'transcribing'], failure);
    };
    const consent = await this.consentFor(chapterId, userId);
    if (!consent.allowed) {
      await end(
        consent.reason === 'chapter_off' ? 'chapter_off' : 'consent_required',
      );
      throw aiConsentRefusal(consent.reason);
    }

    const moved = await this.recordings.step(
      chapterId,
      meetingId,
      uploadId,
      ['uploading'],
      { status: 'transcribing' },
    );
    if (!moved) {
      // A second confirmation got there first.
      const now = await this.recordings.find(chapterId, meetingId);
      return this.stateFor(chapterId, userId, now);
    }

    let current = moved;
    try {
      const run = await this.runs.enqueue({
        chapterId,
        kind: MEETING_TRANSCRIPTION_RUN_KIND,
        // One run per upload: a new upload is new work.
        dedupeKey: `recording:${meetingId}:${uploadId}`,
        requestedBy: userId,
        actingUserId: userId,
        input: { meeting_id: meetingId, upload_id: uploadId },
      });
      current =
        (await this.recordings.step(
          chapterId,
          meetingId,
          uploadId,
          ['transcribing'],
          { run_id: run.id },
        )) ?? current;
    } catch (error) {
      // Nothing will transcribe it, so it is not kept.
      await end('unavailable');
      throw error;
    }

    await this.tellAttendees(chapterId, meeting, userId);
    return this.stateFor(chapterId, userId, current);
  }

  /**
   * Removes the recording, its transcript and its audio, and stops a
   * transcription still running. The notes and the minutes are not changed.
   */
  async remove(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<void> {
    await this.meetings.editableBy(chapterId, meetingId, userId);
    const recording = await this.recordings.find(chapterId, meetingId);
    if (!recording) return;
    if (recording.status === 'transcribing' && recording.run_id) {
      await this.runs.cancel(chapterId, recording.run_id);
    }
    await this.recordings.delete(chapterId, meetingId);
    if (recording.storage_path) await this.deleteAudio(recording.storage_path);
  }

  // ── Sweeps ────────────────────────────────────────────────────────────────

  /** The retention sweep: every recording older than the limit, everywhere. */
  async deleteExpired(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - MEETING_RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    return this.recordings.deleteCreatedBefore(cutoff.toISOString());
  }

  /**
   * Makes sure no audio outlives its use, in every chapter:
   *
   * 1. an upload nobody finished reads as failed and its file goes;
   * 2. a transcription whose run ended without saying why is settled, which
   *    deletes its file;
   * 3. any file in the bucket that no row names is deleted: what a posted,
   *    deleted or replaced meeting, a removed member or a failed delete left.
   *
   * Resolves to how many files it deleted.
   */
  async sweepAudio(now: Date = new Date()): Promise<number> {
    let deleted = 0;
    for (const recording of await this.recordings.listWithAudio(SWEEP_BATCH)) {
      if (recording.status === 'uploading') {
        const age = now.getTime() - Date.parse(recording.created_at);
        if (age > ABANDONED_UPLOAD_MS) {
          await this.fail(recording, ['uploading'], 'upload_incomplete');
          deleted += 1;
        }
      } else if (recording.status === 'transcribing') {
        await this.settled(recording);
      } else if (recording.storage_path) {
        // Ended, with a file a failed delete left behind.
        await this.deleteAudio(recording.storage_path);
        await this.recordings.step(
          recording.chapter_id,
          recording.meeting_id,
          recording.upload_id,
          [recording.status],
          { storage_path: null },
        );
        deleted += 1;
      }
    }

    const chapters = await this.storage.listFolders(MEETING_AUDIO_BUCKET, '');
    for (const chapter of chapters.slice(0, SWEEP_BATCH)) {
      const meetings = await this.storage.listFolders(
        MEETING_AUDIO_BUCKET,
        chapter,
      );
      for (const meeting of meetings.slice(0, SWEEP_BATCH)) {
        const paths = await this.storage.listFiles(
          MEETING_AUDIO_BUCKET,
          `${chapter}/${meeting}`,
        );
        if (paths.length === 0) continue;
        const named = new Set(await this.recordings.pathsStillNamed(paths));
        const orphans = paths.filter((path) => !named.has(path));
        if (orphans.length === 0) continue;
        await this.storage.deleteFiles(MEETING_AUDIO_BUCKET, orphans);
        deleted += orphans.length;
      }
    }
    return deleted;
  }

  // ── The AI run ────────────────────────────────────────────────────────────

  /**
   * Writes the transcript. Safe to run twice for one upload: an upload that
   * has already ended, or that the officer replaced or removed, writes
   * nothing, and a second try resumes the provider's job.
   */
  async run({ run, input, signal }: AiRunContext) {
    const meetingId = String(input.meeting_id);
    const uploadId = String(input.upload_id);
    const chapterId = run.chapter_id;
    const userId = run.acting_user_id;

    const recording = await this.recordings.find(chapterId, meetingId);
    if (
      !recording ||
      recording.upload_id !== uploadId ||
      recording.status !== 'transcribing'
    ) {
      return;
    }
    const fail = async (
      failure: MeetingRecordingFailure,
      reason: AiRunFailureReason,
    ): Promise<never> => {
      await this.fail(recording, ['transcribing'], failure);
      throw new AiRunFailure(reason, `meeting transcription ended: ${failure}`);
    };
    if (!userId) return fail('not_permitted', 'not_permitted');

    // The officer's access now, not when they uploaded.
    try {
      const meeting = await this.meetings.editableBy(
        chapterId,
        meetingId,
        userId,
      );
      assertMeetingDraftable(meeting);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        return fail('not_permitted', 'not_permitted');
      }
      throw error;
    }

    const path = recording.storage_path;
    if (!path) return fail('upload_incomplete', 'source_gone');

    const members =
      await this.memberRepo.findChapterMemberIdentities(chapterId);
    const vocabulary = members
      .map((member) => member.display_name.trim())
      .filter((name) => name.length > 0)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, VOCABULARY_LIMIT);

    let result;
    try {
      result = await this.transcription.transcribe(
        MEETING_TRANSCRIPTION_TASK,
        {
          audio: {
            url: await this.storage.getSignedDownloadUrl(
              MEETING_AUDIO_BUCKET,
              path,
              AUDIO_LINK_SECONDS,
            ),
            read: async () => {
              const bytes = await this.storage.downloadFile(
                MEETING_AUDIO_BUCKET,
                path,
              );
              if (!bytes) {
                throw new LanguageModelError('invalid_request', 'scripted');
              }
              return bytes;
            },
            mimeType: recording.mime_type,
            sizeBytes: recording.size_bytes,
            durationSeconds: recording.duration_seconds,
          },
          vocabulary,
          promptVersion: MEETING_TRANSCRIPTION_VERSION,
          resumeJobId: recording.provider_job_id,
          onJobStarted: async (jobId) => {
            await this.recordings.step(
              chapterId,
              meetingId,
              uploadId,
              ['transcribing'],
              { provider_job_id: jobId.slice(0, 200) },
            );
          },
          signal,
        },
        { chapterId, actingUserId: userId, runId: run.id },
      );
    } catch (error) {
      if (error instanceof LanguageModelError) {
        if (error.kind === 'invalid_request') {
          return fail('unreadable', 'handler_failed');
        }
        // Stopped by the officer, the time limit or a lost lease: the queue
        // decides what happens next, and the page settles the row.
        if (error.kind === 'aborted' || signal.aborted) throw error;
        // The last try: the audio is not kept for a retry that won't come.
        if (run.attempt_count >= run.max_attempts) {
          return fail('failed', 'handler_failed');
        }
        throw new AiRunFailure(
          'handler_failed',
          `meeting transcription provider call failed: ${error.kind}`,
          true,
        );
      }
      throw error;
    }

    if (result.status === 'unavailable') {
      if (result.reason === 'consent') {
        return fail(
          result.detail === 'chapter_off' ? 'chapter_off' : 'consent_required',
          'not_permitted',
        );
      }
      if (result.reason === 'spend_cap') {
        return fail('spend_limit', 'spend_limit');
      }
      return fail('unavailable', 'ai_unavailable');
    }
    if (result.status === 'unsupported') {
      return fail(
        result.reason === 'too_long' ? 'too_long' : 'failed',
        'handler_failed',
      );
    }

    const formatted = formatMeetingTranscript(result.utterances);
    if (!formatted.text) return fail('no_speech', 'handler_failed');

    const measured = Math.min(
      36_000,
      Math.max(1, Math.round(result.durationSeconds)),
    );
    const written = await this.recordings.step(
      chapterId,
      meetingId,
      uploadId,
      ['transcribing'],
      {
        status: 'ready',
        transcript: wholeLines(formatted.text, MEETING_NOTES_MAX_LENGTH),
        speaker_count: formatted.speakerCount,
        duration_seconds: measured,
        storage_path: null,
        provider_job_id: null,
        finished_at: new Date().toISOString(),
      },
    );
    // Written or not (the officer may have uploaded again or removed it),
    // this upload's audio has no further use.
    await this.deleteAudio(path);
    if (!written) return;
    return {
      meeting_id: meetingId,
      speaker_count: formatted.speakerCount,
      duration_seconds: measured,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** The chapter's switch and the member's answer, for this task. */
  private consentFor(chapterId: string, userId: string) {
    const entry = aiCatalogEntry(MEETING_TRANSCRIPTION_TASK);
    return this.consent.check({
      chapterId,
      actingUserId: userId,
      task: MEETING_TRANSCRIPTION_TASK,
      family: entry.family,
      provider: entry.provider,
      model: entry.model,
      promptVersion: MEETING_TRANSCRIPTION_VERSION,
    });
  }

  /** What this server takes: Frapp's caps, narrowed by the provider's. */
  private limits(): {
    available: boolean;
    max_bytes: number;
    max_seconds: number;
  } {
    const availability = this.transcription.availability(
      MEETING_TRANSCRIPTION_TASK,
    );
    if (!availability.available) {
      return {
        available: false,
        max_bytes: MAX_MEETING_RECORDING_BYTES,
        max_seconds: MAX_MEETING_RECORDING_SECONDS,
      };
    }
    return {
      available: true,
      max_bytes: Math.min(
        MAX_MEETING_RECORDING_BYTES,
        availability.limits.maxBytes,
      ),
      max_seconds: Math.min(
        MAX_MEETING_RECORDING_SECONDS,
        availability.limits.maxDurationSeconds,
      ),
    };
  }

  private unavailable(): ConflictException {
    return new ConflictException({
      code: 'meeting.recording_unavailable',
      message:
        "Transcribing isn't available right now. Type your notes instead.",
    });
  }

  /**
   * Ends a recording as failed and deletes its audio. The file goes whether
   * or not the row was still this upload's to end.
   */
  private async fail(
    recording: MeetingRecording,
    from: readonly MeetingRecording['status'][],
    failure: MeetingRecordingFailure,
  ): Promise<MeetingRecording | null> {
    const ended = await this.recordings.step(
      recording.chapter_id,
      recording.meeting_id,
      recording.upload_id,
      from,
      {
        status: 'failed',
        failure_code: failure,
        storage_path: null,
        provider_job_id: null,
        finished_at: new Date().toISOString(),
      },
    );
    if (ended && recording.storage_path) {
      await this.deleteAudio(recording.storage_path);
    }
    return ended;
  }

  /** Deleting a file that is already gone is not an error; a real one waits for the sweep. */
  private async deleteAudio(path: string): Promise<void> {
    try {
      await this.storage.deleteFile(MEETING_AUDIO_BUCKET, path);
    } catch {
      // The path holds only ids. The cause is left out: a storage error can
      // quote a signed link.
      this.logger.warn(
        `Could not delete meeting audio ${path}; the audio sweep will retry`,
      );
    }
  }

  /** Once per meeting, and never a reason for the upload to fail. */
  private async tellAttendees(
    chapterId: string,
    meeting: Meeting,
    uploaderId: string,
  ): Promise<void> {
    try {
      const claimed = await this.recordings.claimAttendeeNotice(
        chapterId,
        meeting.id,
        new Date().toISOString(),
      );
      if (!claimed) return;
      await this.meetings.notifyRecordingUploaded(
        chapterId,
        meeting,
        uploaderId,
        {
          title: MEETING_RECORDING_NOTIFICATION.title,
          body: MEETING_RECORDING_NOTIFICATION.body(meeting.event_name),
        },
      );
    } catch {
      this.logger.warn(
        `Could not tell attendees about the recording for meeting ${meeting.id}`,
      );
    }
  }

  /**
   * A recording still `transcribing` whose run has ended without the handler
   * recording why (it ran out of tries, was cancelled, or its member left) is
   * recorded as failed here, and its audio deleted, so the page stops
   * waiting.
   */
  private async settled(
    recording: MeetingRecording,
  ): Promise<MeetingRecording> {
    if (recording.status !== 'transcribing') return recording;
    let failure: MeetingRecordingFailure | null = null;
    if (!recording.run_id || !recording.uploaded_by) {
      // No run was ever queued for it, or its member is gone. The row has
      // no time for when the upload finished, so it is given as long as an
      // upload gets before nothing is coming.
      const waited = Date.now() - Date.parse(recording.created_at);
      if (waited > ABANDONED_UPLOAD_MS) failure = 'failed';
    } else
      try {
        const run = await this.runs.getForMember(
          recording.chapter_id,
          recording.uploaded_by,
          recording.run_id,
        );
        if (run.status === 'failed' || run.status === 'cancelled') {
          failure =
            (run.failure_reason && RUN_FAILURES[run.failure_reason]) ||
            'failed';
        }
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
        // The run is gone, or AI was switched off since.
        failure = 'unavailable';
      }
    if (!failure) return recording;
    const ended = await this.fail(recording, ['transcribing'], failure);
    // Lost to the handler finishing at the same moment: read what it wrote.
    return (
      ended ??
      (await this.recordings.find(
        recording.chapter_id,
        recording.meeting_id,
      )) ??
      recording
    );
  }

  private async stateFor(
    chapterId: string,
    userId: string,
    recording: MeetingRecording | null,
  ): Promise<MeetingRecordingState> {
    const consent = await this.consentFor(chapterId, userId);
    const limits = this.limits();
    const base = {
      available: limits.available,
      blocked: consent.allowed
        ? null
        : consent.reason === 'chapter_off'
          ? ('chapter_off' as const)
          : ('consent_required' as const),
      max_bytes: limits.max_bytes,
      max_seconds: limits.max_seconds,
      upload: null,
    };
    if (!recording) {
      return {
        status: 'none',
        upload_id: null,
        file_name: null,
        size_bytes: null,
        duration_seconds: null,
        failure: null,
        failure_message: null,
        transcript: null,
        speaker_count: null,
        uploaded_at: null,
        ...base,
      };
    }
    const failure =
      recording.status === 'failed'
        ? isMeetingRecordingFailure(recording.failure_code)
          ? recording.failure_code
          : 'failed'
        : null;
    return {
      status: recording.status,
      upload_id: recording.upload_id,
      file_name: recording.file_name,
      size_bytes: recording.size_bytes,
      duration_seconds: recording.duration_seconds,
      failure,
      failure_message: failure ? MEETING_RECORDING_FAILURE_COPY[failure] : null,
      transcript: recording.status === 'ready' ? recording.transcript : null,
      speaker_count: recording.speaker_count,
      uploaded_at: recording.created_at,
      ...base,
    };
  }
}

/** The token a signed upload link carries; the link itself is not passed on. */
function uploadTokenOf(signedUrl: string): string {
  const token = new URL(signedUrl).searchParams.get('token');
  if (!token) throw new Error('Signed upload link carries no token');
  return token;
}

/** At most `limit` characters, cut at the end of a line so no turn is halved. */
function wholeLines(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.lastIndexOf('\n', limit);
  return cut > 0 ? text.slice(0, cut) : text.slice(0, limit);
}
