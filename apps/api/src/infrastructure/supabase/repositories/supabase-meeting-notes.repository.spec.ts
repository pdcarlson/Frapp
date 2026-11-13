import { SupabaseMeetingNotesRepository } from './supabase-meeting-notes.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `meeting_notes` (#4935). A row holds a member's rough
 * notes on a meeting, so a chapter filter that slipped would hand one
 * chapter's notes to another.
 */

// The same meeting and member in both chapters, so only the chapter filter
// separates them (the harness's rule for twins).
const MEETING = '0c000000-0000-4000-8000-0000000000a5';
const MEMBER = '0c000000-0000-4000-8000-0000000000a6';
const AT = '2026-11-10T00:00:00.000Z';

const row = {
  meeting_id: MEETING,
  user_id: MEMBER,
  notes: 'Secret notes',
  added_by: null,
  created_at: AT,
  updated_at: AT,
};

const seed = () => ({
  meeting_notes: [
    inA({ id: 'notes-a', ...row }),
    inB({ id: 'notes-b', ...row }),
  ],
});

describe('SupabaseMeetingNotesRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseMeetingNotesRepository;

  const rowOf = (id: string) =>
    harness.rows('meeting_notes').find((r) => r.id === id);

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseMeetingNotesRepository(harness.client);
  });

  it("findByMeeting reads only the caller chapter's notes", async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByMeeting(CHAPTER_B, MEETING),
    );
    expect(found.map((r) => r.chapter_id)).toEqual([CHAPTER_B]);
  });

  it("find reads only the caller chapter's notes", async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.find(CHAPTER_B, MEETING, MEMBER),
    );
    expect(found?.chapter_id).toBe(CHAPTER_B);
  });

  it("findByUser reads only the caller chapter's notes", async () => {
    const found = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findByUser(CHAPTER_A, MEMBER),
    );
    expect(found.map((r) => r.chapter_id)).toEqual([CHAPTER_A]);
  });

  it("upsert rewrites only the caller chapter's notes", async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.upsert({
        meeting_id: MEETING,
        chapter_id: CHAPTER_B,
        user_id: MEMBER,
        notes: 'new notes',
        added_by: null,
      }),
    );
    expect(rowOf('notes-a')?.notes).toBe('Secret notes');
    expect(rowOf('notes-b')?.notes).toBe('new notes');
  });

  it("delete leaves another chapter's notes alone", async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(CHAPTER_B, MEETING, MEMBER),
    );
    expect(harness.rows('meeting_notes').map((r) => r.id)).toEqual(['notes-a']);
  });
});
