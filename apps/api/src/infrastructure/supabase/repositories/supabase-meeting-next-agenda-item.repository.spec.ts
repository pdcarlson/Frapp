import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MEETING_NEXT_AGENDA_ITEM_CONFLICT,
  SupabaseMeetingNextAgendaItemRepository,
} from './supabase-meeting-next-agenda-item.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `meeting_next_agenda_items` (#5790), which carries its
 * own `chapter_id`.
 *
 * The A/B twins agree on everything but their chapter and their suggestion
 * (that column is unique across the table): same minutes id, same words.
 * So a read or write that drops the chapter predicate reaches the other
 * chapter's twin.
 */

const MINUTES = '0f000000-0000-4000-8000-000000005790';
const SUGG_A = '0a000000-0000-4000-8000-000000005790';
const SUGG_B = '0b000000-0000-4000-8000-000000005790';

const item = (overrides: Record<string, unknown> = {}) => ({
  meeting_id: MINUTES,
  text: 'Plan backup activities for rush',
  created_by: USER_SHARED,
  created_at: '2026-11-20T18:00:00.000Z',
  ...overrides,
});

const seed = () => ({
  meeting_next_agenda_items: [
    inA({ id: 'next-a', ...item({ ai_suggestion_id: SUGG_A }) }),
    inB({ id: 'next-b', ...item({ ai_suggestion_id: SUGG_B }) }),
  ],
});

describe('SupabaseMeetingNextAgendaItemRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseMeetingNextAgendaItemRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: { meeting_next_agenda_items: ['ai_suggestion_id'] },
    });
    repo = new SupabaseMeetingNextAgendaItemRepository(harness.client);
  });

  it('lists only the chapter’s items for the minutes', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.listForMeetings(CHAPTER_A, [MINUTES]),
    );
    expect(rows.map((row) => row.id)).toEqual(['next-a']);
  });

  it('finds a suggestion’s item only in the chapter', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.findBySuggestion(CHAPTER_A, SUGG_B),
      ),
    ).resolves.toBeNull();
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.findBySuggestion(CHAPTER_B, SUGG_B),
      ),
    ).resolves.toMatchObject({ id: 'next-b' });
  });

  it('deletes only the chapter’s item', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.delete(CHAPTER_A, 'next-b'),
    );
    expect(
      harness.rows('meeting_next_agenda_items').map((row) => row.id),
    ).toEqual(['next-a', 'next-b']);
  });

  it('upserts on the column the migration makes unique', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../../../../../supabase/migrations/20261120222934_meeting_next_agenda_items.sql',
      ),
      'utf8',
    );
    const found = /meeting_next_agenda_items_suggestion_key unique \(([^)]+)\)/
      .exec(sql)?.[1]
      ?.replace(/\s+/g, '');
    expect(found).toBe(MEETING_NEXT_AGENDA_ITEM_CONFLICT);
  });
});
