import { SupabaseChatMessageReportRepository } from './supabase-chat-message-report.repository';
import type { FrappSupabaseClient } from '../database.types';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  USER_A,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chat_message_reports` (#2257).
 *
 * The table carries its own `chapter_id`, so the ordinary predicate check
 * applies — and it matters more here than on most tables, because the two
 * officer routes are reachable by any `channels:manage` holder and a report id
 * is a bare UUID. Without the chapter predicate on the resolve path, an officer
 * in one chapter could close another chapter's report.
 *
 * The seed pairs a chapter-A row with a chapter-B row that agrees on
 * *everything* except `id` and `chapter_id` — same reporter, same message, same
 * timestamps — so no predicate other than the tenant one can narrow the result.
 * Both statuses are seeded so the queue's status filter has something real to
 * exclude.
 */

const MESSAGE_ONE = '0c000000-0000-4000-8000-000000000201';
const MESSAGE_TWO = '0c000000-0000-4000-8000-000000000202';

const REPORT_A_OPEN = '0a000000-0000-4000-8000-000000000210';
const REPORT_B_OPEN = '0b000000-0000-4000-8000-000000000210';
const REPORT_A_REVIEWED = '0a000000-0000-4000-8000-000000000211';
const REPORT_B_REVIEWED = '0b000000-0000-4000-8000-000000000211';

const openRow = () => ({
  reporter_user_id: USER_SHARED,
  message_id: MESSAGE_ONE,
  reported_content: 'the reported message',
  reported_sender_id: USER_A,
  reported_author_name: null,
  reason: 'harassment',
  details: null,
  status: 'open',
  created_at: '2026-02-02T00:00:00.000Z',
  resolved_at: null,
  resolved_by: null,
});

const reviewedRow = () => ({
  reporter_user_id: USER_SHARED,
  message_id: MESSAGE_TWO,
  reported_content: 'an older reported message',
  reported_sender_id: USER_A,
  reported_author_name: null,
  reason: 'spam',
  details: null,
  status: 'reviewed',
  created_at: '2026-02-01T00:00:00.000Z',
  resolved_at: '2026-02-01T06:00:00.000Z',
  resolved_by: USER_SHARED,
});

const seed = () => ({
  chat_message_reports: [
    inA({ id: REPORT_A_OPEN, ...openRow() }),
    inA({ id: REPORT_A_REVIEWED, ...reviewedRow() }),
    inB({ id: REPORT_B_OPEN, ...openRow() }),
    inB({ id: REPORT_B_REVIEWED, ...reviewedRow() }),
  ],
});

describe('SupabaseChatMessageReportRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChatMessageReportRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseChatMessageReportRepository(harness.client);
  });

  it('findByChapterAndStatus does not return the other chapter queue', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findByChapterAndStatus(CHAPTER_A, 'open'),
    );

    expect(rows.map((r) => r.id)).toEqual([REPORT_A_OPEN]);
  });

  it('findByChapterAndStatus filters to the requested status', async () => {
    const rows = await repo.findByChapterAndStatus(CHAPTER_A, 'reviewed');

    expect(rows.map((r) => r.id)).toEqual([REPORT_A_REVIEWED]);
  });

  it('never returns reporter_user_id to the caller', async () => {
    // The disclosure boundary, as a test rather than a comment. Nothing in this
    // app serializes to the declared DTO, so the repository's strip is the only
    // thing keeping the reporter off the wire — and the officer queue is read by
    // `channels:manage` holders, who can themselves be the reported member.
    const rows = await repo.findByChapterAndStatus(CHAPTER_A, 'open');

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveProperty('reporter_user_id');
    }
  });

  it('resolve will not reach a report in another chapter', async () => {
    const result = await repo.resolve(
      REPORT_B_OPEN,
      CHAPTER_A,
      'dismissed',
      USER_SHARED,
      '2026-02-03T00:00:00.000Z',
    );

    expect(result).toBeNull();
    const untouched = harness
      .rows('chat_message_reports')
      .find((r) => r.id === REPORT_B_OPEN);
    expect(untouched?.status).toBe('open');
  });

  it('resolve stamps status, resolved_at and resolved_by inside the chapter', async () => {
    const resolved = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.resolve(
        REPORT_A_OPEN,
        CHAPTER_A,
        'actioned',
        USER_A,
        '2026-02-03T00:00:00.000Z',
      ),
    );

    expect(resolved).toMatchObject({
      id: REPORT_A_OPEN,
      status: 'actioned',
      resolved_at: '2026-02-03T00:00:00.000Z',
      resolved_by: USER_A,
    });
    expect(resolved).not.toHaveProperty('reporter_user_id');
  });

  it('create stamps the chapter it is given and never writes into another', async () => {
    const created = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.create({
        chapter_id: CHAPTER_B,
        message_id: '0c000000-0000-4000-8000-000000000203',
        reporter_user_id: USER_A,
        reported_content: 'something new',
        reported_sender_id: USER_SHARED,
        reported_author_name: null,
        reason: 'other',
        details: null,
      }),
    );

    expect(created.chapter_id).toBe(CHAPTER_B);
    expect(created).not.toHaveProperty('reporter_user_id');
  });

  it('create snapshots the evidence rather than a reference to the message', async () => {
    await repo.create({
      chapter_id: CHAPTER_A,
      message_id: '0c000000-0000-4000-8000-000000000204',
      reporter_user_id: USER_A,
      reported_content: 'go away',
      reported_sender_id: null,
      reported_author_name: 'imported-handle',
      reason: 'harassment',
      details: 'third time today',
    });

    const written = harness
      .rows('chat_message_reports')
      .find((r) => r.message_id === '0c000000-0000-4000-8000-000000000204');
    expect(written).toMatchObject({
      reported_content: 'go away',
      // Null sender + a name is the Discord-imported shape. Both halves are
      // written, so the officer still has an author once the import purge
      // hard-deletes the message and `message_id` goes NULL.
      reported_sender_id: null,
      reported_author_name: 'imported-handle',
      details: 'third time today',
    });
  });
});

/**
 * The idempotency branch, driven by a hand-rolled double rather than the tenant
 * harness.
 *
 * The harness models PostgREST's *filtering*, not Postgres's constraints: its
 * `insert` appends unconditionally, so it can never raise the `23505` this
 * branch exists to translate. Everything the harness *can* prove about this
 * repository is proven above, under `createTenantHarness`; this block covers the
 * one path it structurally cannot reach.
 *
 * What is being pinned is that a duplicate OPEN report is not a 500. The index
 * is partial (`where status = 'open'`) and PostgREST will not use a partial
 * unique index as an `ON CONFLICT` arbiter, so the repository cannot upsert its
 * way out — it inserts, catches the unique violation, and re-selects.
 */
describe('SupabaseChatMessageReportRepository — duplicate open report', () => {
  const existingRow = {
    id: REPORT_A_OPEN,
    chapter_id: CHAPTER_A,
    message_id: MESSAGE_ONE,
    reporter_user_id: USER_SHARED,
    reported_content: 'the reported message',
    reported_sender_id: USER_A,
    reported_author_name: null,
    reason: 'harassment',
    details: null,
    status: 'open',
    created_at: '2026-02-02T00:00:00.000Z',
    resolved_at: null,
    resolved_by: null,
  };

  const input = {
    chapter_id: CHAPTER_A,
    message_id: MESSAGE_ONE,
    reporter_user_id: USER_SHARED,
    reported_content: 'the reported message',
    reported_sender_id: USER_A,
    reported_author_name: null,
    reason: 'harassment' as const,
    details: null,
  };

  /**
   * Minimal PostgREST double: the first `.insert(...).select().single()` answers
   * with `error`, and the following `.select()…maybeSingle()` answers with
   * `reselect`. `filters` records the re-select's predicates so the test can
   * assert the read-back is scoped to the caller's own tuple.
   */
  function createClient(options: {
    insertError: unknown;
    reselect: Record<string, unknown> | null;
  }) {
    const filters: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {
      insert: jest.fn(() => builder),
      select: jest.fn(() => builder),
      eq: jest.fn((column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      }),
      single: jest.fn(() =>
        Promise.resolve({ data: null, error: options.insertError }),
      ),
      maybeSingle: jest.fn(() =>
        Promise.resolve({ data: options.reselect, error: null }),
      ),
    };
    const from = jest.fn(() => builder);
    const client = { from } as unknown as FrappSupabaseClient;
    // `from` is returned, not just wired: without it nothing in this block
    // pinned the table name, so a repository that inserted into — and
    // re-selected from — some other table passed every assertion here.
    return { client, filters, from };
  }

  it('returns the existing open report instead of surfacing 23505', async () => {
    const { client, filters, from } = createClient({
      insertError: { code: '23505', message: 'duplicate key value' },
      reselect: existingRow,
    });
    const repo = new SupabaseChatMessageReportRepository(client);

    const result = await repo.create(input);

    expect(from).toHaveBeenCalledWith('chat_message_reports');
    expect(result.id).toBe(REPORT_A_OPEN);
    expect(result).not.toHaveProperty('reporter_user_id');
    // Scoped to the caller's own tuple, so the read-back cannot hand over
    // somebody else's report on the same message.
    expect(filters).toEqual([
      ['chapter_id', CHAPTER_A],
      ['reporter_user_id', USER_SHARED],
      ['message_id', MESSAGE_ONE],
      ['status', 'open'],
    ]);
  });

  it('rethrows when the open report vanished between the insert and the re-select', async () => {
    // Resolved by an officer in the gap. Inventing a row here would be a lie
    // about what is in the queue; the honest answer is the original error, and
    // a retry then succeeds.
    const { client } = createClient({
      insertError: { code: '23505', message: 'duplicate key value' },
      reselect: null,
    });
    const repo = new SupabaseChatMessageReportRepository(client);

    await expect(repo.create(input)).rejects.toMatchObject({ code: '23505' });
  });

  it('rethrows an error that is not a unique violation', async () => {
    const { client } = createClient({
      insertError: { code: '23503', message: 'foreign key violation' },
      reselect: existingRow,
    });
    const repo = new SupabaseChatMessageReportRepository(client);

    await expect(repo.create(input)).rejects.toMatchObject({ code: '23503' });
  });
});
