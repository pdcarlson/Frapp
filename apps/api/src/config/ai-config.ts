import { isProductionSupabaseUrl } from '@repo/validation';

type Env = Record<string, unknown>;

/**
 * The server switch for every AI feature (ADR-28, the AI build's rule that
 * everything ships off).
 *
 * On is exactly `AI_ENABLED=true`. Unset, empty or anything else is off, and
 * off means the API behaves as it did before any AI code existed: every AI
 * route answers 404 `ai.disabled` (`AiEnabledGuard`), the gateway makes no
 * call and asks no seam, and no AI entry point is offered to a client.
 *
 * It is the outermost of the gates, not the only one. With it on, a call
 * still needs the provider's credential, the chapter's switch and the
 * member's yes (`spec/behavior/ai.md` § Consent), and room under the caps.
 */
export function isAiEnabled(env: Env = process.env): boolean {
  return env.AI_ENABLED === 'true';
}

/**
 * Which adapters serve the catalog's tasks.
 *
 * - `live` (the default): each provider's own adapter, where its credential
 *   is set. A task whose provider has none is not available.
 * - `scripted`: every task is answered by the scripted adapter, with canned
 *   replies and no network. For local development, tests and evals.
 */
export type AiProviderMode = 'live' | 'scripted';

export function aiProviderMode(env: Env = process.env): AiProviderMode {
  return env.AI_PROVIDER === 'scripted' ? 'scripted' : 'live';
}

/**
 * Boot-time checks, called from `validateEnv`. A typo in a switch must not
 * read as "off" (or, worse, as "live") without anyone noticing.
 */
export function validateAiEnv(env: Env): string[] {
  const problems: string[] = [];
  const enabled = env.AI_ENABLED;
  if (
    enabled !== undefined &&
    enabled !== '' &&
    enabled !== 'true' &&
    enabled !== 'false'
  ) {
    problems.push('AI_ENABLED must be "true" or "false" when set.');
  }
  const provider = env.AI_PROVIDER;
  if (
    provider !== undefined &&
    provider !== '' &&
    provider !== 'live' &&
    provider !== 'scripted'
  ) {
    problems.push('AI_PROVIDER must be "live" or "scripted" when set.');
  }
  // Canned replies must never reach a real chapter as if a model wrote them.
  if (
    provider === 'scripted' &&
    typeof env.SUPABASE_URL === 'string' &&
    isProductionSupabaseUrl(env.SUPABASE_URL)
  ) {
    problems.push(
      'AI_PROVIDER=scripted is refused against the production database: the scripted adapter returns canned text.',
    );
  }
  return problems;
}
