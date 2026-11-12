import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { MEETING_RECORDING_FAILURE_COPY } from '@repo/validation';
import type {
  IMeetingRecordingRepository,
  MeetingRecordingStep,
  NewMeetingRecording,
} from '#domain/repositories/meeting-recording.repository.interface';
import type {
  Meeting,
  MeetingRecording,
} from '#domain/entities/meeting.entity';
import { LanguageModelError } from '#domain/adapters/language-model.interface';
import { AiRunFailure, type AiRunContext } from './ai-run-registry';
import {
  ABANDONED_UPLOAD_MS,
  MEETING_AUDIO_BUCKET,
  MeetingRecordingService,
} from './meeting-recording.service';

const CHAPTER = '0a000000-0000-4000-8000-000000000001';
const MEETING = '0a000000-0000-4000-8000-0000000000a1';
const SECRETARY = '0a000000-0000-4000-8000-0000000000b1';
const RUN = '0a000000-0000-4000-8000-0000000000f1';
const AT = '2026-11-10T02:00:00.000Z';

const meeting = (overrides: Partial<Meeting> = {}): Meeting => ({
  id: MEETING,
  chapter_id: CHAPTER,
  event_id: 'evt-1',
  event_name: 'Chapter meeting',
  event_start_time: '2026-11-10T00:00:00.000Z',
  meeting_type: 'chapter',
  other_label: null,
  status: 'draft',
  content: {},
  created_by: SECRETARY,
  updated_by: SECRETARY,
  posted_by: null,
  posted_at: null,
  created_at: AT,
  updated_at: AT,
  ...overrides,
});

/** `meeting_recordings`, in memory, with the repository's own conditions. */
class FakeRecordings implements IMeetingRecordingRepository {
  row: MeetingRecording | null = null;

  find(): Promise<MeetingRecording | null> {
    return Promise.resolve(this.row ? { ...this.row } : null);
  }
  start(data: NewMeetingRecording): Promise<MeetingRecording> {
    this.row = {
      ...data,
      attendees_notified_at: this.row?.attendees_notified_at ?? null,
      status: 'uploading',
      failure_code: null,
      run_id: null,
      provider_job_id: null,
      transcript: null,
      speaker_count: null,
      created_at: new Date().toISOString(),
      finished_at: null,
    };
    return Promise.resolve({ ...this.row });
  }
  step(
    _c: string,
    _m: string,
    uploadId: string,
    from: readonly string[],
    step: MeetingRecordingStep,
  ): Promise<MeetingRecording | null> {
    if (
      !this.row ||
      this.row.upload_id !== uploadId ||
      !from.includes(this.row.status)
    ) {
      return Promise.resolve(null);
    }
    this.row = { ...this.row, ...step };
    return Promise.resolve({ ...this.row });
  }
  claimAttendeeNotice(_c: string, _m: string, at: string): Promise<boolean> {
    if (!this.row || this.row.attendees_notified_at) {
      return Promise.resolve(false);
    }
    this.row.attendees_notified_at = at;
    return Promise.resolve(true);
  }
  releaseAttendeeNotice(): Promise<void> {
    if (this.row) this.row.attendees_notified_at = null;
    return Promise.resolve();
  }
  delete(): Promise<void> {
    this.row = null;
    return Promise.resolve();
  }
  listWithAudio(): Promise<MeetingRecording[]> {
    return Promise.resolve(this.row?.storage_path ? [{ ...this.row }] : []);
  }
  pathsStillNamed(paths: readonly string[]): Promise<string[]> {
    return Promise.resolve(
      paths.filter((path) => path === this.row?.storage_path),
    );
  }
  deleteCreatedBefore = jest.fn().mockResolvedValue(2);
}

const FILE = {
  file_name: 'Chapter 11-9.m4a',
  mime_type: 'audio/x-m4a',
  size_bytes: 60 * 1024 * 1024,
  duration_seconds: 4320,
  notice_confirmed: true,
};

