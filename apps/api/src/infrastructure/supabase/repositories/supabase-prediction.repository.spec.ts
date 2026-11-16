import { SupabasePredictionRepository } from './supabase-prediction.repository';
import { PredictionRefusal } from '#domain/repositories/prediction.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';
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
 * Tenant scope for predictions (#5133). The A/B twins agree on everything but
 * their chapter, so a read or write that drops the chapter predicate reaches
 * the other chapter's twin. The payout sweep's read is cross-chapter on
 * purpose and pinned as its own rule.
 *
 * Stake, pay and void are database functions, whose SQL the PGlite gate runs
 * (`scripts/pglite/tiers/predictions.mjs`); here only their arguments and
 * the mapping of their refusals are seen.
 */

const MARKET = 'market-1';
const CHANNEL = 'channel-1';
const KEY = '0c000000-0000-4000-8000-000000005133';

const market = (overrides: Record<string, unknown> = {}) => ({
  id: MARKET,
  channel_id: CHANNEL,
  message_id: null,
  created_by: USER_SHARED,
  settler_id: USER_SHARED,
  named_member_id: null,
  question: 'Q?',
  settle_rule: 'Rule',
  closes_at: '2026-11-20T18:00:00.000Z',
  status: 'settled',
  winning_answer_id: 'answer-yes',
  known_at: null,
  settle_note: null,
  settled_by: USER_SHARED,
  settled_at: '2026-11-16T10:00:00.000Z',
  question_window_ends_at: '2026-11-17T10:00:00.000Z',
  payout_round: 0,
  paid_at: null,
  voided_by: null,
  voided_at: null,
  client_message_id: KEY,
  created_at: '2026-11-16T09:00:00.000Z',
  updated_at: '2026-11-16T10:00:00.000Z',
  ...overrides,
});

/**
 * Row ids are unique per table, as in the database, so each twin carries its
 * chapter's suffix; every other column agrees, the market and answer ids it
 * points at excepted.
 */
const twins = (
  base: Record<string, unknown>,
  refs: (suffix: string) => Record<string, unknown>,
) => [
  inA({ ...base, ...refs('a'), id: `${String(base.id)}-a` }),
  inB({ ...base, ...refs('b'), id: `${String(base.id)}-b` }),
];

const seed = () => ({
  prediction_markets: twins(market(), (x) => ({
    winning_answer_id: `answer-yes-${x}`,
  })),
  prediction_answers: twins(
    { id: 'answer-yes', label: 'Yes', position: 0 },
    (x) => ({ market_id: `${MARKET}-${x}` }),
  ),
  prediction_stakes: twins(
    {
      id: 'stake-1',
      user_id: USER_SHARED,
      amount: 5,
      point_transaction_id: 'txn-1',
      client_message_id: KEY,
      created_at: '2026-11-16T09:30:00.000Z',
    },
    (x) => ({ market_id: `${MARKET}-${x}`, answer_id: `answer-yes-${x}` }),
  ),
  prediction_questions: twins(
    {
      id: 'question-1',
      user_id: USER_SHARED,
      note: 'Wrong',
      resolved_at: null,
      created_at: '2026-11-16T11:00:00.000Z',
    },
    (x) => ({ market_id: `${MARKET}-${x}` }),
  ),
});

const COLLISION_EXEMPT = {
  prediction_markets: ['winning_answer_id'],
  prediction_answers: ['market_id'],
  prediction_stakes: ['market_id', 'answer_id'],
  prediction_questions: ['market_id'],
};
const A = `${MARKET}-a`;

describe('SupabasePredictionRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabasePredictionRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      collisionExempt: COLLISION_EXEMPT,
      rpc: {
        place_prediction_stake: { data: inA({ id: 'stake-2' }) },
        pay_prediction_market: { data: inA(market({ id: A, status: 'paid' })) },
        void_prediction_market: {
          data: inA(market({ id: A, status: 'voided' })),
        },
      },
    });
    repo = new SupabasePredictionRepository(harness.client);
  });

  it('findMarket reads only inside the chapter', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findMarket(CHAPTER_A, A),
    );
    expect(found).toEqual(expect.objectContaining({ chapter_id: CHAPTER_A }));
  });

  it('findMarketByClientMessageId reads only inside the chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findMarketByClientMessageId(CHAPTER_B, KEY),
    );
  });

  it('listMarkets, listAnswers, listStakes and listOpenQuestions read only inside the chapter', async () => {
    const markets = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.listMarkets(CHAPTER_A, { statuses: ['settled'], limit: 10 }),
    );
    expect(markets).toHaveLength(1);
    expect(
      await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.listAnswers(CHAPTER_A, [A]),
      ),
    ).toHaveLength(1);
    expect(
      await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.listStakes(CHAPTER_A, [A]),
      ),
    ).toHaveLength(1);
    expect(
      await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.listOpenQuestions(CHAPTER_A, [A]),
      ),
    ).toHaveLength(1);
  });

  it('listMarketIdsStakedBy returns each market once, from the chapter only', async () => {
    const ids = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.listMarketIdsStakedBy(CHAPTER_A, USER_SHARED),
    );
    expect(ids).toEqual([A]);
  });

  it('updateMarketStatus changes only the chapter’s market, and only from the given statuses', async () => {
    const updated = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.updateMarketStatus(CHAPTER_A, A, ['settled'], {
        status: 'questioned',
      }),
    );
    expect(updated).toEqual(
      expect.objectContaining({ chapter_id: CHAPTER_A, status: 'questioned' }),
    );
    // Someone got there first: the status is no longer one of the given.
    await expect(
      repo.updateMarketStatus(CHAPTER_A, A, ['open'], { status: 'settled' }),
    ).resolves.toBeNull();
  });

  it('createMarket writes the market and its answers into the chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.createMarket(
        {
          chapter_id: CHAPTER_B,
          channel_id: CHANNEL,
          created_by: USER_SHARED,
          settler_id: USER_SHARED,
          named_member_id: null,
          question: 'Another?',
          settle_rule: 'Rule',
          closes_at: '2026-11-20T18:00:00.000Z',
          status: 'open',
          client_message_id: null,
        },
        ['Yes', 'No'],
      ),
    );
    const answers = harness
      .rows('prediction_answers')
      .filter(
        (a) => a.chapter_id === CHAPTER_B && a.market_id !== `${MARKET}-b`,
      );
    expect(answers.map((a) => [a.label, a.position])).toEqual([
      ['Yes', 0],
      ['No', 1],
    ]);
  });

  it('findStakeByClientMessageId reads only inside the chapter', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findStakeByClientMessageId(CHAPTER_A, KEY),
    );
    expect(found).toEqual(expect.objectContaining({ chapter_id: CHAPTER_A }));
  });

  it('deleteAwaitingConsent removes only the chapter’s market, and only while it waits', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.deleteAwaitingConsent(CHAPTER_A, A),
      ),
    ).resolves.toBe(false);
    expect(harness.rows('prediction_markets')).toHaveLength(2);
  });

  it('listMarkets narrows by ids and creator inside the chapter', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.listMarkets(CHAPTER_A, {
        ids: [A],
        createdBy: USER_SHARED,
        limit: 5,
      }),
    );
    expect(rows.map((r) => r.id)).toEqual([A]);
    await expect(
      repo.listMarkets(CHAPTER_A, { ids: [], limit: 5 }),
    ).resolves.toEqual([]);
  });

  it('addQuestion writes into the chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.addQuestion(CHAPTER_A, A, USER_SHARED, 'Look again'),
    );
  });

  it('passes the chapter to every money function', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.placeStake({
        chapterId: CHAPTER_A,
        marketId: A,
        answerId: 'answer-yes',
        userId: USER_SHARED,
        amount: 3,
        clientMessageId: KEY,
        since: null,
        maxStake: 25,
      }),
    );
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.pay(CHAPTER_A, A, null, { unquestionedOnly: true }),
    );
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.void(CHAPTER_A, A, USER_SHARED, { beforePayoutOnly: true }),
    );
    expect(harness.rpcCalls.map((c) => [c.fn, c.args.p_chapter_id])).toEqual([
      ['place_prediction_stake', CHAPTER_A],
      ['pay_prediction_market', CHAPTER_A],
      ['void_prediction_market', CHAPTER_A],
    ]);
    expect(harness.rpcCalls[1].args.p_unquestioned_only).toBe(true);
    expect(harness.rpcCalls[2].args.p_before_payout_only).toBe(true);
  });

  // One sweep serves every chapter; each market it returns is then paid in
  // its own chapter (`PredictionService.payDueMarkets`).
  it('listPayable reads across chapters on purpose', async () => {
    const due = await repo.listPayable('2026-11-18T00:00:00.000Z', 10);
    expect(due.map((m) => m.chapter_id).sort()).toEqual(
      [CHAPTER_A, CHAPTER_B].sort(),
    );
  });
});

describe('SupabasePredictionRepository — refusals', () => {
  const build = (error: unknown) =>
    new SupabasePredictionRepository(
      createTenantHarness({
        tables: {},
        rpc: { void_prediction_market: { data: null, error } },
      }).client,
    );

  it('turns a known raised code into a PredictionRefusal', async () => {
    const repo = build({ code: 'P0001', message: 'prediction.market.voided' });
    await expect(repo.void(CHAPTER_A, MARKET, USER_SHARED)).rejects.toEqual(
      new PredictionRefusal('prediction.market.voided'),
    );
  });

  it('leaves an unknown error a query error', async () => {
    const repo = build({ code: '57014', message: 'canceling statement' });
    await expect(
      repo.void(CHAPTER_A, MARKET, USER_SHARED),
    ).rejects.toBeInstanceOf(SupabaseQueryError);
  });
});
