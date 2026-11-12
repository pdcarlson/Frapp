import { SupabaseMeetingRepository } from './supabase-meeting.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `meetings` and `meeting_templates` (#4312). Minutes are
 * read by a meeting's audience, so a chapter filter that slipped would hand
 * one chapter's Exec minutes to another.
 */

const MEETING_A = '0a000000-0000-4000-8000-000000000090';
const MEETING_B = '0b000000-0000-4000-8000-000000000090';
// The same event id in both chapters, so only the chapter filter separates
// them (the harness's rule for twins).
const EVENT = '0c000000-0000-4000-8000-000000000091';
const UPDATED = '2026-11-10T00:00:00.000Z';

const row = {
  event_name: 'Chapter meeting',
  event_start_time: '2026-11-09T00:00:00.000Z',
  meeting_type: 'chapter',
  other_label: null,
  status: 'draft',
  content: { summary: 'Secret' },
  created_by: null,
  updated_by: null,
  posted_by: null,
  posted_at: null,
  created_at: UPDATED,
  updated_at: UPDATED,
};

const seed = () => ({
  meetings: [
    inA({ id: MEETING_A, event_id: EVENT, ...row }),
    inB({ id: MEETING_B, event_id: EVENT, ...row }),
  ],
  // The table's key is chapter_id; the harness tracks rows by an id.
  meeting_templates: [
    inA({ id: 'tpl-a', sections: ['summary'], updated_by: null, updated_at: UPDATED }),
    inB({ id: 'tpl-b', sections: ['summary'], updated_by: null, updated_at: UPDATED }),
  ],
});

describe('SupabaseMeetingRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseMeetingRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseMeetingRepository(harness.client);
  });

  it("findByChapter returns only the caller chapter's minutes", async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B, 10),
    );
    expect(rows.map((r) => r.id)).toEqual([MEETING_B]);
  });

  it("findById misses another chapter's minutes", async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(CHAPTER_B, MEETING_A),
    );
    expect(found).toBeNull();
  });

  it("findByEvent returns only the caller chapter's minutes", async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByEvent(CHAPTER_B, EVENT),
    );
    expect(found?.id).toBe(MEETING_B);
  });

  it("update leaves another chapter's minutes alone", async () => {
    const updated = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.update(CHAPTER_B, MEETING_A, UPDATED, { status: 'posted' }),
    );
    expect(updated).toBeNull();
    expect(
      harness.rows('meetings').find((r) => r.id === MEETING_A)?.status,
    ).toBe('draft');
  });

  it("delete leaves another chapter's minutes alone", async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(CHAPTER_B, MEETING_A),
    );
    expect(harness.rows('meetings').map((r) => r.id)).toContain(MEETING_A);
  });

  it("findTemplate reads only the caller chapter's template", async () => {
    const found = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findTemplate(CHAPTER_B),
    );
    expect(found?.chapter_id).toBe(CHAPTER_B);
  });
});
