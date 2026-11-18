import { aiSpendCaps, validateAiSpendEnv } from './ai-spend-config';

describe('ai-spend-config', () => {
  it('uses the defaults when nothing is set', () => {
    expect(aiSpendCaps('anthropic', {})).toEqual({
      chapterMonthlyMicroUsd: 50_000_000,
      memberDailyMicroUsd: 10_000_000,
      platformMonthlyMicroUsd: 150_000_000,
    });
    expect(aiSpendCaps('google', {}).platformMonthlyMicroUsd).toBe(50_000_000);
    expect(aiSpendCaps('scripted', {}).platformMonthlyMicroUsd).toBeNull();
  });

  it('reads dollars exactly, to the micro-dollar', () => {
    const env = {
      AI_CHAPTER_MONTHLY_CAP_USD: '12.345678',
      AI_MEMBER_DAILY_CAP_USD: '0',
      AI_GOOGLE_MONTHLY_CAP_USD: ' 7.5 ',
    };
    expect(aiSpendCaps('google', env)).toEqual({
      chapterMonthlyMicroUsd: 12_345_678,
      memberDailyMicroUsd: 0,
      platformMonthlyMicroUsd: 7_500_000,
    });
  });

  describe('on staging, where the team tests', () => {
    const staging = {
      NODE_ENV: 'staging',
      SUPABASE_URL: 'https://hnoyzpidbmizhbqaiity.supabase.co',
    };

    it('widens the chapter and member caps, and keeps the account cap', () => {
      expect(aiSpendCaps('anthropic', staging)).toEqual({
        chapterMonthlyMicroUsd: 100_000_000,
        memberDailyMicroUsd: 25_000_000,
        platformMonthlyMicroUsd: 150_000_000,
      });
    });

    it('still takes a cap set by its variable', () => {
      expect(
        aiSpendCaps('anthropic', {
          ...staging,
          AI_CHAPTER_MONTHLY_CAP_USD: '40',
          AI_MEMBER_DAILY_CAP_USD: '3',
        }),
      ).toMatchObject({
        chapterMonthlyMicroUsd: 40_000_000,
        memberDailyMicroUsd: 3_000_000,
      });
    });

    it.each([
      [
        'production',
        { NODE_ENV: 'production', SUPABASE_URL: staging.SUPABASE_URL },
      ],
      [
        'staging pointed at the production database',
        {
          NODE_ENV: 'staging',
          SUPABASE_URL: 'https://unttyvyfezddlyafcydh.supabase.co',
        },
      ],
      ['a laptop', { SUPABASE_URL: 'http://127.0.0.1:54321' }],
    ])('keeps the sold defaults on %s', (_where, env) => {
      expect(aiSpendCaps('anthropic', env)).toMatchObject({
        chapterMonthlyMicroUsd: 50_000_000,
        memberDailyMicroUsd: 10_000_000,
      });
    });
  });

  it('accepts unset, empty and plain amounts', () => {
    expect(validateAiSpendEnv({})).toEqual([]);
    expect(
      validateAiSpendEnv({
        AI_CHAPTER_MONTHLY_CAP_USD: '',
        AI_MEMBER_DAILY_CAP_USD: '2.50',
        AI_ANTHROPIC_MONTHLY_CAP_USD: '150',
      }),
    ).toEqual([]);
  });

  it.each(['$25', '25 USD', '-1', '1e3', 'none', '1.1234567'])(
    'fails boot on a malformed cap (%s) rather than falling back',
    (value) => {
      expect(
        validateAiSpendEnv({ AI_ANTHROPIC_MONTHLY_CAP_USD: value }),
      ).toEqual([
        'AI_ANTHROPIC_MONTHLY_CAP_USD must be a dollar amount such as "25" or "2.50" when set.',
      ]);
    },
  );
});
