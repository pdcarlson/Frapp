import type {
  AskTraceRow,
  AskTraceStepRow,
} from '#domain/entities/ask-trace.entity';
import { SupabaseAskTraceRepository } from './supabase-ask-trace.repository';
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
 * Tenant scope for Ask traces and the thumbs on them (#4902). The A/B twins
 * share an asker, so a read or write that drops the chapter predicate
 * reaches the other chapter's row.
 *
 * Two deletes cross chapters on purpose and are pinned as such below: a No
 * on the AI sheet deletes the person's traces everywhere, and the sweep
 * deletes whatever has run out wherever it is.
 */

const STARTED = '2026-11-13T20:00:00.000Z';
const EXPIRES = '2027-02-11T20:00:00.000Z';

const trace = (over: Partial<AskTraceRow>): AskTraceRow => ({
  id: 'ask-new',
  chapter_id: CHAPTER_A,
  member_id: 'member',
  user_id: USER_A,
  door: 'ask',
  prompt_version: 'ask.answer@v4',
  model: 'model',
  effort: 'default',
  outcome: 'answered',
  limit_kind: null,
  error_kind: null,
  is_follow_up: false,
  is_rephrase: false,
  read_chat: false,
  truncated: false,
  rounds: 1,
  tool_calls: 1,
  tool_failures: 0,
  input_tokens: 10,
  output_tokens: 5,
  cached_input_tokens: 0,
  cost_micro_usd: 7,
  duration_ms: 900,
  sources_read: 1,
  citations_kept: 1,
  citations_dropped: 0,
  left_out_messages: 0,
  proposals: 0,
  started_at: STARTED,
  expires_at: EXPIRES,
  ...over,
});

const step = (over: Partial<AskTraceStepRow>): AskTraceStepRow => ({
  trace_id: 'ask-new',
  seq: 0,
  round: 0,
  kind: 'tool',
  tool: 'search_messages',
  outcome: 'ok',
  duration_ms: 100,
  arg_bytes: 20,
  result_chars: 300,
  result_sources: 2,
  input_tokens: 0,
  output_tokens: 0,
  cached_input_tokens: 0,
  cost_micro_usd: 0,
  ...over,
});

const seed = () => ({
  ai_ask_traces: [
    inA({ ...trace({ id: 'ask-a', user_id: USER_SHARED }) }),
    inB({ ...trace({ id: 'ask-b', user_id: USER_SHARED }) }),
  ],
  ai_ask_trace_steps: [],
  // The table's key is `ask_id`; `id` is here only because the harness tells
  // rows apart by it.
  ai_ask_feedback: [
    inA({
      id: 'thumbs-a',
      ask_id: 'ask',
      user_id: USER_SHARED,
      rating: 'up',
      reason: null,
      created_at: STARTED,
      updated_at: STARTED,
    }),
    inB({
      id: 'thumbs-b',
      ask_id: 'ask',
      user_id: USER_SHARED,
      rating: 'up',
      reason: null,
      created_at: STARTED,
      updated_at: STARTED,
    }),
  ],
});

describe('SupabaseAskTraceRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseAskTraceRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      // Indirectly scoped: a step's chapter is its trace's.
      untenantedTables: ['ai_ask_trace_steps'],
      parentTenant: {
        ai_ask_trace_steps: { column: 'trace_id', table: 'ai_ask_traces' },
      },
    });
    repo = new SupabaseAskTraceRepository(harness.client);
  });

  it('findForAsker reads only the chapter’s trace', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findForAsker('ask-a', CHAPTER_A, USER_SHARED),
    );
    expect(found).toEqual(expect.objectContaining({ id: 'ask-a' }));
    // The same ask named from the other chapter is not found.
    await expect(
      repo.findForAsker('ask-a', CHAPTER_B, USER_SHARED),
    ).resolves.toBeNull();
  });

  it('findForAsker finds nothing for a member who did not ask it', async () => {
    await expect(
      repo.findForAsker('ask-a', CHAPTER_A, USER_B),
    ).resolves.toBeNull();
  });

  it('lastStartedAt reads only the chapter’s traces', async () => {
    const last = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.lastStartedAt(
        CHAPTER_A,
        USER_SHARED,
        new Date('2026-11-13T20:00:30.000Z'),
      ),
    );
    expect(last).toBe(STARTED);
    await expect(
      repo.lastStartedAt(CHAPTER_A, USER_SHARED, new Date(STARTED)),
    ).resolves.toBeNull();
  });

  it('insertTrace writes the trace and its steps under the chapter it was given', async () => {
    await expect(
      repo.insertTrace(trace({}), [step({}), step({ seq: 1 })]),
    ).resolves.toBe(true);
    expect(
      harness
        .rows('ai_ask_traces')
        .filter((row) => row.id === 'ask-new')
        .map((row) => row.chapter_id),
    ).toEqual([CHAPTER_A]);
    expect(
      harness.rows('ai_ask_trace_steps').map((row) => row.trace_id),
    ).toEqual(['ask-new', 'ask-new']);
  });

  it('upsertFeedback writes the thumbs under the chapter it was given', async () => {
    const row = await repo.upsertFeedback({
      askId: 'ask-new',
      chapterId: CHAPTER_A,
      userId: USER_A,
      rating: 'down',
      reason: 'missed',
      now: new Date('2026-11-13T20:05:00.000Z'),
    });
    expect(row).toEqual(
      expect.objectContaining({
        ask_id: 'ask-new',
        chapter_id: CHAPTER_A,
        rating: 'down',
        reason: 'missed',
      }),
    );
  });

  it('deleteFeedback deletes only the chapter’s thumbs', async () => {
    const deleted = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.deleteFeedback('ask', CHAPTER_A, USER_SHARED),
    );
    expect(deleted).toBe(true);
    expect(
      harness.rows('ai_ask_feedback').map((row) => row.chapter_id),
    ).toEqual([CHAPTER_B]);
  });

  it('deleteByUser deletes the person’s traces in every chapter, and nobody else’s', async () => {
    await repo.insertTrace(
      trace({ chapter_id: CHAPTER_B, user_id: USER_B }),
      [],
    );
    await expect(repo.deleteByUser(USER_SHARED)).resolves.toBe(2);
    expect(harness.rows('ai_ask_traces').map((row) => row.user_id)).toEqual([
      USER_B,
    ]);
  });

  it('deleteExpired deletes every trace that has run out, and none that has not', async () => {
    await expect(
      repo.deleteExpired(new Date('2026-12-01T00:00:00.000Z')),
    ).resolves.toBe(0);
    expect(harness.rows('ai_ask_traces')).toHaveLength(2);
    await expect(repo.deleteExpired(new Date(EXPIRES))).resolves.toBe(2);
    expect(harness.rows('ai_ask_traces')).toHaveLength(0);
  });
});
