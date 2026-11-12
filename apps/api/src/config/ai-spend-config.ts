import type { AiProvider } from '#domain/adapters/language-model.interface';
import type { AiSpendCaps } from '#domain/repositories/ai-usage.repository.interface';

type Env = Record<string, unknown>;

/**
 * The AI spend caps (#714, `spec/behavior/billing.md` § AI Usage Pricing),
 * in US dollars, each overridable by an environment variable.
 *
 * Every default is a guard for the beta, not a price: nothing has been
 * measured yet, and billing.md says the allowance is read off real usage, not
 * chosen. They are sized from the research's per-chapter estimate (about $8 a
 * month on Sonnet, $25 at the 90th percentile, 2026-10-08 on #714) and from
 * the provider credits ADR-28 plans on ($200 a month of Anthropic credit, of
 * which the evals take about $50).
 *
 * The chapter cap stands for the allowance plus the overage cap. While the
 * overage cap is $0, billing.md's default, it is the allowance alone, so no
 * chapter can run up a bill. A cap the treasurer sets per chapter (#1310)
 * replaces this default for that chapter.
 */
const AI_SPEND_CAP_DEFAULTS_USD = {
  AI_CHAPTER_MONTHLY_CAP_USD: 25,
  AI_MEMBER_DAILY_CAP_USD: 2,
  AI_ANTHROPIC_MONTHLY_CAP_USD: 150,
  AI_GOOGLE_MONTHLY_CAP_USD: 50,
  // Transcription only (#712): about 100 hours of meetings a month at the
  // catalog's price, which is ten chapters each recording two a week.
  AI_ASSEMBLYAI_MONTHLY_CAP_USD: 25,
} as const;

type CapVariable = keyof typeof AI_SPEND_CAP_DEFAULTS_USD;

/** The platform's monthly cap variable for each provider that costs money. */
const PLATFORM_CAP_VARIABLE: Record<AiProvider, CapVariable | null> = {
  anthropic: 'AI_ANTHROPIC_MONTHLY_CAP_USD',
  google: 'AI_GOOGLE_MONTHLY_CAP_USD',
  assemblyai: 'AI_ASSEMBLYAI_MONTHLY_CAP_USD',
  // Scripted replies cost nothing, so no account can be overspent. Its calls
  // still count against the chapter's and the member's caps at catalog
  // prices, which is how a local run exercises those.
  scripted: null,
};

/** A dollar amount: digits, at most six decimals, nothing else. */
const DOLLARS = /^\d{1,7}(\.\d{1,6})?$/;

function dollarsToMicroUsd(value: string): number {
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 1_000_000 + Number(fraction.padEnd(6, '0'));
}

function capMicroUsd(env: Env, variable: CapVariable): number {
  const raw = env[variable];
  if (typeof raw === 'string' && DOLLARS.test(raw.trim())) {
    return dollarsToMicroUsd(raw.trim());
  }
  // Unset or empty. A malformed value fails boot (`validateAiSpendEnv`).
  return AI_SPEND_CAP_DEFAULTS_USD[variable] * 1_000_000;
}

/** The caps a call by `provider` is held against, read on each call. */
export function aiSpendCaps(
  provider: AiProvider,
  env: Env = process.env,
): AiSpendCaps {
  const platformVariable = PLATFORM_CAP_VARIABLE[provider];
  return {
    chapterMonthlyMicroUsd: capMicroUsd(env, 'AI_CHAPTER_MONTHLY_CAP_USD'),
    memberDailyMicroUsd: capMicroUsd(env, 'AI_MEMBER_DAILY_CAP_USD'),
    platformMonthlyMicroUsd:
      platformVariable === null ? null : capMicroUsd(env, platformVariable),
  };
}

/**
 * Boot-time checks, called from `validateEnv`. A cap that is set must be a
 * plain dollar amount: a typo must not quietly fall back to the default.
 */
export function validateAiSpendEnv(env: Env): string[] {
  const problems: string[] = [];
  for (const variable of Object.keys(
    AI_SPEND_CAP_DEFAULTS_USD,
  ) as CapVariable[]) {
    const raw = env[variable];
    if (raw === undefined || raw === '') continue;
    if (typeof raw !== 'string' || !DOLLARS.test(raw.trim())) {
      problems.push(
        `${variable} must be a dollar amount such as "25" or "2.50" when set.`,
      );
    }
  }
  return problems;
}
