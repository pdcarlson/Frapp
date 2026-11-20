import { SupabaseMeetingNoMinutesRepository } from './supabase-meeting-no-minutes.repository';
import {
  CHAPTER_A,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `meeting_no_minutes` (Paul, 2026-11-20): one mark per
 * event, keyed on `event_id`, with its own `chapter_id`. Every read and the
 * undo filter on the chapter; a mark is written under the caller's chapter.
 * The rows carry an `id` only so the harness can follow them, and both
 * chapters' twins name the same event, so only the chapter filter tells them
 * apart.
 */

const MARK_A = '0a000000-0000-4000-8000-000000000380';
const MARK_B = '0b000000-0000-4000-8000-000000000380';
const EVENT = '0c000000-0000-4000-8000-000000000380';
const EVENT_NEW = '0c000000-0000-4000-8000-000000000381';

const row = (id: string) => ({
  id,
  event_id: EVENT,
  marked_by: USER_SHARED,
  created_at: '2026-11-20T00:00:00.000Z',
});

describe('SupabaseMeetingNoMinutesRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseMeetingNoMinutesRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: {
        meeting_no_minutes: [inA(row(MARK_A)), inB(row(MARK_B))],
      },
      collisionExempt: {
        meeting_no_minutes: ['marked_by', 'created_at'],
      },
    });
    repo = new SupabaseMeetingNoMinutesRepository(harness.client);
  });

  it('lists only this chapter’s marks', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.list(CHAPTER_A),
    );
    expect(rows.map((r) => r.chapter_id)).toEqual([CHAPTER_A]);
  });

  it('writes a mark under the caller’s chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.mark(CHAPTER_A, EVENT_NEW, USER_SHARED),
    );
  });

  it('takes back a mark only in this chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.unmark(CHAPTER_A, EVENT),
    );
    expect(harness.rows('meeting_no_minutes').map((r) => r.id)).toEqual([
      MARK_B,
    ]);
  });
});
