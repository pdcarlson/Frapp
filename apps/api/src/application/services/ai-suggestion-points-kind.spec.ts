import {
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import {
  POINTS_SUGGESTION_MAX_MEMBERS,
  PointsSuggestionKind,
  pointsSuggestionKey,
  readPointsPayload,
} from './ai-suggestion-points-kind';
import type { PointsService } from './points.service';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const OFFICER = '22222222-2222-4222-8222-222222222222';
const A = '33333333-3333-4333-8333-333333333333';
const B = '44444444-4444-4444-8444-444444444444';
const C = '55555555-5555-4555-8555-555555555555';
const SUGGESTION = '66666666-6666-4666-8666-666666666666';

function build(remaining = 50, used = 0) {
  let seq = 0;
  const points = {
    adjustmentBudget: jest
      .fn()
      .mockResolvedValue({ limit: 50, used, remaining }),
    landedKeys: jest.fn(async (_chapter: string, _keys: string[]) => {
      void _chapter;
      void _keys;
      return new Set<string>();
    }),
    adjustPoints: jest.fn(async (input: { targetUserId: string }) => {
      void input;
      return { id: `txn-${++seq}` };
    }),
  };
  return {
    kind: new PointsSuggestionKind(points as unknown as PointsService),
    points,
  };
}

const payload = (targets: string[], extra: Record<string, unknown> = {}) => ({
  amount: 5,
  reason: 'Attended Chapter Meeting',
  target_user_ids: targets,
  event_id: null,
  event_name: null,
  event_start_time: null,
  ...extra,
});

const commit = (
  kind: PointsSuggestionKind,
  targets: string[],
  extra: Record<string, unknown> = {},
) =>
  kind.commit({
    chapterId: CHAPTER,
    userId: OFFICER,
    suggestionId: SUGGESTION,
    payload: payload(targets, extra),
  });

describe('PointsSuggestionKind', () => {
  it('needs the permission and module of the points route', () => {
    const { kind } = build();
    expect(kind.requiredPermission).toBe('points:adjust');
    expect(kind.module).toBe('points');
    expect(kind.expiresAfterDays).toBe(1);
  });

  describe('normalizeProposal', () => {
    const { kind } = build();

    it('keeps a whole, non-zero amount, a one-line reason and member ids', () => {
      expect(
        kind.normalizeProposal({
          amount: -10,
          reason: '  Missed\n cleanup ',
          target_user_ids: [A, A.toUpperCase(), 'not-an-id', B],
          event_id: 'nope',
        }),
      ).toEqual({
        amount: -10,
        reason: 'Missed cleanup',
        target_user_ids: [A, B],
        event_id: null,
        event_name: null,
        event_start_time: null,
      });
    });

    it.each([
      [{ amount: 0, reason: 'x', target_user_ids: [A] }],
      [{ amount: 1.5, reason: 'x', target_user_ids: [A] }],
      [{ amount: 1e9, reason: 'x', target_user_ids: [A] }],
      [{ amount: 5, reason: '  ', target_user_ids: [A] }],
      [null],
      [[]],
    ])('turns down %j', (raw) => {
      expect(kind.normalizeProposal(raw)).toBeNull();
    });

    it('turns down more members than one proposal may hold', () => {
      const many = Array.from(
        { length: POINTS_SUGGESTION_MAX_MEMBERS + 1 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      );
      expect(
        kind.normalizeProposal({
          amount: 5,
          reason: 'x',
          target_user_ids: many,
        }),
      ).toBeNull();
    });
  });

  describe('applyEdits', () => {
    const { kind } = build();

    it('changes only what was edited', () => {
      expect(
        kind.applyEdits(payload([A, B]), { target_user_ids: [A] }),
      ).toEqual(payload([A]));
      expect(kind.applyEdits(payload([A]), { amount: 10 })).toEqual(
        payload([A], { amount: 10 }),
      );
    });

    it('refuses an amount or a reason that is not one', () => {
      expect(() => kind.applyEdits(payload([A]), { amount: 0 })).toThrow();
      expect(() => kind.applyEdits(payload([A]), { reason: ' ' })).toThrow();
    });
  });

  it('cannot be accepted with nobody on it', () => {
    const { kind } = build();
    expect(() => kind.assertAcceptable(payload([]))).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'ai.suggestion.incomplete' }),
      }),
    );
    expect(() => kind.assertAcceptable(payload([A]))).not.toThrow();
  });

  describe('commit', () => {
    it('adjusts each member through the points service, as the officer who confirmed', async () => {
      const { kind, points } = build();
      const result = await commit(kind, [A, B]);
      expect(result).toEqual({
        resultId: 'txn-1',
        outcome: { adjusted: 2, skipped: 0 },
      });
      expect(points.adjustPoints).toHaveBeenCalledTimes(2);
      expect(points.adjustPoints).toHaveBeenCalledWith({
        chapterId: CHAPTER,
        targetUserId: A,
        adminUserId: OFFICER,
        amount: 5,
        category: 'MANUAL',
        reason: 'Attended Chapter Meeting',
        clientMessageId: pointsSuggestionKey(SUGGESTION, A),
      });
    });

    it('never adjusts the confirming officer, even when a stored row names them', async () => {
      const { kind, points } = build();
      await commit(kind, [OFFICER, A]);
      expect(points.adjustPoints).toHaveBeenCalledTimes(1);
      expect(points.adjustPoints).toHaveBeenCalledWith(
        expect.objectContaining({ targetUserId: A }),
      );
    });

    it('refuses the whole change, before any write, when it is over the hourly limit', async () => {
      const { kind, points } = build(2, 48);
      const refused = commit(kind, [A, B, C]);
      await expect(refused).rejects.toBeInstanceOf(HttpException);
      await expect(refused).rejects.toMatchObject({
        status: 429,
        response: { code: 'ai.suggestion.points.over_limit' },
      });
      expect(points.adjustPoints).not.toHaveBeenCalled();
    });

    it('uses the same key for the same suggestion and member, so a retry cannot grant twice', async () => {
      expect(pointsSuggestionKey(SUGGESTION, A)).toBe(
        pointsSuggestionKey(SUGGESTION, A),
      );
      expect(pointsSuggestionKey(SUGGESTION, A)).not.toBe(
        pointsSuggestionKey(SUGGESTION, B),
      );
      expect(pointsSuggestionKey(SUGGESTION, A)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('leaves out a member who has left, and counts them', async () => {
      const { kind, points } = build();
      points.adjustPoints.mockImplementation(
        async (input: { targetUserId: string }) => {
          if (input.targetUserId === B) throw new NotFoundException();
          if (input.targetUserId === C) throw new ForbiddenException();
          return { id: 'txn-a' };
        },
      );
      expect(await commit(kind, [A, B, C])).toEqual({
        resultId: 'txn-a',
        outcome: { adjusted: 1, skipped: 2 },
      });
    });

    it('fails when some members did not go through, so Confirm can be pressed again', async () => {
      const { kind, points } = build();
      points.adjustPoints.mockImplementation(
        async (input: { targetUserId: string }) => {
          if (input.targetUserId === B) throw new Error('database is down');
          return { id: 'txn-1' };
        },
      );
      await expect(
        kind.commit({
          chapterId: CHAPTER,
          userId: OFFICER,
          suggestionId: SUGGESTION,
          payload: payload([A, B, C]),
        }),
      ).rejects.toMatchObject({
        response: { code: 'ai.suggestion.points.partial' },
      });
      // Every member was still tried: the retry has less left to do.
      expect(points.adjustPoints).toHaveBeenCalledTimes(3);
    });

    it('does not count members a first try already changed against the hourly limit', async () => {
      const { kind, points } = build(1, 49);
      points.landedKeys.mockImplementation(
        async (_chapter: string, keys: string[]) => new Set(keys.slice(0, 2)),
      );
      const result = await kind.commit({
        chapterId: CHAPTER,
        userId: OFFICER,
        suggestionId: SUGGESTION,
        payload: payload([A, B, C]),
      });
      expect(result.outcome).toEqual({ adjusted: 3, skipped: 0 });
    });

    it('fails, so the card goes back to waiting, when nothing landed', async () => {
      const gone = build();
      gone.points.adjustPoints.mockRejectedValue(new NotFoundException());
      await expect(commit(gone.kind, [A, B])).rejects.toMatchObject({
        response: { code: 'ai.suggestion.points.no_members' },
      });

      const down = build();
      down.points.adjustPoints.mockRejectedValue(new Error('db down'));
      await expect(commit(down.kind, [A])).rejects.toThrow('db down');
    });

    it('refuses a change with nobody but the officer on it', async () => {
      const { kind, points } = build();
      await expect(commit(kind, [OFFICER])).rejects.toMatchObject({
        response: { code: 'ai.suggestion.incomplete' },
      });
      expect(points.adjustmentBudget).not.toHaveBeenCalled();
    });
  });

  it('reads a stored payload back defensively', () => {
    expect(
      readPointsPayload({ amount: 'lots', target_user_ids: 'all' }),
    ).toEqual({
      amount: 0,
      reason: '',
      target_user_ids: [],
      event_id: null,
      event_name: null,
      event_start_time: null,
    });
  });
});
