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
const SUGG_WAIT_A = '0a000000-0000-4000-8000-000000005791';
const SUGG_WAIT_B = '0b000000-0000-4000-8000-000000005791';
const EVENT = '0e000000-0000-4000-8000-000000005790';
const NOW = '2026-11-20T18:00:00.000Z';
const LATER = '2026-12-20T18:00:00.000Z';

const item = (overrides: Record<string, unknown> = {}) => ({
  meeting_id: MINUTES,
  source_event_id: null,
  text: 'Plan backup activities for rush',
  state: 'offered',
  event_id: null,
  agenda_item_id: null,
  expires_at: null,
  suggestion_payload: {},
  suggestion_quote: null,
  created_by: USER_SHARED,
  created_at: '2026-11-20T18:00:00.000Z',
  ...overrides,
});

const seed = () => ({
  meeting_next_agenda_items: [
    inA({ id: 'next-a', ...item({ ai_suggestion_id: SUGG_A }) }),
    inB({ id: 'next-b', ...item({ ai_suggestion_id: SUGG_B }) }),
    inA({
      id: 'wait-a',
      ...item({
        ai_suggestion_id: SUGG_WAIT_A,
        state: 'waiting',
        expires_at: LATER,
      }),
    }),
    inB({
      id: 'wait-b',
      ...item({
        ai_suggestion_id: SUGG_WAIT_B,
        state: 'waiting',
        expires_at: LATER,
      }),
    }),
  ],
});

describe('SupabaseMeetingNextAgendaItemRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseMeetingNextAgendaItemRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: {
        meeting_next_agenda_items: ['ai_suggestion_id', 'agenda_item_id'],
      },
    });
    repo = new SupabaseMeetingNextAgendaItemRepository(harness.client);
  });

  it('lists only the chapter’s offered items for the minutes', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.listOffered(CHAPTER_A, [MINUTES]),
    );
    expect(rows.map((row) => row.id)).toEqual(['next-a']);
  });

  it('lists only the chapter’s waiting items', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.listWaiting(CHAPTER_A, NOW),
    );
    expect(rows.map((row) => row.id)).toEqual(['wait-a']);
  });

  it('moves only the chapter’s waiting item', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.moveWaiting(CHAPTER_A, 'wait-b', {
          state: 'placed',
          event_id: EVENT,
          agenda_item_id: 'n-wait-b',
        }),
      ),
    ).resolves.toBe(false);
    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.moveWaiting(CHAPTER_A, 'wait-a', {
          state: 'placed',
          event_id: EVENT,
          agenda_item_id: 'n-wait-a',
        }),
      ),
    ).resolves.toBe(true);
    const rows = harness.rows('meeting_next_agenda_items');
    expect(rows.find((row) => row.id === 'wait-a')).toMatchObject({
      state: 'placed',
      expires_at: null,
    });
    expect(rows.find((row) => row.id === 'wait-b')?.state).toBe('waiting');
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
    ).toContain('next-b');
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