function setup(
  options: {
    meeting?: Meeting;
    consent?: { allowed: true } | { allowed: false; reason: string };
    available?: boolean;
    limits?: { maxDurationSeconds: number; maxBytes: number };
  } = {},
) {
  const recordings = new FakeRecordings();
  const files = new Set<string>();
  const storage = {
    getSignedUploadUrl: jest.fn((_bucket: string, path: string) =>
      Promise.resolve(
        `http://storage.test/object/upload/sign/${path}?token=signed-token`,
      ),
    ),
    getSignedDownloadUrl: jest
      .fn()
      .mockResolvedValue('http://storage.test/secret-link'),
    downloadFile: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    deleteFile: jest.fn((_bucket: string, path: string) => {
      files.delete(path);
      return Promise.resolve();
    }),
    deleteFiles: jest.fn((_bucket: string, paths: string[]) => {
      for (const path of paths) files.delete(path);
      return Promise.resolve();
    }),
    listFiles: jest.fn((_bucket: string, prefix: string) =>
      Promise.resolve([...files].filter((path) => path.startsWith(prefix))),
    ),
    listFolders: jest.fn((_bucket: string, prefix: string) => {
      const depth = prefix === '' ? 0 : prefix.split('/').length;
      return Promise.resolve([
        ...new Set(
          [...files]
            .filter((path) => path.startsWith(prefix))
            .map((path) => path.split('/')[depth]),
        ),
      ]);
    }),
  };
  const meetings = {
    editableBy: jest.fn().mockResolvedValue(options.meeting ?? meeting()),
    notifyRecordingUploaded: jest.fn().mockResolvedValue(24),
  };
  const runs = {
    enqueue: jest.fn().mockResolvedValue({ id: RUN }),
    cancel: jest.fn().mockResolvedValue(undefined),
    getForMember: jest.fn().mockResolvedValue({ status: 'running' }),
  };
  const registry = { register: jest.fn() };
  const transcription = {
    availability: jest.fn().mockReturnValue(
      options.available === false
        ? { available: false, reason: 'not_configured' }
        : {
            available: true,
            limits: options.limits ?? {
              maxDurationSeconds: 36_000,
              maxBytes: 5 * 1024 ** 3,
            },
          },
    ),
    discard: jest.fn().mockResolvedValue(undefined),
    transcribe: jest.fn().mockResolvedValue({
      status: 'ok',
      durationSeconds: 4318.4,
      utterances: [
        { speaker: 'A', text: 'Call to order.', startMs: 0, endMs: 900 },
        { speaker: 'B', text: 'Treasurer report.', startMs: 900, endMs: 2000 },
        { speaker: 'A', text: 'Thank you.', startMs: 2000, endMs: 2500 },
      ],
    }),
  };
  const consent = {
    check: jest.fn().mockResolvedValue(options.consent ?? { allowed: true }),
  };
  const members = {
    findChapterMemberIdentities: jest.fn().mockResolvedValue([
      { user_id: 'u2', display_name: 'Priya Natarajan', role_ids: [] },
      { user_id: 'u1', display_name: ' Marcus Ellison ', role_ids: [] },
      { user_id: 'u3', display_name: '', role_ids: [] },
    ]),
  };
  const service = new MeetingRecordingService(
    recordings,
    members as never,
    storage as never,
    meetings as never,
    runs as never,
    registry as never,
    transcription as never,
    consent as never,
  );
  /** Start an upload and put its file in storage, as the browser would. */
  const upload = async () => {
    const state = await service.start(CHAPTER, MEETING, SECRETARY, FILE);
    files.add(state.upload!.path);
    return state.upload!;
  };
  const context = (
    uploadId: string,
    run: Partial<AiRunContext['run']> = {},
  ): AiRunContext => ({
    run: {
      id: RUN,
      chapter_id: CHAPTER,
      kind: 'meeting_transcription',
      requested_by: SECRETARY,
      acting_user_id: SECRETARY,
      attempt_count: 1,
      max_attempts: 3,
      ...run,
    },
    input: { meeting_id: MEETING, upload_id: uploadId },
    signal: new AbortController().signal,
  });
  return {
    service,
    recordings,
    storage,
    files,
    meetings,
    runs,
    registry,
    transcription,
    consent,
    upload,
    context,
  };
}

