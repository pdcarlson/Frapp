import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PredictionService,
  QUESTION_WINDOW_MS,
  summarize,
  type PredictionActor,
} from './prediction.service';
import type { ChannelAccessService } from './channel-access.service';
import type { ChapterPointsConfigService } from './chapter-points-config.service';
import type { PointsService } from './points.service';
import type { RbacService } from './rbac.service';
import {
  PredictionRefusal,
  type IPredictionRepository,
} from '#domain/repositories/prediction.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type {
  PredictionAnswer,
  PredictionMarket,
  PredictionStake,
} from '#domain/entities/prediction.entity';
import * as caughtFailure from '../../infrastructure/observability/report-caught-failure';

const CHAPTER = 'chapter-1';
const CREATOR = 'user-creator';
const SETTLER = 'user-settler';
const MEMBER = 'user-member';
const NAMED = 'user-named';
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

const market = (
  overrides: Partial<PredictionMarket> = {},
): PredictionMarket => ({
  id: 'market-1',
  chapter_id: CHAPTER,
  channel_id: 'channel-1',
  message_id: null,
  created_by: CREATOR,
  settler_id: SETTLER,
  named_member_id: null,
  question: 'Will we win intramurals?',
  settle_rule: 'The league standings on Friday',
  closes_at: FUTURE,
  status: 'open',
  winning_answer_id: null,
  known_at: null,
  settle_note: null,
  settled_by: null,
  settled_at: null,
  question_window_ends_at: null,
  payout_round: 0,
  paid_at: null,
  voided_by: null,
  voided_at: null,
  client_message_id: null,
  created_at: '2026-11-16T09:00:00.000Z',
  updated_at: '2026-11-16T09:00:00.000Z',
  ...overrides,
});

const answer = (id: string, position: number): PredictionAnswer => ({
  id,
  market_id: 'market-1',
  chapter_id: CHAPTER,
  label: id,
  position,
});

const stake = (
  user_id: string,
  answer_id: string,
  amount: number,
): PredictionStake => ({
  id: `${user_id}-${answer_id}-${amount}`,
  chapter_id: CHAPTER,
  market_id: 'market-1',
  answer_id,
  user_id,
  amount,
  point_transaction_id: 'txn',
  client_message_id: 'key',
  created_at: '2026-11-16T09:30:00.000Z',
});

const actor = (
  userId: string,
  enabledModules: PredictionActor['enabledModules'] = { predictions: true },
): PredictionActor => ({ chapterId: CHAPTER, userId, enabledModules });

function build() {
  const repo: jest.Mocked<IPredictionRepository> = {
    findMarket: jest.fn().mockResolvedValue(market()),
    findMarketByClientMessageId: jest.fn().mockResolvedValue(null),
    listMarkets: jest.fn().mockResolvedValue([]),
    listAnswers: jest
      .fn()
      .mockResolvedValue([answer('yes', 0), answer('no', 1)]),
    listStakes: jest.fn().mockResolvedValue([]),
    listMarketIdsStakedBy: jest.fn().mockResolvedValue([]),
    listOpenQuestions: jest.fn().mockResolvedValue([]),
    findStakeByClientMessageId: jest.fn().mockResolvedValue(null),
    deleteAwaitingConsent: jest.fn().mockResolvedValue(true),
    createMarket: jest
      .fn()
      .mockImplementation((input) => Promise.resolve(market(input))),
    updateMarketStatus: jest
      .fn()
      .mockImplementation((_c, _m, _from, patch) =>
        Promise.resolve(market(patch)),
      ),
    addQuestion: jest.fn().mockResolvedValue({}),
    listPayable: jest.fn().mockResolvedValue([]),
    placeStake: jest.fn().mockResolvedValue(stake(MEMBER, 'yes', 5)),
    pay: jest.fn().mockResolvedValue(market({ status: 'paid' })),
    void: jest.fn().mockResolvedValue(market({ status: 'voided' })),
  };
  const memberRepo = {
    findByUserAndChapter: jest.fn().mockResolvedValue({ id: 'member' }),
  };
  const channelAccess = {
    assertChannelAccess: jest.fn().mockResolvedValue({}),
    filterAccessibleChannelIds: jest
      .fn()
      .mockImplementation((_c, _u, ids: string[]) =>
        Promise.resolve(new Set(ids)),
      ),
  };
  const pointsConfig = {
    getConfig: jest.fn().mockResolvedValue({
      adjustment_rate_limit_per_hour: 50,
      anomaly_threshold: 100,
      prediction_max_stake: 25,
    }),
  };
  const points = {
    getActiveSemesterSince: jest
      .fn()
      .mockResolvedValue(new Date('2026-08-20T00:00:00.000Z')),
  };
  const rbac = { isAlumni: jest.fn().mockResolvedValue(false) };
  const service = new PredictionService(
    repo,
    memberRepo as unknown as IMemberRepository,
    channelAccess as unknown as ChannelAccessService,
    pointsConfig as unknown as ChapterPointsConfigService,
    points as unknown as PointsService,
    rbac as unknown as RbacService,
  );
  return { service, repo, memberRepo, channelAccess, rbac };
}

