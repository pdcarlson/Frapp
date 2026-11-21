import { SupabaseMeetingDraftRepository } from './supabase-meeting-draft.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `meeting_drafts` (#4312). A row holds an officer's pasted
 * notes, so a chapter filter that slipped would hand one chapter's rough
 * notes to another.
 */

// The same meeting and request ids in both chapters, so only the chapter
// filter separates them (the harness's rule for twins).
const MEETING = '0c000000-0000-4000-8000-000000000095';
const REQUEST = '0c000000-0000-4000-8000-000000000096';
const AT = '2026-11-10T00:00:00.000Z';

const row = {
  meeting_id: MEETING,
  request_id: REQUEST,
  run_id: null,
  requested_by: null,
  notes: 'Secret notes',
  meeting_date: '2026-11-09',
  base_updated_at: AT,
  status: 'drafting',
  failure_code: null,
  result: null,
  requested_at: AT,
  finished_at: null,
};

// The table's key is meeting_id; the harness tracks rows by an id.
const seed = () => ({
  meeting_drafts: [
    inA({ id: 'draft-a', ...row }),
    inB({ id: 'draft-b', ...row }),
  ],
});

describe('SupabaseMeetingDraftRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseMeetingDraftRepository;

  const rowOf = (id: string) =>
    harness.rows('meeting_drafts').find((r) => r.id === id);

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseMeetingDraftRepository(harness.client);
  });

  it("find reads only the caller chapter's draft", async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.find(CHAPTER_B, MEETING),
    );
    expect(found?.chapter_id).toBe(CHAPTER_B);
  });

  it("setRun leaves another chapter's draft alone", async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.setRun(CHAPTER_B, MEETING, REQUEST, 'run-1'),
    );
    expect(rowOf('draft-a')?.run_id).toBeNull();
    expect(rowOf('draft-b')?.run_id).toBe('run-1');
  });

  it("finish leaves another chapter's draft alone", async () => {
    const ended = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.finish(CHAPTER_B, MEETING, REQUEST, ['drafting'], {
        status: 'failed',
        failure_code: 'failed',
      }),
    );
    expect(ended?.chapter_id).toBe(CHAPTER_B);
    expect(rowOf('draft-a')?.status).toBe('drafting');
  });

  it('finish does nothing for a request that was replaced', async () => {
    const ended = await repo.finish(
      CHAPTER_B,
      MEETING,
      '0c000000-0000-4000-8000-000000000097',
      ['drafting'],
      { status: 'ready', result: {} },
    );
    expect(ended).toBeNull();
    expect(rowOf('draft-b')?.status).toBe('drafting');
  });

  it("delete leaves another chapter's draft alone", async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(CHAPTER_B, MEETING),
    );
    expect(harness.rows('meeting_drafts').map((r) => r.id)).toEqual([
      'draft-a',
    ]);
  });
});