/** An upload that has been confirmed and is waiting on its run. */
async function transcribing(harness: ReturnType<typeof setup>) {
  const target = await harness.upload();
  await harness.service.uploaded(CHAPTER, MEETING, SECRETARY, target.upload_id);
  return target;
}

describe('MeetingRecordingService', () => {
  it('registers itself as the meeting_transcription handler', () => {
    const { service, registry } = setup();
    service.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(service);
    expect(service.kind).toBe('meeting_transcription');
    expect(service.actsForMember).toBe(true);
  });

  describe('starting an upload', () => {
    it('signs one object under the chapter and meeting, and records the upload', async () => {
      const { service, recordings, storage } = setup();
      const state = await service.start(CHAPTER, MEETING, SECRETARY, FILE);
      expect(state.status).toBe('uploading');
      expect(state.upload).toMatchObject({
        bucket: MEETING_AUDIO_BUCKET,
        token: 'signed-token',
        content_type: 'audio/x-m4a',
      });
      expect(state.upload!.path).toBe(
        `${CHAPTER}/${MEETING}/${state.upload!.upload_id}.m4a`,
      );
      expect(storage.getSignedUploadUrl).toHaveBeenCalledWith(
        MEETING_AUDIO_BUCKET,
        state.upload!.path,
        'audio/x-m4a',
      );
      expect(recordings.row).toMatchObject({
        uploaded_by: SECRETARY,
        storage_path: state.upload!.path,
        duration_seconds: 4320,
      });
      expect(recordings.row!.notice_confirmed_at).toEqual(expect.any(String));
    });

    it('refuses a Standards meeting and posted minutes before anything is stored', async () => {
      for (const refused of [
        meeting({ meeting_type: 'standards' as never }),
        meeting({ status: 'posted' }),
      ]) {
        const { service, recordings, storage } = setup({ meeting: refused });
        await expect(
          service.start(CHAPTER, MEETING, SECRETARY, FILE),
        ).rejects.toMatchObject({
          response: {
            code: expect.stringMatching(
              /meeting\.(standards_refused|draft_posted)/,
            ),
          },
        });
        expect(storage.getSignedUploadUrl).not.toHaveBeenCalled();
        expect(recordings.row).toBeNull();
      }
    });

    it('refuses an upload whose officer has not confirmed the room was told', async () => {
      const { service, storage } = setup();
      await expect(
        service.start(CHAPTER, MEETING, SECRETARY, {
          ...FILE,
          notice_confirmed: false,
        }),
      ).rejects.toMatchObject({
        response: { code: 'meeting.recording_notice_required' },
      });
      expect(storage.getSignedUploadUrl).not.toHaveBeenCalled();
    });

    it.each([
      [{ file_name: 'meeting.mov', mime_type: 'video/quicktime' }, 'format'],
      [{ duration_seconds: 4 }, 'too_short'],
      [{ duration_seconds: 2 * 60 * 60 + 1 }, 'too_long'],
    ])('refuses %p as %s', async (change, code) => {
      const { service, storage } = setup();
      await expect(
        service.start(CHAPTER, MEETING, SECRETARY, { ...FILE, ...change }),
      ).rejects.toMatchObject({
        response: { code: `meeting.recording_${code}` },
      });
      expect(storage.getSignedUploadUrl).not.toHaveBeenCalled();
    });

    it("holds a recording to the provider's limit when it is tighter than Frapp's", async () => {
      const { service } = setup({
        limits: { maxDurationSeconds: 1800, maxBytes: 100 * 1024 * 1024 },
      });
      const refusal = service.start(CHAPTER, MEETING, SECRETARY, FILE);
      await expect(refusal).rejects.toBeInstanceOf(BadRequestException);
      await expect(refusal).rejects.toMatchObject({
        response: {
          code: 'meeting.recording_too_long',
          message: expect.stringContaining('30 minutes'),
        },
      });
      const state = await service.state(CHAPTER, MEETING, SECRETARY);
      expect(state).toMatchObject({
        max_seconds: 1800,
        max_bytes: 100 * 1024 * 1024,
      });
    });

    it('refuses when no transcription provider is set up', async () => {
      const { service } = setup({ available: false });
      await expect(
        service.start(CHAPTER, MEETING, SECRETARY, FILE),
      ).rejects.toMatchObject({
        response: { code: 'meeting.recording_unavailable' },
      });
      await expect(
        service.state(CHAPTER, MEETING, SECRETARY),
      ).resolves.toMatchObject({ available: false, status: 'none' });
    });

    it.each([
      ['chapter_off', 'ai.chapter_off'],
      ['member_declined', 'ai.consent.required'],
    ])('refuses on consent %s before signing', async (reason, code) => {
      const { service, storage } = setup({
        consent: { allowed: false, reason },
      });
      const refusal = service.start(CHAPTER, MEETING, SECRETARY, FILE);
      await expect(refusal).rejects.toBeInstanceOf(ForbiddenException);
      await expect(refusal).rejects.toMatchObject({ response: { code } });
      expect(storage.getSignedUploadUrl).not.toHaveBeenCalled();
    });

    it('replaces an earlier recording: stops its run and deletes its audio', async () => {
      const { service, upload, runs, files, recordings } = setup();
      const first = await upload();
      await service.uploaded(CHAPTER, MEETING, SECRETARY, first.upload_id);
      const second = await service.start(CHAPTER, MEETING, SECRETARY, FILE);
      expect(runs.cancel).toHaveBeenCalledWith(CHAPTER, RUN);
      expect(files.has(first.path)).toBe(false);
      expect(recordings.row).toMatchObject({
        upload_id: second.upload!.upload_id,
        status: 'uploading',
        run_id: null,
      });
    });
  });

  describe('confirming the upload', () => {
    it('queues one run for the upload and tells the attendees once', async () => {
      const { service, upload, runs, meetings, recordings } = setup();
      const target = await upload();
      const state = await service.uploaded(
        CHAPTER,
        MEETING,
        SECRETARY,
        target.upload_id,
      );
      expect(state.status).toBe('transcribing');
      expect(state.upload).toBeNull();
      expect(runs.enqueue).toHaveBeenCalledWith({
        chapterId: CHAPTER,
        kind: 'meeting_transcription',
        dedupeKey: `recording:${MEETING}:${target.upload_id}`,
        requestedBy: SECRETARY,
        actingUserId: SECRETARY,
        input: { meeting_id: MEETING, upload_id: target.upload_id },
      });
      expect(recordings.row!.run_id).toBe(RUN);
      expect(meetings.notifyRecordingUploaded).toHaveBeenCalledTimes(1);
      expect(meetings.notifyRecordingUploaded.mock.calls[0][3]).toEqual({
        title: 'Meeting recording uploaded',
        body: expect.stringContaining('Chapter meeting'),
      });

      // Again, and after a second upload for the same meeting: no second run
      // for the first, and no second notice at all.
      await service.uploaded(CHAPTER, MEETING, SECRETARY, target.upload_id);
      expect(runs.enqueue).toHaveBeenCalledTimes(1);
      const again = await upload();
      await service.uploaded(CHAPTER, MEETING, SECRETARY, again.upload_id);
      expect(runs.enqueue).toHaveBeenCalledTimes(2);
      expect(meetings.notifyRecordingUploaded).toHaveBeenCalledTimes(1);
    });

    it('refuses when the file never reached storage', async () => {
      const { service, runs } = setup();
      const state = await service.start(CHAPTER, MEETING, SECRETARY, FILE);
      await expect(
        service.uploaded(CHAPTER, MEETING, SECRETARY, state.upload!.upload_id),
      ).rejects.toMatchObject({
        response: { code: 'meeting.recording_incomplete' },
      });
      expect(runs.enqueue).not.toHaveBeenCalled();
    });

    it('refuses an upload that was replaced', async () => {
      const { service, upload } = setup();
      await upload();
      const refusal = service.uploaded(
        CHAPTER,
        MEETING,
        SECRETARY,
        '0a000000-0000-4000-8000-0000000000ee',
      );
      await expect(refusal).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses, and keeps nothing, when the chapter or the officer said no while the file was uploading', async () => {
      const { service, upload, consent, runs, files, recordings, meetings } =
        setup();
      const target = await upload();
      consent.check.mockResolvedValue({
        allowed: false,
        reason: 'chapter_off',
      });
      await expect(
        service.uploaded(CHAPTER, MEETING, SECRETARY, target.upload_id),
      ).rejects.toBeInstanceOf(HttpException);
      expect(runs.enqueue).not.toHaveBeenCalled();
      expect(meetings.notifyRecordingUploaded).not.toHaveBeenCalled();
      expect(recordings.row).toMatchObject({
        status: 'failed',
        failure_code: 'chapter_off',
      });
      expect(files.size).toBe(0);
    });

    it('queues nothing for minutes that became Standards while the file was uploading', async () => {
      const { service, upload, runs, meetings } = setup();
      const target = await upload();
      meetings.editableBy.mockResolvedValue(
        meeting({ meeting_type: 'standards' as never }),
      );
      await expect(
        service.uploaded(CHAPTER, MEETING, SECRETARY, target.upload_id),
      ).rejects.toBeInstanceOf(HttpException);
      expect(runs.enqueue).not.toHaveBeenCalled();
      expect(meetings.notifyRecordingUploaded).not.toHaveBeenCalled();
    });

    it('keeps nothing when the run cannot be queued', async () => {
      const { service, upload, runs, files, recordings, meetings } = setup();
      const target = await upload();
      runs.enqueue.mockRejectedValue(new Error('queue down'));
      await expect(
        service.uploaded(CHAPTER, MEETING, SECRETARY, target.upload_id),
      ).rejects.toThrow('queue down');
      expect(files.size).toBe(0);
      expect(recordings.row).toMatchObject({
        status: 'failed',
        failure_code: 'unavailable',
        storage_path: null,
      });
      expect(meetings.notifyRecordingUploaded).not.toHaveBeenCalled();
    });

    it('still transcribes when the notice to attendees fails, and leaves it to be sent by the next upload', async () => {
      const { service, upload, meetings, recordings } = setup();
      meetings.notifyRecordingUploaded.mockRejectedValueOnce(new Error('push'));
      const target = await upload();
      await expect(
        service.uploaded(CHAPTER, MEETING, SECRETARY, target.upload_id),
      ).resolves.toMatchObject({ status: 'transcribing' });
      // The claim is given back: nobody was told.
      expect(recordings.row!.attendees_notified_at).toBeNull();
      const again = await upload();
      await service.uploaded(CHAPTER, MEETING, SECRETARY, again.upload_id);
      expect(meetings.notifyRecordingUploaded).toHaveBeenCalledTimes(2);
      expect(recordings.row!.attendees_notified_at).not.toBeNull();
    });
  });

  describe('the run', () => {
    it('writes the transcript with numbered speakers and deletes the audio', async () => {
      const harness = setup();
      const target = await transcribing(harness);
      const result = await harness.service.run(
        harness.context(target.upload_id),
      );
      expect(result).toEqual({
        meeting_id: MEETING,
        speaker_count: 2,
        duration_seconds: 4318,
      });
      expect(harness.recordings.row).toMatchObject({
        status: 'ready',
        transcript:
          'Speaker 1: Call to order.\nSpeaker 2: Treasurer report.\nSpeaker 1: Thank you.',
        speaker_count: 2,
        storage_path: null,
        provider_job_id: null,
      });
      expect(harness.files.size).toBe(0);

      const [task, input, call] =
        harness.transcription.transcribe.mock.calls[0];
      expect(task).toBe('meetings.transcribe');
      expect(call).toEqual({
        chapterId: CHAPTER,
        actingUserId: SECRETARY,
        runId: RUN,
      });
      // Names to spell, sorted, blanks dropped.
      expect(input.vocabulary).toEqual(['Marcus Ellison', 'Priya Natarajan']);
      expect(input.audio).toMatchObject({
        url: 'http://storage.test/secret-link',
        mimeType: 'audio/x-m4a',
        durationSeconds: 4320,
      });
      expect(input.resumeJobId).toBeNull();

      const state = await harness.service.state(CHAPTER, MEETING, SECRETARY);
      expect(state).toMatchObject({
        status: 'ready',
        duration_seconds: 4318,
        transcript: expect.stringContaining('Speaker 2: Treasurer report.'),
      });
    });

    it("stores the provider's job id so a second try resumes it", async () => {
      const harness = setup();
      const target = await transcribing(harness);
      harness.transcription.transcribe.mockImplementationOnce(
        async (
          _task: string,
          input: { onJobStarted(id: string): Promise<void> },
        ) => {
          await input.onJobStarted('job-7');
          throw new LanguageModelError('overloaded', 'assemblyai');
        },
      );
      await expect(
        harness.service.run(harness.context(target.upload_id)),
      ).rejects.toMatchObject({ retryable: true, reason: 'handler_failed' });
      // Not the last try: the audio and the row wait for the next one.
      expect(harness.recordings.row).toMatchObject({
        status: 'transcribing',
        provider_job_id: 'job-7',
      });
      expect(harness.files.size).toBe(1);

      await harness.service.run(
        harness.context(target.upload_id, { attempt_count: 2 }),
      );
      expect(
        harness.transcription.transcribe.mock.calls[1][1].resumeJobId,
      ).toBe('job-7');
      expect(harness.recordings.row!.status).toBe('ready');
      // The provider's copy goes only once the transcript is stored: the
      // first try left it for the second to read.
      expect(harness.transcription.discard).toHaveBeenCalledTimes(1);
      expect(harness.transcription.discard).toHaveBeenCalledWith(
        'meetings.transcribe',
        'job-7',
      );
    });

    it("has the provider delete its copy when the officer stops a transcription, and when a tab gives up on someone else's upload does nothing", async () => {
      const harness = setup();
      const target = await transcribing(harness);
      harness.recordings.row!.provider_job_id = 'job-9';

      // Another tab's failed upload names its own upload, not this one.
      await harness.service.remove(
        CHAPTER,
        MEETING,
        SECRETARY,
        '00000000-0000-4000-8000-00000000dead',
      );
      expect(harness.recordings.row!.upload_id).toBe(target.upload_id);
      expect(harness.files.size).toBe(1);
      expect(harness.transcription.discard).not.toHaveBeenCalled();
      expect(harness.runs.cancel).not.toHaveBeenCalled();

      await harness.service.remove(CHAPTER, MEETING, SECRETARY);
      // The run is stopped, so nothing more is spent on it.
      expect(harness.runs.cancel).toHaveBeenCalledWith(CHAPTER, RUN);
      expect(harness.recordings.row).toBeNull();
      expect(harness.files.size).toBe(0);
      expect(harness.transcription.discard).toHaveBeenCalledWith(
        'meetings.transcribe',
        'job-9',
      );
    });

    it('deletes the audio of a run that ends after the minutes were posted and the row went', async () => {
      const harness = setup();
      const target = await transcribing(harness);
      harness.transcription.transcribe.mockImplementationOnce(
        async (
          _task: string,
          input: { onJobStarted(id: string): Promise<void> },
        ) => {
          await input.onJobStarted('job-3');
          // Posting the minutes removes the row under the run.
          harness.recordings.row = null;
          throw new LanguageModelError('invalid_request', 'assemblyai');
        },
      );
      await expect(
        harness.service.run(harness.context(target.upload_id)),
      ).rejects.toBeInstanceOf(AiRunFailure);
      expect(harness.files.size).toBe(0);
      expect(harness.transcription.discard).toHaveBeenCalledWith(
        'meetings.transcribe',
        'job-3',
      );
    });

    it('fails for good, and deletes the audio, when the last try fails', async () => {
      const harness = setup();
      const target = await transcribing(harness);
      harness.transcription.transcribe.mockRejectedValue(
        new LanguageModelError('overloaded', 'assemblyai'),
      );
      const failure = harness.service.run(
        harness.context(target.upload_id, { attempt_count: 3 }),
      );
      await expect(failure).rejects.toBeInstanceOf(AiRunFailure);
      await expect(failure).rejects.toMatchObject({ retryable: false });
      expect(harness.recordings.row).toMatchObject({
        status: 'failed',
        failure_code: 'failed',
        storage_path: null,
      });
      expect(harness.files.size).toBe(0);
    });

    it.each([
      [
        () =>
          Promise.reject(
            new LanguageModelError('invalid_request', 'assemblyai'),
          ),
        'unreadable',
      ],
      [
        () =>
          Promise.resolve({
            status: 'ok',
            durationSeconds: 900,
            utterances: [],
          }),
        'no_speech',
      ],
      [
        () =>
          Promise.resolve({
            status: 'unavailable',
            reason: 'spend_cap',
            detail: 'chapter_cap',
          }),
        'spend_limit',
      ],
      [
        () =>
          Promise.resolve({
            status: 'unavailable',
            reason: 'consent',
            detail: 'member_declined',
          }),
        'consent_required',
      ],
      [
        () => Promise.resolve({ status: 'unavailable', reason: 'disabled' }),
        'unavailable',
      ],
      [
        () =>
          Promise.resolve({
            status: 'unsupported',
            reason: 'too_long',
            limits: { maxDurationSeconds: 1800, maxBytes: 1 },
          }),
        'too_long',
      ],
    ])(
      'ends as %#: %s, in plain words, with the audio deleted',
      async (answer, failure) => {
        const harness = setup();
        const target = await transcribing(harness);
        harness.transcription.transcribe.mockImplementation(answer);
        await expect(
          harness.service.run(harness.context(target.upload_id)),
        ).rejects.toMatchObject({ retryable: false });
        expect(harness.files.size).toBe(0);
        const state = await harness.service.state(CHAPTER, MEETING, SECRETARY);
        expect(state).toMatchObject({
          status: 'failed',
          failure,
          failure_message:
            MEETING_RECORDING_FAILURE_COPY[
              failure as keyof typeof MEETING_RECORDING_FAILURE_COPY
            ],
          transcript: null,
        });
      },
    );

    it('sends nothing when the officer can no longer edit the minutes, or they became Standards', async () => {
      for (const change of [
        (h: ReturnType<typeof setup>) =>
          h.meetings.editableBy.mockRejectedValue(new NotFoundException()),
        (h: ReturnType<typeof setup>) =>
          h.meetings.editableBy.mockResolvedValue(
            meeting({ meeting_type: 'standards' as never }),
          ),
      ]) {
        const harness = setup();
        const target = await transcribing(harness);
        change(harness);
        await expect(
          harness.service.run(harness.context(target.upload_id)),
        ).rejects.toMatchObject({ reason: 'not_permitted' });
        expect(harness.transcription.transcribe).not.toHaveBeenCalled();
        expect(harness.recordings.row!.failure_code).toBe('not_permitted');
        expect(harness.files.size).toBe(0);
      }
    });

    it('writes nothing for an upload the officer replaced or removed', async () => {
      const harness = setup();
      const first = await transcribing(harness);
      const second = await harness.upload();
      await expect(
        harness.service.run(harness.context(first.upload_id)),
      ).resolves.toBeUndefined();
      expect(harness.transcription.transcribe).not.toHaveBeenCalled();
      expect(harness.recordings.row!.upload_id).toBe(second.upload_id);

      await harness.service.remove(CHAPTER, MEETING, SECRETARY);
      expect(harness.recordings.row).toBeNull();
      expect(harness.files.size).toBe(0);
    });

    it('discards a transcript that lands after the officer removed the recording', async () => {
      const harness = setup();
      const target = await transcribing(harness);
      harness.transcription.transcribe.mockImplementationOnce(async () => {
        harness.recordings.row = null;
        return {
          status: 'ok',
          durationSeconds: 60,
          utterances: [{ speaker: 'A', text: 'Hi.', startMs: 0, endMs: 1 }],
        };
      });
      await expect(
        harness.service.run(harness.context(target.upload_id)),
      ).resolves.toBeUndefined();
      expect(harness.recordings.row).toBeNull();
      expect(harness.files.size).toBe(0);
    });

    it('never puts the file name, the link or the transcript in an error', async () => {
      const harness = setup();
      const target = await transcribing(harness);
      harness.transcription.transcribe.mockRejectedValue(
        new LanguageModelError('invalid_request', 'assemblyai'),
      );
      const error = await harness.service
        .run(harness.context(target.upload_id))
        .catch((caught: Error) => caught);
      expect((error as Error).message).toBe(
        'meeting transcription ended: unreadable',
      );
    });
  });

  describe('reading the state', () => {
    it('settles a transcription whose run died, and deletes its audio', async () => {
      const harness = setup();
      const target = await harness.upload();
      await harness.service.uploaded(
        CHAPTER,
        MEETING,
        SECRETARY,
        target.upload_id,
      );
      harness.runs.getForMember.mockResolvedValue({
        status: 'failed',
        failure_reason: 'attempts_exhausted',
      });
      const state = await harness.service.state(CHAPTER, MEETING, SECRETARY);
      expect(state).toMatchObject({ status: 'failed', failure: 'failed' });
      expect(harness.files.size).toBe(0);
    });

    it('says why the viewer cannot upload yet', async () => {
      const { service } = setup({
        consent: { allowed: false, reason: 'member_declined' },
      });
      await expect(
        service.state(CHAPTER, MEETING, SECRETARY),
      ).resolves.toMatchObject({ status: 'none', blocked: 'consent_required' });
    });
  });

  describe('the sweeps', () => {
    it('fails an upload nobody finished, and leaves a fresh one alone', async () => {
      const harness = setup();
      await harness.upload();
      await expect(harness.service.sweepAudio()).resolves.toBe(0);
      expect(harness.recordings.row!.status).toBe('uploading');

      const later = new Date(Date.now() + ABANDONED_UPLOAD_MS + 60_000);
      await harness.service.sweepAudio(later);
      expect(harness.recordings.row).toMatchObject({
        status: 'failed',
        failure_code: 'upload_incomplete',
        storage_path: null,
      });
      expect(harness.files.size).toBe(0);
    });

    it('settles a transcription whose run died with nobody watching, and deletes its audio', async () => {
      const harness = setup();
      await transcribing(harness);
      harness.runs.getForMember.mockResolvedValue({
        status: 'failed',
        failure_reason: 'attempts_exhausted',
      });
      await harness.service.sweepAudio();
      expect(harness.recordings.row).toMatchObject({
        status: 'failed',
        storage_path: null,
      });
      expect(harness.files.size).toBe(0);
    });

    it('deletes a file a failed delete left behind an ended recording', async () => {
      const harness = setup();
      const target = await transcribing(harness);
      // The transcript was written, and deleting the audio failed.
      Object.assign(harness.recordings.row!, {
        status: 'ready',
        transcript: 'Speaker 1: Call to order.',
      });
      expect(harness.files.has(target.path)).toBe(true);
      await harness.service.sweepAudio();
      expect(harness.files.size).toBe(0);
      expect(harness.recordings.row!.storage_path).toBeNull();
      expect(harness.recordings.row!.status).toBe('ready');
    });

    it('deletes audio no recording names any more, and only that', async () => {
      const harness = setup();
      const target = await harness.upload();
      const orphan = `${CHAPTER}/0a000000-0000-4000-8000-0000000000a9/old.m4a`;
      harness.files.add(orphan);
      await expect(harness.service.sweepAudio()).resolves.toBe(1);
      expect([...harness.files]).toEqual([target.path]);
    });

    it('deletes recordings thirty days after upload', async () => {
      const { service, recordings } = setup();
      await expect(
        service.deleteExpired(new Date('2026-12-15T00:00:00.000Z')),
      ).resolves.toBe(2);
      expect(recordings.deleteCreatedBefore).toHaveBeenCalledWith(
        '2026-11-15T00:00:00.000Z',
      );
    });
  });
});
