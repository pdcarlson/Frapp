import { isProductionSupabaseUrl } from '@repo/validation';
import { isAiEnabled } from '#domain/utils/ai-enabled';

type Env = Record<string, unknown>;

// The switch itself is domain code (`#domain/utils/ai-enabled`), so every
// layer reads the same definition. Re-exported for this file's callers.
export { isAiEnabled };

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
