import { aiSpendCaps, validateAiSpendEnv } from './ai-spend-config';

describe('ai-spend-config', () => {
  it('uses the defaults when nothing is set', () => {
    expect(aiSpendCaps('anthropic', {})).toEqual({
      chapterMonthlyMicroUsd: 25_000_000,
      memberDailyMicroUsd: 2_000_000,
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
