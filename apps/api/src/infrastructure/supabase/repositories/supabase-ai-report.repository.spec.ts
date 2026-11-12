import { SupabaseAiReportRepository } from './supabase-ai-report.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_A,
  USER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for reports of AI-made text (#4315). The insert is keyed by
 * chapter. Two deletes cross chapters on purpose and are pinned as such: a
 * No on the AI sheet deletes every report quoting the person, wherever it
 * is, and the sweep deletes whatever has run out wherever it is.
 */

const CREATED = '2026-11-12T10:00:00.000Z';
const EXPIRES = '2026-12-12T10:00:00.000Z';

const report = (id: string, quoted: string[]) => ({
  id,
  reported_by: USER_A,
  subject_type: 'ask_answer',
  subject_id: '00000000-0000-4000-8000-000000000001',
  reason: 'wrong',
  note: null,
  sealed: 'v1.k.n.t.c',
  quoted_user_ids: quoted,
  model: 'model',
  prompt_version: 'ask@v1',
  created_at: CREATED,
  expires_at: EXPIRES,
});

const seed = () => ({
  ai_reports: [
    inA(report('report-a', [USER_SHARED])),
    inB(report('report-b', [USER_SHARED])),
  ],
});

describe('SupabaseAiReportRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseAiReportRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseAiReportRepository(harness.client);
  });

  it('insert writes the report under the chapter it was given', async () => {
    await expect(
      repo.insert({
        chapterId: CHAPTER_A,
        reportedBy: USER_B,
        subjectType: 'meeting_draft',
        subjectId: '00000000-0000-4000-8000-000000000002',
        reason: 'harmful',
        note: 'It invented a vote.',
        sealed: 'v1.k.n.t.c2',
        quotedUserIds: [USER_A],
        model: null,
        promptVersion: null,
        createdAt: new Date(CREATED),
        expiresAt: new Date(EXPIRES),
      }),
    ).resolves.toBe('kept');
    expect(
      harness.rows('ai_reports').filter((row) => row.reported_by === USER_B),
    ).toEqual([
      expect.objectContaining({
        chapter_id: CHAPTER_A,
        sealed: 'v1.k.n.t.c2',
        quoted_user_ids: [USER_A],
      }),
    ]);
  });

  it('deleteQuoting deletes every report quoting the person in every chapter, and no other', async () => {
    await repo.insert({
      chapterId: CHAPTER_B,
      reportedBy: USER_B,
      subjectType: 'ai_suggestion',
      subjectId: '00000000-0000-4000-8000-000000000003',
      reason: 'other',
      note: null,
      sealed: null,
      quotedUserIds: [USER_B],
      model: null,
      promptVersion: null,
      createdAt: new Date(CREATED),
      expiresAt: new Date(EXPIRES),
    });
    await expect(repo.deleteQuoting(USER_SHARED)).resolves.toBe(2);
    expect(
      harness.rows('ai_reports').map((row) => row.quoted_user_ids),
    ).toEqual([[USER_B]]);
  });

  it('deleteExpired deletes every report past its date, and none before', async () => {
    await expect(
      repo.deleteExpired(new Date('2026-12-01T00:00:00.000Z')),
    ).resolves.toBe(0);
    expect(harness.rows('ai_reports')).toHaveLength(2);
    await expect(repo.deleteExpired(new Date(EXPIRES))).resolves.toBe(2);
    expect(harness.rows('ai_reports')).toHaveLength(0);
  });
});
