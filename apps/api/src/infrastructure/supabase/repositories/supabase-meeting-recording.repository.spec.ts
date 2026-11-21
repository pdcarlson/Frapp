import { SupabaseMeetingRecordingRepository } from './supabase-meeting-recording.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `meeting_recordings` (#712). A row holds a meeting's
 * transcript and names its audio, so a chapter filter that slipped would hand
 * one chapter's meeting to another.
 */

// The same meeting and upload ids in both chapters, so only the chapter
// filter separates them (the harness's rule for twins).
const MEETING = '0c000000-0000-4000-8000-000000000195';
const UPLOAD = '0c000000-0000-4000-8000-000000000196';
const AT = '2026-11-10T00:00:00.000Z';
const PATH = 'shared/recording.m4a';

const row = {
  meeting_id: MEETING,
  upload_id: UPLOAD,
  uploaded_by: null,
  file_name: 'chapter.m4a',
  mime_type: 'audio/mp4',
  size_bytes: 1000,
  duration_seconds: 600,
  notice_confirmed_at: AT,
  attendees_notified_at: null,
  status: 'transcribing',
  failure_code: null,
  run_id: null,
  provider_job_id: null,
  transcript: null,
  speaker_count: null,
  created_at: AT,
  finished_at: null,
  storage_path: PATH,
};

// The table's key is meeting_id; the harness tracks rows by an id.
const seed = () => ({
  meeting_recordings: [
    inA({ id: 'rec-a', ...row }),
    inB({ id: 'rec-b', ...row }),
  ],
});

describe('SupabaseMeetingRecordingRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseMeetingRecordingRepository;

  const rowOf = (id: string) =>
    harness.rows('meeting_recordings').find((r) => r.id === id);

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseMeetingRecordingRepository(harness.client);
  });

  it("find reads only the caller chapter's recording", async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.find(CHAPTER_B, MEETING),
    );
    expect(found?.chapter_id).toBe(CHAPTER_B);
  });

  it("step leaves another chapter's recording alone", async () => {
    const moved = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.step(CHAPTER_B, MEETING, UPLOAD, ['transcribing'], {
        status: 'failed',
        failure_code: 'failed',
        storage_path: null,
      }),
    );
    expect(moved?.chapter_id).toBe(CHAPTER_B);
    expect(rowOf('rec-a')?.status).toBe('transcribing');
    expect(rowOf('rec-a')?.storage_path).toBe(PATH);
  });

  it('step does nothing for an upload that was replaced, or has moved on', async () => {
    await expect(
      repo.step(
        CHAPTER_B,
        MEETING,
        '0c000000-0000-4000-8000-000000000197',
        ['transcribing'],
        { status: 'ready', transcript: 'Speaker 1: Hello.' },
      ),
    ).resolves.toBeNull();
    await expect(
      repo.step(CHAPTER_B, MEETING, UPLOAD, ['uploading'], {
        status: 'transcribing',
      }),
    ).resolves.toBeNull();
    expect(rowOf('rec-b')?.transcript).toBeNull();
  });

  it('claims the attendee notice once, in one chapter', async () => {
    const first = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.claimAttendeeNotice(CHAPTER_B, MEETING, AT),
    );
    expect(first).toBe(true);
    await expect(
      repo.claimAttendeeNotice(CHAPTER_B, MEETING, AT),
    ).resolves.toBe(false);
    expect(rowOf('rec-a')?.attendees_notified_at).toBeNull();
  });

  it("delete leaves another chapter's recording alone", async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(CHAPTER_B, MEETING),
    );
    expect(harness.rows('meeting_recordings').map((r) => r.id)).toEqual([
      'rec-a',
    ]);
  });

  // The sweeps serve every chapter on purpose: they take no chapter.
  it('the audio sweep reads every row that still names a file', async () => {
    const rows = await repo.listWithAudio(10);
    expect(rows.map((r) => r.chapter_id).sort()).toEqual(
      [CHAPTER_A, CHAPTER_B].sort(),
    );
  });

  it('answers which paths a row still names', async () => {
    await expect(
      repo.pathsStillNamed([PATH, 'shared/gone.m4a']),
    ).resolves.toEqual([PATH, PATH]);
    await expect(repo.pathsStillNamed([])).resolves.toEqual([]);
  });

  it('the retention sweep deletes by age, in every chapter', async () => {
    await expect(
      repo.deleteCreatedBefore('2026-11-11T00:00:00.000Z'),
    ).resolves.toBe(2);
    expect(harness.rows('meeting_recordings')).toEqual([]);
  });
});
