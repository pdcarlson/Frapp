import { SupabaseAiSuggestionRepository } from './supabase-ai-suggestion.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_A,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `ai_suggestions` (#4309).
 *
 * The A/B twins agree on everything but `id` and `chapter_id`: same batch,
 * same source, same text, same status. A query that dropped its chapter
 * filter would therefore read, decide or link the other chapter's twin.
 * `batch_id` + `ordinal` is unique in the real table, so the twins differ on
 * `batch_id`, which is exempt from the collision check.
 */

const SUG_A = '0a000000-0000-4000-8000-000000000301';
const SUG_B = '0b000000-0000-4000-8000-000000000301';
const SUG_A_DONE = '0a000000-0000-4000-8000-000000000302';
const SUG_B_DONE = '0b000000-0000-4000-8000-000000000302';
const MEETING = '0c000000-0000-4000-8000-000000000303';
const TASK = '0c000000-0000-4000-8000-000000000304';
const BATCH_A = '0a000000-0000-4000-8000-000000000305';
const BATCH_B = '0b000000-0000-4000-8000-000000000305';

const NOW = '2026-11-12T12:00:00.000Z';

const waiting = (batch: string) => ({
  batch_id: batch,
  ordinal: 0,
  run_id: null,
  requested_for: USER_A,
  kind: 'task',
  source_type: 'meeting',
  source_id: MEETING,
  payload: { title: 'Book the venue' },
  quote: 'book the venue',
  quote_author_id: null,
  required_permission: 'tasks:manage',
  status: 'pending',
  edited: false,
  decided_by: null,
  decided_at: null,
  result_id: null,
  notified_at: null,
  expires_at: '2026-11-26T12:00:00.000Z',
  created_at: '2026-11-12T11:00:00.000Z',
});

const lapsed = (batch: string) => ({
  ...waiting(batch),
  ordinal: 1,
  expires_at: '2026-11-12T11:30:00.000Z',
});

const seed = () => ({
  ai_suggestions: [
    inA({ id: SUG_A, ...waiting(BATCH_A) }),
    inB({ id: SUG_B, ...waiting(BATCH_B) }),
    inA({ id: SUG_A_DONE, ...lapsed(BATCH_A) }),
    inB({ id: SUG_B_DONE, ...lapsed(BATCH_B) }),
  ],
});

describe('SupabaseAiSuggestionRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseAiSuggestionRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: { ai_suggestions: ['batch_id'] },
    });
    repo = new SupabaseAiSuggestionRepository(harness.client);
  });

  it('findById stays in the chapter', async () => {
    const row = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findById(CHAPTER_A, SUG_A),
    );
    expect(row?.id).toBe(SUG_A);
    expect(await repo.findById(CHAPTER_A, SUG_B)).toBeNull();
  });

  it('listPending stays in the chapter and leaves out what has lapsed', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.listPending(CHAPTER_A, {
        permissions: ['tasks:manage'],
        source: { type: 'meeting', id: MEETING },
        now: NOW,
        offset: 0,
        limit: 10,
      }),
    );
    expect(rows.map((row) => row.id)).toEqual([SUG_A]);
  });

  it('listPending asks nothing for a caller who holds none of the permissions', async () => {
    const rows = await repo.listPending(CHAPTER_A, {
      permissions: [],
      now: NOW,
      offset: 0,
      limit: 10,
    });
    expect(rows).toEqual([]);
    expect(harness.ops).toHaveLength(0);
  });

  it('claim dismisses only this chapter’s row and empties its text', async () => {
    const claimed = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.claim(CHAPTER_A, SUG_A, {
        status: 'dismissed',
        decidedBy: USER_A,
        edited: false,
        now: NOW,
      }),
    );
    expect(claimed).toMatchObject({
      status: 'dismissed',
      payload: {},
      quote: null,
    });
    const twin = harness.rows('ai_suggestions').find((r) => r.id === SUG_B);
    expect(twin).toMatchObject({ status: 'pending', quote: 'book the venue' });
  });

  it('claim finds nothing to decide once it has lapsed', async () => {
    const claimed = await repo.claim(CHAPTER_A, SUG_A_DONE, {
      status: 'dismissed',
      decidedBy: USER_A,
      edited: false,
      now: NOW,
    });
    expect(claimed).toBeNull();
  });

  it('an accept holds its text until finishAccept, which stays in the chapter', async () => {
    const held = await repo.claim(CHAPTER_A, SUG_A, {
      status: 'accepting',
      decidedBy: USER_A,
      edited: false,
      now: NOW,
    });
    expect(held).toMatchObject({
      status: 'accepting',
      quote: 'book the venue',
    });
    const finished = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.finishAccept(CHAPTER_A, SUG_A, TASK),
    );
    expect(finished).toMatchObject({
      status: 'accepted',
      result_id: TASK,
      payload: {},
      quote: null,
    });
    expect(await repo.finishAccept(CHAPTER_B, SUG_A, TASK)).toBeNull();
    const twin = harness.rows('ai_suggestions').find((r) => r.id === SUG_B);
    expect(twin?.result_id).toBeNull();
  });

  it('release puts an accept back to waiting, in this chapter only', async () => {
    await repo.claim(CHAPTER_A, SUG_A, {
      status: 'accepting',
      decidedBy: USER_A,
      edited: true,
      now: NOW,
    });
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.release(CHAPTER_A, SUG_A),
    );
    const row = harness.rows('ai_suggestions').find((r) => r.id === SUG_A);
    expect(row).toMatchObject({
      status: 'pending',
      decided_by: null,
      decided_at: null,
      edited: false,
      quote: 'book the venue',
    });
  });

  it('listUnnotified and markNotified stay in the chapter', async () => {
    const owed = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.listUnnotified(CHAPTER_A, BATCH_A),
    );
    expect(owed.map((row) => row.id).sort()).toEqual([SUG_A, SUG_A_DONE]);
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.markNotified(CHAPTER_A, [SUG_A, SUG_B], NOW),
    );
    const rows = harness.rows('ai_suggestions');
    expect(rows.find((r) => r.id === SUG_A)?.notified_at).toBe(NOW);
    expect(rows.find((r) => r.id === SUG_B)?.notified_at).toBeNull();
  });

  it('releaseStale crosses chapters by design and leaves a recent accept alone', async () => {
    // The hourly sweep serves the whole database.
    for (const [chapter, id] of [
      [CHAPTER_A, SUG_A],
      [CHAPTER_B, SUG_B],
    ] as const) {
      await repo.claim(chapter, id, {
        status: 'accepting',
        decidedBy: USER_A,
        edited: false,
        now: NOW,
      });
    }
    expect(await repo.releaseStale(NOW)).toBe(0);
    expect(await repo.releaseStale('2026-11-12T12:10:00.000Z')).toBe(2);
  });

  it('insertBatch writes the chapter it is given', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.insertBatch(CHAPTER_A, [
        {
          batch_id: '0a000000-0000-4000-8000-000000000399',
          ordinal: 0,
          run_id: null,
          requested_for: USER_A,
          kind: 'task',
          source_type: 'meeting',
          source_id: MEETING,
          payload: { title: 'Order shirts' },
          quote: null,
          quote_author_id: null,
          required_permission: 'tasks:manage',
          expires_at: '2026-11-26T12:00:00.000Z',
        },
      ]),
    );
    const written = harness
      .rows('ai_suggestions')
      .filter((r) => r.batch_id === '0a000000-0000-4000-8000-000000000399');
    expect(written.map((r) => r.chapter_id)).toEqual([CHAPTER_A]);
  });

  it('expireDue crosses chapters by design and empties the text it expires', async () => {
    // The hourly sweep serves the whole database.
    const expired = await repo.expireDue(NOW);
    expect(expired.map((row) => row.chapter_id).sort()).toEqual(
      [CHAPTER_A, CHAPTER_B].sort(),
    );
    const rows = harness
      .rows('ai_suggestions')
      .filter((r) => r.status === 'expired');
    expect(rows.every((r) => r.quote === null)).toBe(true);
  });
});