const NOT_OFFICER = { manages: false };
const OFFICER = { manages: true };

const createInput = {
  channelId: 'channel-1',
  question: '  Will we win intramurals?  ',
  settleRule: 'The league standings on Friday',
  answers: ['Yes', 'No'],
  closesAt: FUTURE,
};

describe('PredictionService', () => {
  describe('assertEnabled', () => {
    const { service } = build();

    it('is off unless the chapter turned predictions on', () => {
      expect(() => service.assertEnabled(null)).toThrow(ForbiddenException);
      expect(() => service.assertEnabled({})).toThrow(ForbiddenException);
      expect(() => service.assertEnabled({ predictions: true })).not.toThrow();
    });

    it('needs Points on too, since the stake is points', () => {
      expect(() =>
        service.assertEnabled({ predictions: true, points: false }),
      ).toThrow(ForbiddenException);
    });
  });

  describe('create', () => {
    it('opens a question at once, settled by its creator by default', async () => {
      const { service, repo, channelAccess } = build();
      await service.create(actor(CREATOR), createInput);
      expect(channelAccess.assertChannelAccess).toHaveBeenCalledWith(
        'channel-1',
        CHAPTER,
        CREATOR,
        'post',
      );
      expect(repo.createMarket).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: CHAPTER,
          created_by: CREATOR,
          settler_id: CREATOR,
          question: 'Will we win intramurals?',
          status: 'open',
        }),
        ['Yes', 'No'],
      );
    });

    it('waits for the consent of a member the question names', async () => {
      const { service, repo } = build();
      await service.create(actor(CREATOR), {
        ...createInput,
        namedMemberId: NAMED,
      });
      expect(repo.createMarket).toHaveBeenCalledWith(
        expect.objectContaining({
          named_member_id: NAMED,
          status: 'awaiting_consent',
        }),
        ['Yes', 'No'],
      );
    });

    it('refuses a settler from outside the chapter', async () => {
      const { service, memberRepo } = build();
      memberRepo.findByUserAndChapter.mockResolvedValue(null);
      await expect(
        service.create(actor(CREATOR), { ...createInput, settlerId: SETTLER }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      ['one answer', { answers: ['Yes'] }],
      ['a blank answer', { answers: ['Yes', '  '] }],
      ['two answers alike', { answers: ['Yes', ' yes'] }],
      ['a question of only spaces', { question: '   ' }],
      ['a close time already past', { closesAt: '2020-01-01T00:00:00Z' }],
      [
        'a named member who also settles',
        { namedMemberId: SETTLER, settlerId: SETTLER },
      ],
    ])('refuses %s', async (_name, patch) => {
      const { service, repo } = build();
      await expect(
        service.create(actor(CREATOR), { ...createInput, ...patch }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.createMarket).not.toHaveBeenCalled();
    });

    it('returns the same question for a replayed key, and refuses someone else’s', async () => {
      const { service, repo } = build();
      repo.findMarketByClientMessageId.mockResolvedValue(
        market({ created_by: CREATOR, client_message_id: 'k' }),
      );
      const view = await service.create(actor(CREATOR), {
        ...createInput,
        clientMessageId: 'k',
      });
      expect(view.market.client_message_id).toBe('k');
      expect(repo.createMarket).not.toHaveBeenCalled();
      await expect(
        service.create(actor(MEMBER), { ...createInput, clientMessageId: 'k' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses when the module is off', async () => {
      const { service } = build();
      await expect(
        service.create(actor(CREATOR, null), createInput),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('reading', () => {
    it('hides a question waiting on consent from everyone but its creator and the named member', async () => {
      const { service, repo } = build();
      repo.listMarkets.mockResolvedValue([
        market({ id: 'open' }),
        market({
          id: 'waiting',
          status: 'awaiting_consent',
          named_member_id: NAMED,
        }),
      ]);
      const ids = async (who: string) =>
        (await service.list(actor(who), 'open')).map((v) => v.market.id);
      expect(await ids(MEMBER)).toEqual(['open']);
      expect(await ids(NAMED)).toEqual(['open', 'waiting']);
      expect(await ids(CREATOR)).toEqual(['open', 'waiting']);

      repo.findMarket.mockResolvedValue(
        market({ status: 'awaiting_consent', named_member_id: NAMED }),
      );
      await expect(
        service.get(actor(MEMBER), 'market-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('leaves out questions in channels the member cannot see', async () => {
      const { service, repo, channelAccess } = build();
      repo.listMarkets.mockResolvedValue([
        market({ id: 'seen', channel_id: 'general' }),
        market({ id: 'hidden', channel_id: 'exec' }),
      ]);
      channelAccess.filterAccessibleChannelIds.mockResolvedValue(
        new Set(['general']),
      );
      const views = await service.list(actor(MEMBER), 'all');
      expect(views.map((v) => v.market.id)).toEqual(['seen']);
    });

    it('lists the questions a member staked on or asked under mine', async () => {
      const { service, repo } = build();
      repo.listMarketIdsStakedBy.mockResolvedValue(['staked']);
      repo.listMarkets.mockImplementation((_c, options) =>
        Promise.resolve(
          options.ids
            ? [market({ id: 'staked', created_at: '2026-11-01T00:00:00Z' })]
            : [market({ id: 'asked', created_by: MEMBER })],
        ),
      );
      const views = await service.list(actor(MEMBER), 'mine');
      expect(views.map((v) => v.market.id)).toEqual(['asked', 'staked']);
      expect(repo.listMarkets).toHaveBeenCalledWith(
        CHAPTER,
        expect.objectContaining({ ids: ['staked'] }),
      );
    });

    it('looks up whether the viewer is alumni once per list, not once per question', async () => {
      const { service, repo, rbac } = build();
      repo.listMarkets.mockResolvedValue([
        market({ id: 'a' }),
        market({ id: 'b' }),
        market({ id: 'c' }),
      ]);
      await service.list(actor(MEMBER), 'open');
      expect(rbac.isAlumni).toHaveBeenCalledTimes(1);
    });
  });

  describe('stake', () => {
    const input = { answerId: 'yes', amount: 5, clientMessageId: 'key' };

    it('passes the cap and this semester’s window to the stake function', async () => {
      const { service, repo, channelAccess } = build();
      await service.stake(actor(MEMBER), 'market-1', input);
      expect(channelAccess.assertChannelAccess).toHaveBeenCalledWith(
        'channel-1',
        CHAPTER,
        MEMBER,
        'vote',
      );
      expect(repo.placeStake).toHaveBeenCalledWith({
        chapterId: CHAPTER,
        marketId: 'market-1',
        answerId: 'yes',
        userId: MEMBER,
        amount: 5,
        clientMessageId: 'key',
        since: '2026-08-20T00:00:00.000Z',
        maxStake: 25,
      });
    });

    it.each([
      ['its creator', CREATOR, market(), false],
      ['its settler', SETTLER, market(), false],
      ['the member it names', NAMED, market({ named_member_id: NAMED }), false],
      ['an alumnus', MEMBER, market(), true],
      [
        'anyone, once it closed',
        MEMBER,
        market({ closes_at: '2020-01-01T00:00:00Z' }),
        false,
      ],
      [
        'anyone, while it waits on consent',
        MEMBER,
        market({ status: 'awaiting_consent', named_member_id: MEMBER }),
        false,
      ],
    ])('refuses %s', async (_name, who, found, alumni) => {
      const { service, repo, rbac } = build();
      repo.findMarket.mockResolvedValue(found);
      rbac.isAlumni.mockResolvedValue(alumni);
      await expect(
        service.stake(actor(who), 'market-1', input),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.placeStake).not.toHaveBeenCalled();
    });

    it.each([
      ['prediction.stake.over_cap', BadRequestException, /up to 25 points/],
      [
        'prediction.stake.insufficient_points',
        BadRequestException,
        /this semester/,
      ],
      ['prediction.stake.key_reused', ConflictException, /key/],
      ['prediction.market.not_open', ConflictException, /closed/],
      ['prediction.answer.not_found', NotFoundException, /answer/],
    ] as const)(
      'turns %s into a readable refusal',
      async (code, type, message) => {
        const { service, repo } = build();
        repo.placeStake.mockRejectedValue(new PredictionRefusal(code));
        const err = await service
          .stake(actor(MEMBER), 'market-1', input)
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(type);
        expect((err as Error).message).toMatch(message);
      },
    );
  });

  describe('stake replay', () => {
    const input = { answerId: 'yes', amount: 5, clientMessageId: 'key' };

    it('returns the original result for a replayed key, even after the question closed', async () => {
      const { service, repo } = build();
      repo.findStakeByClientMessageId.mockResolvedValue(
        stake(MEMBER, 'yes', 5),
      );
      repo.findMarket.mockResolvedValue(
        market({ closes_at: '2020-01-01T00:00:00Z' }),
      );
      await expect(
        service.stake(actor(MEMBER), 'market-1', input),
      ).resolves.toEqual(expect.objectContaining({ total_staked: 0 }));
      expect(repo.placeStake).not.toHaveBeenCalled();
    });

    it('refuses a key already used for a different stake', async () => {
      const { service, repo } = build();
      repo.findStakeByClientMessageId.mockResolvedValue(stake(MEMBER, 'no', 5));
      await expect(
        service.stake(actor(MEMBER), 'market-1', input),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('consent', () => {
    it('opens the question when the named member agrees, and removes it when they decline', async () => {
      const { service, repo } = build();
      repo.findMarket.mockResolvedValue(
        market({ status: 'awaiting_consent', named_member_id: NAMED }),
      );
      await service.consent(actor(NAMED), 'market-1', true);
      expect(repo.updateMarketStatus).toHaveBeenLastCalledWith(
        CHAPTER,
        'market-1',
        ['awaiting_consent'],
        { status: 'open' },
      );
      // Declining removes it, so the chapter never sees a question its
      // subject refused.
      await expect(
        service.consent(actor(NAMED), 'market-1', false),
      ).resolves.toBeNull();
      expect(repo.deleteAwaitingConsent).toHaveBeenCalledWith(
        CHAPTER,
        'market-1',
      );
    });

    it('answers only to the member it names', async () => {
      const { service, repo } = build();
      repo.findMarket.mockResolvedValue(
        market({ status: 'awaiting_consent', named_member_id: NAMED }),
      );
      await expect(
        service.consent(actor(CREATOR), 'market-1', true),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('settle', () => {
    it('lets only the settler name the winner, and opens a 24-hour window', async () => {
      const { service, repo } = build();
      await expect(
        service.settle(
          actor(CREATOR),
          'market-1',
          { answerId: 'yes' },
          NOT_OFFICER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const before = Date.now();
      await service.settle(
        actor(SETTLER),
        'market-1',
        { answerId: 'yes' },
        NOT_OFFICER,
      );
      const patch = repo.updateMarketStatus.mock.calls[0][3];
      expect(repo.updateMarketStatus.mock.calls[0][2]).toEqual(['open']);
      expect(patch).toEqual(
        expect.objectContaining({
          status: 'settled',
          winning_answer_id: 'yes',
          settled_by: SETTLER,
        }),
      );
      const windowEnds = new Date(patch.question_window_ends_at!).getTime();
      expect(windowEnds - before).toBeGreaterThanOrEqual(QUESTION_WINDOW_MS);
    });

    it('refuses an answer from another question, and a known time in the future', async () => {
      const { service } = build();
      await expect(
        service.settle(
          actor(SETTLER),
          'market-1',
          { answerId: 'maybe' },
          NOT_OFFICER,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.settle(
          actor(SETTLER),
          'market-1',
          { answerId: 'yes', knownAt: FUTURE },
          NOT_OFFICER,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('says so when someone settled or voided it first', async () => {
      const { service, repo } = build();
      repo.updateMarketStatus.mockResolvedValue(null);
      await expect(
        service.settle(
          actor(SETTLER),
          'market-1',
          { answerId: 'yes' },
          NOT_OFFICER,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('question', () => {
    const settled = (endsIn: number) =>
      market({
        status: 'settled',
        winning_answer_id: 'yes',
        question_window_ends_at: new Date(Date.now() + endsIn).toISOString(),
      });

    it('lets a staker question a result inside the window', async () => {
      const { service, repo } = build();
      repo.findMarket.mockResolvedValue(settled(60_000));
      repo.listStakes.mockResolvedValue([stake(MEMBER, 'yes', 5)]);
      await service.question(actor(MEMBER), 'market-1', 'The score was wrong');
      expect(repo.addQuestion).toHaveBeenCalledWith(
        CHAPTER,
        'market-1',
        MEMBER,
        'The score was wrong',
      );
      expect(repo.updateMarketStatus).toHaveBeenCalledWith(
        CHAPTER,
        'market-1',
        ['settled', 'questioned'],
        { status: 'questioned' },
      );
    });

    it('refuses a member who did not stake, and anyone after the window', async () => {
      const { service, repo } = build();
      repo.findMarket.mockResolvedValue(settled(60_000));
      await expect(
        service.question(actor(MEMBER), 'market-1', 'Hm'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      repo.findMarket.mockResolvedValue(settled(-60_000));
      repo.listStakes.mockResolvedValue([stake(MEMBER, 'yes', 5)]);
      await expect(
        service.question(actor(MEMBER), 'market-1', 'Hm'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('question races', () => {
    it('files nothing when the sweep paid the market first', async () => {
      const { service, repo } = build();
      repo.findMarket.mockResolvedValue(
        market({
          status: 'settled',
          question_window_ends_at: new Date(Date.now() + 1000).toISOString(),
        }),
      );
      repo.listStakes.mockResolvedValue([stake(MEMBER, 'yes', 5)]);
      repo.updateMarketStatus.mockResolvedValue(null);
      await expect(
        service.question(actor(MEMBER), 'market-1', 'Late'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.addQuestion).not.toHaveBeenCalled();
    });
  });

  describe('officer settle and confirm', () => {
    it('lets an officer with nothing staked settle, and not one who staked', async () => {
      const { service, repo } = build();
      await service.settle(
        actor(MEMBER),
        'market-1',
        { answerId: 'yes' },
        OFFICER,
      );
      expect(repo.updateMarketStatus).toHaveBeenCalledTimes(1);

      repo.listStakes.mockResolvedValue([stake(MEMBER, 'no', 5)]);
      await expect(
        service.settle(actor(MEMBER), 'market-1', { answerId: 'yes' }, OFFICER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('confirms a questioned result, and pays it in the market’s chapter', async () => {
      const { service, repo, channelAccess } = build();
      repo.findMarket.mockResolvedValue(market({ status: 'questioned' }));
      await service.confirm(actor(MEMBER), 'market-1', 'no');
      expect(channelAccess.assertChannelAccess).toHaveBeenCalled();
      expect(repo.pay).toHaveBeenCalledWith(CHAPTER, 'market-1', 'no');
    });

    it('works with the module off, so a stake is never stranded', async () => {
      const { service, repo } = build();
      repo.findMarket.mockResolvedValue(market({ status: 'questioned' }));
      await service.confirm(actor(MEMBER, {}), 'market-1', null);
      expect(repo.pay).toHaveBeenCalled();
      await service.void(actor(MEMBER, {}), 'market-1', OFFICER);
      expect(repo.void).toHaveBeenCalled();
      await service.get(actor(MEMBER, {}), 'market-1');
    });

    it('won’t cut an unquestioned window short', async () => {
      const { service, repo } = build();
      repo.findMarket.mockResolvedValue(
        market({
          status: 'settled',
          question_window_ends_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      );
      await expect(
        service.confirm(actor(MEMBER), 'market-1', null),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.pay).not.toHaveBeenCalled();
    });

    it('refuses an officer who staked on it', async () => {
      const { service, repo } = build();
      repo.findMarket.mockResolvedValue(market({ status: 'paid' }));
      repo.listStakes.mockResolvedValue([stake(MEMBER, 'no', 5)]);
      await expect(
        service.confirm(actor(MEMBER), 'market-1', 'no'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.pay).not.toHaveBeenCalled();
    });
  });

  describe('void', () => {
    it('lets the settler void before payout, and only predictions:manage after', async () => {
      const { service, repo } = build();
      await service.void(actor(SETTLER), 'market-1', { manages: false });
      // The function re-checks payout under its lock for the settler.
      expect(repo.void).toHaveBeenCalledWith(CHAPTER, 'market-1', SETTLER, {
        beforePayoutOnly: true,
      });

      repo.findMarket.mockResolvedValue(market({ status: 'paid' }));
      await expect(
        service.void(actor(SETTLER), 'market-1', { manages: false }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await service.void(actor(MEMBER), 'market-1', { manages: true });
      expect(repo.void).toHaveBeenLastCalledWith(CHAPTER, 'market-1', MEMBER, {
        beforePayoutOnly: false,
      });
    });

    it('refuses any other member', async () => {
      const { service } = build();
      await expect(
        service.void(actor(MEMBER), 'market-1', { manages: false }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('payDueMarkets', () => {
    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('pays each due market in its own chapter, skipping one questioned meanwhile', async () => {
      const { service, repo } = build();
      const reported = jest
        .spyOn(caughtFailure, 'reportCaughtFailure')
        .mockImplementation(() => undefined);
      repo.listPayable.mockResolvedValue([
        market({ id: 'm1', chapter_id: 'c1', status: 'settled' }),
        market({ id: 'm2', chapter_id: 'c2', status: 'settled' }),
        market({ id: 'm3', chapter_id: 'c3', status: 'settled' }),
      ]);
      repo.pay
        .mockResolvedValueOnce(market({ status: 'paid' }))
        .mockRejectedValueOnce(
          new PredictionRefusal('prediction.market.questioned'),
        )
        .mockRejectedValueOnce(new Error('connection reset'));

      await expect(service.payDueMarkets(new Date())).resolves.toBe(1);
      expect(repo.pay.mock.calls).toEqual([
        ['c1', 'm1', null, { unquestionedOnly: true }],
        ['c2', 'm2', null, { unquestionedOnly: true }],
        ['c3', 'm3', null, { unquestionedOnly: true }],
      ]);
      expect(reported).toHaveBeenCalledTimes(1);
    });
  });
});

describe('summarize', () => {
  it('derives each answer’s pool and chance, and totals stakes per member', () => {
    const result = summarize(
      [answer('yes', 0), answer('no', 1)],
      [stake('a', 'yes', 10), stake('a', 'yes', 5), stake('b', 'no', 5)],
      'a',
    );
    expect(result.total_staked).toBe(20);
    expect(result.answers).toEqual([
      { id: 'yes', label: 'yes', pool: 15, chance: 75 },
      { id: 'no', label: 'no', pool: 5, chance: 25 },
    ]);
    expect(result.my_stakes).toEqual([
      { user_id: 'a', answer_id: 'yes', amount: 15 },
    ]);
    expect(result.stakers).toHaveLength(2);
  });

  it('shows no chance before anyone stakes', () => {
    const result = summarize([answer('yes', 0)], [], 'a');
    expect(result.answers[0].chance).toBeNull();
  });
});
